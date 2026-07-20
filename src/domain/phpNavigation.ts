import type { EditorPosition } from "./languageServerFeatures";
import { resolvePhpClassName } from "./phpClassNameResolution";
export { phpParameterTypeForVariable } from "./phpParameterTypes";
import {
  PHP_EXPRESSION_RECEIVER_PATTERN,
  PHP_MEMBER_ACCESS_PATTERN,
  PHP_MEMBER_CHAIN_SEGMENT_PATTERN,
  phpNormalizeReceiverExpression,
  phpSimpleVariableName,
} from "./phpReceiverExpressions";
import {
  editorPositionAtOffset,
  identifierAtOffset,
  offsetAtPosition,
  stringLiteralAtOffset,
  type IdentifierAtOffset,
} from "./phpSourceScanning";
import {
  joinWorkspacePath,
  type ComposerPackageDescriptor,
  type PhpProjectDescriptor,
  type Psr4Root,
} from "./workspace";
export { resolvePhpClassName };
export {
  phpLaravelRelationStringCompletionContextAt,
  phpLaravelRelationStringIdentifierContextAt,
  phpLaravelRequestMethodDefinition,
  phpLaravelRouteActionIdentifierContextAt,
  phpLaravelRouteActionMethodCompletionContextAt,
  type PhpLaravelRelationStringCompletionContext,
  type PhpLaravelRouteActionMethodCompletionContext,
} from "./phpLaravelNavigationContexts";

export type PhpCoreIdentifierContext =
  | {
      kind: "classIdentifier";
      name: string;
    }
  | {
      kind: "methodCall";
      methodName: string;
      receiverExpression: string;
      variableName: string;
    }
  | {
      kind: "memberPropertyAccess";
      propertyName: string;
      receiverExpression: string;
      variableName: string;
    }
  | {
      className: string;
      kind: "staticMethodCall";
      methodName: string;
    }
  | {
      className: string;
      constantName: string;
      kind: "classConstant";
    };

export interface PhpFrameworkIdentifierContextContributions {}

export type PhpFrameworkIdentifierContext =
  PhpFrameworkIdentifierContextContributions[keyof PhpFrameworkIdentifierContextContributions];

export type PhpIdentifierContext =
  | PhpCoreIdentifierContext
  | PhpFrameworkIdentifierContext;

export interface PhpMethodDefinitionHint {
  className: string;
  methodName: string;
}

export interface PhpImplementationDeclarationContext {
  methodName: string;
  typeKind: "class" | "enum" | "interface" | "trait";
}

export function phpIdentifierContextAt(
  source: string,
  position: EditorPosition,
): PhpCoreIdentifierContext | null {
  const offset = offsetAtPosition(source, position);
  const identifier = identifierAtOffset(source, offset);

  if (!identifier) {
    return null;
  }

  const methodCall = methodCallContextAt(source, identifier);

  if (methodCall) {
    return methodCall;
  }

  const memberProperty = memberPropertyAccessContextAt(source, identifier);

  if (memberProperty) {
    return memberProperty;
  }

  const staticMember = staticMemberAccessContextAt(source, identifier);

  if (staticMember) {
    return staticMember;
  }

  return {
    kind: "classIdentifier",
    name: qualifiedClassIdentifierAtOffset(source, offset) ?? identifier.name,
  };
}

/**
 * Returns the full namespace-qualified class token surrounding `offset`
 * (e.g. `\App\Models\Baz` or `App\Models\Baz`), spanning every `\`-separated
 * segment, or `null` when the offset is not inside such a token. Used only for
 * the `classIdentifier` fallback so a Cmd+Click on any segment of a qualified
 * type reference (docblock `@var`/`@param`/`@return` or a type-hint) resolves
 * the whole FQN rather than a single segment. Method/property/static-call
 * classification keeps using the single-segment {@link identifierAtOffset} so
 * qualified static receivers (`\App\Models\Album::find()`) are not hijacked.
 */
function qualifiedClassIdentifierAtOffset(
  source: string,
  offset: number,
): string | null {
  for (const match of source.matchAll(
    /\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*/g,
  )) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (offset >= start && offset <= end) {
      return match[0].includes("\\") ? match[0] : null;
    }
  }

  return null;
}

/**
 * Returns the bare class / interface / trait / enum type identifier under
 * `offset` (e.g. a constructor-promoted property or parameter type-hint), or
 * `null` when the offset is not on such a reference. Reuses
 * {@link phpIdentifierContextAt}'s classification so method calls, property
 * accesses, and static calls are all excluded — only the framework-agnostic
 * `classIdentifier` fallback yields a name. Offset-based so Cmd+Click
 * definition providers can call it directly.
 */
