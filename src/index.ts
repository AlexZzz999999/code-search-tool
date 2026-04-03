export { indexJavaFile, indexJavaWorkspace, parseJavaSource } from "./indexer.js";
export { JavaCodeSearchEngine } from "./search-engine.js";
export { JavaCodeSearchService } from "./service.js";
export type {
  FileFingerprint,
  IndexWorkspaceOptions,
  JavaFileIndex,
  JavaCodeSearchServiceOptions,
  JavaSymbol,
  JavaSymbolKind,
  PersistedFileIndex,
  PersistedIndexSnapshot,
  RefreshSummary,
  ResolutionTarget,
  SearchQuery,
  SearchResult,
  SourcePosition,
  SourceRange,
  SymbolResolution,
  WatchHandle,
  WatchOptions
} from "./types.js";
