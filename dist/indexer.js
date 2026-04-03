import path from "node:path";
import { collectJavaFiles, readUtf8File } from "./fs.js";
import { getJavaParser } from "./parser.js";
const TYPE_KINDS = new Map([
    ["class_declaration", "class"],
    ["interface_declaration", "interface"],
    ["enum_declaration", "enum"],
    ["record_declaration", "record"],
    ["annotation_type_declaration", "annotation"]
]);
const ERROR_CODE_PATTERN = /^[A-Z]\d{4,}$/;
export async function indexJavaWorkspace(options) {
    const files = await collectJavaFiles(options.rootDir, options.excludeDirs);
    const indexed = await Promise.all(files.map((filePath) => indexJavaFile(filePath)));
    return indexed;
}
export async function indexJavaFile(filePath) {
    const source = await readUtf8File(filePath);
    return parseJavaSource({
        filePath,
        source
    });
}
export function parseJavaSource(input) {
    const parser = getJavaParser();
    const tree = parser.parse(input.source);
    const root = tree.rootNode;
    const packageNode = findFirstChild(root, "package_declaration");
    const packageName = packageNode ? readScopedName(packageNode, input.source) : undefined;
    const imports = root.namedChildren
        .filter((child) => child.type === "import_declaration")
        .map((node) => readScopedName(node, input.source))
        .filter(Boolean);
    const symbols = [];
    walkNode({
        node: root,
        source: input.source,
        filePath: input.filePath,
        packageName,
        symbols,
        typeStack: [],
        callableStack: []
    });
    return {
        filePath: path.resolve(input.filePath),
        packageName,
        imports,
        symbols
    };
}
function walkNode(context) {
    const { node, source, filePath, packageName, symbols, typeStack, callableStack = [] } = context;
    const typeKind = TYPE_KINDS.get(node.type);
    if (typeKind) {
        const nameNode = node.childForFieldName("name");
        const name = nameNode ? sliceText(nameNode, source) : undefined;
        if (name) {
            const parentType = typeStack[typeStack.length - 1];
            const qualifiedName = joinQualifiedName(packageName, parentType?.qualifiedName ? `${parentType.qualifiedName}.${name}` : name);
            const annotations = extractAnnotations(node, source);
            const extendsTypes = extractExtendsTypes(node, source);
            const implementsTypes = extractImplementsTypes(node, source);
            const typeContext = { name, qualifiedName, packageName, kind: typeKind };
            symbols.push(createSymbol({
                kind: typeKind,
                name,
                qualifiedName,
                packageName,
                enclosingType: parentType?.name,
                filePath,
                node,
                metadata: {
                    annotations: annotations.map((annotation) => annotation.name).join(","),
                    extends: extendsTypes.join(","),
                    implements: implementsTypes.join(",")
                }
            }));
            addAnnotationSymbols({
                annotations,
                subjectName: name,
                subjectKind: typeKind,
                packageName,
                enclosingType: parentType?.name,
                filePath,
                symbols
            });
            addRelationSymbols({
                relationKind: "extends",
                names: extendsTypes,
                subjectName: name,
                subjectKind: typeKind,
                packageName,
                enclosingType: parentType?.name,
                filePath,
                node,
                symbols
            });
            addRelationSymbols({
                relationKind: "implements",
                names: implementsTypes,
                subjectName: name,
                subjectKind: typeKind,
                packageName,
                enclosingType: parentType?.name,
                filePath,
                node,
                symbols
            });
            for (const child of node.namedChildren) {
                walkNode({
                    ...context,
                    node: child,
                    typeStack: [...typeStack, typeContext]
                });
            }
            return;
        }
    }
    if (node.type === "method_declaration") {
        const nameNode = node.childForFieldName("name");
        const name = nameNode ? sliceText(nameNode, source) : undefined;
        if (name) {
            const enclosingType = typeStack[typeStack.length - 1];
            const annotations = extractAnnotations(node, source);
            const parameters = extractParameters(node, source);
            symbols.push(createSymbol({
                kind: "method",
                name,
                packageName,
                qualifiedName: joinQualifiedName(packageName, enclosingType ? `${enclosingType.qualifiedName}.${name}` : name),
                enclosingType: enclosingType?.name,
                filePath,
                node,
                signature: buildMethodSignature(node, source),
                metadata: {
                    annotations: annotations.map((annotation) => annotation.name).join(","),
                    parameterTypes: parameters.types.join(","),
                    parameterNames: parameters.names.join(","),
                    parameterCount: parameters.types.length,
                    returnType: readMethodReturnType(node, source)
                }
            }));
            addAnnotationSymbols({
                annotations,
                subjectName: name,
                subjectKind: "method",
                packageName,
                enclosingType: enclosingType?.name,
                filePath,
                symbols
            });
            for (const child of node.namedChildren) {
                walkNode({
                    ...context,
                    node: child,
                    callableStack: [...callableStack, { name, parameterTypes: parameters.types, parameterNames: parameters.names }]
                });
            }
            return;
        }
    }
    if (node.type === "constructor_declaration") {
        const nameNode = node.childForFieldName("name");
        const name = nameNode ? sliceText(nameNode, source) : undefined;
        if (name) {
            const enclosingType = typeStack[typeStack.length - 1];
            const annotations = extractAnnotations(node, source);
            const parameters = extractParameters(node, source);
            symbols.push(createSymbol({
                kind: "constructor",
                name,
                packageName,
                qualifiedName: joinQualifiedName(packageName, enclosingType ? `${enclosingType.qualifiedName}.${name}` : name),
                enclosingType: enclosingType?.name,
                filePath,
                node,
                signature: buildMethodSignature(node, source),
                metadata: {
                    annotations: annotations.map((annotation) => annotation.name).join(","),
                    parameterTypes: parameters.types.join(","),
                    parameterNames: parameters.names.join(","),
                    parameterCount: parameters.types.length
                }
            }));
            addAnnotationSymbols({
                annotations,
                subjectName: name,
                subjectKind: "constructor",
                packageName,
                enclosingType: enclosingType?.name,
                filePath,
                symbols
            });
            for (const child of node.namedChildren) {
                walkNode({
                    ...context,
                    node: child,
                    callableStack: [...callableStack, { name, parameterTypes: parameters.types, parameterNames: parameters.names }]
                });
            }
            return;
        }
    }
    if (node.type === "field_declaration") {
        const enclosingType = typeStack[typeStack.length - 1];
        const annotations = extractAnnotations(node, source);
        const fieldType = readDeclarationType(node, source);
        for (const child of node.namedChildren) {
            if (child.type !== "variable_declarator") {
                continue;
            }
            const nameNode = child.childForFieldName("name");
            const name = nameNode ? sliceText(nameNode, source) : undefined;
            if (!name) {
                continue;
            }
            symbols.push(createSymbol({
                kind: "field",
                name,
                packageName,
                qualifiedName: joinQualifiedName(packageName, enclosingType ? `${enclosingType.qualifiedName}.${name}` : name),
                enclosingType: enclosingType?.name,
                filePath,
                node: child,
                metadata: {
                    annotations: annotations.map((annotation) => annotation.name).join(","),
                    type: fieldType
                }
            }));
            addAnnotationSymbols({
                annotations,
                subjectName: name,
                subjectKind: "field",
                packageName,
                enclosingType: enclosingType?.name,
                filePath,
                symbols
            });
        }
    }
    if (node.type === "local_variable_declaration") {
        const enclosingType = typeStack[typeStack.length - 1];
        const currentCallable = callableStack[callableStack.length - 1];
        const declarationType = readDeclarationType(node, source);
        for (const child of node.namedChildren) {
            if (child.type !== "variable_declarator") {
                continue;
            }
            const nameNode = child.childForFieldName("name");
            const valueNode = child.childForFieldName("value");
            const name = nameNode ? sliceText(nameNode, source) : undefined;
            if (!name) {
                continue;
            }
            symbols.push(createSymbol({
                kind: "field",
                name,
                packageName,
                enclosingType: enclosingType?.name,
                filePath,
                node: child,
                metadata: {
                    type: declarationType,
                    declaredIn: currentCallable?.name,
                    isLocal: true,
                    initializerKind: valueNode?.type,
                    initializerText: valueNode ? sliceText(valueNode, source) : undefined
                }
            }));
        }
    }
    if (node.type === "method_invocation") {
        const nameNode = node.childForFieldName("name");
        const name = nameNode ? sliceText(nameNode, source) : undefined;
        if (name) {
            const enclosingType = typeStack[typeStack.length - 1];
            const currentCallable = callableStack[callableStack.length - 1];
            symbols.push(createSymbol({
                kind: "call",
                name,
                packageName,
                enclosingType: enclosingType?.name,
                filePath,
                node,
                metadata: {
                    expression: readInvocationQualifier(node, source),
                    argumentCount: countInvocationArguments(node),
                    enclosingCallable: currentCallable?.name
                }
            }));
        }
    }
    if (node.type === "string_literal") {
        const errorCode = extractErrorCodeLiteral(node, source);
        if (errorCode) {
            const enclosingType = typeStack[typeStack.length - 1];
            const currentCallable = callableStack[callableStack.length - 1];
            symbols.push(createSymbol({
                kind: "error_code",
                name: errorCode,
                packageName,
                enclosingType: enclosingType?.name,
                filePath,
                node,
                metadata: {
                    enclosingCallable: currentCallable?.name,
                    ...describeErrorCodeUsage(node, source)
                }
            }));
        }
    }
    for (const child of node.namedChildren) {
        walkNode({
            ...context,
            node: child
        });
    }
}
function buildMethodSignature(node, source) {
    const parameters = node.childForFieldName("parameters");
    return parameters ? sliceText(parameters, source) : "()";
}
function readMethodReturnType(node, source) {
    const typeNode = node.childForFieldName("type") ??
        node.namedChildren.find((child) => [
            "type_identifier",
            "scoped_type_identifier",
            "generic_type",
            "integral_type",
            "floating_point_type",
            "boolean_type",
            "void_type"
        ].includes(child.type));
    return typeNode ? readTypeName(typeNode, source) : undefined;
}
function readInvocationQualifier(node, source) {
    const objectNode = node.childForFieldName("object");
    if (!objectNode) {
        return undefined;
    }
    return sliceText(objectNode, source);
}
function countInvocationArguments(node) {
    const argumentsNode = node.childForFieldName("arguments");
    return argumentsNode?.namedChildCount ?? 0;
}
function extractErrorCodeLiteral(node, source) {
    const raw = sliceText(node, source);
    const unquoted = raw.slice(1, -1);
    return ERROR_CODE_PATTERN.test(unquoted) ? unquoted : undefined;
}
function describeErrorCodeUsage(node, source) {
    const parent = node.parent;
    if (parent?.type === "variable_declarator") {
        const nameNode = parent.childForFieldName("name");
        return {
            usageKind: "variable_initializer",
            variableName: nameNode ? sliceText(nameNode, source) : undefined
        };
    }
    if (parent?.type === "argument_list" && parent.parent?.type === "method_invocation") {
        const invocationNode = parent.parent;
        const nameNode = invocationNode.childForFieldName("name");
        return {
            usageKind: "method_argument",
            argumentOf: nameNode ? sliceText(nameNode, source) : undefined
        };
    }
    if (parent?.type === "argument_list" && parent.parent?.type === "object_creation_expression") {
        const creationNode = parent.parent;
        const typeNode = creationNode.childForFieldName("type") ??
            creationNode.namedChildren.find((child) => ["type_identifier", "scoped_type_identifier", "generic_type"].includes(child.type));
        return {
            usageKind: "constructor_argument",
            argumentOf: typeNode ? readTypeName(typeNode, source) : undefined
        };
    }
    if (parent?.type === "element_value_pair") {
        const keyNode = parent.childForFieldName("key");
        return {
            usageKind: "annotation_argument",
            annotationKey: keyNode ? sliceText(keyNode, source) : undefined
        };
    }
    if (parent?.type === "return_statement") {
        return {
            usageKind: "return_value"
        };
    }
    return {
        usageKind: parent?.type
    };
}
function addAnnotationSymbols(input) {
    for (const annotation of input.annotations) {
        input.symbols.push(createSymbol({
            kind: "annotation_usage",
            name: annotation.name,
            packageName: input.packageName,
            enclosingType: input.enclosingType,
            filePath: input.filePath,
            node: annotation.node,
            metadata: {
                subjectName: input.subjectName,
                subjectKind: input.subjectKind
            }
        }));
    }
}
function addRelationSymbols(input) {
    for (const relationName of input.names) {
        input.symbols.push(createSymbol({
            kind: input.relationKind,
            name: relationName,
            packageName: input.packageName,
            enclosingType: input.enclosingType,
            filePath: input.filePath,
            node: input.node,
            metadata: {
                subjectName: input.subjectName,
                subjectKind: input.subjectKind
            }
        }));
    }
}
function createSymbol(input) {
    return {
        kind: input.kind,
        name: input.name,
        qualifiedName: input.qualifiedName,
        packageName: input.packageName,
        enclosingType: input.enclosingType,
        filePath: path.resolve(input.filePath),
        range: toRange(input.node),
        signature: input.signature,
        metadata: input.metadata
    };
}
function toRange(node) {
    return {
        start: {
            line: node.startPosition.row + 1,
            column: node.startPosition.column + 1
        },
        end: {
            line: node.endPosition.row + 1,
            column: node.endPosition.column + 1
        }
    };
}
function sliceText(node, source) {
    return source.slice(node.startIndex, node.endIndex);
}
function readScopedName(node, source) {
    const scopedNode = findNamedDescendant(node, [
        "scoped_identifier",
        "identifier",
        "asterisk"
    ]);
    return scopedNode ? sliceText(scopedNode, source) : "";
}
function extractAnnotations(node, source) {
    const modifiersNode = node.namedChildren.find((child) => child.type === "modifiers");
    if (!modifiersNode) {
        return [];
    }
    return modifiersNode.namedChildren
        .filter((child) => child.type === "annotation" || child.type === "marker_annotation")
        .map((annotationNode) => {
        const nameNode = findNamedDescendant(annotationNode, [
            "identifier",
            "scoped_identifier"
        ]);
        return nameNode
            ? {
                name: sliceText(nameNode, source),
                node: annotationNode
            }
            : undefined;
    })
        .filter((value) => Boolean(value));
}
function extractParameters(node, source) {
    const parametersNode = node.childForFieldName("parameters");
    if (!parametersNode) {
        return { names: [], types: [] };
    }
    const names = [];
    const types = [];
    for (const child of parametersNode.namedChildren) {
        if (!["formal_parameter", "spread_parameter"].includes(child.type)) {
            continue;
        }
        const nameNode = child.childForFieldName("name");
        const typeNode = child.childForFieldName("type") ?? child.namedChildren[0];
        if (!nameNode || !typeNode) {
            continue;
        }
        names.push(sliceText(nameNode, source));
        types.push(readTypeName(typeNode, source));
    }
    return { names, types };
}
function extractExtendsTypes(node, source) {
    if (node.type === "class_declaration") {
        const superclassNode = node.namedChildren.find((child) => child.type === "superclass");
        return superclassNode ? readTypeNames(superclassNode, source) : [];
    }
    if (node.type === "interface_declaration") {
        const extendsNode = node.namedChildren.find((child) => child.type === "extends_interfaces");
        return extendsNode ? readTypeNames(extendsNode, source) : [];
    }
    return [];
}
function extractImplementsTypes(node, source) {
    const interfacesNode = node.namedChildren.find((child) => child.type === "super_interfaces");
    return interfacesNode ? readTypeNames(interfacesNode, source) : [];
}
function readTypeNames(node, source) {
    const typeListNode = node.namedChildren.find((child) => child.type === "type_list");
    if (typeListNode) {
        return typeListNode.namedChildren.map((child) => readTypeName(child, source)).filter(Boolean);
    }
    const directType = findNamedDescendant(node, [
        "type_identifier",
        "scoped_type_identifier",
        "generic_type",
        "identifier"
    ]);
    return directType ? [readTypeName(directType, source)] : [];
}
function readTypeName(node, source) {
    if (node.type === "generic_type") {
        const baseNode = findNamedDescendant(node, ["type_identifier", "scoped_type_identifier"]);
        return baseNode ? sliceText(baseNode, source) : sliceText(node, source);
    }
    return sliceText(node, source);
}
function readDeclarationType(node, source) {
    const typeNode = node.childForFieldName("type") ??
        node.namedChildren.find((child) => [
            "type_identifier",
            "scoped_type_identifier",
            "generic_type",
            "integral_type",
            "floating_point_type",
            "boolean_type",
            "array_type"
        ].includes(child.type));
    return typeNode ? readTypeName(typeNode, source) : undefined;
}
function findNamedDescendant(node, types) {
    if (types.includes(node.type)) {
        return node;
    }
    for (const child of node.namedChildren) {
        const match = findNamedDescendant(child, types);
        if (match) {
            return match;
        }
    }
    return undefined;
}
function findFirstChild(node, type) {
    return node.namedChildren.find((child) => child.type === type);
}
function joinQualifiedName(packageName, name) {
    if (!name) {
        return undefined;
    }
    if (!packageName) {
        return name;
    }
    if (name.startsWith(`${packageName}.`)) {
        return name;
    }
    return `${packageName}.${name}`;
}
