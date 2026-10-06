// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { SpeechInputSetting } from "../domain/speechDictationInputSetting";
import { createSpeechDictationPorts } from "../infrastructure/speechDictationComposition";
import { TauriRemoteRunnerGateway } from "../infrastructure/tauriRemoteRunnerGateway";
import { installFakeAudioInputs, type FakeAudioInputs } from "../test/audioInputDevicesTestSupport";
import { controlledInvoke, flushAsync, tone } from "../test/speechDictationTestSupport";
import type { AudioInputDevicesSnapshot } from "./speechDictationPorts";
import { useSpeechDictation, type SpeechDictationController } from "./useSpeechDictation";
import { useAudioInputDevices, useSpeechInputSelection } from "./useSpeechInput";

const STUDIO: SpeechInputSetting = { kind: "device", id: "studio-1", label: "Studio Mic" };
const BUILT_IN: SpeechInputSetting = {
  kind: "device",
  id: "built-in-1",
  label: "MacBook Pro Microphone",
};

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
});

function setup(initial: SpeechInputSetting | undefined) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const inputs: FakeAudioInputs = installFakeAudioInputs({ granted: true, sampleRate: 16000 });
  const ipc = controlledInvoke();
  const ports = createSpeechDictationPorts(new TauriRemoteRunnerGateway(ipc.invoke));
  const transcripts: string[] = [];
  const onTranscript = (text: string): void => {
    transcripts.push(text);
  };
  let stored = initial;
  let controller!: SpeechDictationController;
  const controllers = new Set<SpeechDictationController["start"]>();
  function Host() {
    useSpeechInputSelection(ports.input?.selection ?? null, stored);
    controller = useSpeechDictation({
      ownerId: "draft-a",
      serverIds: ["server-a"],
      language: "sk",
      ports,
      onTranscript,
    });
    controllers.add(controller.start);
    return null;
  }
  const root: Root = createRoot(document.createElement("div"));
  const render = (next: SpeechInputSetting | undefined) => {
    stored = next;
    act(() => root.render(createElement(Host)));
  };
  cleanup.push(() => {
    act(() => root.unmount());
    inputs.restore();
  });
  render(initial);
  const record = () =>
    act(async () => {
      controller.start();
      await flushAsync();
    });
  const stop = () =>
    act(async () => {
      controller.stop();
      await flushAsync();
    });
  const transcribe = (text: string) =>
    act(async () => {
      ipc.calls[ipc.calls.length - 1]?.resolve({ text });
      await flushAsync();
    });
  return {
    inputs,
    transcripts,
    render,
    record,
    stop,
    transcribe,
    controller: () => controller,
    controllers,
  };
}

describe("speech input selection", () => {
  it("captures from the system default until a device is selected", async () => {
    const { inputs, record } = setup(undefined);
    await record();

    expect(inputs.requestedDeviceIds()).toEqual([null]);
  });

  it("captures from the stored device from the first start", async () => {
    const { inputs, record, controller } = setup(STUDIO);
    await record();

    expect(controller().state).toEqual({ kind: "recording", input: "selected" });
    expect(inputs.requestedDeviceIds()).toEqual(["studio-1"]);
  });

  it("applies a setting changed during a recording only to the next start", async () => {
    const { inputs, transcripts, render, record, stop, transcribe, controller, controllers } =
      setup(BUILT_IN);
    await record();
    const running = inputs.streams[0];

    render(STUDIO);
    act(() => inputs.audio.emit(tone(0.2, 16000)));

    expect(controller().state).toEqual({ kind: "recording", input: "selected" });
    expect(controller().meter.getSnapshot().elapsedMs).toBeGreaterThan(0);
    expect(running?.deviceId).toBe("built-in-1");
    expect(running?.tracks.every((track) => !track.stopped)).toBe(true);
    expect(inputs.requestedDeviceIds()).toEqual(["built-in-1"]);
    expect(controllers.size).toBe(1);

    await stop();
    expect(controller().state).toEqual({
      kind: "finishing",
      outcome: "completed",
      input: "selected",
    });
    expect(running?.tracks.every((track) => track.stopped)).toBe(true);
    await transcribe("ahoj");
    expect(transcripts).toEqual(["ahoj"]);
    expect(controller().state).toEqual({ kind: "idle" });

    await record();

    expect(controller().state).toEqual({ kind: "recording", input: "selected" });
    expect(inputs.requestedDeviceIds()).toEqual(["built-in-1", "studio-1"]);
    expect(inputs.streams[1]?.deviceId).toBe("studio-1");
  });

  it("falls back to the system default when the stored value is malformed", async () => {
    const malformed = { kind: "device", id: "studio 1", label: "Studio Mic" } as SpeechInputSetting;
    const { inputs, record } = setup(malformed);
    await record();

    expect(inputs.requestedDeviceIds()).toEqual([null]);
  });
});

describe("audio input devices hook", () => {
  it("is unsupported without a port and subscribes to nothing", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const seen: AudioInputDevicesSnapshot[] = [];
    function Probe() {
      seen.push(useAudioInputDevices(null));
      return null;
    }
    const root = createRoot(document.createElement("div"));
    cleanup.push(() => act(() => root.unmount()));
    act(() => root.render(createElement(Probe)));

    expect(seen[seen.length - 1]).toEqual({ kind: "unsupported" });
  });
});
