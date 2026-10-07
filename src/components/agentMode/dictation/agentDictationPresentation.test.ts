import { describe, expect, it } from "vitest";
import type {
  SpeechDictationFailureReason,
  SpeechDictationState,
} from "../../../domain/speechDictation";
import {
  SPEECH_LANGUAGE_LABELS,
  agentDictationButtonView,
  agentDictationExplanationText,
  agentDictationInputNote,
  agentDictationControlView,
  agentDictationDisabledReason,
  agentDictationFailureMessage,
  agentDictationNoticeView,
  agentDictationStatusText,
  agentDictationSubmitBlockedReason,
  agentDictationToggleAction,
  agentDictationUnavailableReason,
  dismissAgentDictationAftermath,
  formatAgentDictationElapsed,
  initialAgentDictationAftermath,
  observeAgentDictationAftermath,
  type AgentDictationExplanation,
  type AgentDictationExplanationContext,
  type AgentDictationNoticeView,
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
  "no-speech-detected":
    "No speech was detected. Check the input device and speak closer to the microphone, then try again.",
  "no-speech-on-system-default":
    "No speech was detected on the system default microphone. The selected one was unavailable. Check both, then try again.",
  "transcript-empty":
    "Transcription returned no text. Check the dictation language and speak closer to the microphone, then try again.",
};
const SILENT_OUTCOMES: readonly SpeechDictationFailureReason[] = [
  "no-speech-detected",
  "no-speech-on-system-default",
  "transcript-empty",
];
const DISCARDING: readonly SpeechDictationFailureReason[] = [
  "server-busy",
  "transcription-failed",
  "server-disconnected",
];
const DRAINING: readonly SpeechDictationFailureReason[] = ["microphone-failed", "limit-reached"];
const REASONS = Object.keys(FAILURES) as SpeechDictationFailureReason[];
const NO_SERVER: SpeechDictationState = { kind: "unavailable", reason: "no-speech-server" };
const NO_CAPTURE: SpeechDictationState = { kind: "unavailable", reason: "capture-unsupported" };
const DISCONNECTED_NOTICE: AgentDictationNoticeView = {
  kind: "failed",
  message: FAILURES["server-disconnected"],
};
const ACTIVE: readonly SpeechDictationState[] = [
  { kind: "starting" },
  { kind: "recording", input: "selected" },
  { kind: "finishing", outcome: "completed", input: "selected" },
];

function aftermathOf(states: readonly SpeechDictationState[], ownerKey = "draft-a") {
  const [first = NO_SERVER, ...rest] = states;
  return rest.reduce(
    (aftermath, state) => observeAgentDictationAftermath(aftermath, ownerKey, state),
    initialAgentDictationAftermath(ownerKey, first),
  );
}

const STATES: readonly SpeechDictationState[] = [
  { kind: "unavailable", reason: "no-speech-server" },
  { kind: "unavailable", reason: "capture-unsupported" },
  { kind: "idle" },
  { kind: "starting" },
  { kind: "recording", input: "selected" },
  { kind: "finishing", outcome: "completed", input: "selected" },
  { kind: "finishing", outcome: "limit-reached", input: "selected" },
  { kind: "finishing", outcome: "microphone-failed", input: "selected" },
  ...REASONS.map((reason): SpeechDictationState => ({ kind: "failed", reason })),
];

const FALLBACK_RECORDING: SpeechDictationState = { kind: "recording", input: "system-default" };
const FALLBACK_FINISHING: SpeechDictationState = {
  kind: "finishing",
  outcome: "completed",
  input: "system-default",
};
const FALLBACK_NOTE = "Using the system default microphone";
const START_REFUSED_MESSAGE =
  "Dictation did not start because the prompt field was not available. Try again once you can type in it.";

