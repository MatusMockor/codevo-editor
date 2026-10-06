import { describe, expect, it } from "vitest";
import type {
  SpeechDictationFailureReason,
  SpeechDictationState,
} from "../../../domain/speechDictation";
import {
  SPEECH_LANGUAGE_LABELS,
  agentDictationButtonView,
  agentDictationDisabledReason,
  agentDictationFailureMessage,
  agentDictationNoticeView,
  agentDictationStatusText,
  agentDictationSubmitBlockedReason,
  agentDictationToggleAction,
  agentDictationUnavailableReason,
  formatAgentDictationElapsed,
} from "./agentDictationPresentation";

const FAILURES: Readonly<Record<SpeechDictationFailureReason, string>> = {
  "permission-denied":
    "Microphone access was denied. Allow it in the system settings, then try again.",
  "microphone-failed":
    "The microphone is not working. Speech captured earlier was transcribed. Check the input device, then try again.",
  "server-busy":
    "The server is busy with another transcription. Audio that was not transcribed yet was discarded. Try again in a moment.",
  "transcription-failed": "Transcription failed. Audio that was not transcribed yet was discarded.",
  "server-disconnected":
    "The server disconnected during dictation. Audio that was not transcribed yet was discarded.",
  "limit-reached":
    "Dictation reached its limit and stopped. Speech captured so far was transcribed. Start again to continue.",
};
const DISCARDING: readonly SpeechDictationFailureReason[] = [
  "server-busy",
  "transcription-failed",
  "server-disconnected",
];
const DRAINING: readonly SpeechDictationFailureReason[] = ["microphone-failed", "limit-reached"];
const REASONS = Object.keys(FAILURES) as SpeechDictationFailureReason[];

const STATES: readonly SpeechDictationState[] = [
  { kind: "unavailable", reason: "no-speech-server" },
  { kind: "unavailable", reason: "capture-unsupported" },
  { kind: "idle" },
  { kind: "starting" },
  { kind: "recording" },
  { kind: "finishing", outcome: "completed" },
  { kind: "finishing", outcome: "limit-reached" },
  { kind: "finishing", outcome: "microphone-failed" },
  ...REASONS.map((reason): SpeechDictationState => ({ kind: "failed", reason })),
];

