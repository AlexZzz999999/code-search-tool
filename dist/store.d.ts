import type { FileFingerprint, PersistedIndexSnapshot } from "./types.js";
export declare class JsonIndexStore {
    readonly cacheDir: string;
    readonly snapshotPath: string;
    constructor(cacheDir: string);
    load(rootDir: string): Promise<PersistedIndexSnapshot | null>;
    save(snapshot: PersistedIndexSnapshot): Promise<void>;
    createSnapshot(input: {
        rootDir: string;
        files: PersistedIndexSnapshot["files"];
    }): PersistedIndexSnapshot;
}
export declare function readFileFingerprint(filePath: string): Promise<FileFingerprint>;
