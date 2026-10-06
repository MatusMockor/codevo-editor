// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  FakeMediaStream,
  flushAsync,
  namedError,
  tone,
} from "../../test/speechDictationTestSupport";
import {
  disposeDictationComposers,
  mountDictationComposer,
} from "./dictation/agentComposerDictationTestSupport";

afterEach(() => {
  disposeDictationComposers();
  vi.useRealTimers();
});

describe("AgentComposer dictation control", () => {
  it("renders no microphone when the workbench provides no dictation ports", () => {
    const composer = mountDictationComposer({ provided: false });

    expect(composer.microphone()).toBeNull();
    expect(composer.host.querySelector(".agent-dictation")).toBeNull();
    expect(composer.button("Send follow-up")).not.toBeNull();
  });

  it("offers a quiet idle microphone next to the send button", () => {
    const composer = mountDictationComposer();
    const microphone = composer.microphone();
    const actions = composer.host.querySelector(".cv-composer__actions");

    expect(composer.state()).toBe("idle");
    expect(microphone?.getAttribute("aria-label")).toBe("Start dictation");
    expect(microphone?.getAttribute("title")).toBe("Start dictation");
    expect(microphone?.getAttribute("aria-pressed")).toBe("false");
    expect(microphone?.getAttribute("type")).toBe("button");
    expect(microphone?.disabled).toBe(false);
    expect(microphone?.classList.contains("agent-dictation__button--live")).toBe(false);
    expect(actions?.contains(microphone)).toBe(true);
    expect(actions?.lastElementChild).toBe(composer.button("Send follow-up"));
    expect(microphone?.closest(".agent-dictation")?.nextElementSibling).toBe(
      composer.button("Send follow-up"),
    );
    expect(composer.status()).toBe("");
    expect(composer.notice()).toBeNull();
  });

  it("announces state through one polite live region", () => {
    const composer = mountDictationComposer();
    const regions = composer.host.querySelectorAll('.agent-dictation [role="status"]');

    expect(regions).toHaveLength(1);
    expect(regions[0]?.getAttribute("aria-live")).toBe("polite");
  });

  it("stays reachable and explains itself when no connected server transcribes speech", () => {
    const reason = "Dictation needs a connected server with speech transcription.";
    const composer = mountDictationComposer({ serverIds: [] });
    const microphone = composer.microphone();

    expect(composer.state()).toBe("unavailable");
    expect(microphone?.disabled).toBe(false);
    expect(microphone?.getAttribute("aria-disabled")).toBe("true");
    expect(microphone?.getAttribute("aria-label")).toBe("Dictation unavailable");
    expect(microphone?.getAttribute("title")).toBe(reason);
    expect(composer.microphoneDescription()).toBe(reason);
    expect(microphone?.getAttribute("aria-pressed")).toBe("false");
    expect(composer.notice()).toBeNull();

    act(() => microphone?.focus());
    expect(document.activeElement).toBe(microphone);
    act(() => microphone?.click());

    expect(composer.state()).toBe("unavailable");
    expect(composer.audio?.getUserMedia).not.toHaveBeenCalled();
    expect(composer.noticeKind()).toBe("unavailable");
    expect(composer.notice()).toBe(reason);
    expect(composer.status()).toBe(reason);

    act(() => composer.button("Dismiss dictation message")?.click());
    expect(composer.notice()).toBeNull();

    composer.render({ serverIds: ["server-a"] });
    expect(composer.state()).toBe("idle");
    expect(composer.microphone()?.hasAttribute("aria-disabled")).toBe(false);
    expect(composer.microphone()?.hasAttribute("aria-describedby")).toBe(false);
  });

  it("stays reachable with the reason when the webview cannot capture audio", () => {
    const reason = "Microphone capture is not available in this build.";
    const composer = mountDictationComposer({ audio: false });
    const microphone = composer.microphone();

    expect(composer.state()).toBe("unavailable");
    expect(microphone?.disabled).toBe(false);
    expect(microphone?.getAttribute("aria-disabled")).toBe("true");
    expect(microphone?.getAttribute("title")).toBe(reason);
    expect(composer.microphoneDescription()).toBe(reason);

    composer.clickMicrophone();
    expect(composer.notice()).toBe(reason);
  });

  it("shows a busy toggle while the microphone starts and stops on a second click", async () => {
    const stream = deferred<FakeMediaStream>();
    const composer = mountDictationComposer({ audio: { getUserMedia: () => stream.promise } });
    act(() => composer.prompt().focus());

    composer.clickMicrophone();
    await composer.settle();

    expect(composer.state()).toBe("starting");
    expect(composer.microphone()?.getAttribute("aria-label")).toBe("Stop dictation");
    expect(composer.microphone()?.getAttribute("title")).toBe(
      "Starting the microphone… Click to stop.",
    );
    expect(composer.microphone()?.getAttribute("aria-pressed")).toBe("true");
    expect(composer.microphone()?.getAttribute("aria-busy")).toBe("true");
    expect(composer.microphone()?.querySelector(".cv-spinner")).not.toBeNull();
    expect(composer.status()).toBe("Starting the microphone");

    composer.clickMicrophone();
    expect(composer.state()).toBe("idle");
    await act(async () => {
      stream.resolve(new FakeMediaStream());
      await flushAsync();
    });

    expect(composer.state()).toBe("idle");
    expect(composer.audio?.microphoneLive()).toBe(false);
    expect(document.activeElement).toBe(composer.prompt());
  });

  it("shows a live recording toggle with a meter and elapsed time, keeping focus in the prompt", async () => {
    const composer = mountDictationComposer();
    act(() => composer.prompt().focus());

    await composer.record();

    expect(composer.state()).toBe("recording");
    expect(composer.audio?.microphoneLive()).toBe(true);
    expect(composer.microphone()?.getAttribute("aria-label")).toBe("Stop dictation");
    expect(composer.microphone()?.getAttribute("title")).toBe(
      "Stop dictation and insert the transcript (Esc cancels)",
    );
    expect(composer.microphone()?.getAttribute("aria-pressed")).toBe("true");
    expect(composer.microphone()?.hasAttribute("aria-busy")).toBe(false);
    expect(composer.microphone()?.classList.contains("agent-dictation__button--live")).toBe(true);
    expect(composer.status()).toBe("Dictation recording");
    expect(composer.meterText()).toBe("0:00");
    expect(composer.host.querySelector(".agent-dictation__meter")).not.toBeNull();
    expect(document.activeElement).toBe(composer.prompt());

    composer.emit(tone(3, 16000));
    expect(composer.meterText()).toBe("0:03");
    expect(
      Number(
        composer.host.querySelector("[data-dictation-meter]")?.getAttribute("data-dictation-meter"),
      ),
    ).toBeGreaterThan(0.5);
  });

  it("does not rerender the composer for meter updates", async () => {
    const composer = mountDictationComposer();
    await composer.record();
    const renders = composer.composerRenders();

    composer.emit(tone(1, 16000));
    composer.emit(tone(1, 16000));

    expect(composer.meterText()).toBe("0:02");
    expect(composer.composerRenders()).toBe(renders);
  });

  it("stops on click, shows transcribing, inserts the transcript and never sends it", async () => {
    const composer = mountDictationComposer();
    act(() => composer.prompt().focus());
    await composer.record();
    composer.utter();

    composer.clickMicrophone();

    expect(composer.state()).toBe("finishing");
    expect(composer.audio?.microphoneLive()).toBe(false);
    expect(composer.microphone()?.disabled).toBe(true);
    expect(composer.microphone()?.getAttribute("aria-label")).toBe("Transcribing dictation");
    expect(composer.microphone()?.getAttribute("title")).toBe("Transcribing… Press Esc to cancel.");
    expect(composer.microphone()?.getAttribute("aria-pressed")).toBe("false");
    expect(composer.microphone()?.getAttribute("aria-busy")).toBe("true");
    expect(composer.host.querySelector(".agent-dictation__note")?.textContent).toBe(
      "Transcribing…",
    );
    expect(composer.status()).toBe("Transcribing dictation");
    expect(composer.meterText()).toBeNull();
    expect(composer.ipc.calls[0]?.request.serverId).toBe("server-a");
    expect(composer.ipc.calls[0]?.request.language).toBe("sk");

    await composer.resolve(0, " Oprav prihlásenie ");

    expect(composer.state()).toBe("idle");
    expect(composer.prompt().value).toBe("Oprav prihlásenie");
    expect(composer.status()).toBe("");
    expect(composer.submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(composer.prompt());
  });

  it("is keyboard operable and returns focus to the prompt", async () => {
    const composer = mountDictationComposer();
    const microphone = composer.microphone();
    act(() => microphone?.focus());

    act(() => microphone?.click());
    await composer.settle();

    expect(composer.state()).toBe("recording");
    expect(document.activeElement).toBe(composer.prompt());
  });

  it("uses the dictation language resolved from the setting and the system locale", async () => {
    const composer = mountDictationComposer({ language: undefined, locale: "cs-CZ" });
    await composer.record();
    composer.utter();
    expect(composer.ipc.calls[0]?.request.language).toBe("cs");
  });
});

describe("AgentComposer dictation and sending", () => {
  it("blocks Enter and the send button while the microphone is still starting", async () => {
    const stream = deferred<FakeMediaStream>();
    const composer = mountDictationComposer({ audio: { getUserMedia: () => stream.promise } });
    act(() => composer.prompt().focus());
    composer.type("Ship it");

    composer.clickMicrophone();
    await composer.settle();

    expect(composer.state()).toBe("starting");
    expect(composer.button("Send follow-up")?.disabled).toBe(true);
    expect(composer.button("Send follow-up")?.getAttribute("title")).toBe(
      "The microphone is starting. Stop dictation before sending.",
    );
    const whileStarting = composer.press(composer.prompt(), "Enter");
    expect(whileStarting.defaultPrevented).toBe(true);
    composer.press(composer.prompt(), "Enter", { ctrlKey: true });
    act(() => composer.host.querySelector("form")?.requestSubmit());
    expect(composer.submit).not.toHaveBeenCalled();
    expect(composer.prompt().value).toBe("Ship it");

    await act(async () => {
      stream.resolve(new FakeMediaStream());
      await flushAsync();
    });
    expect(composer.state()).toBe("recording");
    composer.utter();
    composer.clickMicrophone();
    await composer.resolve(0, "today");

    expect(composer.prompt().value).toBe("Ship it today");
    composer.press(composer.prompt(), "Enter");
    expect(composer.submit).toHaveBeenCalledTimes(1);
    expect(composer.submit.mock.calls[0]?.[0]).toBe("Ship it today");
  });

  it("blocks Enter and the send button while recording and while transcribing", async () => {
    const composer = mountDictationComposer();
    act(() => composer.prompt().focus());
    composer.type("Ship it");
    expect(composer.button("Send follow-up")?.disabled).toBe(false);

    await composer.record();

    expect(composer.button("Send follow-up")?.disabled).toBe(true);
    expect(composer.button("Send follow-up")?.getAttribute("title")).toBe(
      "Stop dictation before sending.",
    );
    const whileRecording = composer.press(composer.prompt(), "Enter");
    expect(whileRecording.defaultPrevented).toBe(true);
    act(() => composer.host.querySelector("form")?.requestSubmit());
    expect(composer.submit).not.toHaveBeenCalled();
    expect(composer.prompt().value).toBe("Ship it");

    composer.utter();
    composer.clickMicrophone();

    expect(composer.state()).toBe("finishing");
    expect(composer.button("Send follow-up")?.disabled).toBe(true);
    expect(composer.button("Send follow-up")?.getAttribute("title")).toBe(
      "Wait for the transcript before sending.",
    );
    composer.press(composer.prompt(), "Enter");
    composer.press(composer.prompt(), "Enter", { ctrlKey: true });
    act(() => composer.host.querySelector("form")?.requestSubmit());
    expect(composer.submit).not.toHaveBeenCalled();

    await composer.resolve(0, "today");

    expect(composer.prompt().value).toBe("Ship it today");
    expect(composer.button("Send follow-up")?.disabled).toBe(false);
    expect(composer.button("Send follow-up")?.getAttribute("title")).toContain("Send follow-up");
    composer.press(composer.prompt(), "Enter");
    expect(composer.submit).toHaveBeenCalledTimes(1);
    expect(composer.submit.mock.calls[0]?.[0]).toBe("Ship it today");
  });

  it("still inserts a line break with Shift+Enter while recording", async () => {
    const composer = mountDictationComposer();
    await composer.record();

    const event = composer.press(composer.prompt(), "Enter", { shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(composer.submit).not.toHaveBeenCalled();
  });

  it("does not block sending once dictation has failed", async () => {
    const composer = mountDictationComposer();
    composer.type("Ship it");
    await composer.record();
    composer.utter();
    await composer.reject(0, "whisper exploded");

    expect(composer.state()).toBe("failed");
    expect(composer.button("Send follow-up")?.disabled).toBe(false);
    composer.press(composer.prompt(), "Enter");
    expect(composer.submit).toHaveBeenCalledTimes(1);
  });
});

describe("AgentComposer dictation and Escape", () => {
  const steering = { mode: { kind: "steer", threadId: "thread-a" }, running: true } as const;

  it("cancels only dictation from the prompt and leaves the running agent alone", async () => {
    const composer = mountDictationComposer(steering);
    act(() => composer.prompt().focus());
    await composer.record();
    composer.utter();

    const first = composer.press(composer.prompt(), "Escape");

    expect(first.defaultPrevented).toBe(true);
    expect(composer.state()).toBe("idle");
    expect(composer.audio?.microphoneLive()).toBe(false);
    expect(composer.onStop).not.toHaveBeenCalled();

    await composer.resolve(0, "late words");
    expect(composer.prompt().value).toBe("");

    composer.press(composer.prompt(), "Escape");
    expect(composer.onStop).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending transcription with Escape without stopping the agent", async () => {
    const composer = mountDictationComposer(steering);
    await composer.record();
    composer.utter();
    composer.clickMicrophone();
    expect(composer.state()).toBe("finishing");

    composer.press(composer.prompt(), "Escape");

    expect(composer.state()).toBe("idle");
    expect(composer.onStop).not.toHaveBeenCalled();
    await composer.resolve(0, "dropped");
    expect(composer.prompt().value).toBe("");
  });

  it("ignores a held Escape so the repeat cannot reach the agent stop", async () => {
    const composer = mountDictationComposer(steering);
    await composer.record();

    composer.press(composer.prompt(), "Escape", { repeat: true });
    expect(composer.state()).toBe("recording");
    expect(composer.onStop).not.toHaveBeenCalled();
  });

  it("takes Escape before the conversation-level agent stop when focus is outside the prompt", async () => {
    const composer = mountDictationComposer(steering);
    await composer.record();
    act(() => composer.outsideButton().focus());

    const first = composer.press(composer.outsideButton(), "Escape");

    expect(first.defaultPrevented).toBe(true);
    expect(composer.state()).toBe("idle");
    expect(composer.audio?.microphoneLive()).toBe(false);
    expect(composer.onStop).not.toHaveBeenCalled();

    composer.press(composer.outsideButton(), "Escape");
    expect(composer.onStop).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape to another text field that owns it", async () => {
    const composer = mountDictationComposer(steering);
    await composer.record();
    act(() => composer.outsideInput().focus());

    const event = composer.press(composer.outsideInput(), "Escape");

    expect(event.defaultPrevented).toBe(false);
    expect(composer.state()).toBe("recording");
    expect(composer.onStop).not.toHaveBeenCalled();
  });

  it.each([
    ["the model picker", "#agent-launch-model"],
    ["the access menu", "#agent-launch-mode"],
  ])("leaves Escape to %s opened by mouse and keeps dictating", async (_name, selector) => {
    const composer = mountDictationComposer();
    await composer.record();
    const trigger = composer.host.querySelector<HTMLButtonElement>(selector);
    expect(trigger?.hasAttribute("aria-haspopup")).toBe(true);
    act(() => trigger?.click());
    act(() => trigger?.focus());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(trigger);

    composer.press(trigger ?? composer.outsideButton(), "Escape");

    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(composer.state()).toBe("recording");
    expect(composer.audio?.microphoneLive()).toBe(true);

    const next = composer.press(trigger ?? composer.outsideButton(), "Escape");

    expect(next.defaultPrevented).toBe(true);
    expect(composer.state()).toBe("idle");
    expect(composer.audio?.microphoneLive()).toBe(false);
  });

  it("leaves Escape to an open modal dialog", async () => {
    const composer = mountDictationComposer(steering);
    await composer.record();
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);

    composer.press(composer.outsideButton(), "Escape");
    dialog.remove();

    expect(composer.state()).toBe("recording");
    expect(composer.onStop).not.toHaveBeenCalled();
  });

  it("keeps the agent stop on Escape when dictation is idle or failed", async () => {
    const composer = mountDictationComposer({
      ...steering,
      audio: { getUserMedia: async () => Promise.reject(namedError("NotAllowedError")) },
    });
    composer.press(composer.prompt(), "Escape");
    expect(composer.onStop).toHaveBeenCalledTimes(1);

    await composer.record();
    expect(composer.state()).toBe("failed");
    composer.press(composer.prompt(), "Escape");
    expect(composer.onStop).toHaveBeenCalledTimes(2);
    expect(composer.state()).toBe("failed");
  });
});

describe("AgentComposer dictation failures", () => {
  it("explains a denied microphone and dismisses the message", async () => {
    const composer = mountDictationComposer({
      audio: { getUserMedia: async () => Promise.reject(namedError("NotAllowedError")) },
    });

    await composer.record();

    expect(composer.state()).toBe("failed");
    expect(composer.notice()).toBe(
      "Microphone access was denied. Allow it in the system settings, then try again.",
    );
    expect(composer.status()).toBe(composer.notice());
    expect(composer.microphone()?.getAttribute("aria-label")).toBe("Start dictation");
    expect(composer.microphone()?.disabled).toBe(false);

    act(() => composer.button("Dismiss dictation message")?.click());

    expect(composer.state()).toBe("idle");
    expect(composer.notice()).toBeNull();
    expect(composer.status()).toBe("");
  });

  it("explains a microphone that cannot be opened", async () => {
    const composer = mountDictationComposer({
      audio: { getUserMedia: async () => Promise.reject(namedError("NotReadableError")) },
    });

    await composer.record();

    expect(composer.notice()).toBe(
      "The microphone is not working. Speech captured earlier was transcribed. Check the input device, then try again.",
    );
  });

  it("explains a microphone that fails mid-recording after inserting what was heard", async () => {
    const composer = mountDictationComposer();
    await composer.record();
    composer.utter();

    act(() => composer.audio?.endTrack());
    expect(composer.state()).toBe("finishing");
    await composer.resolve(0, "heard so far");

    expect(composer.state()).toBe("failed");
    expect(composer.prompt().value).toBe("heard so far");
    expect(composer.notice()).toBe(
      "The microphone is not working. Speech captured earlier was transcribed. Check the input device, then try again.",
    );
  });

  it("explains a failed transcription without leaking the backend message", async () => {
    const composer = mountDictationComposer();
    await composer.record();
    composer.utter();

    await composer.reject(0, "Runner speech transcription failed: speech_unavailable (HTTP 503).");

    expect(composer.state()).toBe("failed");
    expect(composer.audio?.microphoneLive()).toBe(false);
    expect(composer.notice()).toBe(
      "Transcription failed. Audio that was not transcribed yet was discarded.",
    );
    expect(composer.host.textContent).not.toContain("HTTP 503");
    expect(composer.host.textContent).not.toContain("speech_unavailable");
    expect(composer.prompt().value).toBe("");
  });

  it("explains a server that disconnects during dictation", async () => {
    const composer = mountDictationComposer();
    await composer.record();
    composer.utter();

    await composer.reject(0, "Server is not connected");

    expect(composer.notice()).toBe(
      "The server disconnected during dictation. Audio that was not transcribed yet was discarded.",
    );
  });

  it("keeps dictating on its server when another speech server becomes preferred", async () => {
    const composer = mountDictationComposer();
    await composer.record();
    composer.utter();

    composer.render({ serverIds: ["server-b", "server-a"] });

    expect(composer.state()).toBe("recording");
    expect(composer.audio?.microphoneLive()).toBe(true);
    expect(composer.notice()).toBeNull();
    await composer.resolve(0, "same session");
    expect(composer.ipc.calls[0]?.request.serverId).toBe("server-a");
    expect(composer.prompt().value).toBe("same session");

    composer.clickMicrophone();
    await composer.settle();
    expect(composer.state()).toBe("idle");
    await composer.record();
    composer.utter();
    expect(composer.ipc.calls[1]?.request.serverId).toBe("server-b");
  });

  it("fails the session when its speech server is no longer available", async () => {
    const composer = mountDictationComposer();
    await composer.record();
    composer.utter();

    composer.render({ serverIds: ["server-b"] });

    expect(composer.state()).toBe("failed");
    expect(composer.audio?.microphoneLive()).toBe(false);
    expect(composer.notice()).toBe(
      "The server disconnected during dictation. Audio that was not transcribed yet was discarded.",
    );
    await composer.resolve(0, "old server words");
    expect(composer.prompt().value).toBe("");
  });

  it("explains a server that stays busy after the bounded retries", async () => {
    vi.useFakeTimers();
    const composer = mountDictationComposer();
    await composer.record();
    composer.utter();

    for (const [call, delay] of [
      [0, 400],
      [1, 1200],
    ] as const) {
      await composer.reject(call, "Runner is busy; retry shortly");
      expect(composer.state()).toBe("recording");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
    }
    await composer.reject(2, "Runner is busy; retry shortly");

    expect(composer.ipc.calls).toHaveLength(3);
    expect(composer.state()).toBe("failed");
    expect(composer.notice()).toBe(
      "The server is busy with another transcription. Audio that was not transcribed yet was discarded. Try again in a moment.",
    );
  });

  it("stops at the queue limit, inserts everything heard and says why it stopped", async () => {
    const composer = mountDictationComposer();
    await composer.record();

    for (let utterance = 0; utterance < 5; utterance += 1) composer.utter();

    expect(composer.state()).toBe("finishing");
    expect(composer.audio?.microphoneLive()).toBe(false);
    for (let call = 0; call < 5; call += 1) await composer.resolve(call, `part${call + 1}`);

    expect(composer.state()).toBe("failed");
    expect(composer.prompt().value).toBe("part1 part2 part3 part4 part5");
    expect(composer.notice()).toBe(
      "Dictation reached its limit and stopped. Speech captured so far was transcribed. Start again to continue.",
    );
  });

  it("starts a new session from a failed state and clears the message", async () => {
    const composer = mountDictationComposer();
    await composer.record();
    composer.utter();
    await composer.reject(0, "boom");
    expect(composer.notice()).not.toBeNull();

    await composer.record();

    expect(composer.state()).toBe("recording");
    expect(composer.notice()).toBeNull();
  });
});
