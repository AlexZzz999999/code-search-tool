export declare function collectJavaFiles(rootDir: string, excludeDirs?: string[]): Promise<string[]>;
export declare function collectWorkspaceEntries(rootDir: string, excludeDirs?: string[]): Promise<{
    files: string[];
    directories: string[];
}>;
export declare function readUtf8File(filePath: string): Promise<string>;
