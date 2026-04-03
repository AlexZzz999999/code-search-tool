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
export async function collectJavaFiles(rootDir, excludeDirs = []) {
    const { files } = await collectWorkspaceEntries(rootDir, excludeDirs);
    return files;
}
export async function collectWorkspaceEntries(rootDir, excludeDirs = []) {
    const mergedExcludes = new Set([...DEFAULT_EXCLUDE_DIRS, ...excludeDirs]);
    const files = [];
    const directories = [];
    async function walk(currentDir) {
        directories.push(currentDir);
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
    return {
        files: files.sort(),
        directories: directories.sort((a, b) => a.localeCompare(b))
    };
}
export async function readUtf8File(filePath) {
    return readFile(filePath, "utf8");
}
