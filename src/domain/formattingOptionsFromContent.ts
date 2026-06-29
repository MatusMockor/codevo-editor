import type { LanguageServerFormattingOptions } from "./languageServerFeatures";

const DEFAULT_TAB_SIZE = 2;

const CANDIDATE_SPACE_INDENTS = [2, 4, 6, 8] as const;

export function defaultFormattingOptions(): LanguageServerFormattingOptions {
  return {
    insertSpaces: true,
    tabSize: DEFAULT_TAB_SIZE,
  };
}

/**
 * Derives formatting options from a document's text content using the same
 * signals Monaco relies on for `detectIndentation`: whether indented lines use
 * tabs or spaces, and—for spaces—the most common indentation step between
 * consecutive lines. Falls back to two-space indentation when no indentation
 * can be observed.
 */
export function formattingOptionsFromContent(
  content: string,
  fallback: LanguageServerFormattingOptions = defaultFormattingOptions(),
): LanguageServerFormattingOptions {
  const lines = content.split("\n");

  let linesIndentedWithTabs = 0;
  let linesIndentedWithSpaces = 0;
  const spaceIndentVotes = new Map<number, number>();

  let previousSpaceIndent = 0;

  for (const line of lines) {
    const leadingSpaces = countLeading(line, " ");
    const leadingTabs = countLeading(line, "\t");

    if (leadingTabs > 0 && leadingSpaces === 0) {
      linesIndentedWithTabs += 1;
    }

    if (leadingSpaces > 0 && leadingTabs === 0) {
      linesIndentedWithSpaces += 1;
      countSpaceIndentVote(spaceIndentVotes, previousSpaceIndent, leadingSpaces);
    }

    previousSpaceIndent = leadingTabs > 0 ? 0 : leadingSpaces;
  }

  if (linesIndentedWithTabs > linesIndentedWithSpaces) {
    return { insertSpaces: false, tabSize: fallback.tabSize };
  }

  if (linesIndentedWithSpaces === 0) {
    return fallback;
  }

  return {
    insertSpaces: true,
    tabSize: mostLikelySpaceIndent(spaceIndentVotes, fallback.tabSize),
  };
}

function countLeading(line: string, character: string): number {
  let count = 0;

  while (count < line.length && line[count] === character) {
    count += 1;
  }

  return count;
}

function countSpaceIndentVote(
  votes: Map<number, number>,
  previousIndent: number,
  currentIndent: number,
): void {
  const delta = Math.abs(currentIndent - previousIndent);

  if (delta === 0) {
    addVote(votes, currentIndent);
    return;
  }

  addVote(votes, delta);
}

function addVote(votes: Map<number, number>, indent: number): void {
  if (!CANDIDATE_SPACE_INDENTS.includes(indent as never)) {
    return;
  }

  votes.set(indent, (votes.get(indent) ?? 0) + 1);
}

function mostLikelySpaceIndent(
  votes: Map<number, number>,
  fallbackTabSize: number,
): number {
  let bestIndent = fallbackTabSize;
  let bestVotes = 0;

  for (const indent of CANDIDATE_SPACE_INDENTS) {
    const count = votes.get(indent) ?? 0;

    if (count > bestVotes) {
      bestVotes = count;
      bestIndent = indent;
    }
  }

  return bestIndent;
}
