import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioInputDevicesSnapshot } from "../application/speechDictationPorts";
import { SPEECH_INPUT_MAX_LISTED_DEVICES } from "../domain/speechDictationInputSetting";
import {
  BUILT_IN_MICROPHONE,
  STUDIO_MICROPHONE,
  installFakeAudioInputs,
  numberedAudioInputs,
  type FakeAudioInputs,
  type FakeAudioInputsOptions,
} from "../test/audioInputDevicesTestSupport";
import { deferred, flushAsync } from "../test/speechDictationTestSupport";
import { BrowserAudioInputDevices } from "./browserAudioInputDevices";

let inputs: FakeAudioInputs | null = null;
afterEach(() => {
  inputs?.restore();
  inputs = null;
});

function setup(options: FakeAudioInputsOptions = {}) {
  const installed = installFakeAudioInputs(options);
  inputs = installed;
  const devices = new BrowserAudioInputDevices();
  const seen: AudioInputDevicesSnapshot[] = [];
  const listen = () => devices.subscribe(() => seen.push(devices.getSnapshot()));
  return { inputs: installed, devices, seen, listen };
}

const READY_BOTH: AudioInputDevicesSnapshot = {
  kind: "ready",
  devices: [
    { id: "built-in-1", label: "MacBook Pro Microphone" },
    { id: "studio-1", label: "Studio Mic" },
  ],
  truncated: false,
};

