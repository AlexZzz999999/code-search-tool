export { indexJavaFile, indexJavaWorkspace, parseJavaSource } from "./indexer.js";
export { JavaCodeSearchEngine } from "./search-engine.js";
export type {
  IndexWorkspaceOptions,
  JavaFileIndex,
  JavaSymbol,
  JavaSymbolKind,
  ResolutionTarget,
  SearchQuery,
  SearchResult,
  SourcePosition,
  SourceRange,
  SymbolResolution
} from "./types.js";
