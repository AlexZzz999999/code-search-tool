import type {
  JavaFileIndex,
  JavaSymbol,
  JavaSymbolKind,
  ResolutionTarget,
  SearchQuery,
  SearchResult,
  SymbolResolution
} from "./types.js";
import { indexJavaWorkspace } from "./indexer.js";

const TYPE_DEFINITION_KINDS = new Set<JavaSymbolKind>([
  "class",
  "interface",
  "enum",
  "record",
  "annotation"
]);

export class JavaCodeSearchEngine {
  private readonly files = new Map<string, JavaFileIndex>();
  private readonly definitionsByQualifiedName = new Map<string, JavaSymbol>();
  private readonly definitionsBySimpleName = new Map<string, JavaSymbol[]>();
  private readonly methodsByTypeName = new Map<string, JavaSymbol[]>();

  constructor(initialFiles: JavaFileIndex[] = []) {
    for (const entry of initialFiles) {
      this.files.set(entry.filePath, entry);
    }
    this.rebuildDefinitionIndexes();
  }

  static async fromWorkspace(rootDir: string): Promise<JavaCodeSearchEngine> {
    const indexed = await indexJavaWorkspace({ rootDir });
    return new JavaCodeSearchEngine(indexed);
  }

  addOrUpdate(fileIndex: JavaFileIndex): void {
    this.files.set(fileIndex.filePath, fileIndex);
    this.rebuildDefinitionIndexes();
  }

  remove(filePath: string): void {
    this.files.delete(filePath);
    this.rebuildDefinitionIndexes();
  }

  listFiles(): JavaFileIndex[] {
    return [...this.files.values()];
  }

