// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { silence } from "../../test/speechDictationTestSupport";
import {
  disposeDictationComposers,
  mountDictationComposer,
} from "./dictation/agentComposerDictationTestSupport";

const NO_SPEECH_MESSAGE =
  "No speech was detected. Check the input device and speak closer to the microphone, then try again.";
const EMPTY_TRANSCRIPT_MESSAGE =
  "Transcription returned no text. Check the dictation language and speak closer to the microphone, then try again.";

afterEach(() => {
  disposeDictationComposers();
  vi.useRealTimers();
});

describe("AgentComposer dictation that inserts nothing", () => {
  it("explains a session in which no speech was detected", async () => {
    const composer = mountDictationComposer();
    composer.type("draft");
    await composer.record();
    expect(composer.state()).toBe("recording");

    composer.emit(silence(3, 16000));
    composer.clickMicrophone();
    await composer.settle();

    expect(composer.ipc.calls).toEqual([]);
    expect(composer.prompt().value).toBe("draft");
    expect(composer.state()).toBe("failed");
    expect(composer.noticeKind()).toBe("failed");
    expect(composer.notice()).toBe(NO_SPEECH_MESSAGE);
    expect(composer.status()).toBe(NO_SPEECH_MESSAGE);
    expect(composer.microphone()?.getAttribute("aria-label")).toBe("Start dictation");
    expect(composer.microphone()?.disabled).toBe(false);
    expect(composer.button("Send follow-up")?.disabled).toBe(false);
  });

  it("explains a session whose transcripts came back empty", async () => {
    const composer = mountDictationComposer();
    await composer.record();
    composer.utter();
    composer.clickMicrophone();
    await composer.settle();
    expect(composer.state()).toBe("finishing");

    await composer.resolve(0, "   ");

    expect(composer.prompt().value).toBe("");
    expect(composer.state()).toBe("failed");
    expect(composer.notice()).toBe(EMPTY_TRANSCRIPT_MESSAGE);
    expect(composer.microphone()?.getAttribute("aria-label")).toBe("Start dictation");
  });

  it("dismisses the message and records again from the same button", async () => {
    const composer = mountDictationComposer();
    await composer.record();
    composer.clickMicrophone();
    await composer.settle();
    expect(composer.notice()).toBe(NO_SPEECH_MESSAGE);

    act(() => composer.button("Dismiss dictation message")?.click());
    await composer.settle();
    expect(composer.notice()).toBeNull();
    expect(composer.state()).toBe("idle");

    await composer.record();
    expect(composer.state()).toBe("recording");
    expect(composer.notice()).toBeNull();
  });

  it("clears the message when a later session starts and then inserts text", async () => {
    const composer = mountDictationComposer();
    await composer.record();
    composer.clickMicrophone();
    await composer.settle();
    expect(composer.state()).toBe("failed");

    await composer.record();
    expect(composer.state()).toBe("recording");
    expect(composer.notice()).toBeNull();
    composer.utter();
    composer.clickMicrophone();
    await composer.settle();
    await composer.resolve(0, "Ahoj svet.");

    expect(composer.prompt().value).toBe("Ahoj svet.");
    expect(composer.state()).toBe("idle");
    expect(composer.notice()).toBeNull();
  });
});
