import {
  isSpeechDictationActive,
  type SpeechDictationFailureReason,
  type SpeechDictationInput,
  type SpeechDictationState,
  type SpeechDictationUnavailableReason,
  type SpeechLanguage,
} from "../../../domain/speechDictation";

export type AgentDictationButtonGlyph = "microphone" | "microphoneOff" | "stop" | "busy";

export type AgentDictationButtonView = Readonly<{
  label: string;
  title: string;
  glyph: AgentDictationButtonGlyph;
  pressed: boolean;
  disabled: boolean;
  unavailableReason: string | null;
  live: boolean;
}>;

export type AgentDictationNoticeView = Readonly<{
  kind: "failed" | "unavailable";
  message: string;
}>;

export type AgentDictationControlView =
  Readonly<{ kind: "hidden" }> | Readonly<{ kind: "shown"; button: AgentDictationButtonView }>;

export type AgentDictationAftermath = Readonly<{
  ownerKey: string;
  state: SpeechDictationState;
  origin: "owned" | "inherited";
  notice: AgentDictationNoticeView | null;
}>;

export type AgentDictationToggleAction = "start" | "stop" | "none";

export type AgentDictationStartRefusal = "prompt-unavailable" | "window-hidden";

export type AgentDictationExplanation =
  | Readonly<{ kind: "disabled"; reason: string }>
  | Readonly<{ kind: "start-refused"; ownerKey: string; refusal: AgentDictationStartRefusal }>;

export type AgentDictationExplanationContext = Readonly<{
  ownerKey: string;
  disabledReason: string | null;
  action: AgentDictationToggleAction;
}>;

const HIDDEN_CONTROL: AgentDictationControlView = { kind: "hidden" };

export const AGENT_DICTATION_START_LABEL = "Start dictation";
export const AGENT_DICTATION_STOP_LABEL = "Stop dictation";
export const AGENT_DICTATION_TRANSCRIBING_LABEL = "Transcribing…";
export const AGENT_DICTATION_DISMISS_LABEL = "Dismiss dictation message";
export const AGENT_DICTATION_SUBMIT_STARTING_REASON =
  "The microphone is starting. Stop dictation before sending.";
export const AGENT_DICTATION_SUBMIT_RECORDING_REASON = "Stop dictation before sending.";
export const AGENT_DICTATION_SUBMIT_TRANSCRIBING_REASON = "Wait for the transcript before sending.";

export const SPEECH_LANGUAGE_LABELS: Readonly<Record<SpeechLanguage, string>> = {
  auto: "Automatic detection",
  sk: "Slovak",
  en: "English",
  cs: "Czech",
};

export function agentDictationControlView(
  state: SpeechDictationState,
  blockedReason: string | null,
  retainedNotice: AgentDictationNoticeView | null,
): AgentDictationControlView {
  if (!controlOffered(state, retainedNotice)) return HIDDEN_CONTROL;
  return { kind: "shown", button: agentDictationButtonView(state, blockedReason) };
}

export function initialAgentDictationAftermath(
  ownerKey: string,
  state: SpeechDictationState,
): AgentDictationAftermath {
  return { ownerKey, state, origin: "owned", notice: null };
}

export function observeAgentDictationAftermath(
  aftermath: AgentDictationAftermath,
  ownerKey: string,
  state: SpeechDictationState,
): AgentDictationAftermath {
  if (aftermath.ownerKey !== ownerKey) {
    return { ownerKey, state, origin: "inherited", notice: null };
  }
  if (aftermath.state === state) return aftermath;
  return { ownerKey, state, origin: "owned", notice: retainedNoticeAfter(aftermath, state) };
}

export function dismissAgentDictationAftermath(
  aftermath: AgentDictationAftermath,
): AgentDictationAftermath {
  if (aftermath.notice === null) return aftermath;
  return { ...aftermath, notice: null };
}

