export type EditorChangeKind = "added" | "modified" | "deleted";

export interface EditorChangeHunk {
  currentLines: string[];
  endLineNumber: number;
  id: string;
  kind: EditorChangeKind;
  originalLines: string[];
  originalStartLineNumber: number;
  startLineNumber: number;
}

interface DiffOp {
  line: string;
  originalLineNumber: number | null;
  currentLineNumber: number | null;
  type: "equal" | "delete" | "insert";
}

interface HunkBuilder {
  currentLines: string[];
  currentStartLineNumber: number;
  originalLines: string[];
  originalStartLineNumber: number;
}

const MAX_EXACT_DIFF_CELLS = 250_000;

export function editorChangeHunks(
  originalContent: string,
  currentContent: string,
): EditorChangeHunk[] {
  if (originalContent === currentContent) {
    return [];
  }

  const originalLines = normalizedBaselineLines(originalContent);
  const currentLines = normalizedLines(currentContent);
  const prefixLength = commonPrefixLength(originalLines, currentLines);
  const suffixLength = commonSuffixLength(
    originalLines,
    currentLines,
    prefixLength,
  );
  const changedOriginalLines = originalLines.slice(
    prefixLength,
    originalLines.length - suffixLength,
  );
  const changedCurrentLines = currentLines.slice(
    prefixLength,
    currentLines.length - suffixLength,
  );

  if (!changedOriginalLines.length && !changedCurrentLines.length) {
    return [];
  }

  const ops =
    changedOriginalLines.length * changedCurrentLines.length <=
    MAX_EXACT_DIFF_CELLS
      ? exactLineDiffOps(
          changedOriginalLines,
          changedCurrentLines,
          prefixLength + 1,
        )
      : coarseLineDiffOps(
          changedOriginalLines,
          changedCurrentLines,
          prefixLength + 1,
        );

  return hunksFromOps(ops, Math.max(1, currentLines.length));
}

export function applyEditorChangeRevert(
  currentContent: string,
  hunk: EditorChangeHunk,
): string {
  const eol = currentContent.includes("\r\n") ? "\r\n" : "\n";
  const lines = normalizedLines(currentContent);
  const startIndex = Math.max(0, hunk.startLineNumber - 1);
  const removeCount = hunk.kind === "deleted" ? 0 : hunk.currentLines.length;
  lines.splice(startIndex, removeCount, ...hunk.originalLines);
  return lines.join(eol);
}

function normalizedLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, "\n").split("\n");
}

// The change gutter recomputes hunks on every keystroke, but the baseline
// (saved content / git baseline) is the same string while the user types. Cache
// its normalized split so only the current content is re-split per keystroke,
// keeping large-file typing responsive. A single-entry cache is enough because
// the baseline rarely changes; the result is read-only (callers only slice it),
// so it is safe to share.
let cachedBaselineContent: string | null = null;
let cachedBaselineLines: string[] = [];

function normalizedBaselineLines(content: string): string[] {
  if (cachedBaselineContent === content) {
    return cachedBaselineLines;
  }

  cachedBaselineContent = content;
  cachedBaselineLines = normalizedLines(content);
  return cachedBaselineLines;
}

