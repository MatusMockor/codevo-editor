import type { EditorPosition } from "./languageServerFeatures";
import {
  joinWorkspacePath,
  type ComposerPackageDescriptor,
  type PhpProjectDescriptor,
  type Psr4Root,
} from "./workspace";

export type PhpIdentifierContext =
  | {
      kind: "classIdentifier";
      name: string;
    }
  | {
      kind: "methodCall";
      methodName: string;
      variableName: string;
    };

export interface PhpMethodDefinitionHint {
  className: string;
  methodName: string;
}

interface IdentifierAtOffset {
  end: number;
  name: string;
  start: number;
}

export function phpIdentifierContextAt(
  source: string,
  position: EditorPosition,
): PhpIdentifierContext | null {
  const offset = offsetAtPosition(source, position);
  const identifier = identifierAtOffset(source, offset);

  if (!identifier) {
    return null;
  }

  const methodCall = methodCallContextAt(source, identifier);

  if (methodCall) {
    return methodCall;
  }

  return {
    kind: "classIdentifier",
    name: identifier.name,
  };
}

export function resolvePhpClassName(
  source: string,
  className: string,
): string | null {
  const normalizedClassName = className.trim().replace(/^\\+/, "");

  if (!normalizedClassName) {
    return null;
  }

  const imports = phpUseImports(source);
  const [firstSegment, ...remainingSegments] = normalizedClassName.split("\\");
  const importedName = imports.get(firstSegment.toLowerCase());

  if (importedName) {
    return [importedName, ...remainingSegments].join("\\");
  }

  if (normalizedClassName.includes("\\")) {
    return normalizedClassName;
  }

  const namespace = phpNamespace(source);

  if (namespace) {
    return `${namespace}\\${normalizedClassName}`;
  }

  return normalizedClassName;
}

export function phpParameterTypeForVariable(
  source: string,
  position: EditorPosition,
  variableName: string,
): string | null {
  const offset = offsetAtPosition(source, position);
  const parameterList = enclosingFunctionParameters(source, offset);

  if (!parameterList) {
    return null;
  }

  for (const parameter of splitPhpParameterList(parameterList)) {
    const variableIndex = parameter.search(
      new RegExp(`\\$${escapeRegExp(variableName)}\\b`),
    );

    if (variableIndex < 0) {
      continue;
    }

    const typeName = phpParameterType(parameter.slice(0, variableIndex));

    if (typeName) {
      return typeName;
    }
  }

  return null;
}

export function phpClassPathCandidates(
  rootPath: string,
  descriptor: PhpProjectDescriptor,
  className: string,
): string[] {
  const candidates = [
    ...phpRootClassPathCandidates(rootPath, descriptor.psr4Roots, className),
    ...descriptor.packages.flatMap((composerPackage) =>
      phpPackageClassPathCandidates(rootPath, composerPackage, className),
    ),
  ];

  return Array.from(new Set(candidates));
}

export function phpLaravelRequestMethodDefinition(
  variableType: string | null,
  methodName: string,
): PhpMethodDefinitionHint | null {
  if (!variableType) {
    return null;
  }

  if (!variableType.endsWith("Request")) {
    return null;
  }

  if (methodName === "input") {
    return {
      className: "Illuminate\\Http\\Concerns\\InteractsWithInput",
      methodName,
    };
  }

  if (methodName === "boolean") {
    return {
      className: "Illuminate\\Support\\Traits\\InteractsWithData",
      methodName,
    };
  }

  return null;
}

export function phpNamedTypePosition(
  source: string,
  name: string,
): EditorPosition {
  const match = new RegExp(
    `\\b(?:class|interface|trait|enum)\\s+${escapeRegExp(name)}\\b`,
  ).exec(source);

  if (!match) {
    return { column: 1, lineNumber: 1 };
  }

  return editorPositionAtOffset(source, match.index + match[0].lastIndexOf(name));
}

export function phpMethodPosition(
  source: string,
  methodName: string,
): EditorPosition {
  const match = new RegExp(
    `\\bfunction\\s+${escapeRegExp(methodName)}\\b`,
  ).exec(source);

  if (!match) {
    return { column: 1, lineNumber: 1 };
  }

  return editorPositionAtOffset(
    source,
    match.index + match[0].lastIndexOf(methodName),
  );
}

function methodCallContextAt(
  source: string,
  identifier: IdentifierAtOffset,
): PhpIdentifierContext | null {
  const lineStart = source.lastIndexOf("\n", identifier.start - 1) + 1;
  const lineEnd = source.indexOf("\n", identifier.end);
  const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
  const methodPattern = new RegExp(
    `\\$([A-Za-z_][A-Za-z0-9_]*)\\s*->\\s*${escapeRegExp(identifier.name)}\\b`,
    "g",
  );

  for (const match of line.matchAll(methodPattern)) {
    const matchStart = lineStart + (match.index ?? 0);
    const methodStart = matchStart + match[0].lastIndexOf(identifier.name);
    const methodEnd = methodStart + identifier.name.length;

    if (identifier.start >= methodStart && identifier.end <= methodEnd) {
      return {
        kind: "methodCall",
        methodName: identifier.name,
        variableName: match[1] || "",
      };
    }
  }

  return null;
}

function identifierAtOffset(
  source: string,
  offset: number,
): IdentifierAtOffset | null {
  for (const match of source.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (offset >= start && offset <= end) {
      return {
        end,
        name: match[0],
        start,
      };
    }
  }

  return null;
}

