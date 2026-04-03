import Parser from "tree-sitter";
import Java from "tree-sitter-java";
let sharedParser;
export function getJavaParser() {
    if (!sharedParser) {
        sharedParser = new Parser();
        sharedParser.setLanguage(Java);
    }
    return sharedParser;
}
