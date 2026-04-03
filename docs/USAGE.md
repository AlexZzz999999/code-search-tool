# Java Code Search Tool 使用说明书

## 1. 项目定位

`java-ast-search-tool` 是一个基于 Node.js + Tree-sitter AST 的 Java 代码仓检索工具。

它的目标不是做简单的字符串搜索，而是把 Java 仓库解析成结构化索引，然后提供：

- 类型、方法、字段、调用点检索
- 继承关系、接口实现关系检索
- 注解使用点检索
- 跨文件符号解析
- 方法调用目标解析
- 本地 JSON 索引持久化
- 增量刷新
- 自动 watch 刷新

它既可以作为一个 npm 库被其他项目调用，也可以作为底层能力嵌入巡检工具、代码分析平台、IDE 插件或本地开发辅助工具中。

## 2. 安装方式

如果你在另一个本地项目里依赖它，比如目录结构是：

```text
D:\work\inspector-tool
D:\work\code-search-tool
```

那么在巡检工具的 `package.json` 中配置：

```json
{
  "dependencies": {
    "java-ast-search-tool": "file:../code-search-tool"
  }
}
```

然后执行：

```bash
cd D:\work\code-search-tool
npm install
npm run build

cd D:\work\inspector-tool
npm install
```

说明：

- `inspector-tool` 会通过本地路径依赖 `code-search-tool`
- 每次修改 `code-search-tool` 源码后，都建议重新执行一次 `npm run build`

## 3. 导入方式

在你的项目中直接导入：

```ts
import {
  JavaCodeSearchService,
  JavaCodeSearchEngine,
  parseJavaSource,
  indexJavaFile,
  indexJavaWorkspace
} from "java-ast-search-tool";
```

## 4. 推荐使用方式

### 4.1 推荐主入口：`JavaCodeSearchService`

如果你是做巡检工具、服务端分析工具、长期运行的后台能力，推荐优先使用：

```ts
import { JavaCodeSearchService } from "java-ast-search-tool";

const service = await JavaCodeSearchService.open({
  rootDir: "D:\\repos\\order-service"
});

await service.refresh();
```

这个对象负责：

- 加载索引
- 持久化索引
- 增量更新
- 自动 watch
- 对外搜索

## 5. 核心概念

### 5.1 `rootDir`

表示要索引的 Java 仓库根目录。

```ts
const service = await JavaCodeSearchService.open({
  rootDir: "D:\\repos\\order-service"
});
```

### 5.2 `cacheDir`

表示索引 JSON 文件保存位置。

如果不传，默认写到：

```text
<rootDir>\.javasearch\index.json
```

例如：

```ts
const service = await JavaCodeSearchService.open({
  rootDir: "D:\\repos\\order-service",
  cacheDir: "D:\\cache\\order-service-index"
});
```

## 6. 对外 API 说明

## 6.1 `JavaCodeSearchService.open(options)`

打开一个带 JSON 快照能力的代码检索服务。

### 参数

```ts
{
  rootDir: string;
  cacheDir?: string;
  excludeDirs?: string[];
}
```

### 示例

```ts
const service = await JavaCodeSearchService.open({
  rootDir: "D:\\repos\\order-service",
  cacheDir: "D:\\cache\\order-service-index",
  excludeDirs: ["target", "build"]
});
```

## 6.2 `service.refresh()`

执行一次增量刷新。

它会：

- 扫描当前仓库中的 `.java` 文件
- 比较文件的 `mtimeMs + size`
- 识别新增、修改、删除的文件
- 只重建变化文件的索引
- 更新本地 JSON 快照

### 返回值

```ts
{
  added: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
}
```

### 示例

```ts
const summary = await service.refresh();
console.log(summary);
```

示例输出：

```ts
{
  added: ["D:\\repos\\order-service\\src\\main\\java\\com\\acme\\demo\\OrderService.java"],
  modified: [],
  deleted: [],
  unchanged: []
}
```

## 6.3 `service.watch(options)`

启动自动刷新模式。

当前版本通过轮询方式检测文件变化，变化后自动触发防抖刷新。

### 参数

```ts
{
  debounceMs?: number;
  onRefresh?: (summary) => void | Promise<void>;
  onError?: (error) => void | Promise<void>;
}
```

