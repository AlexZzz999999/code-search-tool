# java-ast-search-tool

一个基于 Node.js 和 Tree-sitter AST 的 Java 代码仓检索工具，可作为 npm 库嵌入其他项目，也可作为本地代码索引服务使用。

适合这些场景：

- Java 仓库巡检
- 结构化代码搜索
- 跨文件符号解析
- 调用关系分析
- 本地索引服务或开发工具集成

详细使用说明见 [docs/USAGE.md](/Users/shaobin/Personal/AgentWork/Projects/code-search-tool/docs/USAGE.md)。

## 安装

```bash
npm install java-ast-search-tool
```

## 快速开始

```ts
import { JavaCodeSearchService } from "java-ast-search-tool";

const service = await JavaCodeSearchService.open({
  rootDir: "/path/to/java-repo"
});

await service.refresh();

const results = service.search({
  kind: "method",
  text: "findOrder",
  exact: true
});

console.log(results);
```

## 核心能力

- AST 驱动的 Java 结构化检索
- 类、接口、方法、字段、调用点搜索
- `extends` / `implements` / 注解使用点检索
- 跨文件类型定义解析
- 方法调用目标解析
- 本地 JSON 索引持久化
- 增量刷新
- `watch()` 自动刷新

## 主要 API

- `JavaCodeSearchService.open({ rootDir, cacheDir? })`
- `service.refresh()`
- `service.watch({ debounceMs?, onRefresh?, onError? })`
- `service.search(query)`
- `service.resolveSearch(query)`
- `service.resolveSymbol(symbol)`
- `JavaCodeSearchEngine.fromWorkspace(rootDir)`
- `parseJavaSource({ filePath, source })`

## CLI

```bash
javasearch search --root /path/to/java-repo --text findOrder --kind method --exact
```

## 文档

- 详细使用说明：[docs/USAGE.md](/Users/shaobin/Personal/AgentWork/Projects/code-search-tool/docs/USAGE.md)

## 本地开发

```bash
npm install
npm run build
npm test
```