function commonPrefixLength(left: string[], right: string[]): number {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;

  while (index < maxLength && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function commonSuffixLength(
  left: string[],
  right: string[],
  prefixLength: number,
): number {
  const maxLength = Math.min(left.length, right.length) - prefixLength;
  let length = 0;

  while (
    length < maxLength &&
    left[left.length - length - 1] === right[right.length - length - 1]
  ) {
    length += 1;
  }

  return length;
}

function exactLineDiffOps(
  originalLines: string[],
  currentLines: string[],
  firstLineNumber: number,
): DiffOp[] {
  const dp: number[][] = Array.from({ length: originalLines.length + 1 }, () =>
    Array(currentLines.length + 1).fill(0),
  );

  for (let originalIndex = originalLines.length - 1; originalIndex >= 0; originalIndex -= 1) {
    for (
      let currentIndex = currentLines.length - 1;
      currentIndex >= 0;
      currentIndex -= 1
    ) {
      dp[originalIndex][currentIndex] =
        originalLines[originalIndex] === currentLines[currentIndex]
          ? dp[originalIndex + 1][currentIndex + 1] + 1
          : Math.max(
              dp[originalIndex + 1][currentIndex],
              dp[originalIndex][currentIndex + 1],
            );
    }
  }

  const ops: DiffOp[] = [];
  let originalIndex = 0;
  let currentIndex = 0;
  let originalLineNumber = firstLineNumber;
  let currentLineNumber = firstLineNumber;

  while (
    originalIndex < originalLines.length ||
    currentIndex < currentLines.length
  ) {
    if (
      originalIndex < originalLines.length &&
      currentIndex < currentLines.length &&
      originalLines[originalIndex] === currentLines[currentIndex]
    ) {
      ops.push({
        currentLineNumber,
        line: originalLines[originalIndex],
        originalLineNumber,
        type: "equal",
      });
      originalIndex += 1;
      currentIndex += 1;
      originalLineNumber += 1;
      currentLineNumber += 1;
      continue;
    }

    if (
      currentIndex >= currentLines.length ||
      (originalIndex < originalLines.length &&
        dp[originalIndex + 1][currentIndex] >=
          dp[originalIndex][currentIndex + 1])
    ) {
      ops.push({
        currentLineNumber: null,
        line: originalLines[originalIndex],
        originalLineNumber,
        type: "delete",
      });
      originalIndex += 1;
      originalLineNumber += 1;
      continue;
    }

    ops.push({
      currentLineNumber,
      line: currentLines[currentIndex],
      originalLineNumber: null,
      type: "insert",
    });
    currentIndex += 1;
    currentLineNumber += 1;
  }

  return ops;
}

function coarseLineDiffOps(
  originalLines: string[],
  currentLines: string[],
  firstLineNumber: number,
): DiffOp[] {
  return [
    ...originalLines.map((line, index) => ({
      currentLineNumber: null,
      line,
      originalLineNumber: firstLineNumber + index,
      type: "delete" as const,
    })),
    ...currentLines.map((line, index) => ({
      currentLineNumber: firstLineNumber + index,
      line,
      originalLineNumber: null,
      type: "insert" as const,
    })),
  ];
}

function hunksFromOps(ops: DiffOp[], currentLineCount: number): EditorChangeHunk[] {
  const hunks: EditorChangeHunk[] = [];
  let builder: HunkBuilder | null = null;
  let originalCursor =
    ops.find((op) => op.originalLineNumber !== null)?.originalLineNumber ??
    ops.find((op) => op.currentLineNumber !== null)?.currentLineNumber ??
    1;
  let currentCursor =
    ops.find((op) => op.currentLineNumber !== null)?.currentLineNumber ??
    ops.find((op) => op.originalLineNumber !== null)?.originalLineNumber ??
    1;

  const flush = () => {
    if (!builder) {
      return;
    }

    const kind = editorChangeKind(
      builder.originalLines.length,
      builder.currentLines.length,
    );
    const startLineNumber = clampLineNumber(
      builder.currentStartLineNumber,
      currentLineCount,
    );
    const endLineNumber =
      builder.currentLines.length > 0
        ? startLineNumber + builder.currentLines.length - 1
        : startLineNumber;

    hunks.push({
      currentLines: builder.currentLines,
      endLineNumber,
      id: [
        kind,
        builder.originalStartLineNumber,
        startLineNumber,
        builder.originalLines.length,
        builder.currentLines.length,
      ].join(":"),
      kind,
      originalLines: builder.originalLines,
      originalStartLineNumber: builder.originalStartLineNumber,
      startLineNumber,
    });
    builder = null;
  };

  ops.forEach((op) => {
    if (op.type === "equal") {
      flush();
      originalCursor = (op.originalLineNumber ?? originalCursor) + 1;
      currentCursor = (op.currentLineNumber ?? currentCursor) + 1;
      return;
    }

    if (!builder) {
      builder = {
        currentLines: [],
        currentStartLineNumber: op.currentLineNumber ?? currentCursor,
        originalLines: [],
        originalStartLineNumber: op.originalLineNumber ?? originalCursor,
      };
    }

    if (op.type === "delete") {
      builder.originalLines.push(op.line);
      originalCursor = (op.originalLineNumber ?? originalCursor) + 1;
      return;
    }

    builder.currentLines.push(op.line);
    currentCursor = (op.currentLineNumber ?? currentCursor) + 1;
  });
  flush();

  return hunks;
}

function editorChangeKind(
  originalLineCount: number,
  currentLineCount: number,
): EditorChangeKind {
  if (originalLineCount === 0) {
    return "added";
  }

  if (currentLineCount === 0) {
    return "deleted";
  }

  return "modified";
}

function clampLineNumber(lineNumber: number, lineCount: number): number {
  return Math.min(Math.max(1, lineNumber), Math.max(1, lineCount));
}
