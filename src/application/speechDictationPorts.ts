import type { SpeechLanguage } from "../domain/speechDictation";
import type { SpeechTranscription } from "../domain/speechTranscription";

export type AudioCaptureFailureReason = "permission-denied" | "unsupported" | "failed";
export type AudioCaptureFrame = Readonly<{ samples: Float32Array; sampleRate: number }>;
export type AudioCaptureStartOutcome =
  Readonly<{ kind: "started" }> | Readonly<{ kind: "failed"; reason: AudioCaptureFailureReason }>;

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

export type SpeechDictationPorts = Readonly<{
  capture: AudioCapturePort;
  transcriber: SpeechTranscriberPort;
}>;
