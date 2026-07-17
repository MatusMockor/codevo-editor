import {
  parsePhpClassStructure,
  phpTopLevelTypeDeclarationNames,
} from "./phpClassStructure";
import { resolvePhpClassName } from "./phpClassNameResolution";
import { maskPhpSource } from "./phpSourceMask";

export type LattePhpExtensionCallableKind = "instance" | "static";

export interface LattePhpExtensionFilter {
  callableOffset?: number;
  callableKind?: LattePhpExtensionCallableKind;
  className?: string;
  methodName?: string;
  name: string;
  offset: number;
  serviceClassName?: string;
}

export interface LattePhpExtensionFilterCallable {
  callableOffset?: number;
  callableKind?: LattePhpExtensionCallableKind;
  className?: string;
  methodName?: string;
  serviceClassName?: string;
}

interface ArrayReturnRange {
  end: number;
  start: number;
}

export function lattePhpExtensionFiltersFromSource(
  source: string,
): LattePhpExtensionFilter[] {
  return lattePhpExtensionCallableMapEntriesFromSource(source, "getFilters");
}

export function lattePhpExtensionCallableMapEntriesFromSource(
  source: string,
  getterMethodName: string,
): LattePhpExtensionFilter[] {
  const masked = maskPhpSource(source);
  const filters: LattePhpExtensionFilter[] = [];
  const getterMethodPattern = new RegExp(
    `\\bfunction\\s+${getterMethodName}\\s*\\(`,
    "g",
  );

  for (
    let match = getterMethodPattern.exec(masked);
    match;
    match = getterMethodPattern.exec(masked)
  ) {
    const methodBody = getFiltersMethodBody(masked, match.index);

    if (!methodBody) {
      continue;
    }

    const returnedArray = staticArrayReturnRange(masked, methodBody);

    if (!returnedArray) {
      continue;
    }

    filters.push(
      ...stringKeyFiltersFromArray(
        source,
        masked,
        returnedArray,
        methodBody.start,
      ),
    );
  }

  return filters;
}

function getFiltersMethodBody(
  masked: string,
  functionOffset: number,
): { end: number; start: number } | null {
  const openParen = masked.indexOf("(", functionOffset);

  if (openParen < 0) {
    return null;
  }

  const closeParen = matchingPair(masked, openParen, "(", ")");

  if (closeParen === null) {
    return null;
  }

  const bodyStart = nextBraceOrSemicolon(masked, closeParen + 1);

  if (bodyStart === null || masked[bodyStart] !== "{") {
    return null;
  }

  const signatureTail = masked.slice(closeParen + 1, bodyStart);

  if (!/:\s*array\b/i.test(signatureTail)) {
    return null;
  }

  const bodyEnd = matchingPair(masked, bodyStart, "{", "}");

  if (bodyEnd === null) {
    return null;
  }

  return { end: bodyEnd, start: bodyStart + 1 };
}

function staticArrayReturnRange(
  masked: string,
  methodBody: { end: number; start: number },
): ArrayReturnRange | null {
  let squareDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;

  for (let index = methodBody.start; index < methodBody.end; index += 1) {
    const character = masked[index] ?? "";

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      braceDepth -= 1;
      continue;
    }

    if (character === "[") {
      squareDepth += 1;
      continue;
    }

    if (character === "]") {
      squareDepth -= 1;
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      parenDepth -= 1;
      continue;
    }

    if (braceDepth > 0 || squareDepth > 0 || parenDepth > 0) {
      continue;
    }

    if (!keywordAt(masked, index, "return")) {
      continue;
    }

    const arrayStart = skipSpaces(masked, index + "return".length);

    if (masked[arrayStart] === "[") {
      const arrayEnd = matchingPair(masked, arrayStart, "[", "]");

      return arrayEnd === null
        ? null
        : { end: arrayEnd, start: arrayStart + 1 };
    }

    if (keywordAt(masked, arrayStart, "array")) {
      const openParen = skipSpaces(masked, arrayStart + "array".length);

      if (masked[openParen] !== "(") {
        return null;
      }

      const closeParen = matchingPair(masked, openParen, "(", ")");

      return closeParen === null
        ? null
        : { end: closeParen, start: openParen + 1 };
    }

    return null;
  }

  return null;
}

