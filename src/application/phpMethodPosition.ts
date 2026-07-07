import type { EditorPosition } from "../domain/languageServerFeatures";

export function phpMethodPositionInSource(
  source: string,
  methodNames: readonly string[],
): EditorPosition | null {
  for (const name of methodNames) {
    const pattern = new RegExp(`\\bfunction\\s+&?${name}\\b`);
    const match = pattern.exec(source);

    if (match) {
      const nameOffset = match.index + match[0].length - name.length;
      return editorPositionAtOffset(source, nameOffset);
    }
  }

  return null;
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split("\n");

  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    lineNumber: lines.length,
  };
}
