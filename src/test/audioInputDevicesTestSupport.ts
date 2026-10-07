import { vi } from "vitest";
import {
  FakeMediaStream,
  FakeMediaTrack,
  installFakeBrowserAudio,
  namedError,
  type FakeBrowserAudio,
} from "./speechDictationTestSupport";

export type FakeAudioInput = Readonly<{ deviceId: string; label: string }>;

export interface FakeAudioInputsOptions {
  readonly devices?: readonly FakeAudioInput[];
  readonly granted?: boolean;
  readonly denied?: boolean;
  readonly sampleRate?: number;
}

export interface FakeAudioInputs {
  readonly audio: FakeBrowserAudio;
  readonly enumerateDevices: ReturnType<typeof vi.fn<() => Promise<readonly unknown[]>>>;
  readonly streams: FakeInputStream[];
  requestedDeviceIds(): (string | null)[];
  setDevices(devices: readonly FakeAudioInput[]): void;
  setDenied(denied: boolean): void;
  changeDevices(devices: readonly FakeAudioInput[]): void;
  emitDeviceChange(): void;
  deviceChangeListeners(): number;
  restore(): void;
}

export class FakeInputTrack extends FakeMediaTrack {
  constructor(readonly deviceId: string) {
    super();
  }
  getSettings(): { deviceId: string } {
    return { deviceId: this.deviceId };
  }
}

export class FakeInputStream extends FakeMediaStream {
  override readonly tracks: FakeInputTrack[];
  constructor(readonly deviceId: string) {
    super();
    this.tracks = [new FakeInputTrack(deviceId)];
  }
}

export const BUILT_IN_MICROPHONE: FakeAudioInput = {
  deviceId: "built-in-1",
  label: "MacBook Pro Microphone",
};
export const STUDIO_MICROPHONE: FakeAudioInput = { deviceId: "studio-1", label: "Studio Mic" };

export function installFakeAudioInputs(options: FakeAudioInputsOptions = {}): FakeAudioInputs {
  let devices = [...(options.devices ?? [BUILT_IN_MICROPHONE, STUDIO_MICROPHONE])];
  let granted = options.granted ?? false;
  let denied = options.denied ?? false;
  const streams: FakeInputStream[] = [];
  const requested: (string | null)[] = [];
  const listeners = new Set<() => void>();
  const open = async (constraints: unknown): Promise<FakeInputStream> => {
    const deviceId = exactDeviceId(constraints);
    requested.push(deviceId);
    if (denied) return Promise.reject(namedError("NotAllowedError"));
    if (devices.length === 0) return Promise.reject(namedError("NotFoundError"));
    const device = deviceId === null ? devices[0] : devices.find((it) => it.deviceId === deviceId);
    if (device === undefined) return Promise.reject(namedError("OverconstrainedError"));
    granted = true;
    const stream = new FakeInputStream(device.deviceId);
    streams.push(stream);
    return stream;
  };
  const audio = installFakeBrowserAudio({ getUserMedia: open, sampleRate: options.sampleRate });
  const enumerateDevices = vi.fn(async (): Promise<readonly unknown[]> => {
    if (!granted) return devices.length === 0 ? [] : [CONCEALED_ENTRY, CAMERA_ENTRY];
    return [CAMERA_ENTRY, ...devices.map((device) => ({ kind: "audioinput", ...device }))];
  });
  Object.assign(globalThis.navigator.mediaDevices, {
    enumerateDevices,
    addEventListener: (type: string, listener: () => void) => {
      if (type === "devicechange") listeners.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === "devicechange") listeners.delete(listener);
    },
  });
  const emitDeviceChange = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return {
    audio,
    enumerateDevices,
    streams,
    requestedDeviceIds: () => [...requested],
    setDevices: (next) => {
      devices = [...next];
    },
    setDenied: (next) => {
      denied = next;
    },
    changeDevices: (next) => {
      devices = [...next];
      emitDeviceChange();
    },
    emitDeviceChange,
    deviceChangeListeners: () => listeners.size,
    restore: () => audio.restore(),
  };
}

export function numberedAudioInputs(count: number): FakeAudioInput[] {
  return Array.from({ length: count }, (_, index) => ({
    deviceId: `numbered-${index + 1}`,
    label: `Microphone ${index + 1}`,
  }));
}

const CONCEALED_ENTRY = { kind: "audioinput", deviceId: "", label: "" };
const CAMERA_ENTRY = { kind: "videoinput", deviceId: "camera-1", label: "FaceTime HD Camera" };

function exactDeviceId(constraints: unknown): string | null {
  const audio = property(constraints, "audio");
  const exact = property(property(audio, "deviceId"), "exact");
  return typeof exact === "string" ? exact : null;
}

function property(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}
