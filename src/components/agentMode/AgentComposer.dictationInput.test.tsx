// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import type { SpeechInputSetting } from "../../domain/speechDictationInputSetting";
import { BUILT_IN_MICROPHONE, STUDIO_MICROPHONE } from "../../test/audioInputDevicesTestSupport";
import { silence, tone } from "../../test/speechDictationTestSupport";
import {
  disposeDictationComposers,
  mountDictationComposer,
} from "./dictation/agentComposerDictationTestSupport";

const STUDIO: SpeechInputSetting = { kind: "device", id: "studio-1", label: "Studio Mic" };
const SYSTEM_DEFAULT: SpeechInputSetting = { kind: "system-default" };
const FALLBACK_NOTE = "Using the system default microphone";
const FALLBACK_STATUS = "Dictation recording, using the system default microphone";
const NO_SPEECH_MESSAGE =
  "No speech was detected. Check the input device and speak closer to the microphone, then try again.";
const NO_SPEECH_ON_FALLBACK_MESSAGE =
  "No speech was detected on the system default microphone. The selected one was unavailable. Check both, then try again.";
const INPUT_LOOKUP_TURNS = 40;

afterEach(() => {
  disposeDictationComposers();
});

function mountWithUnpluggedStudioMicrophone() {
  return mountDictationComposer({
    input: { selected: STUDIO, devices: [BUILT_IN_MICROPHONE] },
  });
}

