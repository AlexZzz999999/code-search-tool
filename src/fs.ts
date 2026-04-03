import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_EXCLUDE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  ".idea",
  ".gradle"
]);

export async function collectJavaFiles(
  rootDir: string,
  excludeDirs: string[] = []
): Promise<string[]> {
  const mergedExcludes = new Set([...DEFAULT_EXCLUDE_DIRS, ...excludeDirs]);
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!mergedExcludes.has(entry.name)) {
          await walk(fullPath);
        }
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".java")) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files.sort();
}

export async function readUtf8File(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}