### 返回值

```ts
{
  close(): void;
}
```

### 示例

```ts
const handle = await service.watch({
  debounceMs: 200,
  onRefresh(summary) {
    console.log("索引已刷新", summary);
  },
  onError(error) {
    console.error("刷新失败", error);
  }
});
```

关闭监听：

```ts
handle.close();
```

## 6.4 `service.search(query)`

按条件搜索符号。

### 常用查询字段

```ts
{
  text?: string;
  kind?: JavaSymbolKind;
  packageName?: string;
  enclosingType?: string;
  filePath?: string;
  subjectName?: string;
  subjectKind?: JavaSymbolKind;
  exact?: boolean;
  limit?: number;
}
```

### 支持的 `kind`

- `class`
- `interface`
- `enum`
- `record`
- `annotation`
- `method`
- `constructor`
- `field`
- `call`
- `error_code`
- `extends`
- `implements`
- `annotation_usage`

## 6.5 `service.resolveSearch(query)`

先搜索，再对结果做符号解析。

适合不想分两步 `search + resolveSymbol` 的场景。

### 示例

```ts
const results = service.resolveSearch({
  kind: "call",
  text: "load",
  exact: true
});
```

## 6.6 `service.resolveSymbol(symbol)`

把一个搜索结果解析到真实定义。

当前主要支持解析：

- `extends`
- `implements`
- `annotation_usage`
- `call`

### 示例

```ts
const call = service.search({
  kind: "call",
  text: "load",
  exact: true
})[0]?.symbol;

if (call) {
  const resolved = service.resolveSymbol(call);
  console.log(resolved);
}
```

## 6.7 `service.listFiles()`

返回当前已索引的文件列表。

### 示例

```ts
const files = service.listFiles();
console.log(files.length);
```

## 6.8 `service.getRootDir()`

返回当前绑定的仓库路径。

```ts
console.log(service.getRootDir());
```

## 6.9 `service.getCachePath()`

返回当前索引 JSON 文件路径。

```ts
console.log(service.getCachePath());
```

## 7. 查询示例

## 7.1 查找类

```ts
const results = service.search({
  kind: "class",
  text: "OrderService",
  exact: true
});
```

## 7.2 查找方法

```ts
const results = service.search({
  kind: "method",
  text: "findOrder",
  exact: true
});
```

## 7.3 查找字段

```ts
const results = service.search({
  kind: "field",
  text: "repository",
  exact: true
});
```

## 7.4 查找方法调用点

```ts
const results = service.search({
  kind: "call",
  text: "load",
  exact: true
});
```

## 7.5 查找继承关系

例如查 `OrderService` 继承了谁：

```ts
const results = service.search({
  kind: "extends",
  subjectName: "OrderService"
});
```

## 7.6 查找错误码

适合排查这类代码：

```java
private static final String ORDER_NOT_FOUND = "E20001";
throw new BusinessException("I10001");
```

对应搜索：

```ts
const results = service.search({
  kind: "error_code",
  text: "E20001",
  exact: true
});
```

当前版本会索引 Java 字符串字面量中形如 `E20001`、`I10001` 的错误码，并在 `metadata` 中带出常见使用上下文，例如：

- `usageKind=variable_initializer`
- `usageKind=constructor_argument`
- `usageKind=method_argument`
- `enclosingCallable`
- `variableName`
- `argumentOf`

## 7.7 查找接口实现关系

例如查 `OrderService` 实现了哪些接口：

```ts
const results = service.search({
  kind: "implements",
  subjectName: "OrderService"
});
```

## 7.8 查找注解使用点

例如查所有带 `@Transactional` 的方法：

```ts
const results = service.search({
  kind: "annotation_usage",
  text: "Transactional",
  subjectKind: "method",
  exact: true
});
```

## 8. 解析示例

## 8.1 解析继承关系到真实定义

```ts
const relation = service.search({
  kind: "extends",
  subjectName: "OrderService"
})[0]?.symbol;

if (relation) {
  const resolved = service.resolveSymbol(relation);
  console.log(resolved.candidates);
}
```

## 8.2 解析注解到真实定义

