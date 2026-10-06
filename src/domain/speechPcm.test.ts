import { describe, expect, it } from "vitest";
import { silence, tone } from "../test/speechDictationTestSupport";
import {
  SPEECH_MAX_BASE64_LENGTH,
  SPEECH_MAX_SEGMENT_BYTES,
  SPEECH_MIN_SEGMENT_BYTES,
  SPEECH_SAMPLE_RATE,
  createSpeechResampler,
  encodeSpeechPcmBase64,
  floatToPcm16,
  isSpeechPcmBase64,
  pcm16RmsLevel,
  pcm16ToBytes,
  pcm16ToLittleEndianBytes,
  resampleSpeechFrame,
  speechMeterFraction,
  speechRmsLevel,
  type SpeechResamplerState,
} from "./speechPcm";

function resampleAll(inputRate: number, input: Float32Array, frame = input.length): Float32Array {
  let state = createSpeechResampler(inputRate) as SpeechResamplerState;
  const parts: number[] = [];
  for (let offset = 0; offset < input.length; offset += frame) {
    const step = resampleSpeechFrame(state, input.subarray(offset, offset + frame));
    state = step.state;
    parts.push(...step.samples);
  }
  return Float32Array.from(parts);
}

describe("PCM16 conversion", () => {
  it("scales, clamps and sanitises samples", () => {
    expect([
      ...floatToPcm16(Float32Array.from([0, 1, -1, 2, -2, 0.5, -0.5, Number.NaN, Infinity])),
    ]).toEqual([0, 32767, -32768, 32767, -32768, 16384, -16384, 0, 0]);
  });
  it.each([
    ["the host byte order path", pcm16ToBytes],
    ["the portable path", pcm16ToLittleEndianBytes],
  ])("writes signed little-endian bytes through %s", (_name, encode) => {
    expect([...encode(Int16Array.from([1, -2, 0x1234, -32768]))]).toEqual([
      0x01, 0x00, 0xfe, 0xff, 0x34, 0x12, 0x00, 0x80,
    ]);
    expect(encode(new Int16Array(0)).length).toBe(0);
  });
  it("encodes a view into a larger buffer identically on both paths and never aliases it", () => {
    const backing = Int16Array.from(
      { length: 4096 },
      (_, index) => ((index * 7919) % 65536) - 32768,
    );
    const view = backing.subarray(3, 2051);
    const fast = pcm16ToBytes(view);

    expect(fast.length).toBe(view.length * 2);
    expect([...fast]).toEqual([...pcm16ToLittleEndianBytes(view)]);
    const before = [...fast];
    backing.fill(0);
    expect([...fast]).toEqual(before);
  });
});

describe("speech resampling", () => {
  it.each([44100, 48000, 16000, 96000, 8000, 22050])(
    "produces exactly one second at 16 kHz from one second at %i Hz",
    (rate) => {
      expect(resampleAll(rate, tone(1, rate)).length).toBe(SPEECH_SAMPLE_RATE);
    },
  );
  it.each([44100, 48000])("is independent of how %i Hz input is framed", (rate) => {
    const input = tone(0.5, rate, 0.4, 440);
    const whole = resampleAll(rate, input);
    expect([...resampleAll(rate, input, 128)]).toEqual([...whole]);
    expect([...resampleAll(rate, input, 2048)]).toEqual([...whole]);
    expect([...resampleAll(rate, input, 1)]).toEqual([...whole]);
  });
  it("averages three input samples per output sample at 48 kHz", () => {
    const output = resampleAll(48000, Float32Array.from([0.3, 0.6, 0.9, -0.3, -0.3, -0.3, 1]));
    expect(output.length).toBe(2);
    expect(output[0]).toBeCloseTo(0.6, 6);
    expect(output[1]).toBeCloseTo(-0.3, 6);
  });
  it("passes 16 kHz input through unchanged", () => {
    const input = tone(0.01, 16000);
    expect([...resampleAll(16000, input)]).toEqual([...input]);
  });
  it.each([44100, 48000])("keeps a speech-band tone from %i Hz", (rate) => {
    const output = resampleAll(rate, tone(1, rate, 0.5, 300));
    expect(speechRmsLevel(output)).toBeGreaterThan(0.33);
    expect(speechRmsLevel(output)).toBeLessThan(0.36);
  });
  it.each([
    [48000, 12000],
    [48000, 15000],
    [44100, 13000],
  ])("attenuates a tone above the output band (%i Hz input, %i Hz tone)", (rate, hz) => {
    const input = tone(1, rate, 0.5, hz);
    const decimated = Float32Array.from(
      { length: SPEECH_SAMPLE_RATE },
      (_, index) => input[Math.floor((index * rate) / SPEECH_SAMPLE_RATE)] ?? 0,
    );
    const output = resampleAll(rate, input);
    expect(speechRmsLevel(decimated)).toBeGreaterThan(0.3);
    expect(speechRmsLevel(output)).toBeLessThan(speechRmsLevel(decimated) * 0.5);
  });
  it.each([0, 7999, 192001, Number.NaN, Infinity, -48000])(
    "rejects unsupported input rate %s",
    (rate) => {
      expect(createSpeechResampler(rate)).toBeNull();
    },
  );
  it("rounds a fractional device rate", () => {
    expect(createSpeechResampler(44100.4)?.inputRate).toBe(44100);
  });
});

