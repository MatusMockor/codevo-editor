import { notifyQuietly } from "../application/speechDictationMeterStore";
import type {
  AudioInputDevicesPort,
  AudioInputDevicesSnapshot,
  AudioInputLockReason,
} from "../application/speechDictationPorts";
import {
  listSpeechInputDevices,
  type SpeechInputDevice,
  type SpeechInputDeviceListing,
} from "../domain/speechDictationInputSetting";
import { mediaErrorName, releaseMediaStream } from "./browserAudioInputStream";

interface AudioInputDevicesApi {
  readonly enumerateDevices: () => Promise<readonly unknown[]>;
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  readonly listen: (listener: () => void) => () => void;
}

type MicrophoneAccess = Readonly<{ reason: AudioInputLockReason; release: () => void }>;
type EnumeratedAudioInputs = SpeechInputDeviceListing | "unsupported" | "failed";

const ACCESS_CONSTRAINTS: MediaStreamConstraints = { audio: true, video: false };
const DEVICE_CHANGE_EVENT = "devicechange";
const PERMISSION_ERROR_NAMES: ReadonlySet<string> = new Set(["NotAllowedError", "SecurityError"]);
const NO_MICROPHONE_ERROR_NAMES: ReadonlySet<string> = new Set([
  "NotFoundError",
  "OverconstrainedError",
]);
const UNSUPPORTED: AudioInputDevicesSnapshot = { kind: "unsupported" };
const LOADING: AudioInputDevicesSnapshot = { kind: "loading" };

export class BrowserAudioInputDevices implements AudioInputDevicesPort {
  private readonly listeners = new Set<() => void>();
  private snapshot: AudioInputDevicesSnapshot = LOADING;
  private lock: AudioInputLockReason = "permission-required";
  private requesting = false;
  private loading = false;
  private stale = false;
  private unlisten: (() => void) | null = null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.unlisten === null) this.attach();
    return () => this.unsubscribe(listener);
  };

  readonly getSnapshot = (): AudioInputDevicesSnapshot => this.snapshot;

  readonly refresh = (): void => {
    if (this.listeners.size === 0) return;
    void this.load();
  };

  readonly requestAccess = (): void => {
    void this.unlock();
  };

  private attach(): void {
    const api = audioInputDevicesApi();
    if (api === null) {
      this.snapshot = UNSUPPORTED;
      return;
    }
    this.unlisten = api.listen(this.refresh);
    void this.load();
  }

  private unsubscribe(listener: () => void): void {
    this.listeners.delete(listener);
    if (this.listeners.size > 0) return;
    const unlisten = this.unlisten;
    this.unlisten = null;
    unlisten?.();
  }

  private async load(): Promise<void> {
    if (this.loading) {
      this.stale = true;
      return;
    }
    this.loading = true;
    const listing = await enumerateAudioInputs();
    this.loading = false;
    const stale = this.takeStale();
    if (this.listeners.size === 0) return;
    this.publish(this.snapshotFor(listing));
    if (stale) await this.load();
  }

  private takeStale(): boolean {
    const stale = this.stale;
    this.stale = false;
    return stale;
  }

  private snapshotFor(listing: EnumeratedAudioInputs): AudioInputDevicesSnapshot {
    if (listing === "unsupported") return UNSUPPORTED;
    if (listing === "failed") return this.locked("listing-failed");
    if (listing.devices.length > 0) return this.ready(listing);
    if (listing.concealed) return this.locked(this.lock);
    return this.locked("no-microphone");
  }

  private ready(listing: SpeechInputDeviceListing): AudioInputDevicesSnapshot {
    this.lock = "permission-required";
    return { kind: "ready", devices: listing.devices, truncated: listing.truncated };
  }

  private locked(reason: AudioInputLockReason): AudioInputDevicesSnapshot {
    return { kind: "locked", reason, requesting: this.requesting };
  }

  private async unlock(): Promise<void> {
    const api = audioInputDevicesApi();
    if (api === null || this.requesting) return;
    this.requesting = true;
    this.republishLock();
    const access = await requestMicrophone(api);
    this.lock = access.reason;
    await this.load();
    this.requesting = false;
    this.republishLock();
    access.release();
  }

  private republishLock(): void {
    if (this.snapshot.kind !== "locked") return;
    this.publish(this.locked(this.snapshot.reason));
  }

  private publish(next: AudioInputDevicesSnapshot): void {
    if (sameSnapshot(this.snapshot, next)) return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) notifyQuietly(listener);
  }
}

async function enumerateAudioInputs(): Promise<EnumeratedAudioInputs> {
  const api = audioInputDevicesApi();
  if (api === null) return "unsupported";
  try {
    return listSpeechInputDevices(await api.enumerateDevices());
  } catch {
    return "failed";
  }
}

async function requestMicrophone(api: AudioInputDevicesApi): Promise<MicrophoneAccess> {
  try {
    const stream = await api.getUserMedia(ACCESS_CONSTRAINTS);
    return { reason: "listing-failed", release: () => releaseMediaStream(stream) };
  } catch (error) {
    return { reason: accessFailureReason(mediaErrorName(error)), release: () => undefined };
  }
}

function accessFailureReason(errorName: string): AudioInputLockReason {
  if (PERMISSION_ERROR_NAMES.has(errorName)) return "permission-denied";
  if (NO_MICROPHONE_ERROR_NAMES.has(errorName)) return "no-microphone";
  return "listing-failed";
}

function audioInputDevicesApi(): AudioInputDevicesApi | null {
  const devices = globalThis.navigator?.mediaDevices;
  if (typeof devices?.enumerateDevices !== "function") return null;
  if (typeof devices.getUserMedia !== "function") return null;
  return {
    enumerateDevices: () => devices.enumerateDevices(),
    getUserMedia: (constraints) => devices.getUserMedia(constraints),
    listen: (listener) => listenForDeviceChanges(devices, listener),
  };
}

function listenForDeviceChanges(devices: MediaDevices, listener: () => void): () => void {
  if (typeof devices.addEventListener !== "function") return () => undefined;
  devices.addEventListener(DEVICE_CHANGE_EVENT, listener);
  return () => devices.removeEventListener(DEVICE_CHANGE_EVENT, listener);
}

function sameSnapshot(left: AudioInputDevicesSnapshot, right: AudioInputDevicesSnapshot): boolean {
  if (left.kind === "locked" && right.kind === "locked") {
    return left.reason === right.reason && left.requesting === right.requesting;
  }
  if (left.kind === "ready" && right.kind === "ready") {
    return left.truncated === right.truncated && sameDevices(left.devices, right.devices);
  }
  return left.kind === right.kind;
}

function sameDevices(
  left: readonly SpeechInputDevice[],
  right: readonly SpeechInputDevice[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (device, index) => device.id === right[index]?.id && device.label === right[index]?.label,
  );
}
