export const SPEECH_MAX_TRANSCRIPT_CHARACTERS = 4000;

export type SpeechTranscriptionFailureReason =
  "server-busy" | "server-disconnected" | "transcription-failed";
export type SpeechTranscription =
  | Readonly<{ kind: "transcribed"; text: string }>
  | Readonly<{ kind: "failed"; reason: SpeechTranscriptionFailureReason }>;

const RUNNER_SPEECH_FAILURE =
  /^Runner speech transcription failed: (not_found|invalid_input|too_large|unsupported_media|busy|speech_unavailable) \(HTTP [1-5][0-9]{2}\)\.$/;
const BUSY_MESSAGES: ReadonlySet<string> = new Set(["Runner is busy; retry shortly"]);
const DISCONNECTED_MESSAGES: ReadonlySet<string> = new Set([
  "Server is not connected",
  "Server connection changed during request",
  "Server connection was superseded",
  "Runner connection changed during request.",
  "Runner connection is closed.",
  "Runner connection is closed. Reconnect the server.",
  "Runner connection unavailable.",
  "Runner connection was superseded.",
  "Runner connections are shutting down",
  "Runner identity changed. Reconnect the server before continuing.",
]);
const FAILED: SpeechTranscription = { kind: "failed", reason: "transcription-failed" };
const FAILURE_REASONS: readonly SpeechTranscriptionFailureReason[] = [
  "server-busy",
  "server-disconnected",
  "transcription-failed",
];

export function isSpeechTranscriptText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length > SPEECH_MAX_TRANSCRIPT_CHARACTERS * 2) return false;
  if (value.includes("\0")) return false;
  return codePointCount(value) <= SPEECH_MAX_TRANSCRIPT_CHARACTERS;
}

export function parseSpeechTranscription(value: unknown): SpeechTranscription {
  if (typeof value !== "object" || value === null) return FAILED;
  const candidate = value as Readonly<{ kind?: unknown; text?: unknown; reason?: unknown }>;
  if (candidate.kind === "transcribed" && isSpeechTranscriptText(candidate.text)) {
    return { kind: "transcribed", text: candidate.text };
  }
  if (candidate.kind !== "failed") return FAILED;
  const reason = FAILURE_REASONS.find((known) => known === candidate.reason);
  return reason === undefined ? FAILED : { kind: "failed", reason };
}

export function speechTranscriptionErrorMessage(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  return "";
}

export function classifySpeechTranscriptionError(error: unknown): SpeechTranscriptionFailureReason {
  const message = speechTranscriptionErrorMessage(error);
  if (DISCONNECTED_MESSAGES.has(message)) return "server-disconnected";
  if (BUSY_MESSAGES.has(message)) return "server-busy";
  if (RUNNER_SPEECH_FAILURE.exec(message)?.[1] === "busy") return "server-busy";
  return "transcription-failed";
}

function codePointCount(value: string): number {
  let count = 0;
  for (const _character of value) count += 1;
  return count;
}
