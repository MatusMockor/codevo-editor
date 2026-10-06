export const SPEECH_SAMPLE_RATE = 16000;
export const SPEECH_BYTES_PER_SAMPLE = 2;
export const SPEECH_MIN_SEGMENT_BYTES = 640;
export const SPEECH_MAX_SEGMENT_BYTES = 960000;
export const SPEECH_MIN_INPUT_SAMPLE_RATE = 8000;
export const SPEECH_MAX_INPUT_SAMPLE_RATE = 192000;
export const SPEECH_MAX_BASE64_LENGTH = Math.ceil(SPEECH_MAX_SEGMENT_BYTES / 3) * 4;
export const SPEECH_METER_FLOOR_DB = -60;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_CODES = Uint8Array.from(BASE64_ALPHABET, (character) => character.charCodeAt(0));
const BASE64_PADDING = "=".charCodeAt(0);
const BASE64_SHAPE = /^[A-Za-z0-9+/]+={0,2}$/;
const PCM16_NEGATIVE_SCALE = 32768;
const PCM16_POSITIVE_SCALE = 32767;
const HOST_IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export type SpeechResamplerState = Readonly<{
  inputRate: number;
  sum: number;
  filled: number;
}>;
export type SpeechResampleStep = Readonly<{
  state: SpeechResamplerState;
  samples: Float32Array;
}>;

export function createSpeechResampler(inputRate: number): SpeechResamplerState | null {
  if (!Number.isFinite(inputRate)) return null;
  const rate = Math.round(inputRate);
  if (rate < SPEECH_MIN_INPUT_SAMPLE_RATE || rate > SPEECH_MAX_INPUT_SAMPLE_RATE) return null;
  return { inputRate: rate, sum: 0, filled: 0 };
}

export function resampleSpeechFrame(
  state: SpeechResamplerState,
  frame: Float32Array,
): SpeechResampleStep {
  const window = state.inputRate;
  const samples = new Float32Array(
    Math.floor((state.filled + frame.length * SPEECH_SAMPLE_RATE) / window),
  );
  let sum = state.sum;
  let filled = state.filled;
  let written = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const sample = finiteSample(frame[index]);
    let available = SPEECH_SAMPLE_RATE;
    while (available >= window - filled) {
      const take = window - filled;
      samples[written] = (sum + sample * take) / window;
      written += 1;
      available -= take;
      sum = 0;
      filled = 0;
    }
    sum += sample * available;
    filled += available;
  }
  return { state: { inputRate: state.inputRate, sum, filled }, samples };
}

export function floatToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    pcm[index] = pcm16Sample(finiteSample(samples[index]));
  }
  return pcm;
}

export function pcm16ToBytes(samples: Int16Array): Uint8Array {
  if (!HOST_IS_LITTLE_ENDIAN) return pcm16ToLittleEndianBytes(samples);
  return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength).slice();
}

export function pcm16ToLittleEndianBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * SPEECH_BYTES_PER_SAMPLE);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * SPEECH_BYTES_PER_SAMPLE, samples[index] ?? 0, true);
  }
  return bytes;
}

export function speechRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let squares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = finiteSample(samples[index]);
    squares += sample * sample;
  }
  return Math.min(1, Math.sqrt(squares / samples.length));
}

export function pcm16RmsLevel(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let squares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = (samples[index] ?? 0) / PCM16_NEGATIVE_SCALE;
    squares += sample * sample;
  }
  return Math.min(1, Math.sqrt(squares / samples.length));
}

export function speechMeterFraction(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const decibels = 20 * Math.log10(Math.min(1, rms));
  if (decibels <= SPEECH_METER_FLOOR_DB) return 0;
  return 1 - decibels / SPEECH_METER_FLOOR_DB;
}

export function isSpeechPcmByteLength(byteLength: number): boolean {
  return (
    Number.isSafeInteger(byteLength) &&
    byteLength >= SPEECH_MIN_SEGMENT_BYTES &&
    byteLength <= SPEECH_MAX_SEGMENT_BYTES &&
    byteLength % SPEECH_BYTES_PER_SAMPLE === 0
  );
}

export function encodeSpeechPcmBase64(pcm: Uint8Array): string | null {
  if (!isSpeechPcmByteLength(pcm.length)) return null;
  const encoded = new Uint8Array(Math.ceil(pcm.length / 3) * 4);
  let written = 0;
  for (let index = 0; index < pcm.length; index += 3) {
    const first = pcm[index] ?? 0;
    const second = pcm[index + 1] ?? 0;
    const third = pcm[index + 2] ?? 0;
    encoded[written] = base64Code(first >> 2);
    encoded[written + 1] = base64Code(((first & 0x03) << 4) | (second >> 4));
    encoded[written + 2] =
      index + 1 < pcm.length ? base64Code(((second & 0x0f) << 2) | (third >> 6)) : BASE64_PADDING;
    encoded[written + 3] = index + 2 < pcm.length ? base64Code(third & 0x3f) : BASE64_PADDING;
    written += 4;
  }
  return new TextDecoder().decode(encoded);
}

export function isSpeechPcmBase64(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > SPEECH_MAX_BASE64_LENGTH) return false;
  if (value.length % 4 !== 0 || !BASE64_SHAPE.test(value)) return false;
  return isSpeechPcmByteLength((value.length / 4) * 3 - base64PaddingLength(value));
}

function base64PaddingLength(value: string): number {
  if (value.endsWith("==")) return 2;
  if (value.endsWith("=")) return 1;
  return 0;
}

function base64Code(index: number): number {
  return BASE64_CODES[index] ?? BASE64_PADDING;
}

function finiteSample(sample: number | undefined): number {
  if (sample === undefined || !Number.isFinite(sample)) return 0;
  return sample;
}

function pcm16Sample(sample: number): number {
  if (sample <= -1) return -PCM16_NEGATIVE_SCALE;
  if (sample >= 1) return PCM16_POSITIVE_SCALE;
  if (sample < 0) return Math.round(sample * PCM16_NEGATIVE_SCALE);
  return Math.round(sample * PCM16_POSITIVE_SCALE);
}
