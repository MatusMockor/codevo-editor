export const MAX_DIFF_VIEW_LINES_PER_SIDE = 20_000;
export const MAX_DIFF_VIEW_EDIT_DISTANCE = 1_500;

export type DiffLineKind = "context" | "add" | "del";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly text: string;
}

export interface LineDiffOptions {
  readonly ignoreWhitespace: boolean;
}

export type LineDiffResult =
  | {
      readonly kind: "ready";
      readonly lines: ReadonlyArray<DiffLine>;
      readonly added: number;
      readonly deleted: number;
    }
  | { readonly kind: "tooLarge"; readonly reason: "lines" | "editDistance" };

type EditOp = "equal" | "delete" | "insert";

export function splitDiffText(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function computeLineDiff(
  original: string,
  modified: string,
  options: LineDiffOptions,
): LineDiffResult {
  const oldLines = splitDiffText(original);
  const newLines = splitDiffText(modified);
  if (
    oldLines.length > MAX_DIFF_VIEW_LINES_PER_SIDE ||
    newLines.length > MAX_DIFF_VIEW_LINES_PER_SIDE
  ) {
    return { kind: "tooLarge", reason: "lines" };
  }
  const key = options.ignoreWhitespace ? whitespaceInsensitiveKey : exactKey;
  const oldKeys = oldLines.map(key);
  const newKeys = newLines.map(key);
  const prefix = commonPrefixLength(oldKeys, newKeys);
  const suffix = commonSuffixLength(oldKeys, newKeys, prefix);
  const script = shortestEditScript(
    oldKeys.slice(prefix, oldKeys.length - suffix),
    newKeys.slice(prefix, newKeys.length - suffix),
    MAX_DIFF_VIEW_EDIT_DISTANCE,
  );
  if (script === null) return { kind: "tooLarge", reason: "editDistance" };

  const lines: DiffLine[] = [];
  const context = (oldIndex: number, newIndex: number): DiffLine => ({
    kind: "context",
    oldLine: oldIndex + 1,
    newLine: newIndex + 1,
    text: newLines[newIndex] ?? "",
  });
  for (let index = 0; index < prefix; index += 1) lines.push(context(index, index));
  let oldIndex = prefix;
  let newIndex = prefix;
  let added = 0;
  let deleted = 0;
  for (const op of script) {
    if (op === "equal") {
      lines.push(context(oldIndex, newIndex));
      oldIndex += 1;
      newIndex += 1;
      continue;
    }
    if (op === "delete") {
      lines.push({
        kind: "del",
        oldLine: oldIndex + 1,
        newLine: null,
        text: oldLines[oldIndex] ?? "",
      });
      oldIndex += 1;
      deleted += 1;
      continue;
    }
    lines.push({
      kind: "add",
      oldLine: null,
      newLine: newIndex + 1,
      text: newLines[newIndex] ?? "",
    });
    newIndex += 1;
    added += 1;
  }
  for (let index = 0; index < suffix; index += 1)
    lines.push(context(oldIndex + index, newIndex + index));
  return { kind: "ready", lines, added, deleted };
}

function exactKey(line: string): string {
  return line;
}

function whitespaceInsensitiveKey(line: string): string {
  return line.replace(/\s+/g, "");
}

function commonPrefixLength(left: ReadonlyArray<string>, right: ReadonlyArray<string>): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
  prefix: number,
): number {
  const limit = Math.min(left.length, right.length) - prefix;
  let length = 0;
  while (length < limit && left[left.length - 1 - length] === right[right.length - 1 - length]) {
    length += 1;
  }
  return length;
}

function shortestEditScript(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
  maxDistance: number,
): EditOp[] | null {
  const n = left.length;
  const m = right.length;
  if (n === 0) return new Array<EditOp>(m).fill("insert");
  if (m === 0) return new Array<EditOp>(n).fill("delete");
  const limit = Math.min(maxDistance, n + m);
  const offset = limit + 1;
  const frontier = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];
  for (let distance = 0; distance <= limit; distance += 1) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down =
        diagonal === -distance ||
        (diagonal !== distance &&
          frontier[offset + diagonal - 1] < frontier[offset + diagonal + 1]);
      let x = down ? frontier[offset + diagonal + 1] : frontier[offset + diagonal - 1] + 1;
      let y = x - diagonal;
      while (x < n && y < m && left[x] === right[y]) {
        x += 1;
        y += 1;
      }
      frontier[offset + diagonal] = x;
      if (x >= n && y >= m) {
        trace.push(frontier.slice(offset - distance, offset + distance + 1));
        return backtrack(trace, n, m);
      }
    }
    trace.push(frontier.slice(offset - distance, offset + distance + 1));
  }
  return null;
}

function backtrack(trace: ReadonlyArray<Int32Array>, n: number, m: number): EditOp[] {
  const ops: EditOp[] = [];
  let x = n;
  let y = m;
  for (let distance = trace.length - 1; distance > 0; distance -= 1) {
    const previous = trace[distance - 1];
    const at = (diagonal: number): number => previous[diagonal + distance - 1];
    const diagonal = x - y;
    const previousDiagonal =
      diagonal === -distance || (diagonal !== distance && at(diagonal - 1) < at(diagonal + 1))
        ? diagonal + 1
        : diagonal - 1;
    const previousX = at(previousDiagonal);
    const previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) {
      ops.push("equal");
      x -= 1;
      y -= 1;
    }
    ops.push(previousDiagonal === diagonal + 1 ? "insert" : "delete");
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    ops.push("equal");
    x -= 1;
    y -= 1;
  }
  return ops.reverse();
}