function phpUseImports(source: string): Map<string, string> {
  const imports = new Map<string, string>();

  for (const match of source.matchAll(/^\s*use\s+(?!function\b|const\b)([^;]+);/gm)) {
    const importName = (match[1] || "").trim();

    if (!importName) {
      continue;
    }

    if (importName.includes("{")) {
      continue;
    }

    const aliasMatch = /^(.*?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(
      importName,
    );
    const fullyQualifiedName = (aliasMatch?.[1] || importName)
      .trim()
      .replace(/^\\+/, "");
    const alias = aliasMatch?.[2] || shortPhpName(fullyQualifiedName);

    imports.set(alias.toLowerCase(), fullyQualifiedName);
  }

  return imports;
}

function phpNamespace(source: string): string | null {
  const match = /^\s*namespace\s+([^;{]+)[;{]/m.exec(source);
  return match?.[1]?.trim().replace(/^\\+/, "") || null;
}

function enclosingFunctionParameters(
  source: string,
  offset: number,
): string | null {
  let parameters: string | null = null;

  for (const match of source.matchAll(/\bfunction\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/g)) {
    const parametersStart = (match.index ?? 0) + match[0].length;

    if (parametersStart > offset) {
      continue;
    }

    const parametersEnd = matchingParenthesisOffset(source, parametersStart - 1);

    if (!parametersEnd || parametersEnd > offset) {
      parameters = source.slice(parametersStart, parametersEnd || offset);
      continue;
    }

    parameters = source.slice(parametersStart, parametersEnd);
  }

  return parameters;
}

function matchingParenthesisOffset(source: string, openOffset: number): number | null {
  let depth = 0;
  let quote: string | null = null;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character !== ")") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function splitPhpParameterList(parameters: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < parameters.length; index += 1) {
    const character = parameters[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character !== "," || depth > 0) {
      continue;
    }

    parts.push(parameters.slice(start, index).trim());
    start = index + 1;
  }

  parts.push(parameters.slice(start).trim());
  return parts.filter(Boolean);
}

function phpParameterType(beforeVariable: string): string | null {
  const typeSource = beforeVariable
    .replace(/\b(?:public|protected|private|readonly|static)\b/g, " ")
    .trim();
  const typeParts = typeSource.split(/\s+/).filter(Boolean);
  const typeName = typeParts[typeParts.length - 1];

  if (!typeName) {
    return null;
  }

  const normalized = typeName
    .replace(/^\\+/, "")
    .replace(/^\?/, "")
    .split(/[|&]/)
    .find((candidate) => !isPhpBuiltinType(candidate));

  return normalized || null;
}

function isPhpBuiltinType(typeName: string | undefined): boolean {
  return (
    !typeName ||
    [
      "array",
      "bool",
      "callable",
      "false",
      "float",
      "int",
      "iterable",
      "mixed",
      "never",
      "null",
      "object",
      "self",
      "static",
      "string",
      "true",
      "void",
    ].includes(typeName.toLowerCase())
  );
}

function phpRootClassPathCandidates(
  rootPath: string,
  roots: Psr4Root[],
  className: string,
): string[] {
  return roots.flatMap((root) =>
    root.paths.map((path) => psr4ClassPath(rootPath, path, root.namespace, className)),
  ).filter((path): path is string => Boolean(path));
}

function phpPackageClassPathCandidates(
  rootPath: string,
  composerPackage: ComposerPackageDescriptor,
  className: string,
): string[] {
  const packagePath = composerPackage.installPath
    ? composerInstallPath(rootPath, composerPackage.installPath)
    : joinWorkspacePath(rootPath, `vendor/${composerPackage.name}`);

  return composerPackage.psr4Roots
    .flatMap((root) =>
      root.paths.map((path) =>
        psr4ClassPath(packagePath, path, root.namespace, className),
      ),
    )
    .filter((path): path is string => Boolean(path));
}

function psr4ClassPath(
  basePath: string,
  relativeRoot: string,
  namespace: string,
  className: string,
): string | null {
  if (!className.startsWith(namespace)) {
    return null;
  }

  const relativeClassName = className.slice(namespace.length);
  const relativePath = `${trimSlashes(relativeRoot)}/${relativeClassName
    .split("\\")
    .join("/")}.php`;

  return joinWorkspacePath(basePath, relativePath);
}

function composerInstallPath(rootPath: string, installPath: string): string {
  if (installPath.startsWith("/")) {
    return normalizePath(installPath);
  }

  return normalizePath(joinWorkspacePath(`${rootPath}/vendor/composer`, installPath));
}

function normalizePath(path: string): string {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return `/${parts.join("/")}`;
}

function shortPhpName(className: string): string {
  const parts = className.split("\\");
  return parts[parts.length - 1] || className;
}

function trimSlashes(path: string): string {
  return path.trim().split("\\").join("/").replace(/^\/+|\/+$/g, "");
}

function offsetAtPosition(source: string, position: EditorPosition): number {
  let line = 1;
  let column = 1;

  for (let index = 0; index < source.length; index += 1) {
    if (line === position.lineNumber && column === position.column) {
      return index;
    }

    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return source.length;
}

function editorPositionAtOffset(
  source: string,
  offset: number,
): EditorPosition {
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] !== "\n") {
      continue;
    }

    lineNumber += 1;
    lineStart = index + 1;
  }

  return {
    column: offset - lineStart + 1,
    lineNumber,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