function stringKeyFiltersFromArray(
  source: string,
  masked: string,
  range: ArrayReturnRange,
  getFiltersBodyStart: number,
): LattePhpExtensionFilter[] {
  const filters: LattePhpExtensionFilter[] = [];
  let squareDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;

  for (let index = range.start; index < range.end; index += 1) {
    const character = masked[index] ?? "";

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      braceDepth -= 1;
      continue;
    }

    if (character === "[") {
      squareDepth += 1;
      continue;
    }

    if (character === "]") {
      squareDepth -= 1;
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      parenDepth -= 1;
      continue;
    }

    if (braceDepth > 0 || squareDepth > 0 || parenDepth > 0) {
      continue;
    }

    const quote = source[index] ?? "";

    if (quote !== "'" && quote !== '"') {
      continue;
    }

    const literal = stringLiteralAt(source, index, quote);

    if (!literal) {
      continue;
    }

    const arrowOffset = skipInlineSpaces(masked, literal.end + 1);

    if (masked.slice(arrowOffset, arrowOffset + 2) !== "=>") {
      index = literal.end;
      continue;
    }

    if (literal.name.length === 0) {
      index = literal.end;
      continue;
    }

    const callable = staticArrayCallable(
      source,
      arrowOffset + 2,
      getFiltersBodyStart,
    );

    filters.push({
      ...(callable ?? {}),
      name: literal.name,
      offset: index + 1,
    });
    index = literal.end;
  }

  return filters;
}

export function lattePhpExtensionArrayCallableAt(
  source: string,
  valueStart: number,
  containingOffset: number,
): LattePhpExtensionFilterCallable | undefined {
  return staticArrayCallable(source, valueStart, containingOffset);
}

