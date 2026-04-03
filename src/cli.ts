#!/usr/bin/env node

import path from "node:path";

import { JavaCodeSearchEngine } from "./search-engine.js";
import type { JavaSymbolKind, SearchQuery } from "./types.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command !== "search") {
    throw new Error(`Unsupported command: ${command}`);
  }

  const query = parseSearchArgs(args.slice(1));
  const engine = await JavaCodeSearchEngine.fromWorkspace(query.rootDir);
  const results = engine.search(query.searchQuery);

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

function parseSearchArgs(args: string[]): {
  rootDir: string;
  searchQuery: SearchQuery;
} {
  const query: SearchQuery = {};
  let rootDir = process.cwd();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
      case "--root":
        rootDir = path.resolve(next);
        index += 1;
        break;
      case "--text":
        query.text = next;
        index += 1;
        break;
      case "--kind":
        query.kind = next as JavaSymbolKind;
        index += 1;
        break;
      case "--package":
        query.packageName = next;
        index += 1;
        break;
      case "--type":
        query.enclosingType = next;
        index += 1;
        break;
      case "--file":
        query.filePath = path.resolve(next);
        index += 1;
        break;
      case "--exact":
        query.exact = true;
        break;
      case "--limit":
        query.limit = Number(next);
        index += 1;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return { rootDir, searchQuery: query };
}

function printHelp(): void {
  const help = `
Usage:
  javasearch search [options]

Options:
  --root <dir>       Java repository root, defaults to current working directory
  --text <text>      Search keyword
  --kind <kind>      class|interface|enum|record|annotation|method|constructor|field|call|extends|implements|annotation_usage
  --package <name>   Filter by package name
  --type <name>      Filter by enclosing type
  --file <path>      Filter by absolute file path
  --exact            Use exact match
  --limit <number>   Result count limit
`;

  process.stdout.write(help.trimStart());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
