import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SPEECH_CAPTURE_CHUNK_SAMPLES,
  SPEECH_CAPTURE_PROCESSOR_NAME,
  isSpeechCaptureChunk,
  mixSpeechCaptureSample,
} from "./speechCaptureWorkletProtocol";

interface Processor {
  readonly port: { readonly posted: { data: Float32Array; transfer: readonly unknown[] }[] };
  process(inputs: readonly (readonly Float32Array[])[]): boolean;
}

const registered = new Map<string, new () => Processor>();

beforeEach(async () => {
  registered.clear();
  vi.resetModules();
  vi.stubGlobal(
    "AudioWorkletProcessor",
    class {
      readonly port = {
        posted: [] as { data: Float32Array; transfer: readonly unknown[] }[],
        postMessage(data: Float32Array, transfer: readonly unknown[]) {
          this.posted.push({ data, transfer });
        },
      };
    },
  );
  vi.stubGlobal("registerProcessor", (name: string, processor: new () => Processor) => {
    registered.set(name, processor);
  });
  await import("./speechCapture.worklet");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function createProcessor(): Processor {
  const Registered = registered.get(SPEECH_CAPTURE_PROCESSOR_NAME);
  expect(Registered).toBeDefined();
  return new (Registered as new () => Processor)();
}
const quantum = (value: number) => new Float32Array(128).fill(value);

describe("speech capture worklet", () => {
  it("registers exactly one processor under the shared name", () => {
    expect([...registered.keys()]).toEqual([SPEECH_CAPTURE_PROCESSOR_NAME]);
  });
  it("batches render quanta into transferred chunks", () => {
    const processor = createProcessor();
    const quanta = SPEECH_CAPTURE_CHUNK_SAMPLES / 128;
    for (let index = 0; index < quanta - 1; index += 1) {
      expect(processor.process([[quantum(0.25)]])).toBe(true);
    }
    expect(processor.port.posted).toEqual([]);
    processor.process([[quantum(0.5)]]);
    expect(processor.port.posted.length).toBe(1);
    const chunk = processor.port.posted[0];
    expect(chunk?.data.length).toBe(SPEECH_CAPTURE_CHUNK_SAMPLES);
    expect(chunk?.data[0]).toBe(0.25);
    expect(chunk?.data[SPEECH_CAPTURE_CHUNK_SAMPLES - 1]).toBe(0.5);
    expect(chunk?.transfer).toEqual([chunk?.data.buffer]);
    expect(isSpeechCaptureChunk(chunk?.data)).toBe(true);
    for (let index = 0; index < quanta; index += 1) processor.process([[quantum(1)]]);
    expect(processor.port.posted.length).toBe(2);
    expect(processor.port.posted[1]?.data).not.toBe(chunk?.data);
    expect(processor.port.posted[1]?.data[0]).toBe(1);
  });
  it("mixes multiple channels down to mono", () => {
    const processor = createProcessor();
    for (let index = 0; index < SPEECH_CAPTURE_CHUNK_SAMPLES / 128; index += 1) {
      processor.process([[quantum(0.5), quantum(-0.25)]]);
    }
    expect(processor.port.posted[0]?.data[10]).toBe(0.125);
  });
  it("stays alive without a connected input", () => {
    const processor = createProcessor();
    expect(processor.process([])).toBe(true);
    expect(processor.process([[]])).toBe(true);
    expect(processor.port.posted).toEqual([]);
  });
});

describe("speech capture worklet protocol", () => {
  it("accepts only bounded Float32 chunks", () => {
    expect(isSpeechCaptureChunk(new Float32Array(1))).toBe(true);
    expect(isSpeechCaptureChunk(new Float32Array(SPEECH_CAPTURE_CHUNK_SAMPLES))).toBe(true);
    expect(isSpeechCaptureChunk(new Float32Array(0))).toBe(false);
    expect(isSpeechCaptureChunk(new Float32Array(SPEECH_CAPTURE_CHUNK_SAMPLES + 1))).toBe(false);
    expect(isSpeechCaptureChunk(new Int16Array(16))).toBe(false);
    expect(isSpeechCaptureChunk({ length: 16 })).toBe(false);
  });
  it("averages channels and tolerates missing ones", () => {
    expect(mixSpeechCaptureSample([], 0)).toBe(0);
    expect(mixSpeechCaptureSample([Float32Array.from([0.5])], 0)).toBe(0.5);
    expect(mixSpeechCaptureSample([Float32Array.from([1]), Float32Array.from([0])], 0)).toBe(0.5);
    expect(mixSpeechCaptureSample([Float32Array.from([1]), new Float32Array(0)], 0)).toBe(0.5);
  });
});
