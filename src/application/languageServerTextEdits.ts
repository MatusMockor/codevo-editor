import type {
  LanguageServerPosition,
  LanguageServerTextEdit,
} from "../domain/languageServerFeatures";

export function applyLanguageServerTextEdits(
  content: string,
  edits: LanguageServerTextEdit[],
): string {
  const indexedEdits = edits
    .map((edit) => ({
      end: byteOffsetForLanguageServerPosition(content, edit.range.end),
      newText: edit.newText,
      start: byteOffsetForLanguageServerPosition(content, edit.range.start),
    }))
    .sort((left, right) => right.start - left.start || right.end - left.end);
  let nextContent = content;
  let previousStart = content.length;

  for (const edit of indexedEdits) {
    if (edit.start > edit.end || edit.end > previousStart) {
      throw new Error("Workspace edit ranges overlap or are invalid.");
    }

    nextContent =
      nextContent.slice(0, edit.start) +
      edit.newText +
      nextContent.slice(edit.end);
    previousStart = edit.start;
  }

  return nextContent;
}

function byteOffsetForLanguageServerPosition(
  content: string,
  position: LanguageServerPosition,
): number {
  let line = 0;
  let character = 0;

  for (let index = 0; index < content.length; ) {
    if (line === position.line && character === position.character) {
      return index;
    }

    const codePoint = content.codePointAt(index);

    if (codePoint === undefined) {
      break;
    }

    const value = String.fromCodePoint(codePoint);

    if (value === "\n") {
      line += 1;
      character = 0;
      index += value.length;
      continue;
    }

    character += value.length;
    index += value.length;
  }

  if (line === position.line && character === position.character) {
    return content.length;
  }

  throw new Error("Workspace edit position is outside of the document.");
}