describe("speech level", () => {
  it("measures RMS and clamps it", () => {
    expect(speechRmsLevel(new Float32Array(0))).toBe(0);
    expect(speechRmsLevel(silence(0.1, 16000))).toBe(0);
    expect(speechRmsLevel(Float32Array.from([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5, 6);
    expect(speechRmsLevel(Float32Array.from([4, -4]))).toBe(1);
    expect(speechRmsLevel(tone(1, 16000, 0.5))).toBeCloseTo(0.5 / Math.SQRT2, 3);
  });
  it("measures PCM16 RMS on the same scale", () => {
    expect(pcm16RmsLevel(new Int16Array(0))).toBe(0);
    expect(pcm16RmsLevel(floatToPcm16(tone(1, 16000, 0.5)))).toBeCloseTo(0.5 / Math.SQRT2, 3);
  });
  it("maps RMS to a bounded meter fraction", () => {
    expect(speechMeterFraction(0)).toBe(0);
    expect(speechMeterFraction(Number.NaN)).toBe(0);
    expect(speechMeterFraction(0.0001)).toBe(0);
    expect(speechMeterFraction(1)).toBe(1);
    expect(speechMeterFraction(5)).toBe(1);
    expect(speechMeterFraction(0.001)).toBeCloseTo(0, 6);
    expect(speechMeterFraction(0.0316227766)).toBeCloseTo(0.5, 4);
  });
});

describe("speech PCM base64", () => {
  it.each([640, 642, 644, 4096, SPEECH_MAX_SEGMENT_BYTES])(
    "encodes %i bytes as standard base64",
    (length) => {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 31 + 7) % 256);
      const encoded = encodeSpeechPcmBase64(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
      expect(isSpeechPcmBase64(encoded)).toBe(true);
    },
  );
  it.each([0, 2, 638, 641, SPEECH_MAX_SEGMENT_BYTES + 2])(
    "refuses %i bytes outside the wire contract",
    (length) => {
      expect(encodeSpeechPcmBase64(new Uint8Array(length))).toBeNull();
    },
  );
  it("bounds the encoded request", () => {
    expect(SPEECH_MAX_BASE64_LENGTH).toBe(1280000);
    expect(SPEECH_MIN_SEGMENT_BYTES).toBe(640);
    expect(encodeSpeechPcmBase64(new Uint8Array(SPEECH_MAX_SEGMENT_BYTES))?.length).toBe(1280000);
  });
  it.each([
    "",
    "AAAA",
    Buffer.alloc(638).toString("base64"),
    Buffer.alloc(641).toString("base64"),
    Buffer.alloc(SPEECH_MAX_SEGMENT_BYTES + 2).toString("base64"),
    `${Buffer.alloc(640).toString("base64")}\n`,
    Buffer.alloc(642).toString("base64").replace("A", "-"),
    Buffer.alloc(640).toString("base64").replace(/=+$/, ""),
    null,
    undefined,
    640,
    new Uint8Array(640),
  ])("rejects invalid base64 payload %#", (value) => {
    expect(isSpeechPcmBase64(value)).toBe(false);
  });
});
