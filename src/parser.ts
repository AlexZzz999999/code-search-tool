import Parser from "tree-sitter";
import Java from "tree-sitter-java";

let sharedParser: Parser | undefined;

export function getJavaParser(): Parser {
  if (!sharedParser) {
    sharedParser = new Parser();
    sharedParser.setLanguage(Java);
  }
  return sharedParser;
}