export function phpClassIdentifierNameAt(
  source: string,
  offset: number,
): string | null {
  if (stringLiteralAtOffset(source, offset)) {
    return null;
  }

  const context = phpIdentifierContextAt(
    source,
    editorPositionAtOffset(source, offset),
  );

  if (context?.kind !== "classIdentifier") {
    return null;
  }

  return context.name;
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
  return phpMethodPositionOrNull(source, methodName) ?? {
    column: 1,
    lineNumber: 1,
  };
}

export function phpMethodPositionOrNull(
  source: string,
  methodName: string,
): EditorPosition | null {
  const match = new RegExp(
    `\\bfunction\\s+${escapeRegExp(methodName)}\\b`,
  ).exec(source);

  if (!match) {
    return null;
  }

  return editorPositionAtOffset(
    source,
    match.index + match[0].lastIndexOf(methodName),
  );
}

export function phpClassConstantPositionOrNull(
  source: string,
  constantName: string,
): EditorPosition | null {
  const normalizedConstantName = constantName.trim();

  if (!normalizedConstantName) {
    return null;
  }

  const escapedConstantName = escapeRegExp(normalizedConstantName);
  // Match a declared class constant (`const NAME`, optionally with
  // visibility/final modifiers and an optional type before the name) or an enum
  // `case NAME`. Anchored to the start of a line and requiring the name to be
  // followed by `=` or `;` so a `const`/`case` keyword cannot pick up an
  // unrelated trailing identifier and a `switch` arm (`case EXPR:`) is excluded.
  const constantPattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:(?:final|public|protected|private)\s+)*(?:const\b[^\r\n;=]*?|case)\s+${escapedConstantName}\b(?=\s*[=;])`,
  );
  const match = constantPattern.exec(source);

  if (!match) {
    return null;
  }

  return editorPositionAtOffset(
    source,
    match.index + match[0].lastIndexOf(normalizedConstantName),
  );
}

export function phpDocMethodPositionOrNull(
  source: string,
  methodName: string,
): EditorPosition | null {
  for (const match of source.matchAll(
    /@(?:(?:phpstan|psalm)-)?method\s+([^\r\n*]+)/g,
  )) {
    const body = match[1] ?? "";
    const bodyOffset = (match.index ?? 0) + match[0].indexOf(body);
    const methodMatch = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(body);

    if (methodMatch?.[1] !== methodName) {
      continue;
    }

    const methodOffset = bodyOffset + (methodMatch.index ?? 0);

    return editorPositionAtOffset(source, methodOffset);
  }

  return null;
}

export function phpPropertyPositionOrNull(
  source: string,
  propertyName: string,
): EditorPosition | null {
  return (
    phpDeclaredPropertyPositionOrNull(source, propertyName) ??
    phpDocPropertyPositionOrNull(source, propertyName)
  );
}

export function phpDocPropertyPositionOrNull(
  source: string,
  propertyName: string,
): EditorPosition | null {
  const normalizedPropertyName = propertyName.trim().replace(/^\$+/, "");

  if (!normalizedPropertyName) {
    return null;
  }

  const pattern = new RegExp(
    String.raw`@(?:(?:phpstan|psalm)-)?property(?:-read|-write)?\s+[^\r\n*]+?\s+\$` +
      escapeRegExp(normalizedPropertyName) +
      String.raw`\b`,
    "g",
  );

  for (const match of source.matchAll(pattern)) {
    const propertyOffset =
      (match.index ?? 0) + match[0].lastIndexOf(normalizedPropertyName);

    return editorPositionAtOffset(source, propertyOffset);
  }

  return null;
}

function phpDeclaredPropertyPositionOrNull(
  source: string,
  propertyName: string,
): EditorPosition | null {
  const normalizedPropertyName = propertyName.trim().replace(/^\$+/, "");

  if (!normalizedPropertyName) {
    return null;
  }

  const pattern = new RegExp(
    String.raw`(?:^|\n)\s*(?:(?:public|protected|private|readonly|static|var)\s+)*(?:\??[\\A-Za-z_][\\A-Za-z0-9_]*(?:\|[\\A-Za-z_][\\A-Za-z0-9_]*)?\s+)?\$` +
      escapeRegExp(normalizedPropertyName) +
      String.raw`\b`,
    "g",
  );

  for (const match of source.matchAll(pattern)) {
    const propertyOffset =
      (match.index ?? 0) + match[0].lastIndexOf(normalizedPropertyName);

    return editorPositionAtOffset(source, propertyOffset);
  }

  return null;
}

export function phpImplementationDeclarationContextAt(
  source: string,
  position: EditorPosition,
): PhpImplementationDeclarationContext | null {
  const methodName = phpMethodDeclarationNameAtPosition(source, position);

  if (!methodName) {
    return null;
  }

  const typeKind = phpCurrentTypeKind(source);

  if (typeKind === "interface") {
    return { methodName, typeKind };
  }

  if (typeKind !== "class") {
    return null;
  }

  const declarationPrefix = phpMethodDeclarationPrefixAt(source, position);

  if (!declarationPrefix || !/\babstract\b/.test(declarationPrefix)) {
    return null;
  }

  return { methodName, typeKind };
}

export function phpCurrentTypeKind(
  source: string,
): "class" | "trait" | "enum" | "interface" | null {
  const match = /\b(class|trait|enum|interface)\s+[A-Za-z_][A-Za-z0-9_]*\b/.exec(
    source,
  );
  const kind = match?.[1];

  if (
    kind === "class" ||
    kind === "trait" ||
    kind === "enum" ||
    kind === "interface"
  ) {
    return kind;
  }

  return null;
}

export function phpExtendsClassName(source: string): string | null {
  const match =
    /\b(?:class|interface)\s+[A-Za-z_][A-Za-z0-9_]*[^{;]*?\bextends\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)\b/m.exec(
      source,
    );
  return match?.[1]?.trim().replace(/^\\+/, "") || null;
}

export function phpSuperTypeReferences(source: string): string[] {
  const declaration =
    /\b(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*\b[\s\S]*?\{/.exec(
      source,
    );

  if (!declaration) {
    return [];
  }

  const header = declaration[0].slice(0, -1);
  const references: string[] = [];
  const extendsMatch = /\bextends\s+([\s\S]*?)(?=\bimplements\b|$)/.exec(
    header,
  );
  const implementsMatch = /\bimplements\s+([\s\S]*?)$/.exec(header);

  references.push(...phpClassReferenceList(extendsMatch?.[1] ?? ""));
  references.push(...phpClassReferenceList(implementsMatch?.[1] ?? ""));

  return references;
}

function methodCallContextAt(
  source: string,
  identifier: IdentifierAtOffset,
): PhpCoreIdentifierContext | null {
  const contextStart = Math.max(0, identifier.start - 800);
  const contextEnd = source.indexOf("\n", identifier.end);
  const context = source.slice(
    contextStart,
    contextEnd < 0 ? source.length : contextEnd,
  );
  const methodPattern = new RegExp(
    String.raw`(` +
      PHP_EXPRESSION_RECEIVER_PATTERN +
      String.raw`(?:` +
      PHP_MEMBER_CHAIN_SEGMENT_PATTERN +
      String.raw`)*?)` +
      PHP_MEMBER_ACCESS_PATTERN +
      escapeRegExp(identifier.name) +
      String.raw`\b\s*\(`,
    "g",
  );

  for (const match of context.matchAll(methodPattern)) {
    const matchStart = contextStart + (match.index ?? 0);
    const methodStart = matchStart + match[0].lastIndexOf(identifier.name);
    const methodEnd = methodStart + identifier.name.length;

    if (identifier.start >= methodStart && identifier.end <= methodEnd) {
      return {
        kind: "methodCall",
        methodName: identifier.name,
        receiverExpression: phpNormalizeReceiverExpression(match[1] || ""),
        variableName: phpSimpleVariableName(match[1] || "") || "",
      };
    }
  }

  return null;
}

function memberPropertyAccessContextAt(
  source: string,
  identifier: IdentifierAtOffset,
): PhpCoreIdentifierContext | null {
  const contextStart = Math.max(0, identifier.start - 800);
  const contextEnd = source.indexOf("\n", identifier.end);
  const context = source.slice(
    contextStart,
    contextEnd < 0 ? source.length : contextEnd,
  );
  const propertyPattern = new RegExp(
    String.raw`(` +
      PHP_EXPRESSION_RECEIVER_PATTERN +
      String.raw`(?:` +
      PHP_MEMBER_CHAIN_SEGMENT_PATTERN +
      String.raw`)*?)` +
      PHP_MEMBER_ACCESS_PATTERN +
      escapeRegExp(identifier.name) +
      String.raw`\b(?!\s*\()`,
    "g",
  );

  for (const match of context.matchAll(propertyPattern)) {
    const matchStart = contextStart + (match.index ?? 0);
    const propertyStart = matchStart + match[0].lastIndexOf(identifier.name);
    const propertyEnd = propertyStart + identifier.name.length;

    if (identifier.start >= propertyStart && identifier.end <= propertyEnd) {
      return {
        kind: "memberPropertyAccess",
        propertyName: identifier.name,
        receiverExpression: phpNormalizeReceiverExpression(match[1] || ""),
        variableName: phpSimpleVariableName(match[1] || "") || "",
      };
    }
  }

  return null;
}

function staticMemberAccessContextAt(
  source: string,
  identifier: IdentifierAtOffset,
): PhpCoreIdentifierContext | null {
  // `Class::class` is a magic constant resolving to the FQN string, never a
  // method or class constant: leave it for the classIdentifier fallback so the
  // `class` token does not shadow the receiver type navigation.
  if (identifier.name.toLowerCase() === "class") {
    return null;
  }

  const contextStart = Math.max(0, identifier.start - 800);
  const contextEnd = source.indexOf("\n", identifier.end);
  const context = source.slice(
    contextStart,
    contextEnd < 0 ? source.length : contextEnd,
  );
  // Capture the trailing token (group 2) so a `(` marks a static method call
  // while its absence marks a class constant / enum case access. Without this
  // split, `Class::CONST` was misclassified as a `staticMethodCall` with the
  // constant name as the method name and never navigated.
  const staticMemberPattern = new RegExp(
    `((?:\\\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)\\s*::\\s*${escapeRegExp(identifier.name)}\\b(\\s*\\()?`,
    "g",
  );

  for (const match of context.matchAll(staticMemberPattern)) {
    const matchStart = contextStart + (match.index ?? 0);
    const memberStart = matchStart + match[0].lastIndexOf(identifier.name);
    const memberEnd = memberStart + identifier.name.length;

    if (identifier.start < memberStart || identifier.end > memberEnd) {
      continue;
    }

    const className = (match[1] ?? "").replace(/^\\+/, "");

    if (match[2]) {
      return {
        className,
        kind: "staticMethodCall",
        methodName: identifier.name,
      };
    }

    return {
      className,
      constantName: identifier.name,
      kind: "classConstant",
    };
  }

  return null;
}

function phpMethodDeclarationNameAtPosition(
  source: string,
  position: EditorPosition,
): string | null {
  const offset = offsetAtPosition(source, position);
  const identifier = identifierAtOffset(source, offset);

  if (!identifier) {
    return null;
  }

  return phpMethodDeclarationPrefixAt(source, position) ? identifier.name : null;
}

function phpMethodDeclarationPrefixAt(
  source: string,
  position: EditorPosition,
): string | null {
  const offset = offsetAtPosition(source, position);
  const identifier = identifierAtOffset(source, offset);

  if (!identifier) {
    return null;
  }

  const declarationStart =
    Math.max(
      source.lastIndexOf(";", identifier.start - 1),
      source.lastIndexOf("{", identifier.start - 1),
      source.lastIndexOf("}", identifier.start - 1),
    ) + 1;
  const prefix = source.slice(declarationStart, identifier.start);

  return /\bfunction\s*&?\s*$/.test(prefix) ? prefix : null;
}

export function phpEnclosingMethodNameAt(
  source: string,
  position: EditorPosition,
): string | null {
  const offset = offsetAtPosition(source, position);
  let enclosingMethodName: string | null = null;

  for (const match of source.matchAll(
    /\bfunction\s*&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
  )) {
    const methodName = match[1] || "";
    const parametersStart = (match.index ?? 0) + match[0].length - 1;
    const parametersEnd = matchingParenthesisOffset(source, parametersStart);

    if (!parametersEnd) {
      continue;
    }

    const bodyStart = source.indexOf("{", parametersEnd);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd = matchingBraceOffset(source, bodyStart);

    if (!bodyEnd) {
      continue;
    }

    if (offset >= (match.index ?? 0) && offset <= bodyEnd) {
      enclosingMethodName = methodName;
    }
  }

  return enclosingMethodName;
}

function matchingBraceOffset(source: string, openOffset: number): number | null {
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

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character !== "}") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function phpClassReferenceList(source: string): string[] {
  return source
    .split(",")
    .map((part) => /\\?[A-Za-z_][A-Za-z0-9_\\]*/.exec(part.trim())?.[0] ?? "")
    .filter(Boolean);
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

function trimSlashes(path: string): string {
  return path.trim().split("\\").join("/").replace(/^\/+|\/+$/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