  search(query: SearchQuery): SearchResult[] {
    const text = query.text?.trim().toLowerCase();
    const exact = query.exact ?? false;
    const limit = query.limit ?? 50;
    const results: SearchResult[] = [];

    for (const file of this.files.values()) {
      for (const symbol of file.symbols) {
        if (query.kind && symbol.kind !== query.kind) {
          continue;
        }
        if (query.packageName && symbol.packageName !== query.packageName) {
          continue;
        }
        if (query.enclosingType && symbol.enclosingType !== query.enclosingType) {
          continue;
        }
        if (query.filePath && symbol.filePath !== query.filePath) {
          continue;
        }
        if (query.subjectName && symbol.metadata?.subjectName !== query.subjectName) {
          continue;
        }
        if (query.subjectKind && symbol.metadata?.subjectKind !== query.subjectKind) {
          continue;
        }

        const score = scoreSymbol({
          text,
          exact,
          candidate: [
            symbol.name,
            symbol.qualifiedName,
            symbol.signature,
            symbol.metadata?.expression?.toString(),
            symbol.metadata?.subjectName?.toString(),
            symbol.metadata?.annotations?.toString(),
            symbol.metadata?.extends?.toString(),
            symbol.metadata?.implements?.toString()
          ]
        });

        if (score === null) {
          continue;
        }

        results.push({ symbol, score });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  resolveSymbol(symbol: JavaSymbol): SymbolResolution {
    const sourceFile = this.files.get(symbol.filePath);
    if (!sourceFile) {
      return { symbol, candidates: [] };
    }

    const candidates =
      symbol.kind === "call"
        ? this.resolveCallSymbol(symbol, sourceFile)
        : this.resolveTypeName(symbol.name, sourceFile, symbol.kind);
    return {
      symbol,
      candidates: candidates.map(toResolutionTarget)
    };
  }

  resolveSearch(query: SearchQuery): SymbolResolution[] {
    return this.search(query).map((result) => this.resolveSymbol(result.symbol));
  }

  findTypeDefinitions(name: string, sourceFilePath?: string): ResolutionTarget[] {
    if (!sourceFilePath) {
      return (this.definitionsByQualifiedName.get(name)
        ? [this.definitionsByQualifiedName.get(name)]
        : this.definitionsBySimpleName.get(name) ?? []
      )
        .filter((symbol): symbol is JavaSymbol => Boolean(symbol))
        .map(toResolutionTarget);
    }

    const sourceFile = this.files.get(sourceFilePath);
    if (!sourceFile) {
      return [];
    }

    return this.resolveTypeName(name, sourceFile).map(toResolutionTarget);
  }

  findReferencesToType(typeName: string): JavaSymbol[] {
    const references: JavaSymbol[] = [];

    for (const file of this.files.values()) {
      for (const symbol of file.symbols) {
        if (!isResolvableReference(symbol.kind)) {
          continue;
        }
        const resolutions = this.resolveTypeName(symbol.name, file, symbol.kind);
        if (resolutions.some((candidate) => candidate.name === typeName || candidate.qualifiedName === typeName)) {
          references.push(symbol);
        }
      }
    }

    return references;
  }

  private rebuildDefinitionIndexes(): void {
    this.definitionsByQualifiedName.clear();
    this.definitionsBySimpleName.clear();
    this.methodsByTypeName.clear();

    for (const file of this.files.values()) {
      for (const symbol of file.symbols) {
        if (!TYPE_DEFINITION_KINDS.has(symbol.kind)) {
          if (symbol.kind === "method") {
            const existingMethods = this.methodsByTypeName.get(symbol.enclosingType ?? "") ?? [];
            existingMethods.push(symbol);
            this.methodsByTypeName.set(symbol.enclosingType ?? "", existingMethods);
          }
          continue;
        }

        if (symbol.qualifiedName) {
          this.definitionsByQualifiedName.set(symbol.qualifiedName, symbol);
        }

        const existing = this.definitionsBySimpleName.get(symbol.name) ?? [];
        existing.push(symbol);
        this.definitionsBySimpleName.set(symbol.name, existing);
      }
    }
  }

  private resolveTypeName(
    name: string,
    sourceFile: JavaFileIndex,
    referenceKind?: JavaSymbolKind
  ): JavaSymbol[] {
    const candidates = new Map<string, JavaSymbol>();
    const normalized = normalizeTypeName(name);

    const byQualified = this.definitionsByQualifiedName.get(normalized);
    if (byQualified && matchesReferenceKind(byQualified.kind, referenceKind)) {
      candidates.set(candidateKey(byQualified), byQualified);
    }

    const importedMatch = resolveImportedTypeName(normalized, sourceFile.imports);
    if (importedMatch) {
      const importedSymbol = this.definitionsByQualifiedName.get(importedMatch);
      if (importedSymbol && matchesReferenceKind(importedSymbol.kind, referenceKind)) {
        candidates.set(candidateKey(importedSymbol), importedSymbol);
      }
    }

    if (sourceFile.packageName) {
      const samePackageName = `${sourceFile.packageName}.${normalized}`;
      const samePackageSymbol = this.definitionsByQualifiedName.get(samePackageName);
      if (samePackageSymbol && matchesReferenceKind(samePackageSymbol.kind, referenceKind)) {
        candidates.set(candidateKey(samePackageSymbol), samePackageSymbol);
      }
    }

    const simpleMatches = this.definitionsBySimpleName.get(normalized) ?? [];
    for (const candidate of simpleMatches) {
      if (matchesReferenceKind(candidate.kind, referenceKind)) {
        candidates.set(candidateKey(candidate), candidate);
      }
    }

    return [...candidates.values()];
  }

  private resolveCallSymbol(symbol: JavaSymbol, sourceFile: JavaFileIndex): JavaSymbol[] {
    const receiverTypes = this.resolveCallReceiverTypes(symbol, sourceFile);
    const argumentCount = Number(symbol.metadata?.argumentCount ?? -1);
    const matches = new Map<string, JavaSymbol>();

    for (const receiverType of receiverTypes) {
      for (const candidateType of this.collectTypeHierarchy(receiverType)) {
        const methods = this.methodsByTypeName.get(candidateType.name) ?? [];
        for (const method of methods) {
          const parameterCount = Number(method.metadata?.parameterCount ?? -1);
          if (method.name !== symbol.name) {
            continue;
          }
          if (argumentCount >= 0 && parameterCount >= 0 && parameterCount !== argumentCount) {
            continue;
          }
          matches.set(candidateKey(method), method);
        }
      }
    }

    if (!symbol.metadata?.expression) {
      const localMethods = this.methodsByTypeName.get(symbol.enclosingType ?? "") ?? [];
      for (const method of localMethods) {
        const parameterCount = Number(method.metadata?.parameterCount ?? -1);
        if (method.name !== symbol.name) {
          continue;
        }
        if (argumentCount >= 0 && parameterCount >= 0 && parameterCount !== argumentCount) {
          continue;
        }
        matches.set(candidateKey(method), method);
      }
    }

    return [...matches.values()];
  }

  private resolveCallReceiverTypes(symbol: JavaSymbol, sourceFile: JavaFileIndex): JavaSymbol[] {
    const expression = symbol.metadata?.expression?.toString().trim();
    if (!expression || expression === "this") {
      return symbol.enclosingType
        ? this.resolveTypeName(symbol.enclosingType, sourceFile)
        : [];
    }

    if (expression.startsWith("this.")) {
      return this.resolveValueType(expression.slice(5), symbol, sourceFile);
    }

    if (/^[A-Z]/.test(expression)) {
      return this.resolveTypeName(expression, sourceFile);
    }

    return this.resolveValueType(expression, symbol, sourceFile);
  }

  private resolveValueType(
    valueName: string,
    symbol: JavaSymbol,
    sourceFile: JavaFileIndex
  ): JavaSymbol[] {
    const normalizedValue = valueName.split(".").pop() ?? valueName;
    const parameterTypes = this.findEnclosingCallableParameterTypes(symbol, sourceFile);
    const parameterType = parameterTypes.get(normalizedValue);
    if (parameterType) {
      return this.resolveTypeName(parameterType, sourceFile);
    }

    const fieldSymbol = sourceFile.symbols.find(
      (candidate) =>
        candidate.kind === "field" &&
        candidate.enclosingType === symbol.enclosingType &&
        candidate.name === normalizedValue
    );
    const fieldType = fieldSymbol?.metadata?.type?.toString();
    if (fieldType) {
      return this.resolveTypeName(fieldType, sourceFile);
    }

    return [];
  }

  private findEnclosingCallableParameterTypes(
    symbol: JavaSymbol,
    sourceFile: JavaFileIndex
  ): Map<string, string> {
    const parameterMap = new Map<string, string>();
    const callableName = symbol.metadata?.enclosingCallable?.toString();
    if (!callableName) {
      return parameterMap;
    }

    const callableSymbol = sourceFile.symbols.find(
      (candidate) =>
        (candidate.kind === "method" || candidate.kind === "constructor") &&
        candidate.enclosingType === symbol.enclosingType &&
        candidate.name === callableName
    );
    const parameterNames = splitMetadataList(callableSymbol?.metadata?.parameterNames);
    const parameterTypes = splitMetadataList(callableSymbol?.metadata?.parameterTypes);
    for (let index = 0; index < Math.min(parameterNames.length, parameterTypes.length); index += 1) {
      parameterMap.set(parameterNames[index]!, parameterTypes[index]!);
    }
    return parameterMap;
  }

  private collectTypeHierarchy(typeSymbol: JavaSymbol): JavaSymbol[] {
    const collected = new Map<string, JavaSymbol>();
    const queue: JavaSymbol[] = [typeSymbol];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const key = candidateKey(current);
      if (collected.has(key)) {
        continue;
      }
      collected.set(key, current);

      const file = this.files.get(current.filePath);
      if (!file) {
        continue;
      }

      const parentRelations = file.symbols.filter(
        (symbol) =>
          (symbol.kind === "extends" || symbol.kind === "implements") &&
          symbol.metadata?.subjectName === current.name
      );

      for (const relation of parentRelations) {
        for (const resolved of this.resolveTypeName(relation.name, file, relation.kind)) {
          queue.push(resolved);
        }
      }
    }

    return [...collected.values()];
  }
}

function scoreSymbol(input: {
  text?: string;
  exact: boolean;
  candidate: Array<string | undefined>;
}): number | null {
  if (!input.text) {
    return 1;
  }

  let bestScore: number | null = null;
  for (const rawValue of input.candidate) {
    if (!rawValue) {
      continue;
    }
    const value = rawValue.toLowerCase();
    if (input.exact) {
      if (value === input.text) {
        bestScore = Math.max(bestScore ?? 0, 100);
      }
      continue;
    }

    if (value === input.text) {
      bestScore = Math.max(bestScore ?? 0, 100);
      continue;
    }
    if (value.endsWith(`.${input.text}`)) {
      bestScore = Math.max(bestScore ?? 0, 90);
      continue;
    }
    if (value.includes(input.text)) {
      bestScore = Math.max(bestScore ?? 0, 70);
    }
  }

  return bestScore;
}

function resolveImportedTypeName(name: string, imports: string[]): string | undefined {
  for (const imported of imports) {
    if (imported.endsWith(`.${name}`)) {
      return imported;
    }
  }
  return undefined;
}

function normalizeTypeName(name: string): string {
  return name.replace(/<.*>/g, "").trim();
}

function isResolvableReference(kind: JavaSymbolKind): boolean {
  return kind === "extends" || kind === "implements" || kind === "annotation_usage" || kind === "call";
}

function matchesReferenceKind(
  candidateKind: JavaSymbolKind,
  referenceKind?: JavaSymbolKind
): boolean {
  if (referenceKind === "annotation_usage") {
    return candidateKind === "annotation";
  }
  if (referenceKind === "extends") {
    return candidateKind !== "annotation";
  }
  if (referenceKind === "implements") {
    return candidateKind === "interface";
  }
  return true;
}

function toResolutionTarget(symbol: JavaSymbol): ResolutionTarget {
  return {
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind,
    filePath: symbol.filePath,
    range: symbol.range
  };
}

function candidateKey(symbol: JavaSymbol): string {
  return `${symbol.filePath}:${symbol.kind}:${symbol.qualifiedName ?? symbol.name}`;
}

function splitMetadataList(value: string | number | boolean | undefined): string[] {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
