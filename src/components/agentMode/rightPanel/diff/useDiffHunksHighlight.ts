import { useMemo } from "react";
import { useHighlightedCodeBatch } from "../../../../application/codeHighlight/codeHighlightBatch";
import { codeLanguageForPath } from "../../../../domain/codeHighlight/codeLanguage";
import {
  exceedsHighlightBatchBudget,
  type HighlightedLine,
  type HighlightedLines,
} from "../../../../domain/codeHighlight/highlightedCode";
import type { DiffHunk } from "../../../../domain/diffView/diffHunks";
import {
  MAX_HIGHLIGHTED_HUNKS_PER_FILE,
  diffHunkSideTexts,
  type DiffHunkSideTexts,
  type DiffLineSides,
} from "../../../../domain/diffView/diffSideText";

export type DiffTokenSide = "old" | "new";

export interface DiffHunkHighlight {
  tokens(lineIndex: number, side: DiffTokenSide): HighlightedLine | null;
}

export interface DiffFileHighlight {
  readonly limited: boolean;
  hunk(hunkIndex: number): DiffHunkHighlight;
}

export const PLAIN_DIFF_HUNK_HIGHLIGHT: DiffHunkHighlight = { tokens: () => null };

const NO_TEXTS: readonly string[] = [];

export function useDiffFileHighlight(
  path: string,
  hunks: ReadonlyArray<DiffHunk>,
): DiffFileHighlight {
  const language = codeLanguageForPath(path);
  const sides = useMemo(
    () => hunks.slice(0, MAX_HIGHLIGHTED_HUNKS_PER_FILE).map(diffHunkSideTexts),
    [hunks],
  );
  const oldTexts = useMemo(() => sides.map((side) => side.oldText), [sides]);
  const newTexts = useMemo(() => sides.map((side) => side.newText), [sides]);
  const eligible =
    language !== "plaintext" &&
    !exceedsHighlightBatchBudget(oldTexts) &&
    !exceedsHighlightBatchBudget(newTexts);
  const oldState = useHighlightedCodeBatch(eligible ? oldTexts : NO_TEXTS, language, {
    enabled: eligible,
  });
  const newState = useHighlightedCodeBatch(eligible ? newTexts : NO_TEXTS, language, {
    enabled: eligible,
  });
  const oldLines = eligible && oldState.kind === "highlighted" ? oldState.texts : null;
  const newLines = eligible && newState.kind === "highlighted" ? newState.texts : null;
  const limited = hunks.length > MAX_HIGHLIGHTED_HUNKS_PER_FILE && eligible;
  return useMemo(
    () => ({
      limited,
      hunk: (hunkIndex) => hunkHighlight(sides[hunkIndex], oldLines, newLines, hunkIndex),
    }),
    [limited, sides, oldLines, newLines],
  );
}

function hunkHighlight(
  side: DiffHunkSideTexts | undefined,
  oldTexts: ReadonlyArray<HighlightedLines> | null,
  newTexts: ReadonlyArray<HighlightedLines> | null,
  hunkIndex: number,
): DiffHunkHighlight {
  if (side === undefined) return PLAIN_DIFF_HUNK_HIGHLIGHT;
  const oldLines = oldTexts?.[hunkIndex] ?? null;
  const newLines = newTexts?.[hunkIndex] ?? null;
  if (oldLines === null && newLines === null) return PLAIN_DIFF_HUNK_HIGHLIGHT;
  return {
    tokens: (lineIndex, tokenSide) => {
      const lineSides = side.sides[lineIndex];
      if (lineSides === undefined) return null;
      return lineTokens(lineSides, tokenSide, oldLines, newLines);
    },
  };
}

function lineTokens(
  sides: DiffLineSides,
  side: DiffTokenSide,
  oldLines: HighlightedLines | null,
  newLines: HighlightedLines | null,
): HighlightedLine | null {
  switch (side) {
    case "old":
      return sides.oldIndex === null ? null : (oldLines?.[sides.oldIndex] ?? null);
    case "new":
      return sides.newIndex === null ? null : (newLines?.[sides.newIndex] ?? null);
  }
}