```ts
const annotation = service.search({
  kind: "annotation_usage",
  text: "Transactional",
  subjectKind: "method",
  exact: true
})[0]?.symbol;

if (annotation) {
  const resolved = service.resolveSymbol(annotation);
  console.log(resolved.candidates);
}
```

## 8.3 解析方法调用目标

```ts
const call = service.search({
  kind: "call",
  text: "findById",
  exact: true
})[0]?.symbol;

if (call) {
  const resolved = service.resolveSymbol(call);
  console.log(resolved.candidates);
}
```

## 9. 当前可解析的调用场景

当前版本已经支持以下调用目标解析：

### 9.1 字段调用

```java
private Repository repository;
repository.load();
```

### 9.2 参数调用

```java
void run(Service svc) {
  svc.save();
}
```

### 9.3 `this` 调用

```java
this.repository.findById(id);
```

### 9.4 同类无前缀调用

```java
loadRunner();
```

### 9.5 局部变量调用

```java
Repository repo = loadRepo();
repo.load();
```

### 9.6 `var` 局部变量推断

```java
var runner = buildRunner();
runner.execute();
```

### 9.7 基础链式调用

```java
loadRunner().execute();
```

## 10. 低层 API 说明

如果你不想用 `Service`，也可以直接用更底层的函数和引擎。

## 10.1 `JavaCodeSearchEngine.fromWorkspace(rootDir)`

创建一个纯内存检索引擎。

```ts
const engine = await JavaCodeSearchEngine.fromWorkspace(
  "D:\\repos\\order-service"
);
```

## 10.2 `engine.search(query)`

与 `service.search()` 类似，但不包含持久化和 watch 能力。

## 10.3 `engine.resolveSymbol(symbol)`

与 `service.resolveSymbol()` 类似。

## 10.4 `engine.findTypeDefinitions(name, sourceFilePath?)`

查找类型定义。

```ts
const defs = engine.findTypeDefinitions(
  "BaseService",
  "D:\\repos\\order-service\\src\\main\\java\\com\\acme\\demo\\OrderService.java"
);
```

## 10.5 `engine.findReferencesToType(typeName)`

反向查谁引用了这个类型。

```ts
const refs = engine.findReferencesToType("com.acme.demo.BaseService");
```

## 10.6 `parseJavaSource({ filePath, source })`

直接解析源码字符串。

```ts
const parsed = parseJavaSource({
  filePath: "D:\\temp\\OrderService.java",
  source: `
package com.acme.demo;

public class OrderService {}
`
});
```

适合：

- 编辑器实时分析
- 临时代码检查
- 不从磁盘读文件的场景

## 10.7 `indexJavaFile(filePath)`

解析单个 Java 文件。

```ts
const fileIndex = await indexJavaFile(
  "D:\\repos\\order-service\\src\\main\\java\\com\\acme\\demo\\OrderService.java"
);
```

## 10.8 `indexJavaWorkspace({ rootDir })`

解析整个 Java 仓库。

```ts
const files = await indexJavaWorkspace({
  rootDir: "D:\\repos\\order-service"
});
```

## 11. 推荐接入方式

如果你是在巡检工具中接入，推荐这样写一个初始化模块。

### 示例：`java-search-client.ts`

```ts
import { JavaCodeSearchService } from "java-ast-search-tool";

export async function createJavaSearchService() {
  const service = await JavaCodeSearchService.open({
    rootDir: "D:\\repos\\order-service",
    cacheDir: "D:\\cache\\order-service-index"
  });

  await service.refresh();

  return service;
}
```

使用时：

```ts
import { createJavaSearchService } from "./java-search-client";

async function run() {
  const service = await createJavaSearchService();

  const results = service.search({
    kind: "annotation_usage",
    text: "Transactional",
    subjectKind: "method",
    exact: true
  });

  console.log(results);
}

run();
```

## 12. Windows 路径建议

在 Windows 下推荐使用以下任一方式：

### 方式一：双反斜杠

```ts
rootDir: "D:\\repos\\order-service"
```

### 方式二：斜杠

```ts
rootDir: "D:/repos/order-service"
```

### 方式三：`path.resolve`

```ts
import path from "node:path";

const rootDir = path.resolve("D:/repos/order-service");
```

推荐优先使用 `path.resolve(...)`，更稳定。

