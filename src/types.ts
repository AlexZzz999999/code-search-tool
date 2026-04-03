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

export interface FileFingerprint {
  filePath: string;
  mtimeMs: number;
  size: number;
}

export interface PersistedFileIndex extends FileFingerprint {
  index: JavaFileIndex;
}

export interface PersistedIndexSnapshot {
  version: number;
  rootDir: string;
  updatedAt: string;
  files: PersistedFileIndex[];
}

export interface JavaCodeSearchServiceOptions {
  rootDir: string;
  cacheDir?: string;
  excludeDirs?: string[];
}

export interface RefreshSummary {
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
}

export interface WatchOptions {
  debounceMs?: number;
  onRefresh?: (summary: RefreshSummary) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}

export interface WatchHandle {
  close(): void;
}
