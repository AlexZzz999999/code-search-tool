export type JavaSymbolKind =
  | "class"
  | "interface"
  | "enum"
  | "record"
  | "annotation"
  | "method"
  | "constructor"
  | "field"
  | "call"
  | "extends"
  | "implements"
  | "annotation_usage";

export interface SourcePosition {
  line: number;
  column: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export interface JavaSymbol {
  kind: JavaSymbolKind;
  name: string;
  qualifiedName?: string;
  packageName?: string;
  enclosingType?: string;
  filePath: string;
  range: SourceRange;
  signature?: string;
  metadata?: Record<string, string | number | boolean | undefined>;
}

export interface JavaFileIndex {
  filePath: string;
  packageName?: string;
  imports: string[];
  symbols: JavaSymbol[];
}

export interface SearchQuery {
  text?: string;
  kind?: JavaSymbolKind;
  packageName?: string;
  enclosingType?: string;
  filePath?: string;
  subjectName?: string;
  subjectKind?: JavaSymbolKind;
  exact?: boolean;
  limit?: number;
}

export interface SearchResult {
  score: number;
  symbol: JavaSymbol;
}

export interface ResolutionTarget {
  name: string;
  qualifiedName?: string;
  kind: JavaSymbolKind;
  filePath: string;
  range: SourceRange;
}

export interface SymbolResolution {
  symbol: JavaSymbol;
  candidates: ResolutionTarget[];
}

export interface IndexWorkspaceOptions {
  rootDir: string;
  include?: string[];
  excludeDirs?: string[];
}
