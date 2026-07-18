import {
  parseLatteBlockSyntax,
  type LatteBlockDeclaration,
  type LatteBlockSourceSpan,
} from "../domain/latteBlockSyntax";
import {
  collectLatteMaskedRegions,
  innermostLatteExpressionSpanAt,
} from "../domain/latteSyntax";

export type LatteBlockSymbolOccurrenceKind =
  | "closing"
  | "declaration"
  | "include";

export interface LatteBlockSymbolOccurrence {
  declarationKind: LatteBlockDeclaration["kind"] | null;
  declarationSpan: LatteBlockSourceSpan | null;
  kind: LatteBlockSymbolOccurrenceKind;
  name: string;
  span: LatteBlockSourceSpan;
}

export interface LatteBlockIncludeCompletionContext {
  candidates: LatteBlockDeclaration[];
  prefix: string;
  replaceSpan: LatteBlockSourceSpan;
}

const MAX_COMPLETION_SCAN = 2_000;
const RESERVED_INCLUDE_NAMES = new Set(["block", "parent", "this"]);

export function latteBlockSymbolOccurrenceAt(
  source: string,
  offset: number,
): LatteBlockSymbolOccurrence | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  return (
    allLatteBlockSymbolOccurrences(source).find(({ span }) =>
      offset >= span.start && offset <= span.end,
    ) ?? null
  );
}

export function latteBlockSymbolOccurrences(
  source: string,
  name: string,
): LatteBlockSymbolOccurrence[] {
  return allLatteBlockSymbolOccurrences(source).filter(
    (occurrence) => occurrence.name === name,
  );
}

export function isProvablyLocalLatteBlockSymbol(
  source: string,
  name: string,
): boolean {
  const declarations = latteBlockSymbolOccurrences(source, name).filter(
    (occurrence) => occurrence.kind === "declaration",
  );

  return (
    declarations.length > 0 &&
    declarations.every((occurrence) => occurrence.declarationKind === "local")
  );
}

export function hasLatteBlockDeclaration(
  source: string,
  name: string,
): boolean {
  return latteBlockSymbolOccurrences(source, name).some(
    (occurrence) => occurrence.kind === "declaration",
  );
}

export function latteBlockIncludeCompletionAt(
  source: string,
  offset: number,
): LatteBlockIncludeCompletionContext | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  if (isMaskedOffset(source, offset)) {
    return null;
  }

  const scanStart = Math.max(0, offset - MAX_COMPLETION_SCAN);

  if (
    source.lastIndexOf("{*", offset - 1) > source.lastIndexOf("*}", offset - 1)
  ) {
    return null;
  }

  const braceStart = source.lastIndexOf("{", offset - 1);

  if (braceStart < scanStart || isEscaped(source, braceStart)) {
    return null;
  }

  const enclosingExpression = innermostLatteExpressionSpanAt(source, offset);

  if (enclosingExpression && enclosingExpression.openBrace < braceStart) {
    return null;
  }

  const fragment = source.slice(braceStart, offset);

  if (fragment.includes("}") || fragment.includes("\n") || fragment.includes("\r")) {
    return null;
  }

  const match = /^\{include\s+(?:(block)\s+)?(#)?([A-Za-z_][A-Za-z0-9_.-]*|)$/.exec(
    fragment,
  );

  if (!match) {
    return null;
  }

  const hasBlockMarker = Boolean(match[1]);
  const hasHashMarker = Boolean(match[2]);
  const prefix = match[3] ?? "";

  if (prefix.includes(".") && !hasBlockMarker && !hasHashMarker) {
    return null;
  }

  const replaceStart = offset - prefix.length;
  let replaceEnd = offset;

  while (/[A-Za-z0-9_.-]/.test(source[replaceEnd] ?? "")) {
    replaceEnd += 1;
  }

  const declarations = parseLatteBlockSyntax(source).declarations;
  const seen = new Set<string>();
  const candidates = declarations.filter((declaration) => {
    if (RESERVED_INCLUDE_NAMES.has(declaration.name)) {
      return false;
    }

    if (!declaration.name.toLowerCase().startsWith(prefix.toLowerCase())) {
      return false;
    }

    if (seen.has(declaration.name)) {
      return false;
    }

    seen.add(declaration.name);
    return true;
  });

  return {
    candidates,
    prefix,
    replaceSpan: { end: replaceEnd, start: replaceStart },
  };
}

export function isValidLatteBlockSymbolName(name: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) {
    return false;
  }

  return !RESERVED_INCLUDE_NAMES.has(name);
}

function allLatteBlockSymbolOccurrences(
  source: string,
): LatteBlockSymbolOccurrence[] {
  const syntax = parseLatteBlockSyntax(source);
  const occurrences: LatteBlockSymbolOccurrence[] = [];

  for (const declaration of syntax.declarations) {
    occurrences.push({
      declarationKind: declaration.kind,
      declarationSpan: declaration.nameSpan,
      kind: "declaration",
      name: declaration.name,
      span: declaration.nameSpan,
    });

    if (declaration.closingNameSpan) {
      occurrences.push({
        declarationKind: declaration.kind,
        declarationSpan: declaration.nameSpan,
        kind: "closing",
        name: declaration.name,
        span: declaration.closingNameSpan,
      });
    }
  }

  for (const include of syntax.includes) {
    occurrences.push({
      declarationKind: null,
      declarationSpan: null,
      kind: "include",
      name: include.name,
      span: include.nameSpan,
    });
  }

  return occurrences.sort((left, right) => left.span.start - right.span.start);
}

function isMaskedOffset(source: string, offset: number): boolean {
  return collectLatteMaskedRegions(source).some(
    (region) =>
      offset >= region.start && (offset < region.end || !region.closed),
  );
}

function isEscaped(source: string, offset: number): boolean {
  let slashCount = 0;
  let index = offset - 1;

  while (source[index] === "\\") {
    slashCount += 1;
    index -= 1;
  }

  return slashCount % 2 === 1;
}
