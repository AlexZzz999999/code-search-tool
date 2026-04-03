import type { IndexWorkspaceOptions, JavaFileIndex } from "./types.js";
export declare function indexJavaWorkspace(options: IndexWorkspaceOptions): Promise<JavaFileIndex[]>;
export declare function indexJavaFile(filePath: string): Promise<JavaFileIndex>;
export declare function parseJavaSource(input: {
    filePath: string;
    source: string;
}): JavaFileIndex;
