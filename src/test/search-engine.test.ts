import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { JavaCodeSearchEngine, JavaCodeSearchService, parseJavaSource } from "../index.js";

const sampleJava = `
package com.acme.demo;

@Service
public class OrderService extends BaseService implements Searchable, Auditable {
  @Inject
  private final Repository repository;

  public OrderService(Repository repository) {
    this.repository = repository;
  }

  @Transactional
  public Order findOrder(String id) {
    repository.findById(id);
    return repository.load(id);
  }
}
`;

test("parseJavaSource extracts core symbols", () => {
  const file = parseJavaSource({
    filePath: "/tmp/OrderService.java",
    source: sampleJava
  });

  assert.equal(file.packageName, "com.acme.demo");
  assert.ok(file.symbols.find((symbol) => symbol.kind === "class" && symbol.name === "OrderService"));
  assert.ok(file.symbols.find((symbol) => symbol.kind === "method" && symbol.name === "findOrder"));
  assert.ok(file.symbols.find((symbol) => symbol.kind === "field" && symbol.name === "repository"));
  assert.ok(
    file.symbols.find(
      (symbol) =>
        symbol.kind === "extends" &&
        symbol.name === "BaseService" &&
        symbol.metadata?.subjectName === "OrderService"
    )
  );
  assert.equal(
    file.symbols.filter((symbol) => symbol.kind === "implements").length,
    2
  );
  assert.ok(
    file.symbols.find(
      (symbol) =>
        symbol.kind === "annotation_usage" &&
        symbol.name === "Transactional" &&
        symbol.metadata?.subjectName === "findOrder" &&
        symbol.metadata?.subjectKind === "method"
    )
  );
  assert.equal(
    file.symbols.filter((symbol) => symbol.kind === "call").length,
    2
  );
});

test("JavaCodeSearchEngine supports name and kind filtering", () => {
  const engine = new JavaCodeSearchEngine([
    parseJavaSource({
      filePath: "/tmp/OrderService.java",
      source: sampleJava
    })
  ]);

  const methodResults = engine.search({ text: "findOrder", kind: "method", exact: true });
  assert.equal(methodResults.length, 1);
  assert.equal(methodResults[0]?.symbol.qualifiedName, "com.acme.demo.OrderService.findOrder");

  const callResults = engine.search({ text: "findById", kind: "call", exact: true });
  assert.equal(callResults.length, 1);
  assert.equal(callResults[0]?.symbol.metadata?.expression, "repository");

  const annotationResults = engine.search({
    text: "Transactional",
    kind: "annotation_usage",
    subjectKind: "method"
  });
  assert.equal(annotationResults.length, 1);
  assert.equal(annotationResults[0]?.symbol.metadata?.subjectName, "findOrder");

  const extendsResults = engine.search({
    text: "BaseService",
    kind: "extends",
    subjectName: "OrderService",
    exact: true
  });
  assert.equal(extendsResults.length, 1);

  const implementsResults = engine.search({
    kind: "implements",
    subjectName: "OrderService"
  });
  assert.equal(implementsResults.length, 2);
});

test("JavaCodeSearchEngine resolves cross-file type references", () => {
  const engine = new JavaCodeSearchEngine([
    parseJavaSource({
      filePath: "/tmp/src/com/acme/demo/OrderService.java",
      source: sampleJava
    }),
    parseJavaSource({
      filePath: "/tmp/src/com/acme/demo/BaseService.java",
      source: `
package com.acme.demo;

public class BaseService {}
`
    }),
    parseJavaSource({
      filePath: "/tmp/src/com/acme/demo/Searchable.java",
      source: `
package com.acme.demo;

public interface Searchable {}
`
    }),
    parseJavaSource({
      filePath: "/tmp/src/com/acme/demo/Auditable.java",
      source: `
package com.acme.demo;

public interface Auditable {}
`
    }),
    parseJavaSource({
      filePath: "/tmp/src/com/acme/demo/Transactional.java",
      source: `
package com.acme.demo;

public @interface Transactional {}
`
    })
  ]);

  const extendsSymbol = engine.search({
    kind: "extends",
    subjectName: "OrderService",
    exact: true
  })[0]?.symbol;
  assert.ok(extendsSymbol);
  const extendsResolution = engine.resolveSymbol(extendsSymbol!);
  assert.equal(extendsResolution.candidates.length, 1);
  assert.equal(
    extendsResolution.candidates[0]?.qualifiedName,
    "com.acme.demo.BaseService"
  );

  const annotationSymbol = engine.search({
    kind: "annotation_usage",
    text: "Transactional",
    subjectKind: "method"
  })[0]?.symbol;
  assert.ok(annotationSymbol);
  const annotationResolution = engine.resolveSymbol(annotationSymbol!);
  assert.equal(annotationResolution.candidates.length, 1);
  assert.equal(
    annotationResolution.candidates[0]?.qualifiedName,
    "com.acme.demo.Transactional"
  );

  const typeDefinitions = engine.findTypeDefinitions(
    "BaseService",
    "/tmp/src/com/acme/demo/OrderService.java"
  );
  assert.equal(typeDefinitions.length, 1);
  assert.equal(typeDefinitions[0]?.filePath, "/tmp/src/com/acme/demo/BaseService.java");

  const references = engine.findReferencesToType("com.acme.demo.BaseService");
  assert.equal(references.length, 1);
  assert.equal(references[0]?.kind, "extends");
});

