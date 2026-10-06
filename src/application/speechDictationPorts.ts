import type { SpeechLanguage } from "../domain/speechDictation";
import type { SpeechInputDevice, SpeechInputSetting } from "../domain/speechDictationInputSetting";
import type { SpeechTranscription } from "../domain/speechTranscription";

export type AudioCaptureFailureReason = "permission-denied" | "unsupported" | "failed";
export type AudioCaptureFrame = Readonly<{ samples: Float32Array; sampleRate: number }>;
export type AudioCaptureInputFallback = "system-default";
export type AudioCaptureStartOutcome =
  | Readonly<{ kind: "started"; inputFallback?: AudioCaptureInputFallback }>
  | Readonly<{ kind: "failed"; reason: AudioCaptureFailureReason }>;

export interface AudioCaptureSink {
  onFrame(frame: AudioCaptureFrame): void;
  onFailure(reason: AudioCaptureFailureReason): void;
}

export interface AudioCaptureHandle {
  readonly started: Promise<AudioCaptureStartOutcome>;
  stop(): void;
}

export interface AudioCapturePort {
  isSupported(): boolean;
  start(sink: AudioCaptureSink): AudioCaptureHandle;
}

export type SpeechTranscriptionRequest = Readonly<{
  serverId: string;
  language: SpeechLanguage;
  pcm: Uint8Array;
}>;

export interface SpeechTranscriberPort {
  transcribe(request: SpeechTranscriptionRequest): Promise<SpeechTranscription>;
}

export type AudioInputLockReason =
  "permission-required" | "permission-denied" | "no-microphone" | "listing-failed";
export type AudioInputDevicesSnapshot =
  | Readonly<{ kind: "unsupported" }>
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "locked"; reason: AudioInputLockReason; requesting: boolean }>
  | Readonly<{ kind: "ready"; devices: readonly SpeechInputDevice[]; truncated: boolean }>;

export interface AudioInputDevicesPort {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AudioInputDevicesSnapshot;
  requestAccess(): void;
}

export interface SpeechInputSelectionPort {
  current(): SpeechInputSetting;
  select(setting: SpeechInputSetting): void;
}

export type SpeechInputPorts = Readonly<{
  devices: AudioInputDevicesPort;
  selection: SpeechInputSelectionPort;
}>;

export type SpeechDictationPorts = Readonly<{
  capture: AudioCapturePort;
  transcriber: SpeechTranscriberPort;
  input?: SpeechInputPorts;
}>;