describe("agent dictation presentation", () => {
  it("does not claim that silence came from the microphone itself", () => {
    expect(agentDictationFailureMessage("no-speech-detected")).not.toMatch(/only silence/i);
    expect(agentDictationFailureMessage("no-speech-detected")).toContain(
      "speak closer to the microphone",
    );
  });

  it("names the system default microphone when a fallback session heard no speech", () => {
    const message = agentDictationFailureMessage("no-speech-on-system-default");

    expect(message).toContain("on the system default microphone");
    expect(message).toContain("The selected one was unavailable.");
    expect(agentDictationFailureMessage("no-speech-detected")).not.toContain("system default");
  });

  it("notes the system default microphone only while a fallback capture is recording", () => {
    expect(agentDictationInputNote(FALLBACK_RECORDING)).toBe(FALLBACK_NOTE);
    expect(STATES.map(agentDictationInputNote)).toEqual(STATES.map(() => null));
    expect(agentDictationInputNote(FALLBACK_FINISHING)).toBeNull();
    expect(agentDictationInputNote({ kind: "failed", reason: "no-speech-on-system-default" })).toBe(
      null,
    );
  });

  it("announces the fallback microphone once with the recording state", () => {
    expect(agentDictationStatusText(FALLBACK_RECORDING)).toBe(
      "Dictation recording, using the system default microphone",
    );
    expect(agentDictationStatusText({ kind: "recording", input: "selected" })).toBe(
      "Dictation recording",
    );
    expect(agentDictationStatusText(FALLBACK_FINISHING)).toBe("Transcribing dictation");
  });

  it("presents a fallback recording with the same button as any recording", () => {
    expect(agentDictationButtonView(FALLBACK_RECORDING, null)).toEqual(
      agentDictationButtonView({ kind: "recording", input: "selected" }, null),
    );
    expect(agentDictationToggleAction(FALLBACK_RECORDING)).toBe("stop");
    expect(agentDictationSubmitBlockedReason(FALLBACK_RECORDING)).toBe(
      "Stop dictation before sending.",
    );
  });

  it("keeps an explained disabled reason only while it is still the reason", () => {
    const explanation: AgentDictationExplanation = {
      kind: "disabled",
      reason: "Choose a project.",
    };
    const context: AgentDictationExplanationContext = {
      ownerKey: "draft-a",
      disabledReason: "Choose a project.",
      action: "none",
    };

    expect(agentDictationExplanationText(null, context)).toBeNull();
    expect(agentDictationExplanationText(explanation, context)).toBe("Choose a project.");
    expect(agentDictationExplanationText(explanation, { ...context, ownerKey: "draft-b" })).toBe(
      "Choose a project.",
    );
    expect(
      agentDictationExplanationText(explanation, { ...context, disabledReason: "Another reason." }),
    ).toBeNull();
    expect(
      agentDictationExplanationText(explanation, { ...context, disabledReason: null }),
    ).toBeNull();
  });

  it("explains a refused start while the same draft could still start", () => {
    const explanation: AgentDictationExplanation = {
      kind: "start-refused",
      ownerKey: "draft-a",
      refusal: "prompt-unavailable",
    };
    const context = { ownerKey: "draft-a", disabledReason: null, action: "start" } as const;

    expect(agentDictationExplanationText(explanation, context)).toBe(START_REFUSED_MESSAGE);
    expect(START_REFUSED_MESSAGE.length).toBeLessThanOrEqual(120);
    expect(
      agentDictationExplanationText(explanation, { ...context, ownerKey: "draft-b" }),
    ).toBeNull();
    expect(agentDictationExplanationText(explanation, { ...context, action: "stop" })).toBeNull();
    expect(agentDictationExplanationText(explanation, { ...context, action: "none" })).toBeNull();
    expect(
      agentDictationExplanationText(explanation, { ...context, disabledReason: "Blocked." }),
    ).toBeNull();
  });

  it("stays quiet about a start refused because the window was hidden", () => {
    expect(
      agentDictationExplanationText(
        { kind: "start-refused", ownerKey: "draft-a", refusal: "window-hidden" },
        { ownerKey: "draft-a", disabledReason: null, action: "start" },
      ),
    ).toBeNull();
  });

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

  it.each(SILENT_OUTCOMES)("tells the user to try again after %s inserted nothing", (reason) => {
    const message = agentDictationFailureMessage(reason);

    expect(message).toMatch(/try again\.$/);
    expect(message).not.toContain("discarded");
    expect(message).not.toContain("was transcribed");
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
    expect(view({ kind: "recording", input: "selected" })).toEqual({
      label: "Stop dictation",
      title: "Stop dictation and insert the transcript (Esc cancels)",
      glyph: "stop",
      pressed: true,
      disabled: false,
      unavailableReason: null,
      live: true,
    });
    expect(view({ kind: "finishing", outcome: "completed", input: "selected" })).toEqual({
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
    expect(
      agentDictationDisabledReason(
        { kind: "recording", input: "selected" },
        "Choose a project first.",
      ),
    ).toBe("Choose a project first.");
  });

  it("shows a notice for a failure or for an explained unavailable reason", () => {
    expect(agentDictationNoticeView({ kind: "idle" }, null, null)).toBeNull();
    expect(
      agentDictationNoticeView({ kind: "recording", input: "selected" }, null, null),
    ).toBeNull();
    expect(agentDictationNoticeView({ kind: "failed", reason: "server-busy" }, null, null)).toEqual(
      { kind: "failed", message: FAILURES["server-busy"] },
    );
    expect(
      agentDictationNoticeView(
        NO_SERVER,
        "Dictation needs a connected server with speech transcription.",
        null,
      ),
    ).toEqual({
      kind: "unavailable",
      message: "Dictation needs a connected server with speech transcription.",
    });
  });

  it("shows a retained notice until an explanation replaces it", () => {
    expect(agentDictationNoticeView(NO_SERVER, null, DISCONNECTED_NOTICE)).toBe(
      DISCONNECTED_NOTICE,
    );
    expect(agentDictationNoticeView({ kind: "idle" }, null, DISCONNECTED_NOTICE)).toBe(
      DISCONNECTED_NOTICE,
    );
    expect(
      agentDictationNoticeView(NO_SERVER, "Choose a project first.", DISCONNECTED_NOTICE),
    ).toEqual({ kind: "unavailable", message: "Choose a project first." });
  });

  it.each([NO_SERVER, NO_CAPTURE])("offers no control in state %j", (state) => {
    expect(agentDictationControlView(state, null, null)).toEqual({ kind: "hidden" });
    expect(agentDictationControlView(state, "Choose a project first.", null)).toEqual({
      kind: "hidden",
    });
  });

  it.each(STATES.slice(2))("offers the control in state %j", (state) => {
    expect(agentDictationControlView(state, null, null)).toEqual({
      kind: "shown",
      button: agentDictationButtonView(state, null),
    });
    expect(agentDictationControlView(state, "Choose a project first.", null)).toEqual({
      kind: "shown",
      button: agentDictationButtonView(state, "Choose a project first."),
    });
  });

  it.each([NO_SERVER, NO_CAPTURE])(
    "keeps the control in state %j while a retained notice is not dismissed",
    (state) => {
      expect(agentDictationControlView(state, null, DISCONNECTED_NOTICE)).toEqual({
        kind: "shown",
        button: agentDictationButtonView(state, null),
      });
    },
  );

  it.each(ACTIVE)("retains a disconnect notice when the server is lost in state %j", (active) => {
    expect(aftermathOf([{ kind: "idle" }, active, NO_SERVER]).notice).toEqual(DISCONNECTED_NOTICE);
  });

  it.each(ACTIVE)("retains the capture reason when capture is lost in state %j", (active) => {
    expect(aftermathOf([{ kind: "idle" }, active, NO_CAPTURE]).notice).toEqual({
      kind: "unavailable",
      message: "Microphone capture is not available in this build.",
    });
  });

  it.each(REASONS)(
    "retains a %s failure when the server is lost before it is dismissed",
    (reason) => {
      expect(
        aftermathOf([
          { kind: "recording", input: "selected" },
          { kind: "failed", reason },
          NO_SERVER,
        ]).notice,
      ).toEqual({ kind: "failed", message: FAILURES[reason] });
    },
  );

  it("retains nothing when dictation was settled before it became unavailable", () => {
    expect(aftermathOf([{ kind: "idle" }, NO_SERVER]).notice).toBeNull();
    expect(aftermathOf([NO_SERVER, NO_CAPTURE]).notice).toBeNull();
    expect(aftermathOf([NO_SERVER, { kind: "idle" }, NO_SERVER]).notice).toBeNull();
    expect(
      aftermathOf([{ kind: "recording", input: "selected" }, { kind: "idle" }, NO_SERVER]).notice,
    ).toBeNull();
  });

  it("keeps a retained notice through a reconnect and drops it when dictation starts again", () => {
    const lost = aftermathOf([{ kind: "recording", input: "selected" }, NO_SERVER]);
    const reconnected = observeAgentDictationAftermath(lost, "draft-a", { kind: "idle" });
    const lostAgain = observeAgentDictationAftermath(reconnected, "draft-a", NO_SERVER);
    const restarted = observeAgentDictationAftermath(reconnected, "draft-a", { kind: "starting" });

    expect(reconnected.notice).toEqual(DISCONNECTED_NOTICE);
    expect(lostAgain.notice).toEqual(DISCONNECTED_NOTICE);
    expect(restarted.notice).toBeNull();
  });

  it("returns the same aftermath while nothing changes", () => {
    const recording: SpeechDictationState = { kind: "recording", input: "selected" };
    const aftermath = initialAgentDictationAftermath("draft-a", recording);

    expect(observeAgentDictationAftermath(aftermath, "draft-a", recording)).toBe(aftermath);
    expect(dismissAgentDictationAftermath(aftermath)).toBe(aftermath);
  });

  it("forgets a retained notice once it is dismissed", () => {
    const lost = aftermathOf([{ kind: "recording", input: "selected" }, NO_SERVER]);
    const dismissed = dismissAgentDictationAftermath(lost);

    expect(dismissed.notice).toBeNull();
    expect(observeAgentDictationAftermath(dismissed, "draft-a", NO_SERVER)).toBe(dismissed);
    expect(agentDictationControlView(NO_SERVER, null, dismissed.notice)).toEqual({
      kind: "hidden",
    });
  });

  it("does not carry a notice or another draft's live state over to a new owner", () => {
    const recording: SpeechDictationState = { kind: "recording", input: "selected" };
    const lost = aftermathOf([recording, NO_SERVER]);
    const moved = observeAgentDictationAftermath(lost, "draft-b", NO_SERVER);
    const live = initialAgentDictationAftermath("draft-a", recording);
    const inherited = observeAgentDictationAftermath(live, "draft-b", recording);
    const settled = observeAgentDictationAftermath(inherited, "draft-b", NO_SERVER);
    const back = observeAgentDictationAftermath(settled, "draft-a", NO_SERVER);

    expect(moved.notice).toBeNull();
    expect(observeAgentDictationAftermath(inherited, "draft-b", recording)).toBe(inherited);
    expect(settled.notice).toBeNull();
    expect(back.notice).toBeNull();
  });

  it("tracks the new owner's own dictation after the inherited state settles", () => {
    const recording: SpeechDictationState = { kind: "recording", input: "selected" };
    const inherited = observeAgentDictationAftermath(
      initialAgentDictationAftermath("draft-a", recording),
      "draft-b",
      recording,
    );
    const own = [{ kind: "idle" }, { kind: "starting" }, NO_SERVER] as const;

    expect(
      own.reduce(
        (aftermath, state) => observeAgentDictationAftermath(aftermath, "draft-b", state),
        inherited,
      ).notice,
    ).toEqual(DISCONNECTED_NOTICE);
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
    expect(SPEECH_LANGUAGE_LABELS).toEqual({
      auto: "Automatic detection",
      sk: "Slovak",
      en: "English",
      cs: "Czech",
    });
  });
});