test("JavaCodeSearchEngine resolves method call targets across files", () => {
  const engine = new JavaCodeSearchEngine([
    parseJavaSource({
      filePath: "/tmp/src/com/acme/demo/OrderService.java",
      source: sampleJava
    }),
    parseJavaSource({
      filePath: "/tmp/src/com/acme/demo/Repository.java",
      source: `
package com.acme.demo;

public class Repository {
  public Order findById(String id) {
    return new Order();
  }

  public Order load(String id) {
    return new Order();
  }
}
`
    }),
    parseJavaSource({
      filePath: "/tmp/src/com/acme/demo/Order.java",
      source: `
package com.acme.demo;

public class Order {}
`
    })
  ]);

  const findByIdCall = engine.search({
    kind: "call",
    text: "findById",
    exact: true
  })[0]?.symbol;
  assert.ok(findByIdCall);
  const findByIdResolution = engine.resolveSymbol(findByIdCall!);
  assert.equal(findByIdResolution.candidates.length, 1);
  assert.equal(
    findByIdResolution.candidates[0]?.qualifiedName,
    "com.acme.demo.Repository.findById"
  );

  const loadCall = engine.search({
    kind: "call",
    text: "load",
    exact: true
  })[0]?.symbol;
  assert.ok(loadCall);
  const loadResolution = engine.resolveSymbol(loadCall!);
  assert.equal(loadResolution.candidates.length, 1);
  assert.equal(
    loadResolution.candidates[0]?.qualifiedName,
    "com.acme.demo.Repository.load"
  );
});

test("JavaCodeSearchEngine resolves local-variable and chained call targets", () => {
  const engine = new JavaCodeSearchEngine([
    parseJavaSource({
      filePath: "/tmp/src/com/acme/demo/FlowService.java",
      source: `
package com.acme.demo;

public class FlowService {
  public void run() {
    Repository repo = loadRepo();
    var runner = buildRunner();
    repo.load();
    runner.execute();
    loadRunner().execute();
  }

  public Repository loadRepo() {
    return new Repository();
  }

  public Runner buildRunner() {
    return new Runner();
  }

  public Runner loadRunner() {
    return new Runner();
  }
}
`
    }),
    parseJavaSource({
      filePath: "/tmp/src/com/acme/demo/Repository.java",
      source: `
package com.acme.demo;

public class Repository {
  public void load() {}
}
`
    }),
    parseJavaSource({
      filePath: "/tmp/src/com/acme/demo/Runner.java",
      source: `
package com.acme.demo;

public class Runner {
  public void execute() {}
}
`
    })
  ]);

  const repoLoadCall = engine.search({
    kind: "call",
    text: "load",
    exact: true,
    filePath: "/tmp/src/com/acme/demo/FlowService.java"
  })[0]?.symbol;
  assert.ok(repoLoadCall);
  const repoLoadResolution = engine.resolveSymbol(repoLoadCall!);
  assert.equal(repoLoadResolution.candidates[0]?.qualifiedName, "com.acme.demo.Repository.load");

  const executeCalls = engine.search({
    kind: "call",
    text: "execute",
    exact: true,
    filePath: "/tmp/src/com/acme/demo/FlowService.java"
  });
  assert.equal(executeCalls.length, 2);

  const localVarResolution = engine.resolveSymbol(executeCalls[0]!.symbol);
  assert.equal(localVarResolution.candidates[0]?.qualifiedName, "com.acme.demo.Runner.execute");

  const chainedResolution = engine.resolveSymbol(executeCalls[1]!.symbol);
  assert.equal(chainedResolution.candidates[0]?.qualifiedName, "com.acme.demo.Runner.execute");
});