describe("browser audio input devices", () => {
  it("is unsupported without media devices", () => {
    const devices = new BrowserAudioInputDevices();
    const unsubscribe = devices.subscribe(() => undefined);

    expect(devices.getSnapshot()).toEqual({ kind: "unsupported" });
    expect(() => devices.requestAccess()).not.toThrow();
    unsubscribe();
  });

  it("does not enumerate until something subscribes", async () => {
    const { inputs, devices } = setup({ granted: true });
    await flushAsync();

    expect(devices.getSnapshot()).toEqual({ kind: "loading" });
    expect(inputs.enumerateDevices).not.toHaveBeenCalled();
    expect(inputs.deviceChangeListeners()).toBe(0);
  });

  it("lists labelled inputs once access was granted", async () => {
    const { inputs, devices, listen } = setup({ granted: true });
    listen();
    await flushAsync();

    expect(devices.getSnapshot()).toEqual(READY_BOTH);
    expect(inputs.enumerateDevices).toHaveBeenCalledTimes(1);
    expect(inputs.requestedDeviceIds()).toEqual([]);
  });

  it("asks for access instead of listing blank entries while labels are hidden", async () => {
    const { inputs, devices, listen } = setup();
    listen();
    await flushAsync();

    expect(devices.getSnapshot()).toEqual({
      kind: "locked",
      reason: "permission-required",
      requesting: false,
    });
    expect(inputs.requestedDeviceIds()).toEqual([]);
  });

  it("lists devices after access is granted and releases the probe stream", async () => {
    const { inputs, devices, seen, listen } = setup();
    listen();
    await flushAsync();
    devices.requestAccess();
    await flushAsync();

    expect(devices.getSnapshot()).toEqual(READY_BOTH);
    expect(seen.map((snapshot) => snapshot.kind)).toEqual(["locked", "locked", "ready"]);
    expect(seen[1]).toMatchObject({ requesting: true });
    expect(inputs.streams).toHaveLength(1);
    expect(inputs.streams[0]?.tracks.every((track) => track.stopped)).toBe(true);
  });

  it("ignores a second access request while one is pending", async () => {
    const { inputs, devices, listen } = setup();
    listen();
    await flushAsync();
    devices.requestAccess();
    devices.requestAccess();
    await flushAsync();

    expect(inputs.requestedDeviceIds()).toEqual([null]);
  });

  it("reports blocked access truthfully and recovers on retry", async () => {
    const { inputs, devices, listen } = setup({ denied: true });
    listen();
    await flushAsync();
    devices.requestAccess();
    await flushAsync();

    expect(devices.getSnapshot()).toEqual({
      kind: "locked",
      reason: "permission-denied",
      requesting: false,
    });

    inputs.setDenied(false);
    devices.requestAccess();
    await flushAsync();

    expect(devices.getSnapshot()).toEqual(READY_BOTH);
  });

  it("reports a missing microphone", async () => {
    const { devices, listen } = setup({ devices: [] });
    listen();
    await flushAsync();

    expect(devices.getSnapshot()).toMatchObject({ kind: "locked", reason: "no-microphone" });

    devices.requestAccess();
    await flushAsync();

    expect(devices.getSnapshot()).toEqual({
      kind: "locked",
      reason: "no-microphone",
      requesting: false,
    });
  });

  it("reports a failed enumeration", async () => {
    const { inputs, devices, listen } = setup({ granted: true });
    inputs.enumerateDevices.mockRejectedValueOnce(new Error("enumeration failed"));
    listen();
    await flushAsync();

    expect(devices.getSnapshot()).toMatchObject({ kind: "locked", reason: "listing-failed" });
  });

  it("updates the list on devicechange", async () => {
    const { inputs, devices, seen, listen } = setup({ granted: true });
    listen();
    await flushAsync();
    inputs.changeDevices([BUILT_IN_MICROPHONE]);
    await flushAsync();

    expect(devices.getSnapshot()).toEqual({
      kind: "ready",
      devices: [{ id: "built-in-1", label: "MacBook Pro Microphone" }],
      truncated: false,
    });
    expect(seen).toHaveLength(2);
  });

  it("does not notify when a devicechange leaves the list unchanged", async () => {
    const { inputs, devices, seen, listen } = setup({ granted: true });
    listen();
    await flushAsync();
    const before = devices.getSnapshot();
    inputs.emitDeviceChange();
    await flushAsync();

    expect(devices.getSnapshot()).toBe(before);
    expect(seen).toHaveLength(1);
  });

  it("coalesces a burst of devicechange events and publishes the latest list", async () => {
    const { inputs, devices, listen } = setup({ granted: true });
    listen();
    await flushAsync();
    const pending = deferred<readonly unknown[]>();
    inputs.enumerateDevices.mockReturnValueOnce(pending.promise);
    inputs.emitDeviceChange();
    for (let burst = 0; burst < 20; burst += 1) inputs.changeDevices([STUDIO_MICROPHONE]);
    pending.resolve([{ kind: "audioinput", deviceId: "stale-1", label: "Stale Mic" }]);
    await flushAsync();

    expect(inputs.enumerateDevices).toHaveBeenCalledTimes(3);
    expect(devices.getSnapshot()).toEqual({
      kind: "ready",
      devices: [{ id: "studio-1", label: "Studio Mic" }],
      truncated: false,
    });
  });

  it("removes its devicechange listener with the last subscriber", async () => {
    const { inputs, devices, seen } = setup({ granted: true });
    const first = devices.subscribe(() => seen.push(devices.getSnapshot()));
    const second = devices.subscribe(() => undefined);
    await flushAsync();

    expect(inputs.deviceChangeListeners()).toBe(1);
    first();
    expect(inputs.deviceChangeListeners()).toBe(1);
    second();
    expect(inputs.deviceChangeListeners()).toBe(0);

    inputs.changeDevices([BUILT_IN_MICROPHONE]);
    await flushAsync();

    expect(inputs.enumerateDevices).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
  });

  it("drops an enumeration that settles after the last subscriber left", async () => {
    const { inputs, devices } = setup({ granted: true });
    const pending = deferred<readonly unknown[]>();
    inputs.enumerateDevices.mockReturnValueOnce(pending.promise);
    const listener = vi.fn();
    const unsubscribe = devices.subscribe(listener);
    unsubscribe();
    pending.resolve([{ kind: "audioinput", deviceId: "studio-1", label: "Studio Mic" }]);
    await flushAsync();

    expect(listener).not.toHaveBeenCalled();
    expect(devices.getSnapshot()).toEqual({ kind: "loading" });
  });

  it("enumerates again for a new subscriber", async () => {
    const { inputs, devices, listen } = setup({ granted: true });
    listen()();
    await flushAsync();
    inputs.setDevices([STUDIO_MICROPHONE]);
    listen();
    await flushAsync();

    expect(inputs.deviceChangeListeners()).toBe(1);
    expect(devices.getSnapshot()).toMatchObject({
      devices: [{ id: "studio-1", label: "Studio Mic" }],
    });
  });

  it("caps the listed devices and reports the truncation", async () => {
    const { devices, listen } = setup({
      granted: true,
      devices: numberedAudioInputs(SPEECH_INPUT_MAX_LISTED_DEVICES + 8),
    });
    listen();
    await flushAsync();
    const snapshot = devices.getSnapshot();

    expect(snapshot).toMatchObject({ kind: "ready", truncated: true });
    expect(snapshot.kind === "ready" ? snapshot.devices.length : 0).toBe(
      SPEECH_INPUT_MAX_LISTED_DEVICES,
    );
  });

  it("refreshes on request only while something is subscribed", async () => {
    const { inputs, devices, listen } = setup({ granted: true });
    devices.refresh();
    await flushAsync();
    expect(inputs.enumerateDevices).not.toHaveBeenCalled();

    listen();
    await flushAsync();
    inputs.setDevices([STUDIO_MICROPHONE]);
    devices.refresh();
    await flushAsync();

    expect(devices.getSnapshot()).toMatchObject({
      devices: [{ id: "studio-1", label: "Studio Mic" }],
    });
  });
});
