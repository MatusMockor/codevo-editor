import { useContext, useState } from "react";
import {
  CodeHighlightThemeContext,
  useHighlightedCode,
  type UseHighlightedCodeOptions,
} from "../../application/codeHighlight/codeHighlighter";
import type { CodeLanguageId } from "../../domain/codeHighlight/codeLanguage";
import {
  plainCodeToken,
  splitCodeLines,
  type HighlightedLine,
  type HighlightedLines,
} from "../../domain/codeHighlight/highlightedCode";
import type { MonacoAppTheme } from "../../domain/settings";

interface RetainedHighlight {
  readonly language: CodeLanguageId;
  readonly theme: MonacoAppTheme | null;
  readonly lines: HighlightedLines;
}

export function useRetainedHighlightedCode(
  text: string,
  language: CodeLanguageId,
  options: UseHighlightedCodeOptions,
): HighlightedLines | null {
  const theme = useContext(CodeHighlightThemeContext);
  const state = useHighlightedCode(text, language, options);
  const [retained, setRetained] = useState<RetainedHighlight | null>(null);
  const published = state.kind === "highlighted" ? state.lines : null;
  if (published !== null && retained?.lines !== published) {
    setRetained({ language, theme, lines: published });
  }
  if (published !== null) return published;
  if (state.kind !== "pending" || options.enabled === false) return null;
  if (retained === null || retained.language !== language || retained.theme !== theme) return null;
  return stablePrefixLines(retained.lines, text);
}

export function stablePrefixLines(
  previous: HighlightedLines,
  text: string,
): HighlightedLines | null {
  const current = splitCodeLines(text);
  const lines: HighlightedLine[] = [];
  let reused = 0;
  for (const [index, line] of current.entries()) {
    const tokens = reused === index ? previous[index] : undefined;
    if (tokens !== undefined && lineText(tokens) === line) {
      lines.push(tokens);
      reused += 1;
      continue;
    }
    lines.push([plainCodeToken(line)]);
  }
  if (reused === 0) return null;
  return lines;
}

function lineText(line: HighlightedLine): string {
  let text = "";
  for (const token of line) text += token.text;
  return text;
}
