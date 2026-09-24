import type { DiffLine, DiffLineKind } from "./lineDiff";

export const DIFF_HUNK_CONTEXT_LINES = 3;
export const MAX_RENDERED_DIFF_LINES_PER_FILE = 2_000;

export interface DiffHunk {
  readonly header: string;
  readonly lines: ReadonlyArray<DiffLine>;
}

export interface SplitDiffCell {
  readonly line: number;
  readonly text: string;
  readonly kind: DiffLineKind;
}

export interface SplitDiffRow {
  readonly left: SplitDiffCell | null;
  readonly right: SplitDiffCell | null;
}

type LineField = "oldLine" | "newLine";

export function groupDiffHunks(
  lines: ReadonlyArray<DiffLine>,
  context: number = DIFF_HUNK_CONTEXT_LINES,
): ReadonlyArray<DiffHunk> {
  const ranges: Array<{ start: number; end: number }> = [];
  lines.forEach((line, index) => {
    if (line.kind === "context") return;
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last !== undefined && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
      return;
    }
    ranges.push({ start, end });
  });
  return ranges.map(({ start, end }) => hunkFor(lines, start, end));
}

export function limitDiffHunks(
  hunks: ReadonlyArray<DiffHunk>,
  maxLines: number,
): { readonly hunks: ReadonlyArray<DiffHunk>; readonly hiddenChangedLines: number } {
  const kept: DiffHunk[] = [];
  let budget = maxLines;
  let hiddenChangedLines = 0;
  for (const hunk of hunks) {
    if (budget <= 0) {
      hiddenChangedLines += changedLineCount(hunk.lines);
      continue;
    }
    if (hunk.lines.length <= budget) {
      kept.push(hunk);
      budget -= hunk.lines.length;
      continue;
    }
    kept.push({ header: hunk.header, lines: hunk.lines.slice(0, budget) });
    hiddenChangedLines += changedLineCount(hunk.lines.slice(budget));
    budget = 0;
  }
  return { hunks: kept, hiddenChangedLines };
}

function changedLineCount(lines: ReadonlyArray<DiffLine>): number {
  return lines.reduce((total, line) => (line.kind === "context" ? total : total + 1), 0);
}

export function splitDiffRows(hunk: DiffHunk): ReadonlyArray<SplitDiffRow> {
  const rows: SplitDiffRow[] = [];
  const lines = hunk.lines;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.kind === "context") {
      rows.push({ left: cell(line, "oldLine"), right: cell(line, "newLine") });
      index += 1;
      continue;
    }
    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];
    while (index < lines.length && lines[index]?.kind === "del") {
      deletions.push(lines[index] as DiffLine);
      index += 1;
    }
    while (index < lines.length && lines[index]?.kind === "add") {
      additions.push(lines[index] as DiffLine);
      index += 1;
    }
    const count = Math.max(deletions.length, additions.length);
    for (let row = 0; row < count; row += 1) {
      const left = deletions[row];
      const right = additions[row];
      rows.push({
        left: left === undefined ? null : cell(left, "oldLine"),
        right: right === undefined ? null : cell(right, "newLine"),
      });
    }
  }
  return rows;
}

function hunkFor(lines: ReadonlyArray<DiffLine>, start: number, end: number): DiffHunk {
  const slice = lines.slice(start, end + 1);
  const oldCount = slice.filter((line) => line.oldLine !== null).length;
  const newCount = slice.filter((line) => line.newLine !== null).length;
  const oldStart = firstLine(slice, "oldLine") ?? lineBefore(lines, start, "oldLine");
  const newStart = firstLine(slice, "newLine") ?? lineBefore(lines, start, "newLine");
  return { header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, lines: slice };
}

function firstLine(lines: ReadonlyArray<DiffLine>, field: LineField): number | null {
  for (const line of lines) {
    const value = line[field];
    if (value !== null) return value;
  }
  return null;
}

function lineBefore(lines: ReadonlyArray<DiffLine>, start: number, field: LineField): number {
  for (let index = start - 1; index >= 0; index -= 1) {
    const value = lines[index]?.[field] ?? null;
    if (value !== null) return value;
  }
  return 0;
}

function cell(line: DiffLine, field: LineField): SplitDiffCell {
  return { line: line[field] ?? 0, text: line.text, kind: line.kind };
}
