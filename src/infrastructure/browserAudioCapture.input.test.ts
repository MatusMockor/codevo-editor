import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpeechInputSetting } from "../domain/speechDictationInputSetting";
import {
  BUILT_IN_MICROPHONE,
  STUDIO_MICROPHONE,
  installFakeAudioInputs,
  type FakeAudioInputs,
  type FakeAudioInputsOptions,
} from "../test/audioInputDevicesTestSupport";
import { SPEECH_WORKLET_TEST_URL, deferred, flushAsync } from "../test/speechDictationTestSupport";
import { BrowserAudioCapture } from "./browserAudioCapture";

const STUDIO: SpeechInputSetting = { kind: "device", id: "studio-1", label: "Studio Mic" };
const SINK = { onFrame: () => undefined, onFailure: () => undefined };

let inputs: FakeAudioInputs | null = null;
afterEach(() => {
  inputs?.restore();
  inputs = null;
});

function setup(selected: SpeechInputSetting, options: FakeAudioInputsOptions = {}) {
  const installed = installFakeAudioInputs(options);
  inputs = installed;
  const opened = vi.fn();
  const selection = { current: selected };
  const capture = new BrowserAudioCapture(SPEECH_WORKLET_TEST_URL, {
    selected: () => selection.current,
    opened,
  });
  return { inputs: installed, capture, opened, selection };
}