export function agentDictationButtonView(
  state: SpeechDictationState,
  blockedReason: string | null,
): AgentDictationButtonView {
  const unavailableReason = agentDictationDisabledReason(state, blockedReason);
  if (unavailableReason !== null) return unavailableButton(unavailableReason);
  switch (state.kind) {
    case "unavailable":
      return unavailableButton(agentDictationUnavailableReason(state.reason));
    case "idle":
    case "failed":
      return {
        label: AGENT_DICTATION_START_LABEL,
        title: AGENT_DICTATION_START_LABEL,
        glyph: "microphone",
        pressed: false,
        disabled: false,
        unavailableReason: null,
        live: false,
      };
    case "starting":
      return {
        label: AGENT_DICTATION_STOP_LABEL,
        title: "Starting the microphone… Click to stop.",
        glyph: "busy",
        pressed: true,
        disabled: false,
        unavailableReason: null,
        live: false,
      };
    case "recording":
      return {
        label: AGENT_DICTATION_STOP_LABEL,
        title: "Stop dictation and insert the transcript (Esc cancels)",
        glyph: "stop",
        pressed: true,
        disabled: false,
        unavailableReason: null,
        live: true,
      };
    case "finishing":
      return {
        label: "Transcribing dictation",
        title: "Transcribing… Press Esc to cancel.",
        glyph: "busy",
        pressed: false,
        disabled: true,
        unavailableReason: null,
        live: false,
      };
    default:
      return unreachable(state);
  }
}

export function agentDictationDisabledReason(
  state: SpeechDictationState,
  blockedReason: string | null,
): string | null {
  if (blockedReason !== null) return blockedReason;
  if (state.kind !== "unavailable") return null;
  return agentDictationUnavailableReason(state.reason);
}

export function agentDictationNoticeView(
  state: SpeechDictationState,
  explainedReason: string | null,
  retainedNotice: AgentDictationNoticeView | null,
): AgentDictationNoticeView | null {
  if (explainedReason !== null) return { kind: "unavailable", message: explainedReason };
  if (retainedNotice !== null) return retainedNotice;
  if (state.kind !== "failed") return null;
  return failureNotice(state.reason);
}

export function agentDictationExplanationText(
  explanation: AgentDictationExplanation | null,
  context: AgentDictationExplanationContext,
): string | null {
  if (explanation === null) return null;
  switch (explanation.kind) {
    case "disabled":
      return explanation.reason === context.disabledReason ? explanation.reason : null;
    case "start-refused":
      return startRefusalText(explanation.ownerKey, explanation.refusal, context);
    default:
      return unreachable(explanation);
  }
}

export function agentDictationInputNote(state: SpeechDictationState): string | null {
  if (state.kind !== "recording") return null;
  switch (state.input) {
    case "selected":
      return null;
    case "system-default":
      return "Using the system default microphone";
    default:
      return unreachable(state.input);
  }
}

export function agentDictationToggleAction(
  state: SpeechDictationState,
): AgentDictationToggleAction {
  switch (state.kind) {
    case "idle":
    case "failed":
      return "start";
    case "starting":
    case "recording":
      return "stop";
    case "finishing":
    case "unavailable":
      return "none";
    default:
      return unreachable(state);
  }
}

export function agentDictationUnavailableReason(reason: SpeechDictationUnavailableReason): string {
  switch (reason) {
    case "no-speech-server":
      return "Dictation needs a connected server with speech transcription.";
    case "capture-unsupported":
      return "Microphone capture is not available in this build.";
    default:
      return unreachable(reason);
  }
}

export function agentDictationFailureMessage(reason: SpeechDictationFailureReason): string {
  switch (reason) {
    case "permission-denied":
      return "Microphone access was denied. Allow it in the system settings, then try again.";
    case "microphone-failed":
      return "The microphone is not working. Speech captured earlier was transcribed. Check the input device, then try again.";
    case "server-busy":
      return "The server is busy with another transcription. Audio that was not transcribed yet was discarded. Try again in a moment.";
    case "transcription-failed":
      return "Transcription failed. Audio that was not transcribed yet was discarded.";
    case "server-disconnected":
      return "The server disconnected during dictation. Audio that was not transcribed yet was discarded.";
    case "limit-reached":
      return "Dictation reached its limit and stopped. Speech captured so far was transcribed. Start again to continue.";
    case "no-speech-detected":
      return "No speech was detected. Check the input device and speak closer to the microphone, then try again.";
    case "no-speech-on-system-default":
      return "No speech was detected on the system default microphone. The selected one was unavailable. Check both, then try again.";
    case "transcript-empty":
      return "Transcription returned no text. Check the dictation language and speak closer to the microphone, then try again.";
    default:
      return unreachable(reason);
  }
}

