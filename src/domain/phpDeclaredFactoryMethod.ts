import { parsePhpClassUseBody } from "./phpAddImport";
import {
  parsePhpClassStructure,
  phpTopLevelTypeDeclarationNames,
  type PhpMethodMember,
  type PhpVisibility,
} from "./phpClassStructure";
import { maskPhpSource } from "./phpSourceMask";

export interface PhpDeclaredFactoryMethod {
  /** Exact FQCN whose declaration was inspected, without a leading slash. */
  declaringClassName: string;
  /** Source context retained for later import-sensitive application work. */
  declaringSource: string;
  isStatic: boolean;
  nativeReturnType: string | null;
  /** FQCN for a single class-like return, otherwise `null`. */
  resolvedReturnClassName: string | null;
  visibility: Exclude<PhpVisibility, "private">;
}

const PHP_BUILTIN_RETURN_TYPES = new Set([
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
  "string",
  "true",
  "void",
]);

/**
 * Extracts one real method declared directly by one exact PHP class.
 *
 * This intentionally does not inspect PHPDoc or inherited/magic methods. Files
 * containing multiple named types are rejected because they do not provide an
 * unambiguous declaration context for factory materialization.
 */
export function phpDeclaredFactoryMethod(
  source: string,
  targetClassName: string,
  methodName: string,
): PhpDeclaredFactoryMethod | null {
  const match = phpDeclaredFactoryMethodMatch(
    source,
    targetClassName,
    methodName,
  );

  if (!match || match.method.visibility === "private") {
    return null;
  }

  return {
    declaringClassName: match.declaringClassName,
    declaringSource: source,
    isStatic: match.method.isStatic,
    nativeReturnType: match.method.returnType,
    resolvedReturnClassName: resolvedClassLikeReturnName(
      source,
      match.declaringClassName,
      match.method.returnType,
    ),
    visibility: match.method.visibility,
  };
}

export function phpDirectlyDeclaresFactoryMethod(
  source: string,
  targetClassName: string,
  methodName: string,
): boolean {
  return (
    phpDeclaredFactoryMethodMatch(source, targetClassName, methodName) !== null
  );
}

export function phpDeclaresExactFactoryClass(
  source: string,
  targetClassName: string,
): boolean {
  return phpExactFactoryClassContext(source, targetClassName) !== null;
}

function phpDeclaredFactoryMethodMatch(
  source: string,
  targetClassName: string,
  methodName: string,
): { declaringClassName: string; method: PhpMethodMember } | null {
  const normalizedMethod = methodName.trim();

  if (!isPhpIdentifier(normalizedMethod)) {
    return null;
  }

  const context = phpExactFactoryClassContext(source, targetClassName);

  if (!context) {
    return null;
  }

  const methods = context.structure.methods.filter(
    (method) => method.name.toLowerCase() === normalizedMethod.toLowerCase(),
  );

  if (methods.length !== 1) {
    return null;
  }

  const method = methods[0];

  if (!method) {
    return null;
  }

  return {
    declaringClassName: context.declaringClassName,
    method,
  };
}

function phpExactFactoryClassContext(
  source: string,
  targetClassName: string,
) {
  const normalizedTarget = normalizeClassName(targetClassName);

  if (!normalizedTarget) {
    return null;
  }

  const structuralSource = maskPhpSource(source);
  const declaredNames = phpTopLevelTypeDeclarationNames(structuralSource);

  if (declaredNames.length !== 1) {
    return null;
  }

  const declaredShortName = declaredNames[0];

  if (!declaredShortName) {
    return null;
  }

  const namespace = namespaceBeforeDeclaration(structuralSource);

  if (namespace === undefined) {
    return null;
  }

  const declaringClassName = namespace
    ? `${namespace}\\${declaredShortName}`
    : declaredShortName;

  if (declaringClassName.toLowerCase() !== normalizedTarget.toLowerCase()) {
    return null;
  }

  const structure = parsePhpClassStructure(structuralSource, declaredShortName);

  if (structure.kind !== "class" && structure.kind !== "abstract-class") {
    return null;
  }

  return {
    declaringClassName,
    structure,
  };
}

