import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  FileFingerprint,
  PersistedIndexSnapshot
} from "./types.js";

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_FILE = "index.json";

export class JsonIndexStore {
  readonly cacheDir: string;
  readonly snapshotPath: string;

  constructor(cacheDir: string) {
    this.cacheDir = path.resolve(cacheDir);
    this.snapshotPath = path.join(this.cacheDir, SNAPSHOT_FILE);
  }

  async load(rootDir: string): Promise<PersistedIndexSnapshot | null> {
    try {
      const raw = await readFile(this.snapshotPath, "utf8");
      const parsed = JSON.parse(raw) as PersistedIndexSnapshot;
      if (parsed.version !== SNAPSHOT_VERSION) {
        return null;
      }
      if (path.resolve(parsed.rootDir) !== path.resolve(rootDir)) {
        return null;
      }
      return parsed;
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  async save(snapshot: PersistedIndexSnapshot): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const tempPath = `${this.snapshotPath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(tempPath, this.snapshotPath);
  }

  createSnapshot(input: {
    rootDir: string;
    files: PersistedIndexSnapshot["files"];
  }): PersistedIndexSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      rootDir: path.resolve(input.rootDir),
      updatedAt: new Date().toISOString(),
      files: input.files
    };
  }
}

export async function readFileFingerprint(filePath: string): Promise<FileFingerprint> {
  const fileStat = await stat(filePath);
  return {
    filePath: path.resolve(filePath),
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size
  };
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