test("JavaCodeSearchService persists snapshot and refreshes incrementally", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "javasearch-"));

  try {
    const srcDir = path.join(tempRoot, "src", "main", "java", "com", "acme", "demo");
    await mkdir(srcDir, { recursive: true });

    const orderServicePath = path.join(srcDir, "OrderService.java");
    const repositoryPath = path.join(srcDir, "Repository.java");

    await writeFile(
      repositoryPath,
      `
package com.acme.demo;

public class Repository {
  public void load() {}
}
`,
      "utf8"
    );
    await writeFile(
      orderServicePath,
      `
package com.acme.demo;

public class OrderService {
  private final Repository repository;

  public OrderService(Repository repository) {
    this.repository = repository;
  }

  public void run() {
    repository.load();
  }
}
`,
      "utf8"
    );

    const service = await JavaCodeSearchService.open({ rootDir: tempRoot });
    const firstRefresh = await service.refresh();
    assert.equal(firstRefresh.added.length, 2);
    assert.equal(firstRefresh.modified.length, 0);
    assert.equal(firstRefresh.deleted.length, 0);

    const snapshotRaw = await readFile(service.getCachePath(), "utf8");
    const snapshot = JSON.parse(snapshotRaw) as { files: Array<{ filePath: string }> };
    assert.equal(snapshot.files.length, 2);

    const reopened = await JavaCodeSearchService.open({ rootDir: tempRoot });
    const secondRefresh = await reopened.refresh();
    assert.equal(secondRefresh.added.length, 0);
    assert.equal(secondRefresh.modified.length, 0);
    assert.equal(secondRefresh.deleted.length, 0);
    assert.equal(
      reopened.search({ kind: "call", text: "load", exact: true }).length,
      1
    );

    await writeFile(
      repositoryPath,
      `
package com.acme.demo;

public class Repository {
  public void load() {}

  public void save() {}
}
`,
      "utf8"
    );

    const thirdRefresh = await reopened.refresh();
    assert.equal(thirdRefresh.modified.length, 1);
    assert.equal(
      reopened.search({ kind: "method", text: "save", exact: true }).length,
      1
    );

    await rm(orderServicePath);
    const fourthRefresh = await reopened.refresh();
    assert.equal(fourthRefresh.deleted.length, 1);
    assert.equal(
      reopened.search({ kind: "class", text: "OrderService", exact: true }).length,
      0
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("JavaCodeSearchService watch refreshes on file changes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "javasearch-watch-"));
  let handle: { close(): void } | undefined;

  try {
    const srcDir = path.join(tempRoot, "src", "main", "java", "com", "acme", "demo");
    await mkdir(srcDir, { recursive: true });

    const repositoryPath = path.join(srcDir, "Repository.java");
    await writeFile(
      repositoryPath,
      `
package com.acme.demo;

public class Repository {
  public void load() {}
}
`,
      "utf8"
    );

    const service = await JavaCodeSearchService.open({ rootDir: tempRoot });
    await service.refresh();

    let resolveRefresh: (() => void) | undefined;
    const refreshed = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });

    handle = await service.watch({
      debounceMs: 50,
      onRefresh: (summary) => {
        if (summary.modified.some((file) => file.endsWith("Repository.java"))) {
          resolveRefresh?.();
        }
      }
    });

    await writeFile(
      repositoryPath,
      `
package com.acme.demo;

public class Repository {
  public void load() {}

  public void save() {}
}
`,
      "utf8"
    );

    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("watch refresh timed out")), 5000);
      refreshed.finally(() => clearTimeout(timer));
    });

    await Promise.race([refreshed, timeout]);
    assert.equal(
      service.search({ kind: "method", text: "save", exact: true }).length,
      1
    );
  } finally {
    handle?.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
