import type { EditorPosition } from "../domain/languageServerFeatures";

export function documentOffsetAtEditorPosition(source: string, position: EditorPosition): number {
  const lines = source.split("\n");
  const targetLine = Math.max(0, position.lineNumber - 1);
  if (targetLine >= lines.length) return source.length;
  let offset = 0;
  for (let line = 0; line < targetLine; line += 1) {
    offset += (lines[line]?.length ?? 0) + 1;
  }
  const column = Math.max(0, position.column - 1);
  return offset + Math.min(column, lines[targetLine]?.length ?? 0);
}

export function identifierAtEditorPosition(
  source: string,
  position: EditorPosition,
): string | null {
  const line = source.split(/\r?\n/)[position.lineNumber - 1] ?? "";
  const cursorIndex = Math.max(0, Math.min(line.length, position.column - 1));
  for (const match of line.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const start = match.index ?? 0;
    if (cursorIndex >= start && cursorIndex <= start + match[0].length) return match[0];
  }
  return null;
}
