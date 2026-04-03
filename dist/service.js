import path from "node:path";
import { collectJavaFiles } from "./fs.js";
import { indexJavaFile } from "./indexer.js";
import { JavaCodeSearchEngine } from "./search-engine.js";
import { JsonIndexStore, readFileFingerprint } from "./store.js";
export class JavaCodeSearchService {
    rootDir;
    excludeDirs;
    store;
    fingerprints = new Map();
    engine;
    constructor(input) {
        this.rootDir = input.rootDir;
        this.excludeDirs = input.excludeDirs;
        this.store = input.store;
        this.engine = new JavaCodeSearchEngine(input.persistedFiles.map((entry) => entry.index));
        for (const entry of input.persistedFiles) {
            this.fingerprints.set(entry.filePath, entry);
        }
    }
    static async open(options) {
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
    getRootDir() {
        return this.rootDir;
    }
    getCachePath() {
        return this.store.snapshotPath;
    }
    search(query) {
        return this.engine.search(query);
    }
    resolveSearch(query) {
        return this.engine.resolveSearch(query);
    }
    resolveSymbol(resolution) {
        return this.engine.resolveSymbol(resolution);
    }
    listFiles() {
        return this.engine.listFiles();
    }
    async watch(options = {}) {
        const debounceMs = options.debounceMs ?? 150;
        let closed = false;
        let timer;
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
        const triggerRefresh = async () => {
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
            }
            catch (error) {
                await options.onError?.(error);
            }
            finally {
                refreshInFlight = false;
            }
            if (refreshQueued) {
                refreshQueued = false;
                await triggerRefresh();
            }
        };
        const scheduleRefresh = () => {
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
    async refresh() {
        const discovered = await collectJavaFiles(this.rootDir, this.excludeDirs);
        const currentFiles = new Set(discovered.map((filePath) => path.resolve(filePath)));
        const summary = {
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
    async upsertFile(fingerprint) {
        const index = await indexJavaFile(fingerprint.filePath);
        const persisted = {
            ...fingerprint,
            index
        };
        this.fingerprints.set(fingerprint.filePath, persisted);
        this.engine.addOrUpdate(index);
    }
    async persist() {
        const snapshot = this.store.createSnapshot({
            rootDir: this.rootDir,
            files: [...this.fingerprints.values()].sort((a, b) => a.filePath.localeCompare(b.filePath))
        });
        await this.store.save(snapshot);
    }
    async createWatchers(onChange) {
        return [this.createPollingWatcher(onChange)];
    }
    replaceWatchers(current, next) {
        for (const watcher of current) {
            watcher.close();
        }
        return next;
    }
    createPollingWatcher(onChange) {
        let closed = false;
        let lastSignature = this.currentFingerprintSignature();
        const poll = async () => {
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
    async buildWorkspaceSignature() {
        const files = await collectJavaFiles(this.rootDir, this.excludeDirs);
        const parts = [];
        for (const filePath of files) {
            const fingerprint = await readFileFingerprint(filePath);
            parts.push(`${fingerprint.filePath}:${fingerprint.mtimeMs}:${fingerprint.size}`);
        }
        return parts.join("|");
    }
    currentFingerprintSignature() {
        return [...this.fingerprints.values()]
            .sort((a, b) => a.filePath.localeCompare(b.filePath))
            .map((entry) => `${entry.filePath}:${entry.mtimeMs}:${entry.size}`)
            .join("|");
    }
}