## 13. 索引文件说明

默认索引文件在：

```text
<rootDir>/.javasearch/index.json
```

例如：

```text
D:\repos\order-service\.javasearch\index.json
```

如果显式指定了 `cacheDir`，则索引文件会写到：

```text
<cacheDir>\index.json
```

这个文件中保存了：

- 索引版本
- 仓库根目录
- 更新时间
- 每个 Java 文件的指纹信息
- 每个文件的结构化索引结果

## 14. 常见使用流程

## 14.1 一次性分析

适合单次巡检任务。

```ts
const service = await JavaCodeSearchService.open({
  rootDir: "D:\\repos\\order-service"
});

await service.refresh();

const methods = service.search({
  kind: "method",
  text: "findOrder",
  exact: true
});
```

## 14.2 长期运行服务

适合后台服务、开发工具。

```ts
const service = await JavaCodeSearchService.open({
  rootDir: "D:\\repos\\order-service"
});

await service.refresh();

const handle = await service.watch({
  debounceMs: 200,
  onRefresh(summary) {
    console.log("索引已更新", summary);
  }
});
```

## 14.3 巡检工具典型使用

```ts
const service = await JavaCodeSearchService.open({
  rootDir: "D:\\repos\\order-service",
  cacheDir: "D:\\cache\\order-service-index"
});

await service.refresh();

const transactionalMethods = service.search({
  kind: "annotation_usage",
  text: "Transactional",
  subjectKind: "method",
  exact: true
});

for (const item of transactionalMethods) {
  console.log(item.symbol.filePath, item.symbol.metadata?.subjectName);
}
```

## 15. 当前功能边界

当前版本已经支持：

- Java 文件 AST 解析
- 类、接口、枚举、记录、注解定义检索
- 方法、构造器、字段检索
- 方法调用点检索
- 继承关系检索
- 接口实现关系检索
- 注解使用点检索
- 跨文件类型解析
- 方法调用目标解析
- 本地 JSON 索引持久化
- 增量刷新
- 自动 watch 刷新

当前暂未完全覆盖：

- 更复杂的数据流推断
- 泛型与复杂重载的精确方法解析
- 静态导入与静态方法调用
- 构造器调用解析
- 更复杂的链式调用传播
- 完整 Java 编译器级语义分析

## 16. 常见问题

## 16.1 为什么改了库代码后，调用方没有生效？

因为调用方依赖的是构建产物 `dist`，不是 `src`。

修改库源码后请重新执行：

```bash
cd D:\work\code-search-tool
npm run build
```

## 16.2 为什么推荐优先使用 `JavaCodeSearchService`？

因为它包含：

- JSON 索引持久化
- 增量更新
- 自动刷新
- 对长期运行工具更友好

而 `JavaCodeSearchEngine` 更适合一次性或底层用法。

## 16.3 `watch()` 为什么是轮询，不是系统文件监听？

因为轮询在不同平台和不同 watcher 配额环境下更稳定，尤其适合本地工具和跨平台工程场景。

## 17. 最小完整示例

```ts
import { JavaCodeSearchService } from "java-ast-search-tool";

async function main() {
  const service = await JavaCodeSearchService.open({
    rootDir: "D:\\repos\\order-service",
    cacheDir: "D:\\cache\\order-service-index"
  });

  await service.refresh();

  const results = service.search({
    kind: "call",
    text: "load",
    exact: true
  });

  for (const item of results) {
    console.log("调用点:", item.symbol.filePath, item.symbol.range.start);
    const resolved = service.resolveSymbol(item.symbol);
    console.log("解析结果:", resolved.candidates);
  }

  const handle = await service.watch({
    debounceMs: 200,
    onRefresh(summary) {
      console.log("自动刷新:", summary);
    }
  });

  setTimeout(() => {
    handle.close();
  }, 10000);
}

main().catch(console.error);
```

## 18. 建议的接入优先级

如果你是第一次接入，建议按这个顺序：

1. 先接 `JavaCodeSearchService.open()`
2. 再接 `service.refresh()`
3. 再用 `service.search()` 完成检索逻辑
4. 需要跳转定义时再接 `service.resolveSymbol()`
5. 最后再接 `service.watch()`

这样接入成本最低，也最容易排查问题。
