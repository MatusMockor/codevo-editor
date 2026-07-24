import type * as Monaco from "monaco-editor";
import type { EditorDocument } from "../domain/workspace";

interface SmartIndentContentChange {
  readonly range?: { readonly startLineNumber: number };
  readonly text: string;
}

export function isSmartBlankLineIndentDocument(
  document: Pick<EditorDocument, "language">,
): boolean {
  return ["php", "blade", "latte", "javascript", "typescript"].includes(document.language);
}

export function smartBlankLineIndent(
  model: Monaco.editor.ITextModel,
  lineNumber: number,
): string | null {
  const line = model.getLineContent(lineNumber);
  if (line.trim().length > 0) return null;

  const previousLine = lineNumber > 1 ? model.getLineContent(lineNumber - 1) : "";
  const previousLineIndent = leadingWhitespace(previousLine);
  if (previousLine.trim().length === 0 && previousLineIndent.length > 0) {
    return previousLineIndent;
  }

  const previous = nearestNonEmptyLine(model, lineNumber, -1);
  if (!previous) return null;
  const previousIndent = leadingWhitespace(previous.content);
  return opensIndentedBlock(previous.content)
    ? previousIndent + indentationUnitNear(model, lineNumber, previousIndent)
    : previousIndent;
}

export function smartBlankLineIndentTargetLineNumber(
  changes: readonly SmartIndentContentChange[],
  fallbackLineNumber: number,
): number {
  const newLineChange = changes.find((change) => change.text.includes("\n"));
  if (!newLineChange?.range) return fallbackLineNumber;
  return newLineChange.range.startLineNumber + countOccurrences(newLineChange.text, "\n");
}

export function leadingWhitespace(value: string): string {
  return /^\s*/.exec(value)?.[0] ?? "";
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function nearestNonEmptyLine(
  model: Monaco.editor.ITextModel,
  lineNumber: number,
  direction: -1 | 1,
): { readonly content: string; readonly lineNumber: number } | null {
  for (
    let candidate = lineNumber + direction;
    candidate >= 1 && candidate <= model.getLineCount();
    candidate += direction
  ) {
    const content = model.getLineContent(candidate);
    if (content.trim().length > 0) return { content, lineNumber: candidate };
  }
  return null;
}

function indentationUnitNear(
  model: Monaco.editor.ITextModel,
  lineNumber: number,
  baseIndent: string,
): string {
  const next = nearestNonEmptyLine(model, lineNumber, 1);
  if (next) {
    const nextIndent = leadingWhitespace(next.content);
    if (nextIndent.startsWith(baseIndent) && nextIndent.length > baseIndent.length) {
      return nextIndent.slice(baseIndent.length);
    }
  }

  for (let candidate = 1; candidate < model.getLineCount(); candidate += 1) {
    const currentIndent = leadingWhitespace(model.getLineContent(candidate));
    const nextIndent = leadingWhitespace(model.getLineContent(candidate + 1));
    if (nextIndent.startsWith(currentIndent) && nextIndent.length > currentIndent.length) {
      return nextIndent.slice(currentIndent.length);
    }
  }
  return "  ";
}

function opensIndentedBlock(value: string): boolean {
  return /(?:\{|\[|\(|=>)\s*(?:\/\/.*)?$/.test(value.trimEnd());
}
