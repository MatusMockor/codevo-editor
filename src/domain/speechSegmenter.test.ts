import { describe, expect, it } from "vitest";
import { tone } from "../test/speechDictationTestSupport";
import { SPEECH_MAX_SEGMENT_BYTES, SPEECH_SAMPLE_RATE, floatToPcm16 } from "./speechPcm";
import {
  SPEECH_ANALYSIS_WINDOW_SAMPLES,
  SPEECH_KEEP_RMS_THRESHOLD,
  SPEECH_LEADING_SILENCE_SAMPLES,
  SPEECH_MAX_SEGMENT_SAMPLES,
  SPEECH_MAX_SOFT_LEAD_SAMPLES,
  SPEECH_MIN_SEGMENT_SAMPLES,
  SPEECH_MIN_TAIL_SAMPLES,
  SPEECH_MIN_VOICED_SAMPLES,
  SPEECH_TRAILING_SILENCE_SAMPLES,
  SPEECH_VOICE_RMS_THRESHOLD,
  createSpeechSegmenter,
  flushSpeechSegmenter,
  pushSpeechFrame,
  type SpeechSegment,
  type SpeechSegmenterState,
} from "./speechSegmenter";

const voiced = (seconds: number, amplitude = 0.3) =>
  floatToPcm16(tone(seconds, SPEECH_SAMPLE_RATE, amplitude));
const quiet = (seconds: number) => new Int16Array(Math.round(seconds * SPEECH_SAMPLE_RATE));
const soft = (seconds: number) => voiced(seconds, 0.004);
const decibels = (rms: number) => 20 * Math.log10(rms);

function feed(frames: readonly Int16Array[], frameSamples = 0) {
  let state: SpeechSegmenterState = createSpeechSegmenter();
  const segments: SpeechSegment[] = [];
  for (const frame of frames) {
    const size = frameSamples > 0 ? frameSamples : Math.max(1, frame.length);
    for (let offset = 0; offset < frame.length; offset += size) {
      const step = pushSpeechFrame(state, frame.subarray(offset, offset + size));
      state = step.state;
      segments.push(...step.segments);
    }
  }
  return { state, segments };
}
const bytes = (segments: readonly SpeechSegment[]) => segments.map((segment) => segment.pcm.length);

describe("speech segmenter constants", () => {
  it("names the documented thresholds", () => {
    expect(SPEECH_ANALYSIS_WINDOW_SAMPLES).toBe(320);
    expect(SPEECH_MIN_SEGMENT_SAMPLES).toBe(32000);
    expect(SPEECH_TRAILING_SILENCE_SAMPLES).toBe(9600);
    expect(SPEECH_MAX_SEGMENT_SAMPLES).toBe(480000);
    expect(SPEECH_MIN_TAIL_SAMPLES).toBe(320);
    expect(SPEECH_LEADING_SILENCE_SAMPLES).toBe(4800);
    expect(SPEECH_MIN_VOICED_SAMPLES).toBe(1600);
    expect(SPEECH_MAX_SOFT_LEAD_SAMPLES).toBe(32000);
  });
  it("keeps leading audio from -55 dBFS and detects voice from -40 dBFS", () => {
    expect(decibels(SPEECH_VOICE_RMS_THRESHOLD)).toBeCloseTo(-40, 5);
    expect(decibels(SPEECH_KEEP_RMS_THRESHOLD)).toBeCloseTo(-55, 0);
    expect(SPEECH_KEEP_RMS_THRESHOLD).toBeLessThan(SPEECH_VOICE_RMS_THRESHOLD);
  });
});

