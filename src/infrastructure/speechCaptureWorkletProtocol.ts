export const SPEECH_CAPTURE_PROCESSOR_NAME = "codevo-speech-capture";
export const SPEECH_CAPTURE_CHUNK_SAMPLES = 2048;

export function isSpeechCaptureChunk(value: unknown): value is Float32Array {
  return (
    value instanceof Float32Array &&
    value.length > 0 &&
    value.length <= SPEECH_CAPTURE_CHUNK_SAMPLES
  );
}

export function mixSpeechCaptureSample(channels: readonly Float32Array[], index: number): number {
  if (channels.length === 0) return 0;
  let sum = 0;
  for (const channel of channels) sum += channel[index] ?? 0;
  return sum / channels.length;
}
