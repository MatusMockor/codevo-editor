export const SPEECH_LANGUAGES = ["sk", "en", "cs"] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];

export const SPEECH_MAX_SESSION_MS = 5 * 60 * 1000;
export const SPEECH_MAX_QUEUED_SEGMENTS = 4;
export const SPEECH_TRANSCRIPTION_TIMEOUT_MS = 120_000;
export const SPEECH_CAPTURE_STALL_MS = 5_000;
export const SPEECH_BUSY_RETRY_DELAYS_MS: readonly number[] = [400, 1200];

export type SpeechDictationUnavailableReason = "no-speech-server" | "capture-unsupported";
export type SpeechDictationFailureReason =
  | "permission-denied"
  | "microphone-failed"
  | "server-busy"
  | "transcription-failed"
  | "server-disconnected"
  | "limit-reached"
  | "no-speech-detected"
  | "no-speech-on-system-default"
  | "transcript-empty";
export type SpeechDictationInput = "selected" | "system-default";
export type SpeechDictationFinishOutcome = "completed" | "limit-reached" | "microphone-failed";
export type SpeechDictationTranscriptOutcome = "delivered" | "no-speech" | "empty";
export type SpeechDictationAvailability =
  | Readonly<{ kind: "available" }>
  | Readonly<{ kind: "unavailable"; reason: SpeechDictationUnavailableReason }>;

export type SpeechDictationState =
  | Readonly<{ kind: "unavailable"; reason: SpeechDictationUnavailableReason }>
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "starting" }>
  | Readonly<{ kind: "recording"; input: SpeechDictationInput }>
  | SpeechDictationFinishingState
  | Readonly<{ kind: "failed"; reason: SpeechDictationFailureReason }>;

export type SpeechDictationFinishingState = Readonly<{
  kind: "finishing";
  outcome: SpeechDictationFinishOutcome;
  input: SpeechDictationInput;
}>;

export type SpeechDictationEvent =
  | Readonly<{ type: "availability"; availability: SpeechDictationAvailability }>
  | Readonly<{ type: "start" }>
  | Readonly<{ type: "capture-ready"; input: SpeechDictationInput }>
  | Readonly<{ type: "capture-ended"; outcome: SpeechDictationFinishOutcome }>
  | Readonly<{ type: "drained"; transcript: SpeechDictationTranscriptOutcome }>
  | Readonly<{ type: "fail"; reason: SpeechDictationFailureReason }>
  | Readonly<{ type: "reset" }>;

const IDLE: SpeechDictationState = { kind: "idle" };

export function parseSpeechLanguage(value: unknown): SpeechLanguage | null {
  return SPEECH_LANGUAGES.find((language) => language === value) ?? null;
}

export function defaultSpeechLanguage(locale: string): SpeechLanguage {
  const primary = locale.trim().toLowerCase().split(/[-_]/)[0];
  return parseSpeechLanguage(primary) ?? "en";
}

export function speechDictationAvailability(
  input: Readonly<{ captureSupported: boolean; serverId: string | null }>,
): SpeechDictationAvailability {
  if (!input.captureSupported) return { kind: "unavailable", reason: "capture-unsupported" };
  if (input.serverId === null) return { kind: "unavailable", reason: "no-speech-server" };
  return { kind: "available" };
}

export function initialSpeechDictationState(
  availability: SpeechDictationAvailability,
): SpeechDictationState {
  if (availability.kind === "unavailable") return availability;
  return IDLE;
}

export function isSpeechDictationActive(state: SpeechDictationState): boolean {
  switch (state.kind) {
    case "starting":
    case "recording":
    case "finishing":
      return true;
    case "unavailable":
    case "idle":
    case "failed":
      return false;
    default:
      return unreachable(state);
  }
}

export function canStartSpeechDictation(state: SpeechDictationState): boolean {
  return state.kind === "idle" || state.kind === "failed";
}

export function reduceSpeechDictation(
  state: SpeechDictationState,
  event: SpeechDictationEvent,
): SpeechDictationState {
  switch (event.type) {
    case "availability":
      return applyAvailability(state, event.availability);
    case "start":
      return canStartSpeechDictation(state) ? { kind: "starting" } : state;
    case "capture-ready":
      return state.kind === "starting" ? { kind: "recording", input: event.input } : state;
    case "capture-ended":
      return endCapture(state, event.outcome);
    case "drained":
      return state.kind === "finishing" ? drainedState(state, event.transcript) : state;
    case "fail":
      return isSpeechDictationActive(state) ? { kind: "failed", reason: event.reason } : state;
    case "reset":
      return state.kind === "unavailable" ? state : IDLE;
    default:
      return unreachable(event);
  }
}

function applyAvailability(
  state: SpeechDictationState,
  availability: SpeechDictationAvailability,
): SpeechDictationState {
  if (availability.kind === "unavailable") return sameUnavailable(state, availability.reason);
  if (state.kind === "unavailable") return IDLE;
  return state;
}

function sameUnavailable(
  state: SpeechDictationState,
  reason: SpeechDictationUnavailableReason,
): SpeechDictationState {
  if (state.kind === "unavailable" && state.reason === reason) return state;
  return { kind: "unavailable", reason };
}

function endCapture(
  state: SpeechDictationState,
  outcome: SpeechDictationFinishOutcome,
): SpeechDictationState {
  if (state.kind === "starting") return settledState(outcome);
  if (state.kind === "recording") return { kind: "finishing", outcome, input: state.input };
  return state;
}

function settledState(outcome: SpeechDictationFinishOutcome): SpeechDictationState {
  switch (outcome) {
    case "completed":
      return IDLE;
    case "limit-reached":
      return { kind: "failed", reason: "limit-reached" };
    case "microphone-failed":
      return { kind: "failed", reason: "microphone-failed" };
    default:
      return unreachable(outcome);
  }
}

function drainedState(
  finishing: SpeechDictationFinishingState,
  transcript: SpeechDictationTranscriptOutcome,
): SpeechDictationState {
  if (finishing.outcome !== "completed") return settledState(finishing.outcome);
  switch (transcript) {
    case "delivered":
      return IDLE;
    case "no-speech":
      return { kind: "failed", reason: noSpeechReason(finishing.input) };
    case "empty":
      return { kind: "failed", reason: "transcript-empty" };
    default:
      return unreachable(transcript);
  }
}

function noSpeechReason(input: SpeechDictationInput): SpeechDictationFailureReason {
  switch (input) {
    case "selected":
      return "no-speech-detected";
    case "system-default":
      return "no-speech-on-system-default";
    default:
      return unreachable(input);
  }
}

function unreachable(value: never): never {
  throw new TypeError(`Unsupported speech dictation variant: ${JSON.stringify(value)}`);
}
