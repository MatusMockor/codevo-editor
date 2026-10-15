export interface CodeToken {
  readonly text: string;
  readonly color: string | null;
  readonly italic: boolean;
  readonly bold: boolean;
}

export type HighlightedLine = ReadonlyArray<CodeToken>;
export type HighlightedLines = ReadonlyArray<HighlightedLine>;

export const MAX_HIGHLIGHT_CHARS = 1_048_576;
export const MAX_HIGHLIGHT_LINES = 30_000;
export const MAX_TOKENIZED_LINE_CHARS = 1_000;

export function splitCodeLines(text: string): readonly string[] {
  return text.split(/\r?\n/);
}

export function exceedsHighlightBudget(text: string): boolean {
  if (text.length > MAX_HIGHLIGHT_CHARS) return true;
  let lines = 1;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    lines += 1;
    if (lines > MAX_HIGHLIGHT_LINES) return true;
  }
  return false;
}

export function plainCodeToken(text: string): CodeToken {
  return { text, color: null, italic: false, bold: false };
}

export const MAX_HIGHLIGHT_BATCH_TEXTS = 128;

export function exceedsHighlightBatchBudget(texts: readonly string[]): boolean {
  if (texts.length > MAX_HIGHLIGHT_BATCH_TEXTS) return true;
  let chars = 0;
  let lines = 0;
  for (const text of texts) {
    chars += text.length;
    if (chars > MAX_HIGHLIGHT_CHARS) return true;
    lines += 1;
    for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
      lines += 1;
      if (lines > MAX_HIGHLIGHT_LINES) return true;
    }
    if (lines > MAX_HIGHLIGHT_LINES) return true;
  }
  return false;
}
