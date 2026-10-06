import type {
  SpeechDictationFailureReason,
  SpeechDictationState,
  SpeechDictationUnavailableReason,
  SpeechLanguage,
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

export type AgentDictationToggleAction = "start" | "stop" | "none";

export const AGENT_DICTATION_START_LABEL = "Start dictation";
export const AGENT_DICTATION_STOP_LABEL = "Stop dictation";
export const AGENT_DICTATION_TRANSCRIBING_LABEL = "Transcribing…";
export const AGENT_DICTATION_DISMISS_LABEL = "Dismiss dictation message";
export const AGENT_DICTATION_SUBMIT_STARTING_REASON =
  "The microphone is starting. Stop dictation before sending.";
export const AGENT_DICTATION_SUBMIT_RECORDING_REASON = "Stop dictation before sending.";
export const AGENT_DICTATION_SUBMIT_TRANSCRIBING_REASON = "Wait for the transcript before sending.";

export const SPEECH_LANGUAGE_LABELS: Readonly<Record<SpeechLanguage, string>> = {
  sk: "Slovak",
  en: "English",
  cs: "Czech",
};

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
): AgentDictationNoticeView | null {
  if (explainedReason !== null) return { kind: "unavailable", message: explainedReason };
  if (state.kind !== "failed") return null;
  return { kind: "failed", message: agentDictationFailureMessage(state.reason) };
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
      return "Dictation recording";
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
