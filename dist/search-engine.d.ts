import type { JavaFileIndex, JavaSymbol, ResolutionTarget, SearchQuery, SearchResult, SymbolResolution } from "./types.js";
export declare class JavaCodeSearchEngine {
    private readonly files;
    private readonly definitionsByQualifiedName;
    private readonly definitionsBySimpleName;
    private readonly methodsByTypeName;
    constructor(initialFiles?: JavaFileIndex[]);
    static fromWorkspace(rootDir: string): Promise<JavaCodeSearchEngine>;
    addOrUpdate(fileIndex: JavaFileIndex): void;
    remove(filePath: string): void;
    listFiles(): JavaFileIndex[];
    search(query: SearchQuery): SearchResult[];
    resolveSymbol(symbol: JavaSymbol): SymbolResolution;
    resolveSearch(query: SearchQuery): SymbolResolution[];
    findTypeDefinitions(name: string, sourceFilePath?: string): ResolutionTarget[];
    findReferencesToType(typeName: string): JavaSymbol[];
    private rebuildDefinitionIndexes;
    private resolveTypeName;
    private resolveCallSymbol;
    private resolveCallReceiverTypes;
    private resolveValueType;
    private findEnclosingCallableParameterTypes;
    private collectTypeHierarchy;
}