function staticArrayCallable(
  source: string,
  valueStart: number,
  getFiltersBodyStart: number,
): LattePhpExtensionFilterCallable | undefined {
  const valueSource = source.slice(valueStart);
  const thisCallable =
    /^\s*\[\s*\$this\s*,\s*(["'])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]/.exec(
      valueSource,
    );
  const thisMethodName = thisCallable?.[2];

  if (thisMethodName) {
    if (!isPhpIdentifier(thisMethodName)) {
      return undefined;
    }

    const callableOffset = phpMethodNameOffsetInContainingClass(
      source,
      thisMethodName,
      getFiltersBodyStart,
    );

    const serviceClassName = containingPhpClassName(
      source,
      getFiltersBodyStart,
    );

    if (!serviceClassName) {
      return undefined;
    }

    return {
      callableKind: "instance",
      ...(callableOffset === undefined ? {} : { callableOffset }),
      className: serviceClassName,
      methodName: thisMethodName,
      serviceClassName,
    };
  }

  return staticClassCallable(source, valueStart, getFiltersBodyStart);
}

function staticClassCallable(
  source: string,
  valueStart: number,
  getFiltersBodyStart: number,
): LattePhpExtensionFilterCallable | undefined {
  const valueSource = source.slice(valueStart);
  const callable =
    /^\s*\[\s*(\\?(?:[A-Za-z_][A-Za-z0-9_]*\\)*[A-Za-z_][A-Za-z0-9_]*)::class\s*,\s*(["'])([A-Za-z_][A-Za-z0-9_]*)\2\s*\]/.exec(
      valueSource,
    );
  const className = callable?.[1];
  const methodName = callable?.[3];

  if (!className || !methodName) {
    return undefined;
  }

  if (!isPhpIdentifier(methodName)) {
    return undefined;
  }

  const methodOffsetInMatch = callable[0].lastIndexOf(methodName);

  if (methodOffsetInMatch < 0) {
    return undefined;
  }

  const callableOffset = valueStart + methodOffsetInMatch;
  const serviceClassName = resolvedCallableClassName(
    source,
    className,
    getFiltersBodyStart,
  );

  if (!serviceClassName) {
    return undefined;
  }

  return {
    callableKind: "static",
    callableOffset,
    className,
    methodName,
    serviceClassName,
  };
}

function resolvedCallableClassName(
  source: string,
  className: string,
  getFiltersBodyStart: number,
): string | null {
  const normalized = className.replace(/^\\+/, "");
  const lower = normalized.toLowerCase();

  if (lower === "self" || lower === "static") {
    return containingPhpClassName(source, getFiltersBodyStart);
  }

  if (lower === "parent") {
    return null;
  }

  if (lower.startsWith("namespace\\")) {
    return resolvePhpClassName(source, normalized.slice("namespace\\".length));
  }

  return resolvePhpClassName(source, className);
}

function containingPhpClassName(source: string, offset: number): string | null {
  const structure = phpClassStructureContainingOffset(source, offset);
  const className = structure.typeDeclaration?.name;

  if (!className) {
    return null;
  }

  const namespace = phpNamespaceName(source);
  return namespace ? `${namespace}\\${className}` : className;
}

function phpNamespaceName(source: string): string | null {
  const match = /^\s*namespace\s+([^;{]+)[;{]/m.exec(source);
  return match?.[1]?.trim().replace(/^\\+/, "") || null;
}

function phpMethodNameOffsetInContainingClass(
  source: string,
  methodName: string,
  getFiltersBodyStart: number,
): number | undefined {
  const type = phpClassStructureContainingOffset(source, getFiltersBodyStart);
  const method = type.methods.find(
    (candidate) => candidate.name === methodName,
  );

  return method
    ? phpMethodMemberNameOffset(source, method.declarationOffset)
    : undefined;
}

function phpMethodMemberNameOffset(
  source: string,
  declarationOffset: number,
): number | undefined {
  const declaration = /\bfunction\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(
    source.slice(declarationOffset),
  );

  return declaration?.index === undefined || declaration.index < 0
    ? undefined
    : declarationOffset +
        declaration.index +
        declaration[0].lastIndexOf(declaration[1] ?? "");
}

function phpClassStructureContainingOffset(source: string, offset: number) {
  for (const className of phpTopLevelTypeDeclarationNames(source)) {
    const structure = parsePhpClassStructure(source, className);
    const declaration = structure.typeDeclaration;

    if (
      declaration &&
      offset > declaration.bodyStartOffset &&
      offset < declaration.bodyEndOffset
    ) {
      return structure;
    }
  }

  return parsePhpClassStructure(source);
}

export function lattePhpStringLiteralAt(
  source: string,
  quoteOffset: number,
  quote: string,
): { end: number; name: string } | null {
  return stringLiteralAt(source, quoteOffset, quote);
}

function stringLiteralAt(
  source: string,
  quoteOffset: number,
  quote: string,
): { end: number; name: string } | null {
  let name = "";

  for (let index = quoteOffset + 1; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (character === "\n" || character === "\r") {
      return null;
    }

    if (character === "\\") {
      const next = source[index + 1];

      if (next === undefined) {
        return null;
      }

      name += next;
      index += 1;
      continue;
    }

    if (character === quote) {
      return { end: index, name };
    }

    name += character;
  }

  return null;
}

function nextBraceOrSemicolon(masked: string, start: number): number | null {
  for (let index = start; index < masked.length; index += 1) {
    const character = masked[index] ?? "";

    if (character === "{" || character === ";") {
      return index;
    }
  }

  return null;
}

function matchingPair(
  masked: string,
  openIndex: number,
  open: string,
  close: string,
): number | null {
  if (openIndex < 0 || masked[openIndex] !== open) {
    return null;
  }

  let depth = 0;

  for (let index = openIndex; index < masked.length; index += 1) {
    const character = masked[index] ?? "";

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character === close) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function keywordAt(source: string, offset: number, keyword: string): boolean {
  if (source.slice(offset, offset + keyword.length) !== keyword) {
    return false;
  }

  return (
    !isIdentifierCharacter(source[offset - 1]) &&
    !isIdentifierCharacter(source[offset + keyword.length])
  );
}

function skipSpaces(source: string, start: number): number {
  let index = start;

  while (/\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function skipInlineSpaces(source: string, start: number): number {
  let index = start;

  while (source[index] === " " || source[index] === "\t") {
    index += 1;
  }

  return index;
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

function isPhpIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