describe("speech segmenter", () => {
  it("cuts at a 600 ms pause once two seconds are buffered", () => {
    const waiting = feed([voiced(2.5), quiet(0.58)]);
    expect(waiting.segments).toEqual([]);
    const cut = pushSpeechFrame(waiting.state, quiet(0.02));
    expect(bytes(cut.segments)).toEqual([(40000 + SPEECH_TRAILING_SILENCE_SAMPLES) * 2]);
    expect(cut.state).toEqual(createSpeechSegmenter());
  });
  it("waits for two buffered seconds before cutting a short utterance", () => {
    const waiting = feed([voiced(1), quiet(0.98)]);
    expect(waiting.segments).toEqual([]);
    expect(bytes(pushSpeechFrame(waiting.state, quiet(0.02)).segments)).toEqual([64000]);
  });
  it("keeps recording through pauses shorter than 600 ms", () => {
    const result = feed([voiced(1.5), quiet(0.5), voiced(1.5), quiet(0.5), voiced(1)]);
    expect(result.segments).toEqual([]);
    expect(result.state.samples).toBe(5 * SPEECH_SAMPLE_RATE);
  });
  it("sends nothing for silence and keeps only a bounded pre-roll", () => {
    const result = feed([quiet(60)], 683);
    expect(result.segments).toEqual([]);
    expect(result.state.samples).toBeLessThanOrEqual(SPEECH_LEADING_SILENCE_SAMPLES);
    expect(result.state.chunks.length).toBeLessThanOrEqual(32);
    expect(flushSpeechSegmenter(result.state).segments).toEqual([]);
  });
  it("treats noise below the voice threshold as silence", () => {
    const result = feed([voiced(5, 0.004)]);
    expect(result.segments).toEqual([]);
    expect(flushSpeechSegmenter(result.state).segments).toEqual([]);
  });
  it("keeps a soft first word in front of normal speech", () => {
    const result = feed([quiet(5), soft(0.8), voiced(2.5), quiet(0.6)]);
    expect(bytes(result.segments)).toEqual([
      (SPEECH_LEADING_SILENCE_SAMPLES + 3.3 * SPEECH_SAMPLE_RATE + 9600) * 2,
    ]);
  });
  it("keeps a soft first word across a short gap before normal speech", () => {
    const result = feed([quiet(5), soft(0.4), quiet(0.4), voiced(2.5), quiet(0.6)]);
    expect(bytes(result.segments)).toEqual([
      (SPEECH_LEADING_SILENCE_SAMPLES + 3.3 * SPEECH_SAMPLE_RATE + 9600) * 2,
    ]);
  });
  it("sends nothing for room noise alone and keeps only a bounded soft lead", () => {
    const result = feed([soft(90)], 683);
    expect(result.segments).toEqual([]);
    expect(result.state.voicedSamples).toBe(0);
    expect(result.state.samples).toBeLessThanOrEqual(SPEECH_MAX_SOFT_LEAD_SAMPLES);
    expect(flushSpeechSegmenter(result.state).segments).toEqual([]);
  });
  it("sends nothing for a soft sound followed by silence", () => {
    const result = feed([soft(1), quiet(5)]);
    expect(result.segments).toEqual([]);
    expect(result.state.samples).toBeLessThanOrEqual(SPEECH_LEADING_SILENCE_SAMPLES);
    expect(flushSpeechSegmenter(result.state).segments).toEqual([]);
  });
  it("returns to the short pre-roll once a soft sound has ended in silence", () => {
    const result = feed([soft(1), quiet(5), voiced(2.5), quiet(0.6)]);
    expect(bytes(result.segments)).toEqual([
      (SPEECH_LEADING_SILENCE_SAMPLES + 2.5 * SPEECH_SAMPLE_RATE + 9600) * 2,
    ]);
  });
  it("caps the soft lead kept in front of speech that follows long room noise", () => {
    const result = feed([soft(20), voiced(2.5), quiet(0.6)]);
    expect(bytes(result.segments)).toEqual([
      (SPEECH_MAX_SOFT_LEAD_SAMPLES + 2.5 * SPEECH_SAMPLE_RATE + 9600) * 2,
    ]);
  });
  it("trims leading silence to the pre-roll before speech", () => {
    const result = feed([quiet(5), voiced(2.5), quiet(0.6)]);
    expect(bytes(result.segments)).toEqual([
      (SPEECH_LEADING_SILENCE_SAMPLES + 2.5 * SPEECH_SAMPLE_RATE + 9600) * 2,
    ]);
  });
  it("drops a click that never becomes speech", () => {
    const result = feed([voiced(0.04), quiet(3)]);
    expect(result.segments).toEqual([]);
    expect(flushSpeechSegmenter(result.state).segments).toEqual([]);
  });
  it("hard-cuts continuous speech at exactly thirty seconds", () => {
    const result = feed([voiced(65)], SPEECH_ANALYSIS_WINDOW_SAMPLES * 4);
    expect(bytes(result.segments)).toEqual([SPEECH_MAX_SEGMENT_BYTES, SPEECH_MAX_SEGMENT_BYTES]);
    expect(bytes(flushSpeechSegmenter(result.state).segments)).toEqual([5 * 32000]);
  });
  it("never exceeds the wire limit when frames do not align with the cut", () => {
    const result = feed([voiced(65)], 683);
    const flushed = flushSpeechSegmenter(result.state).segments;
    const all = bytes([...result.segments, ...flushed]);
    expect(all.length).toBe(3);
    expect(all.every((size) => size <= SPEECH_MAX_SEGMENT_BYTES && size % 2 === 0)).toBe(true);
    expect(all[0]).toBeGreaterThan(SPEECH_MAX_SEGMENT_BYTES - 2 * SPEECH_ANALYSIS_WINDOW_SAMPLES);
    expect(all.reduce((sum, size) => sum + size, 0)).toBe(65 * 32000);
  });
  it("splits a single oversized frame", () => {
    const step = pushSpeechFrame(createSpeechSegmenter(), voiced(61));
    expect(bytes(step.segments)).toEqual([SPEECH_MAX_SEGMENT_BYTES, SPEECH_MAX_SEGMENT_BYTES]);
    expect(step.state.samples).toBe(SPEECH_SAMPLE_RATE);
  });
  it("flushes the remainder on stop", () => {
    const result = feed([voiced(1)]);
    expect(result.segments).toEqual([]);
    const flushed = flushSpeechSegmenter(result.state);
    expect(bytes(flushed.segments)).toEqual([32000]);
    expect(flushed.state).toEqual(createSpeechSegmenter());
  });
  it("drops a final tail shorter than 640 bytes", () => {
    const tail = feed([voiced(0.019)]);
    expect(tail.state.samples).toBe(304);
    expect(flushSpeechSegmenter(tail.state).segments).toEqual([]);
  });
  it("drops a tail with under 100 ms of voiced audio and keeps a longer one", () => {
    expect(flushSpeechSegmenter(feed([voiced(0.08)]).state).segments).toEqual([]);
    expect(bytes(flushSpeechSegmenter(feed([voiced(0.1)]).state).segments)).toEqual([3200]);
  });
  it("drops the short tail left after a hard cut", () => {
    const result = feed([voiced(30.019)], SPEECH_ANALYSIS_WINDOW_SAMPLES);
    expect(bytes(result.segments)).toEqual([SPEECH_MAX_SEGMENT_BYTES]);
    expect(result.state.samples).toBe(304);
    expect(flushSpeechSegmenter(result.state).segments).toEqual([]);
  });
  it("encodes the buffered samples in order as little-endian PCM", () => {
    const frame = Int16Array.from({ length: 16000 }, (_, index) =>
      index % 2 === 0 ? 8000 : -8000,
    );
    const flushed = flushSpeechSegmenter(pushSpeechFrame(createSpeechSegmenter(), frame).state);
    const pcm = flushed.segments[0]?.pcm ?? new Uint8Array(0);
    expect(pcm.length).toBe(32000);
    expect([...pcm.subarray(0, 4)]).toEqual([0x40, 0x1f, 0xc0, 0xe0]);
  });
  it("does not alias the caller's frame", () => {
    const frame = voiced(1);
    const pushed = pushSpeechFrame(createSpeechSegmenter(), frame);
    const expected = [...(flushSpeechSegmenter(pushed.state).segments[0]?.pcm ?? [])];
    frame.fill(0);
    expect([...(flushSpeechSegmenter(pushed.state).segments[0]?.pcm ?? [])]).toEqual(expected);
    expect(expected.some((byte) => byte !== 0)).toBe(true);
  });
  it("leaves the previous state untouched", () => {
    const first = pushSpeechFrame(createSpeechSegmenter(), voiced(1));
    const snapshot = first.state.samples;
    pushSpeechFrame(first.state, voiced(1));
    expect(first.state.samples).toBe(snapshot);
    expect(createSpeechSegmenter().samples).toBe(0);
  });
});
