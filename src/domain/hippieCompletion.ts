// Hippie / Cyclic Word Completion (PhpStorm "Cyclic Expand Word", Emacs hippie,
// VS Code "Snippets / word-based suggestions" cycling). Given the word prefix
// typed before the caret, this pure module finds every distinct word in the
// current buffer that starts with that prefix, ordered nearest-to-the-caret
// first (backward search before forward search, PhpStorm/Emacs order), and
// drives the cyclic expansion session.
//
// Everything here is pure: it only ever looks at the in-memory buffer string and
// the caret offset. No LSP, disk, or network access - this is the "safe"
// text-from-buffer completion path.

// Identifier characters for word boundaries. `$` and `_` and digits are word
// characters so PHP (`$user_name`) and JS (`fooBar2`) identifiers stay intact.
const WORD_CHAR = /[A-Za-z0-9_$]/;

export interface HippieSession {
  /** Offset where the original prefix starts (caret offset minus prefix length). */
  readonly anchorOffset: number;
  /** Distinct candidate words, nearest-to-caret first. */
  readonly candidates: readonly string[];
  /**
   * Current position in the cycle. `-1` means the original typed prefix is
   * shown; `0..candidates.length-1` selects a candidate word.
   */
  readonly index: number;
  /** The original word prefix the user typed before the first expansion. */
  readonly prefix: string;
  /** The word currently inserted in place of the prefix (prefix when index === -1). */
  readonly word: string;
}

/**
 * Finds every distinct buffer word that starts with `prefix`, ordered with the
 * nearest occurrence to the caret first. Searches backward from the caret, then
 * forward, mirroring PhpStorm "Cyclic Expand Word" / Emacs hippie order.
 *
 * The match is case-sensitive and excludes both the bare prefix token under the
 * caret and any word equal to the prefix itself (an exact prefix is not an
 * expansion). Duplicates keep their nearest occurrence only.
 */
export function hippieCandidates(
  documentText: string,
  prefix: string,
  cursorOffset: number,
): string[] {
  if (!prefix) {
    return [];
  }

  const words = collectWords(documentText);
  const caretTokenStart = cursorOffset - prefix.length;
  const backward: string[] = [];
  const forward: string[] = [];

  for (const word of words) {
    if (word.start === caretTokenStart) {
      continue;
    }

    if (word.text === prefix || !word.text.startsWith(prefix)) {
      continue;
    }

    pushOrdered(word, caretTokenStart, backward, forward);
  }

  // Backward matches were collected front-to-back; reverse so the occurrence
  // closest to the caret leads. Forward matches are already nearest-first.
  backward.reverse();

  return dedupe([...backward, ...forward]);
}

/**
 * Starts a cyclic expansion: computes the candidates for `prefix` at the caret
 * and selects the first (nearest) one. Returns `null` when there is nothing to
 * expand, so the caller treats it as a no-op.
 */
export function startHippieSession(
  documentText: string,
  prefix: string,
  cursorOffset: number,
): HippieSession | null {
  const candidates = hippieCandidates(documentText, prefix, cursorOffset);

  if (candidates.length === 0) {
    return null;
  }

  return {
    anchorOffset: cursorOffset - prefix.length,
    candidates,
    index: 0,
    prefix,
    word: candidates[0],
  };
}

/**
 * Advances an active session to the next candidate, wrapping past the last
 * candidate back to the original typed prefix (index `-1`) and then forward to
 * the first candidate again. Anchor, prefix, and candidate list are preserved.
 */
export function advanceHippieSession(session: HippieSession): HippieSession {
  // Slots are: candidates[0..n-1] followed by the original prefix. We model the
  // prefix as a virtual slot at index n, then map it back to -1.
  const slotCount = session.candidates.length + 1;
  const currentSlot = session.index === -1 ? slotCount - 1 : session.index;
  const nextSlot = (currentSlot + 1) % slotCount;
  const isPrefixSlot = nextSlot === session.candidates.length;
  const nextIndex = isPrefixSlot ? -1 : nextSlot;

  return {
    ...session,
    index: nextIndex,
    word: isPrefixSlot ? session.prefix : session.candidates[nextSlot],
  };
}

interface BufferWord {
  readonly start: number;
  readonly text: string;
}

function collectWords(documentText: string): BufferWord[] {
  const words: BufferWord[] = [];
  let start = -1;

  for (let index = 0; index <= documentText.length; index += 1) {
    const isWordChar =
      index < documentText.length && WORD_CHAR.test(documentText[index]);

    if (isWordChar && start === -1) {
      start = index;
      continue;
    }

    if (isWordChar || start === -1) {
      continue;
    }

    words.push({ start, text: documentText.slice(start, index) });
    start = -1;
  }

  return words;
}

function pushOrdered(
  word: BufferWord,
  caretTokenStart: number,
  backward: string[],
  forward: string[],
): void {
  if (word.start < caretTokenStart) {
    backward.push(word.text);
    return;
  }

  forward.push(word.text);
}

function dedupe(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const word of words) {
    if (seen.has(word)) {
      continue;
    }

    seen.add(word);
    result.push(word);
  }

  return result;
}
