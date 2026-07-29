import type * as Monaco from "monaco-editor";
import type {
  LanguageServerLinkedEditingRanges,
  LanguageServerSelectionRange,
} from "../domain/languageServerFeatures";
import { isSafeLinkedEditingWordPattern } from "../domain/linkedEditingRangesPolicy";

export function flattenJavaScriptTypeScriptSelectionRange(
  monaco: typeof Monaco,
  selectionRange: LanguageServerSelectionRange,
): Monaco.languages.SelectionRange[] {
  const ranges: Monaco.languages.SelectionRange[] = [];
  let current: LanguageServerSelectionRange | null = selectionRange;
  while (current) {
    ranges.push({ range: toMonacoRange(monaco, current.range) });
    current = current.parent;
  }
  return ranges;
}

export function toJavaScriptTypeScriptMonacoLinkedEditingRanges(
  monaco: typeof Monaco,
  ranges: LanguageServerLinkedEditingRanges | null,
): Monaco.languages.LinkedEditingRanges | null {
  if (!ranges || ranges.ranges.length === 0) {
    return null;
  }
  return {
    ranges: ranges.ranges.map((range) => toMonacoRange(monaco, range)),
    ...(ranges.wordPattern ? { wordPattern: safeRegExp(ranges.wordPattern) } : {}),
  };
}

function safeRegExp(pattern: string): RegExp | undefined {
  if (!isSafeLinkedEditingWordPattern(pattern)) {
    return undefined;
  }
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

function toMonacoRange(
  monaco: typeof Monaco,
  range: {
    end: { character: number; line: number };
    start: { character: number; line: number };
  },
): Monaco.Range {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}