describe("browser audio capture input selection", () => {
  it("captures from the system default without a device constraint", async () => {
    const { inputs, capture, opened } = setup({ kind: "system-default" });

    expect(await capture.start(SINK).started).toEqual({ kind: "started" });
    expect(inputs.requestedDeviceIds()).toEqual([null]);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("requests exactly the selected device", async () => {
    const { inputs, capture } = setup(STUDIO);

    expect(await capture.start(SINK).started).toEqual({ kind: "started" });
    expect(inputs.audio.getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        deviceId: { exact: "studio-1" },
      },
      video: false,
    });
    expect(inputs.streams.map((stream) => stream.deviceId)).toEqual(["studio-1"]);
    expect(inputs.enumerateDevices).not.toHaveBeenCalled();
  });

  it("reads the selection when a capture starts, not when it was created", async () => {
    const { inputs, capture, selection } = setup({ kind: "system-default" });
    selection.current = STUDIO;
    const first = capture.start(SINK);
    selection.current = { kind: "system-default" };
    await first.started;
    first.stop();
    await capture.start(SINK).started;

    expect(inputs.requestedDeviceIds()).toEqual(["studio-1", null]);
  });

  it("falls back to the system default and says so when the saved device is gone", async () => {
    const { inputs, capture } = setup(
      { kind: "device", id: "gone-1", label: "Gone Mic" },
      { devices: [BUILT_IN_MICROPHONE] },
    );

    expect(await capture.start(SINK).started).toEqual({
      kind: "started",
      inputFallback: "system-default",
    });
    expect(inputs.requestedDeviceIds()).toEqual(["gone-1", null]);
    expect(inputs.streams.map((stream) => stream.deviceId)).toEqual(["built-in-1"]);
    expect(inputs.audio.microphoneLive()).toBe(true);
  });

  it("re-identifies a device whose id changed by its label", async () => {
    const { inputs, capture } = setup({ kind: "device", id: "studio-old", label: "Studio Mic" });

    expect(await capture.start(SINK).started).toEqual({ kind: "started" });
    expect(inputs.requestedDeviceIds()).toEqual(["studio-old", null, "studio-1"]);
    expect(inputs.streams.map((stream) => stream.deviceId)).toEqual(["built-in-1", "studio-1"]);
    expect(inputs.streams[0]?.tracks.every((track) => track.stopped)).toBe(true);
    expect(inputs.streams[1]?.tracks.every((track) => !track.stopped)).toBe(true);
  });

  it("keeps the default stream when it already is the re-identified device", async () => {
    const { inputs, capture } = setup(
      { kind: "device", id: "studio-old", label: "Studio Mic" },
      { devices: [STUDIO_MICROPHONE, BUILT_IN_MICROPHONE] },
    );

    expect(await capture.start(SINK).started).toEqual({ kind: "started" });
    expect(inputs.requestedDeviceIds()).toEqual(["studio-old", null]);
    expect(inputs.streams).toHaveLength(1);
  });

  it("does not guess between devices sharing the saved label", async () => {
    const { inputs, capture } = setup(
      { kind: "device", id: "usb-old", label: "USB Audio" },
      {
        devices: [
          BUILT_IN_MICROPHONE,
          { deviceId: "usb-1", label: "USB Audio" },
          { deviceId: "usb-2", label: "USB Audio" },
        ],
      },
    );

    expect(await capture.start(SINK).started).toEqual({
      kind: "started",
      inputFallback: "system-default",
    });
    expect(inputs.requestedDeviceIds()).toEqual(["usb-old", null]);
  });

  it("stays on the default when the re-identified device cannot be opened", async () => {
    const { inputs, capture } = setup({ kind: "device", id: "studio-old", label: "Studio Mic" });
    inputs.enumerateDevices.mockImplementationOnce(async () => {
      inputs.setDevices([BUILT_IN_MICROPHONE]);
      return [{ kind: "audioinput", deviceId: "studio-1", label: "Studio Mic" }];
    });

    expect(await capture.start(SINK).started).toEqual({
      kind: "started",
      inputFallback: "system-default",
    });
    expect(inputs.requestedDeviceIds()).toEqual(["studio-old", null, "studio-1"]);
    expect(inputs.streams[0]?.tracks.every((track) => !track.stopped)).toBe(true);
  });

  it("stays on the default when devices cannot be enumerated", async () => {
    const { inputs, capture } = setup({ kind: "device", id: "studio-old", label: "Studio Mic" });
    inputs.enumerateDevices.mockRejectedValueOnce(new Error("enumeration failed"));

    expect(await capture.start(SINK).started).toEqual({
      kind: "started",
      inputFallback: "system-default",
    });
  });

  it("reports blocked access for a selected device instead of falling back", async () => {
    const { inputs, capture } = setup(STUDIO, { denied: true });

    expect(await capture.start(SINK).started).toEqual({
      kind: "failed",
      reason: "permission-denied",
    });
    expect(inputs.requestedDeviceIds()).toEqual(["studio-1"]);
  });

  it("fails when neither the saved device nor any default microphone exists", async () => {
    const { inputs, capture, opened } = setup(STUDIO, { devices: [] });

    expect(await capture.start(SINK).started).toEqual({ kind: "failed", reason: "failed" });
    expect(inputs.requestedDeviceIds()).toEqual(["studio-1", null]);
    expect(opened).not.toHaveBeenCalled();
  });

  it("does not open the default microphone after the capture was stopped", async () => {
    const { inputs, capture } = setup({ kind: "device", id: "gone-1", label: "Gone Mic" });
    const gate = deferred<void>();
    const open = inputs.audio.getUserMedia.getMockImplementation();
    inputs.audio.getUserMedia.mockImplementationOnce(async (constraints) => {
      await gate.promise;
      return open?.(constraints);
    });
    const handle = capture.start(SINK);
    handle.stop();
    gate.resolve();
    await flushAsync();

    expect(await handle.started).toEqual({ kind: "failed", reason: "failed" });
    expect(inputs.requestedDeviceIds()).toEqual(["gone-1"]);
    expect(inputs.audio.microphoneLive()).toBe(false);
  });

  it("releases the default stream when stopped while devices are re-identified", async () => {
    const { inputs, capture } = setup({ kind: "device", id: "studio-old", label: "Studio Mic" });
    const pending = deferred<readonly unknown[]>();
    inputs.enumerateDevices.mockReturnValueOnce(pending.promise);
    const handle = capture.start(SINK);
    await flushAsync();
    handle.stop();
    pending.resolve([{ kind: "audioinput", deviceId: "studio-1", label: "Studio Mic" }]);

    expect(await handle.started).toEqual({ kind: "failed", reason: "failed" });
    expect(inputs.requestedDeviceIds()).toEqual(["studio-old", null]);
    expect(inputs.audio.microphoneLive()).toBe(false);
  });
});