export function agentDictationStatusText(state: SpeechDictationState): string {
  switch (state.kind) {
    case "unavailable":
    case "idle":
      return "";
    case "starting":
      return "Starting the microphone";
    case "recording":
      return recordingStatusText(state.input);
    case "finishing":
      return "Transcribing dictation";
    case "failed":
      return agentDictationFailureMessage(state.reason);
    default:
      return unreachable(state);
  }
}

export function agentDictationSubmitBlockedReason(state: SpeechDictationState): string | null {
  switch (state.kind) {
    case "starting":
      return AGENT_DICTATION_SUBMIT_STARTING_REASON;
    case "recording":
      return AGENT_DICTATION_SUBMIT_RECORDING_REASON;
    case "finishing":
      return AGENT_DICTATION_SUBMIT_TRANSCRIBING_REASON;
    case "unavailable":
    case "idle":
    case "failed":
      return null;
    default:
      return unreachable(state);
  }
}

export function formatAgentDictationElapsed(elapsedMs: number): string {
  const totalSeconds = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1000)) : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function startRefusalText(
  ownerKey: string,
  refusal: AgentDictationStartRefusal,
  context: AgentDictationExplanationContext,
): string | null {
  if (ownerKey !== context.ownerKey || context.disabledReason !== null) return null;
  if (context.action !== "start") return null;
  switch (refusal) {
    case "prompt-unavailable":
      return "Dictation did not start because the prompt field was not available. Try again once you can type in it.";
    case "window-hidden":
      return null;
    default:
      return unreachable(refusal);
  }
}

function recordingStatusText(input: SpeechDictationInput): string {
  switch (input) {
    case "selected":
      return "Dictation recording";
    case "system-default":
      return "Dictation recording, using the system default microphone";
    default:
      return unreachable(input);
  }
}

function controlOffered(
  state: SpeechDictationState,
  retainedNotice: AgentDictationNoticeView | null,
): boolean {
  switch (state.kind) {
    case "unavailable":
      return retainedNotice !== null;
    case "idle":
    case "starting":
    case "recording":
    case "finishing":
    case "failed":
      return true;
    default:
      return unreachable(state);
  }
}

function retainedNoticeAfter(
  aftermath: AgentDictationAftermath,
  next: SpeechDictationState,
): AgentDictationNoticeView | null {
  if (isSpeechDictationActive(next)) return null;
  if (next.kind !== "unavailable" || aftermath.origin === "inherited") return aftermath.notice;
  return unsettledNotice(aftermath.state, next.reason) ?? aftermath.notice;
}

function unsettledNotice(
  previous: SpeechDictationState,
  reason: SpeechDictationUnavailableReason,
): AgentDictationNoticeView | null {
  switch (previous.kind) {
    case "starting":
    case "recording":
    case "finishing":
      return interruptionNotice(reason);
    case "failed":
      return failureNotice(previous.reason);
    case "idle":
    case "unavailable":
      return null;
    default:
      return unreachable(previous);
  }
}

function interruptionNotice(reason: SpeechDictationUnavailableReason): AgentDictationNoticeView {
  switch (reason) {
    case "no-speech-server":
      return failureNotice("server-disconnected");
    case "capture-unsupported":
      return { kind: "unavailable", message: agentDictationUnavailableReason(reason) };
    default:
      return unreachable(reason);
  }
}

function failureNotice(reason: SpeechDictationFailureReason): AgentDictationNoticeView {
  return { kind: "failed", message: agentDictationFailureMessage(reason) };
}

function unavailableButton(reason: string): AgentDictationButtonView {
  return {
    label: "Dictation unavailable",
    title: reason,
    glyph: "microphoneOff",
    pressed: false,
    disabled: false,
    unavailableReason: reason,
    live: false,
  };
}

function unreachable(value: never): never {
  throw new TypeError(`Unsupported dictation presentation variant: ${JSON.stringify(value)}`);
}