function resolvedClassLikeReturnName(
  source: string,
  declaringClassName: string,
  nativeReturnType: string | null,
): string | null {
  if (!nativeReturnType) {
    return null;
  }

  const candidate = nativeReturnType.replace(/^\?/, "").trim();

  if (!candidate || candidate.includes("|") || candidate.includes("&")) {
    return null;
  }

  const lowerCandidate = candidate.toLowerCase();

  if (lowerCandidate === "self" || lowerCandidate === "static") {
    return declaringClassName;
  }

  if (
    lowerCandidate === "parent" ||
    PHP_BUILTIN_RETURN_TYPES.has(lowerCandidate)
  ) {
    return null;
  }

  if (!isPhpClassName(candidate)) {
    return null;
  }

  return resolveClassLikeName(source, declaringClassName, candidate);
}

function resolveClassLikeName(
  source: string,
  declaringClassName: string,
  candidate: string,
): string | null {
  const normalizedCandidate = candidate.replace(/^\\+/, "");

  if (candidate.startsWith("\\")) {
    return normalizedCandidate;
  }

  const [firstSegment, ...remainingSegments] = normalizedCandidate.split("\\");

  if (!firstSegment) {
    return null;
  }

  const imports = classImportsBeforeDeclaration(maskPhpSource(source));
  const matchingImports = imports.filter(
    (entry) => entry.alias.toLowerCase() === firstSegment.toLowerCase(),
  );

  if (matchingImports.length > 1) {
    return null;
  }

  const imported = matchingImports[0];

  if (imported) {
    return [imported.fqn, ...remainingSegments].join("\\");
  }

  const namespace = namespaceFromClassName(declaringClassName);

  if (!namespace) {
    return normalizedCandidate;
  }

  return `${namespace}\\${normalizedCandidate}`;
}

function classImportsBeforeDeclaration(
  structuralSource: string,
): Array<{ alias: string; fqn: string }> {
  const declarationOffset = firstTypeDeclarationOffset(structuralSource);
  const prefix = structuralSource.slice(0, declarationOffset);
  const imports: Array<{ alias: string; fqn: string }> = [];
  const pattern = /\buse\s+([^;]+);/gi;

  for (const match of prefix.matchAll(pattern)) {
    if (!isStatementBoundaryBefore(prefix, match.index ?? 0)) {
      continue;
    }

    const body = match[1]?.trim();

    if (!body || /^(?:const|function)\b/i.test(body)) {
      continue;
    }

    imports.push(...parsePhpClassUseBody(body));
  }

  return imports;
}

function isStatementBoundaryBefore(source: string, offset: number): boolean {
  let index = offset - 1;

  while (index >= 0 && /\s/.test(source[index] || "")) {
    index -= 1;
  }

  if (index < 0) {
    return true;
  }

  return source[index] === ";" || source[index] === "{" || source[index] === "}";
}

function namespaceBeforeDeclaration(
  structuralSource: string,
): string | null | undefined {
  const declarationOffset = firstTypeDeclarationOffset(structuralSource);
  const prefix = structuralSource.slice(0, declarationOffset);
  const matches = Array.from(
    prefix.matchAll(/\bnamespace\s+([^;{]+)[;{]/gi),
  );

  if (matches.length > 1) {
    return undefined;
  }

  const namespace = matches[0]?.[1]?.trim().replace(/^\\+/, "");

  return namespace || null;
}

function firstTypeDeclarationOffset(source: string): number {
  const match = /\b(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*/i.exec(
    source,
  );

  return match?.index ?? source.length;
}

function namespaceFromClassName(className: string): string | null {
  const separator = className.lastIndexOf("\\");

  if (separator < 0) {
    return null;
  }

  return className.slice(0, separator) || null;
}

function normalizeClassName(className: string): string | null {
  const normalized = className.trim().replace(/^\\+/, "");

  if (!isPhpClassName(normalized)) {
    return null;
  }

  return normalized;
}

function isPhpClassName(name: string): boolean {
  return /^(?:[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*$/.test(
    name.replace(/^\\/, ""),
  );
}

function isPhpIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