describe("agent dictation presentation", () => {
  it.each(REASONS)("gives %s a short truthful message", (reason) => {
    const message = agentDictationFailureMessage(reason);

    expect(message).toBe(FAILURES[reason]);
    expect(message.length).toBeLessThanOrEqual(120);
    expect(agentDictationStatusText({ kind: "failed", reason })).toBe(message);
  });

  it.each(DISCARDING)("says %s discarded the audio that was not transcribed", (reason) => {
    expect(agentDictationFailureMessage(reason)).toContain(
      "Audio that was not transcribed yet was discarded.",
    );
  });

  it.each(DRAINING)("says %s still transcribed what was captured", (reason) => {
    const message = agentDictationFailureMessage(reason);

    expect(message).toMatch(/Speech captured (earlier|so far) was transcribed\./);
    expect(message).not.toContain("discarded");
  });

  it("does not mention audio when the microphone was never opened", () => {
    expect(agentDictationFailureMessage("permission-denied")).not.toMatch(/captured|discarded/);
  });

  it("states why dictation is unavailable", () => {
    expect(agentDictationUnavailableReason("no-speech-server")).toBe(
      "Dictation needs a connected server with speech transcription.",
    );
    expect(agentDictationUnavailableReason("capture-unsupported")).toBe(
      "Microphone capture is not available in this build.",
    );
  });

  it("presents every state of the microphone button", () => {
    const view = (state: SpeechDictationState) => agentDictationButtonView(state, null);

    expect(view({ kind: "unavailable", reason: "no-speech-server" })).toEqual({
      label: "Dictation unavailable",
      title: "Dictation needs a connected server with speech transcription.",
      glyph: "microphoneOff",
      pressed: false,
      disabled: false,
      unavailableReason: "Dictation needs a connected server with speech transcription.",
      live: false,
    });
    expect(view({ kind: "unavailable", reason: "capture-unsupported" }).title).toBe(
      "Microphone capture is not available in this build.",
    );
    expect(view({ kind: "idle" })).toEqual({
      label: "Start dictation",
      title: "Start dictation",
      glyph: "microphone",
      pressed: false,
      disabled: false,
      unavailableReason: null,
      live: false,
    });
    expect(view({ kind: "failed", reason: "server-busy" })).toEqual(view({ kind: "idle" }));
    expect(view({ kind: "starting" })).toEqual({
      label: "Stop dictation",
      title: "Starting the microphone… Click to stop.",
      glyph: "busy",
      pressed: true,
      disabled: false,
      unavailableReason: null,
      live: false,
    });
    expect(view({ kind: "recording" })).toEqual({
      label: "Stop dictation",
      title: "Stop dictation and insert the transcript (Esc cancels)",
      glyph: "stop",
      pressed: true,
      disabled: false,
      unavailableReason: null,
      live: true,
    });
    expect(view({ kind: "finishing", outcome: "completed" })).toEqual({
      label: "Transcribing dictation",
      title: "Transcribing… Press Esc to cancel.",
      glyph: "busy",
      pressed: false,
      disabled: true,
      unavailableReason: null,
      live: false,
    });
  });

  it.each(STATES)("marks the button unavailable with the composer reason in state %j", (state) => {
    expect(agentDictationButtonView(state, "Choose a project first.")).toEqual({
      label: "Dictation unavailable",
      title: "Choose a project first.",
      glyph: "microphoneOff",
      pressed: false,
      disabled: false,
      unavailableReason: "Choose a project first.",
      live: false,
    });
  });

  it("keeps an unavailable button focusable so its reason stays reachable", () => {
    const unavailable = STATES.filter((state) => state.kind === "unavailable");

    expect(unavailable.map((state) => agentDictationButtonView(state, null).disabled)).toEqual([
      false,
      false,
    ]);
    expect(STATES.map((state) => agentDictationDisabledReason(state, null))).toEqual([
      "Dictation needs a connected server with speech transcription.",
      "Microphone capture is not available in this build.",
      ...STATES.slice(2).map(() => null),
    ]);
    expect(agentDictationDisabledReason({ kind: "recording" }, "Choose a project first.")).toBe(
      "Choose a project first.",
    );
  });

  it("shows a notice for a failure or for an explained unavailable reason", () => {
    expect(agentDictationNoticeView({ kind: "idle" }, null)).toBeNull();
    expect(agentDictationNoticeView({ kind: "recording" }, null)).toBeNull();
    expect(agentDictationNoticeView({ kind: "failed", reason: "server-busy" }, null)).toEqual({
      kind: "failed",
      message: FAILURES["server-busy"],
    });
    expect(
      agentDictationNoticeView(
        { kind: "unavailable", reason: "no-speech-server" },
        "Dictation needs a connected server with speech transcription.",
      ),
    ).toEqual({
      kind: "unavailable",
      message: "Dictation needs a connected server with speech transcription.",
    });
  });

  it("announces only the states worth interrupting for", () => {
    expect(STATES.map(agentDictationStatusText)).toEqual([
      "",
      "",
      "",
      "Starting the microphone",
      "Dictation recording",
      "Transcribing dictation",
      "Transcribing dictation",
      "Transcribing dictation",
      ...REASONS.map((reason) => FAILURES[reason]),
    ]);
  });

  it("blocks sending from the moment the microphone starts until the transcript has landed", () => {
    expect(STATES.map(agentDictationSubmitBlockedReason)).toEqual([
      null,
      null,
      null,
      "The microphone is starting. Stop dictation before sending.",
      "Stop dictation before sending.",
      "Wait for the transcript before sending.",
      "Wait for the transcript before sending.",
      "Wait for the transcript before sending.",
      ...REASONS.map(() => null),
    ]);
  });

  it("maps each state to one toggle action", () => {
    expect(STATES.map(agentDictationToggleAction)).toEqual([
      "none",
      "none",
      "start",
      "stop",
      "stop",
      "none",
      "none",
      "none",
      ...REASONS.map(() => "start"),
    ]);
  });

  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [1000, "0:01"],
    [59_999, "0:59"],
    [60_000, "1:00"],
    [299_000, "4:59"],
    [300_000, "5:00"],
    [-50, "0:00"],
    [Number.NaN, "0:00"],
    [Number.POSITIVE_INFINITY, "0:00"],
  ])("formats %d ms as %s", (elapsedMs, expected) => {
    expect(formatAgentDictationElapsed(elapsedMs)).toBe(expected);
  });

  it("labels the closed language set", () => {
    expect(SPEECH_LANGUAGE_LABELS).toEqual({ sk: "Slovak", en: "English", cs: "Czech" });
  });
});
