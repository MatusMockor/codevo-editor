export type SpeechTranscriptInsertionInput = Readonly<{
  text: string;
  selectionStart: number;
  selectionEnd: number;
  transcript: string;
}>;
export type SpeechTranscriptInsertion = Readonly<{ text: string; caret: number }>;

const CLOSING_PUNCTUATION = /^[.,;:!?%)\]}…»”’]/u;
const OPENING_PUNCTUATION = /[([{«„“‘]$/u;
const TRAILING_WHITESPACE = /\s$/u;
const LEADING_WHITESPACE = /^\s/u;

export function insertSpeechTranscript(
  input: SpeechTranscriptInsertionInput,
): SpeechTranscriptInsertion {
  const start = clampOffset(Math.min(input.selectionStart, input.selectionEnd), input.text);
  const end = clampOffset(Math.max(input.selectionStart, input.selectionEnd), input.text);
  const transcript = input.transcript.trim();
  if (transcript.length === 0) return { text: input.text, caret: end };
  const before = input.text.slice(0, start);
  const after = input.text.slice(end);
  const inserted = `${leadingSeparator(before, transcript)}${transcript}`;
  const caret = before.length + inserted.length;
  return { text: `${before}${inserted}${trailingSeparator(after)}${after}`, caret };
}

function clampOffset(offset: number, text: string): number {
  if (!Number.isFinite(offset)) return text.length;
  return Math.min(Math.max(0, Math.trunc(offset)), text.length);
}

function leadingSeparator(before: string, transcript: string): string {
  if (before.length === 0) return "";
  if (TRAILING_WHITESPACE.test(before)) return "";
  if (OPENING_PUNCTUATION.test(before)) return "";
  if (CLOSING_PUNCTUATION.test(transcript)) return "";
  return " ";
}

function trailingSeparator(after: string): string {
  if (after.length === 0) return "";
  if (LEADING_WHITESPACE.test(after)) return "";
  if (CLOSING_PUNCTUATION.test(after)) return "";
  return " ";
}
