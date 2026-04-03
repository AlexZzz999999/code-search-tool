import type { JavaCodeSearchServiceOptions, JavaFileIndex, RefreshSummary, SearchQuery, SearchResult, SymbolResolution, WatchHandle, WatchOptions } from "./types.js";
export declare class JavaCodeSearchService {
    private readonly rootDir;
    private readonly excludeDirs;
    private readonly store;
    private readonly fingerprints;
    private readonly engine;
    private constructor();
    static open(options: JavaCodeSearchServiceOptions): Promise<JavaCodeSearchService>;
    getRootDir(): string;
    getCachePath(): string;
    search(query: SearchQuery): SearchResult[];
    resolveSearch(query: SearchQuery): SymbolResolution[];
    resolveSymbol(resolution: SearchResult["symbol"]): SymbolResolution;
    listFiles(): JavaFileIndex[];
    watch(options?: WatchOptions): Promise<WatchHandle>;
    refresh(): Promise<RefreshSummary>;
    private upsertFile;
    private persist;
    private createWatchers;
    private replaceWatchers;
    private createPollingWatcher;
    private buildWorkspaceSignature;
    private currentFingerprintSignature;
}
