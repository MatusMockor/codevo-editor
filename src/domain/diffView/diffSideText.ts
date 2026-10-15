import type { DiffHunk } from "./diffHunks";
import type { DiffLine } from "./lineDiff";

export const MAX_HIGHLIGHTED_HUNKS_PER_FILE = 100;

export interface DiffLineSides {
  readonly oldIndex: number | null;
  readonly newIndex: number | null;
}

export interface DiffHunkSideTexts {
  readonly oldText: string;
  readonly newText: string;
  readonly sides: ReadonlyArray<DiffLineSides>;
}

export function diffHunkSideTexts(hunk: DiffHunk): DiffHunkSideTexts {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  const sides = hunk.lines.map((line) => sidesFor(line, oldLines, newLines));
  return { oldText: oldLines.join("\n"), newText: newLines.join("\n"), sides };
}

function sidesFor(line: DiffLine, oldLines: string[], newLines: string[]): DiffLineSides {
  switch (line.kind) {
    case "del":
      return { oldIndex: append(oldLines, line.text), newIndex: null };
    case "add":
      return { oldIndex: null, newIndex: append(newLines, line.text) };
    case "context":
      return { oldIndex: append(oldLines, line.text), newIndex: append(newLines, line.text) };
  }
}

function append(lines: string[], text: string): number {
  lines.push(text);
  return lines.length - 1;
}
