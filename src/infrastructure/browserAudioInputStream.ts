import {
  listSpeechInputDevices,
  resolveSpeechInput,
  type SpeechInputDeviceSetting,
  type SpeechInputSetting,
} from "../domain/speechDictationInputSetting";

export interface AudioInputMedia {
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  readonly enumerateDevices: () => Promise<readonly unknown[]>;
}

export type OpenedAudioInput = Readonly<{ stream: MediaStream; fallback: boolean }>;

const BASE_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
const DEVICE_MISSING_ERROR_NAMES: ReadonlySet<string> = new Set([
  "OverconstrainedError",
  "NotFoundError",
]);

export function audioInputConstraints(deviceId: string | null): MediaStreamConstraints {
  if (deviceId === null) return { audio: BASE_AUDIO_CONSTRAINTS, video: false };
  return { audio: { ...BASE_AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } }, video: false };
}

export async function openAudioInput(
  media: AudioInputMedia,
  setting: SpeechInputSetting,
  cancelled: () => boolean,
): Promise<OpenedAudioInput> {
  if (setting.kind === "system-default") return openSystemDefault(media, false);
  const saved = await openDevice(media, setting.id);
  if (saved !== null) return { stream: saved, fallback: false };
  if (cancelled()) throw new Error("Audio capture was cancelled");
  return openRelabelledDevice(media, setting, await openSystemDefault(media, true), cancelled);
}

export function mediaErrorName(error: unknown): string {
  if (typeof error !== "object" || error === null || !("name" in error)) return "";
  return typeof error.name === "string" ? error.name : "";
}

export function releaseMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.onended = null;
    try {
      track.stop();
    } catch {
      continue;
    }
  }
}

async function openSystemDefault(
  media: AudioInputMedia,
  fallback: boolean,
): Promise<OpenedAudioInput> {
  return { stream: await media.getUserMedia(audioInputConstraints(null)), fallback };
}

async function openDevice(media: AudioInputMedia, deviceId: string): Promise<MediaStream | null> {
  try {
    return await media.getUserMedia(audioInputConstraints(deviceId));
  } catch (error) {
    if (DEVICE_MISSING_ERROR_NAMES.has(mediaErrorName(error))) return null;
    throw error;
  }
}

async function openRelabelledDevice(
  media: AudioInputMedia,
  setting: SpeechInputDeviceSetting,
  systemDefault: OpenedAudioInput,
  cancelled: () => boolean,
): Promise<OpenedAudioInput> {
  const deviceId = await relabelledDeviceId(media, setting);
  if (deviceId === null || cancelled()) return systemDefault;
  if (capturesDevice(systemDefault.stream, deviceId)) {
    return { stream: systemDefault.stream, fallback: false };
  }
  const relabelled = await openDeviceQuietly(media, deviceId);
  if (relabelled === null) return systemDefault;
  releaseMediaStream(systemDefault.stream);
  return { stream: relabelled, fallback: false };
}

async function relabelledDeviceId(
  media: AudioInputMedia,
  setting: SpeechInputDeviceSetting,
): Promise<string | null> {
  const entries = await media.enumerateDevices().catch((): readonly unknown[] => []);
  const resolution = resolveSpeechInput(setting, listSpeechInputDevices(entries).devices);
  if (resolution.kind !== "device" || resolution.device.id === setting.id) return null;
  return resolution.device.id;
}

async function openDeviceQuietly(
  media: AudioInputMedia,
  deviceId: string,
): Promise<MediaStream | null> {
  try {
    return await media.getUserMedia(audioInputConstraints(deviceId));
  } catch {
    return null;
  }
}

function capturesDevice(stream: MediaStream, deviceId: string): boolean {
  try {
    return stream.getAudioTracks().some((track) => track.getSettings().deviceId === deviceId);
  } catch {
    return false;
  }
}
