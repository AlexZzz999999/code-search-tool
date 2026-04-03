# code-search-tool

一个基于 Node.js 和 Tree-sitter AST 的 Java 代码仓检索工具。它既可以作为命令行工具使用，也可以被其他 npm 项目直接依赖，作为“Java 代码检索能力”嵌入到你自己的服务或平台里。

## 设计目标

- 用 AST 做结构化检索，而不是纯文本 grep
- 面向整个 Java 仓库建立轻量索引
- 默认输出对业务系统友好的 JSON 结果
- API 优先，CLI 只是薄包装，方便被其他 npm 项目调用

## 安装

```bash
npm install @shaobin/code-search-tool
```

## 作为库调用

```ts
import { JavaCodeSearchService } from "@shaobin/code-search-tool";

const service = await JavaCodeSearchService.open({
  rootDir: "/path/to/java-repo"
});

await service.refresh();

const methods = service.search({
  text: "findOrder",
  kind: "method",
  exact: true
});

console.log(methods);
```

## API 概览

### `JavaCodeSearchEngine.fromWorkspace(rootDir)`

扫描 Java 仓库并建立内存索引。

### `JavaCodeSearchService.open({ rootDir, cacheDir? })`

打开一个带本地 JSON 快照能力的仓库服务。默认会把索引持久化到 `<rootDir>/.javasearch/index.json`。

### `service.refresh()`

按文件的 `mtimeMs + size` 做增量刷新，只重新解析新增或修改过的 Java 文件，并移除已删除文件的索引结果。

### `service.watch({ debounceMs?, onRefresh?, onError? })`

启动监听模式。当前版本使用轮询方式检测 Java 文件变化，并在变化后自动触发一次防抖后的增量刷新，适合编辑器集成、后台索引服务或本地开发工具。

### `engine.search(query)`

支持的查询字段：

- `text`: 名称、限定名、方法签名、调用对象的模糊或精确匹配
- `kind`: `class` / `interface` / `enum` / `record` / `annotation` / `method` / `constructor` / `field` / `call` / `extends` / `implements` / `annotation_usage`
- `packageName`: 包名过滤
- `enclosingType`: 所属类型过滤
- `filePath`: 文件路径过滤
- `subjectName`: 关系或注解所作用到的主体名，比如 `OrderService`、`findOrder`
- `subjectKind`: 关系或注解所作用到的主体类型，比如 `class`、`method`
- `exact`: 是否精确匹配
- `limit`: 结果数量限制

### `engine.resolveSymbol(symbol)`

把一个检索结果里的符号进一步解析到工作区里的真实定义，当前支持：

- `extends`
- `implements`
- `annotation_usage`
- `call`

### `engine.findTypeDefinitions(name, sourceFilePath?)`

按类型名查定义。传入 `sourceFilePath` 时，会结合当前文件的包名和 imports 做更接近 Java 语义的解析。

### `engine.findReferencesToType(typeName)`

反向查找某个类型在工作区里被哪些 `extends` / `implements` / `annotation_usage` 引用。

### `parseJavaSource({ filePath, source })`

直接解析单个 Java 源码字符串，适合被上层系统接入编辑器、代码平台或增量更新场景。

## CLI

```bash
javasearch search --root /path/to/java-repo --text findOrder --kind method --exact
```

输出示例：

```json
[
  {
    "score": 100,
    "symbol": {
      "kind": "method",
      "name": "findOrder",
      "qualifiedName": "com.acme.demo.OrderService.findOrder",
      "packageName": "com.acme.demo",
      "enclosingType": "OrderService",
      "filePath": "/path/to/java-repo/src/main/java/com/acme/demo/OrderService.java",
      "range": {
        "start": { "line": 10, "column": 3 },
        "end": { "line": 13, "column": 4 }
      },
      "signature": "(String id)"
    }
  }
]
```

## 当前能力边界

当前版本已经支持：

- 类型声明：class / interface / enum / record / annotation
- 方法、构造器、字段
- 方法调用点
- 继承关系和接口实现关系
- 注解使用点检索
- 跨文件类型定义解析和基础引用反查
- 基于字段、方法参数和 `this` 的方法调用目标解析
- 局部变量类型推断与基础链式调用返回值推断
- 本地 JSON 索引持久化与增量刷新
- `watch()` 自动监听文件变化并刷新索引
- 包名和 imports 提取

下一步很适合继续扩展：

- 方法参数、返回值、修饰符过滤
- 局部变量、链式调用返回值推断和完整调用链能力
- 更细粒度的按文件刷新接口和监听状态指标

## 本地开发

```bash
npm install
npm run build
npm test
```
