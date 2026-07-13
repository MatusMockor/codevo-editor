import {
  innermostLatteExpressionSpanAt,
  type LatteExpressionSpan,
} from "./latteSyntax";

export interface LatteTranslationReference {
  key: string;
  prefix: string;
  replaceEnd: number;
  replaceStart: number;
}

const LATTE_TRANSLATION_TAGS = new Set(["_", "translate"]);

export function latteTranslationReferenceAt(
  source: string,
  offset: number,
): LatteTranslationReference | null {
  const span = innermostLatteExpressionSpanAt(source, offset);

  if (!span || !LATTE_TRANSLATION_TAGS.has(span.tagName ?? "")) {
    return null;
  }

  return translationReferenceInSpan(source, offset, span);
}

function translationReferenceInSpan(
  source: string,
  offset: number,
  span: LatteExpressionSpan,
): LatteTranslationReference | null {
  const literal = firstStringLiteralInSpan(source, span);

  if (!literal) {
    return null;
  }

  if (offset < literal.contentStart || offset > literal.contentEnd) {
    return null;
  }

  const key = source.slice(literal.contentStart, literal.contentEnd);

  if (!isStaticTranslationKey(key)) {
    return null;
  }

  return {
    key,
    prefix: source.slice(literal.contentStart, offset),
    replaceEnd: literal.contentEnd,
    replaceStart: literal.contentStart,
  };
}

function firstStringLiteralInSpan(
  source: string,
  span: LatteExpressionSpan,
): { contentEnd: number; contentStart: number } | null {
  let index = span.expressionStart;

  while (index < span.contentEnd && /\s/.test(source[index] ?? "")) {
    index += 1;
  }

  const quote = source[index];

  if (quote !== "'" && quote !== '"') {
    return null;
  }

  const contentStart = index + 1;
  let cursor = contentStart;

  while (cursor < span.contentEnd) {
    const char = source[cursor];

    if (char === "\\") {
      cursor += 2;
      continue;
    }

    if (char === quote) {
      return { contentEnd: cursor, contentStart };
    }

    cursor += 1;
  }

  return { contentEnd: span.contentEnd, contentStart };
}

function isStaticTranslationKey(key: string): boolean {
  return /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)*$/.test(key);
}
