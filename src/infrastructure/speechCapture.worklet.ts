import {
  SPEECH_CAPTURE_CHUNK_SAMPLES,
  SPEECH_CAPTURE_PROCESSOR_NAME,
  mixSpeechCaptureSample,
} from "./speechCaptureWorkletProtocol";

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor & {
    process(inputs: readonly (readonly Float32Array[])[]): boolean;
  },
): void;

class SpeechCaptureProcessor extends AudioWorkletProcessor {
  private chunk = new Float32Array(SPEECH_CAPTURE_CHUNK_SAMPLES);
  private filled = 0;

  process(inputs: readonly (readonly Float32Array[])[]): boolean {
    const channels = inputs[0] ?? [];
    const frames = channels[0]?.length ?? 0;
    for (let index = 0; index < frames; index += 1) {
      this.append(mixSpeechCaptureSample(channels, index));
    }
    return true;
  }

  private append(sample: number): void {
    this.chunk[this.filled] = sample;
    this.filled += 1;
    if (this.filled < SPEECH_CAPTURE_CHUNK_SAMPLES) return;
    const full = this.chunk;
    this.chunk = new Float32Array(SPEECH_CAPTURE_CHUNK_SAMPLES);
    this.filled = 0;
    this.port.postMessage(full, [full.buffer]);
  }
}

registerProcessor(SPEECH_CAPTURE_PROCESSOR_NAME, SpeechCaptureProcessor);
