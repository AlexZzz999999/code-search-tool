import test from "node:test";
import assert from "node:assert/strict";

import { JavaCodeSearchEngine, parseJavaSource } from "../index.js";

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
