import path from "node:path";

import { collectJavaFiles } from "./fs.js";
import { indexJavaFile } from "./indexer.js";
import { JavaCodeSearchEngine } from "./search-engine.js";
import { JsonIndexStore, readFileFingerprint } from "./store.js";
import type {
  JavaCodeSearchServiceOptions,
  JavaFileIndex,
  PersistedFileIndex,
  RefreshSummary,
  SearchQuery,
  SearchResult,
  SymbolResolution,
  WatchHandle,
  WatchOptions
} from "./types.js";

export class JavaCodeSearchService {
  private readonly rootDir: string;
  private readonly excludeDirs: string[];
  private readonly store: JsonIndexStore;
  private readonly fingerprints = new Map<string, PersistedFileIndex>();
  private readonly engine: JavaCodeSearchEngine;

  private constructor(input: {
    rootDir: string;
    excludeDirs: string[];
    store: JsonIndexStore;
    persistedFiles: PersistedFileIndex[];
  }) {
    this.rootDir = input.rootDir;
    this.excludeDirs = input.excludeDirs;
    this.store = input.store;
    this.engine = new JavaCodeSearchEngine(input.persistedFiles.map((entry) => entry.index));
    for (const entry of input.persistedFiles) {
      this.fingerprints.set(entry.filePath, entry);
    }
  }

  static async open(options: JavaCodeSearchServiceOptions): Promise<JavaCodeSearchService> {
    const rootDir = path.resolve(options.rootDir);
    const excludeDirs = options.excludeDirs ?? [];
    const cacheDir = options.cacheDir ?? path.join(rootDir, ".javasearch");
    const store = new JsonIndexStore(cacheDir);
    const snapshot = await store.load(rootDir);

    return new JavaCodeSearchService({
      rootDir,
      excludeDirs,
      store,
      persistedFiles: snapshot?.files ?? []
    });
  }

  getRootDir(): string {
    return this.rootDir;
  }

  getCachePath(): string {
    return this.store.snapshotPath;
  }

  search(query: SearchQuery): SearchResult[] {
    return this.engine.search(query);
  }

  resolveSearch(query: SearchQuery): SymbolResolution[] {
    return this.engine.resolveSearch(query);
  }

  resolveSymbol(resolution: SearchResult["symbol"]): SymbolResolution {
    return this.engine.resolveSymbol(resolution);
  }

  listFiles(): JavaFileIndex[] {
    return this.engine.listFiles();
  }

  async watch(options: WatchOptions = {}): Promise<WatchHandle> {
    const debounceMs = options.debounceMs ?? 150;
    let closed = false;
    let timer: NodeJS.Timeout | undefined;
    let refreshInFlight = false;
    let refreshQueued = false;
    let watchers = await this.createWatchers(() => {
      if (closed) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        void triggerRefresh();
      }, debounceMs);
    });

    const triggerRefresh = async (): Promise<void> => {
      if (closed) {
        return;
      }
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }

      refreshInFlight = true;
      try {
        const summary = await this.refresh();
        await options.onRefresh?.(summary);
        if (!closed) {
          watchers = this.replaceWatchers(watchers, await this.createWatchers(scheduleRefresh));
        }
      } catch (error: unknown) {
        await options.onError?.(error);
      } finally {
        refreshInFlight = false;
      }

      if (refreshQueued) {
        refreshQueued = false;
        await triggerRefresh();
      }
    };

    const scheduleRefresh = (): void => {
      if (closed) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        void triggerRefresh();
      }, debounceMs);
    };

    return {
      close: () => {
        closed = true;
        if (timer) {
          clearTimeout(timer);
        }
        for (const watcher of watchers) {
          watcher.close();
        }
      }
    };
  }

  async refresh(): Promise<RefreshSummary> {
    const discovered = await collectJavaFiles(this.rootDir, this.excludeDirs);
    const currentFiles = new Set(discovered.map((filePath) => path.resolve(filePath)));
    const summary: RefreshSummary = {
      added: [],
      modified: [],
      deleted: [],
      unchanged: []
    };

    for (const filePath of [...this.fingerprints.keys()]) {
      if (!currentFiles.has(filePath)) {
        this.fingerprints.delete(filePath);
        this.engine.remove(filePath);
        summary.deleted.push(filePath);
      }
    }

    for (const filePath of currentFiles) {
      const fingerprint = await readFileFingerprint(filePath);
      const existing = this.fingerprints.get(filePath);

      if (!existing) {
        await this.upsertFile(fingerprint);
        summary.added.push(filePath);
        continue;
      }

      if (existing.mtimeMs !== fingerprint.mtimeMs || existing.size !== fingerprint.size) {
        await this.upsertFile(fingerprint);
        summary.modified.push(filePath);
        continue;
      }

      summary.unchanged.push(filePath);
    }

    await this.persist();
    return summary;
  }

  private async upsertFile(fingerprint: { filePath: string; mtimeMs: number; size: number }): Promise<void> {
    const index = await indexJavaFile(fingerprint.filePath);
    const persisted: PersistedFileIndex = {
      ...fingerprint,
      index
    };
    this.fingerprints.set(fingerprint.filePath, persisted);
    this.engine.addOrUpdate(index);
  }

  private async persist(): Promise<void> {
    const snapshot = this.store.createSnapshot({
      rootDir: this.rootDir,
      files: [...this.fingerprints.values()].sort((a, b) => a.filePath.localeCompare(b.filePath))
    });
    await this.store.save(snapshot);
  }

  private async createWatchers(onChange: () => void): Promise<Array<{ close(): void }>> {
    return [this.createPollingWatcher(onChange)];
  }

  private replaceWatchers(
    current: Array<{ close(): void }>,
    next: Array<{ close(): void }>
  ): Array<{ close(): void }> {
    for (const watcher of current) {
      watcher.close();
    }
    return next;
  }
  private createPollingWatcher(onChange: () => void): { close(): void } {
    let closed = false;
    let lastSignature = this.currentFingerprintSignature();

    const poll = async (): Promise<void> => {
      if (closed) {
        return;
      }

      const signature = await this.buildWorkspaceSignature();
      if (signature !== lastSignature) {
        onChange();
      }
      lastSignature = signature;
    };

    const interval = setInterval(() => {
      void poll();
    }, 250);

    void poll();

    return {
      close: () => {
        closed = true;
        clearInterval(interval);
      }
    };
  }

  private async buildWorkspaceSignature(): Promise<string> {
    const files = await collectJavaFiles(this.rootDir, this.excludeDirs);
    const parts: string[] = [];
    for (const filePath of files) {
      const fingerprint = await readFileFingerprint(filePath);
      parts.push(`${fingerprint.filePath}:${fingerprint.mtimeMs}:${fingerprint.size}`);
    }
    return parts.join("|");
  }

  private currentFingerprintSignature(): string {
    return [...this.fingerprints.values()]
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((entry) => `${entry.filePath}:${entry.mtimeMs}:${entry.size}`)
      .join("|");
  }
}