describe("AgentComposer dictation input", () => {
  it("says next to the meter that the system default microphone is in use when the saved one is missing", async () => {
    const composer = mountWithUnpluggedStudioMicrophone();

    await composer.record(INPUT_LOOKUP_TURNS);

    expect(composer.inputs?.requestedDeviceIds()).toEqual(["studio-1", null]);
    expect(composer.state()).toBe("recording");
    expect(composer.microphone()?.getAttribute("aria-label")).toBe("Stop dictation");
    expect(composer.meterText()).toBe("0:00");
    expect(composer.inputNote()).toBe(FALLBACK_NOTE);
    expect(composer.host.querySelector(".agent-dictation__live")?.nextElementSibling).toBe(
      composer.host.querySelector("[data-dictation-input]"),
    );
    expect(composer.status()).toBe(FALLBACK_STATUS);
    expect(composer.host.querySelectorAll('.agent-dictation [role="status"]')).toHaveLength(1);
    expect(composer.notice()).toBeNull();
  });

  it("announces the fallback once and not again while the meter updates", async () => {
    const composer = mountWithUnpluggedStudioMicrophone();
    await composer.record(INPUT_LOOKUP_TURNS);
    const region = composer.host.querySelector('.agent-dictation [role="status"]');
    const announced = region?.firstChild;
    const note = composer.host.querySelector("[data-dictation-input]");
    const renders = composer.composerRenders();
    expect(announced).not.toBeNull();
    expect(note?.textContent).toBe(FALLBACK_NOTE);

    composer.emit(tone(1, 16000));
    composer.emit(tone(1, 16000));

    expect(composer.meterText()).toBe("0:02");
    expect(composer.composerRenders()).toBe(renders);
    expect(region?.firstChild).toBe(announced);
    expect(region?.textContent).toBe(FALLBACK_STATUS);
    expect(composer.host.querySelector("[data-dictation-input]")).toBe(note);
  });

  it("removes the line when the recording ends", async () => {
    const composer = mountWithUnpluggedStudioMicrophone();
    await composer.record(INPUT_LOOKUP_TURNS);
    composer.utter();

    composer.clickMicrophone();
    await composer.settle();

    expect(composer.state()).toBe("finishing");
    expect(composer.inputNote()).toBeNull();
    expect(composer.host.textContent).not.toContain("system default");
    expect(composer.status()).toBe("Transcribing dictation");

    await composer.resolve(0, "heard on the built-in microphone");

    expect(composer.state()).toBe("idle");
    expect(composer.prompt().value).toBe("heard on the built-in microphone");
    expect(composer.inputNote()).toBeNull();
    expect(composer.status()).toBe("");
    expect(composer.notice()).toBeNull();
  });

  it.each([
    ["the selected microphone", STUDIO, ["studio-1"]],
    ["the system default chosen in the settings", SYSTEM_DEFAULT, [null]],
  ] as const)("shows no line while recording from %s", async (_name, selected, requested) => {
    const composer = mountDictationComposer({
      input: { selected, devices: [BUILT_IN_MICROPHONE, STUDIO_MICROPHONE] },
    });

    await composer.record(INPUT_LOOKUP_TURNS);

    expect(composer.inputs?.requestedDeviceIds()).toEqual(requested);
    expect(composer.state()).toBe("recording");
    expect(composer.inputNote()).toBeNull();
    expect(composer.status()).toBe("Dictation recording");
    expect(composer.host.textContent).not.toContain("system default");
  });

  it("does not carry the line into the next session once the saved microphone is back", async () => {
    const composer = mountWithUnpluggedStudioMicrophone();
    await composer.record(INPUT_LOOKUP_TURNS);
    composer.utter();
    composer.clickMicrophone();
    await composer.settle();
    await composer.resolve(0, "first");
    expect(composer.state()).toBe("idle");

    composer.inputs?.setDevices([BUILT_IN_MICROPHONE, STUDIO_MICROPHONE]);
    await composer.record(INPUT_LOOKUP_TURNS);

    expect(composer.state()).toBe("recording");
    expect(composer.inputNote()).toBeNull();
    expect(composer.status()).toBe("Dictation recording");
  });

  it("does not carry the line into another draft", async () => {
    const composer = mountWithUnpluggedStudioMicrophone();
    await composer.record(INPUT_LOOKUP_TURNS);
    expect(composer.inputNote()).toBe(FALLBACK_NOTE);

    composer.render({ draftKey: "thread-b" });

    expect(composer.state()).toBe("idle");
    expect(composer.audio?.microphoneLive()).toBe(false);
    expect(composer.inputNote()).toBeNull();
    expect(composer.status()).toBe("");
    expect(composer.notice()).toBeNull();

    composer.selectInput(SYSTEM_DEFAULT);
    await composer.record(INPUT_LOOKUP_TURNS);

    expect(composer.state()).toBe("recording");
    expect(composer.inputNote()).toBeNull();
  });

  it("names the system default microphone when a fallback session heard no speech", async () => {
    const composer = mountWithUnpluggedStudioMicrophone();
    await composer.record(INPUT_LOOKUP_TURNS);
    composer.emit(silence(3, 16000));

    composer.clickMicrophone();
    await composer.settle();

    expect(composer.ipc.calls).toEqual([]);
    expect(composer.state()).toBe("failed");
    expect(composer.inputNote()).toBeNull();
    expect(composer.noticeKind()).toBe("failed");
    expect(composer.notice()).toBe(NO_SPEECH_ON_FALLBACK_MESSAGE);
    expect(composer.status()).toBe(NO_SPEECH_ON_FALLBACK_MESSAGE);
    expect(composer.microphone()?.getAttribute("aria-label")).toBe("Start dictation");
  });

  it("goes back to the plain no-speech message once the selected microphone is used again", async () => {
    const composer = mountWithUnpluggedStudioMicrophone();
    await composer.record(INPUT_LOOKUP_TURNS);
    composer.clickMicrophone();
    await composer.settle();
    expect(composer.notice()).toBe(NO_SPEECH_ON_FALLBACK_MESSAGE);

    composer.inputs?.setDevices([BUILT_IN_MICROPHONE, STUDIO_MICROPHONE]);
    await composer.record(INPUT_LOOKUP_TURNS);
    expect(composer.notice()).toBeNull();
    expect(composer.inputNote()).toBeNull();
    composer.clickMicrophone();
    await composer.settle();

    expect(composer.notice()).toBe(NO_SPEECH_MESSAGE);
  });
});
