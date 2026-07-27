import {
  MAX_JS_TEST_OUTPUT_STREAM_BYTES,
  type JsTestTaskOutput,
  type JsTestTaskOutputStream,
} from "../domain/jsTestTask";

export interface NativeJsTestWatchOutputBuffer {
  append(stream: "stderr" | "stdout", data: string, truncated: boolean): void;
  dispose(): void;
  flush(): void;
  snapshot(): JsTestTaskOutput;
}

export interface NativeJsTestWatchOutputBufferOptions {
  readonly onPublish?: (output: JsTestTaskOutput) => void;
  readonly publicationDelayMs?: number;
}

interface Utf8ByteTail {
  readonly bytes: Uint8Array;
  length: number;
  start: number;
  truncated: boolean;
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const DEFAULT_PUBLICATION_DELAY_MS = 16;

export function createNativeJsTestWatchOutputBuffer(
  options: NativeJsTestWatchOutputBufferOptions = {},
): NativeJsTestWatchOutputBuffer {
  const tails = {
    stderr: createTail(),
    stdout: createTail(),
  };
  const delay = Math.max(0, options.publicationDelayMs ?? DEFAULT_PUBLICATION_DELAY_MS);
  let dirty = false;
  let publicationTimer: ReturnType<typeof setTimeout> | null = null;
  const snapshot = (): JsTestTaskOutput =>
    Object.freeze({
      stderr: snapshotTail(tails.stderr),
      stdout: snapshotTail(tails.stdout),
    });
  const flush = (): void => {
    if (publicationTimer !== null) {
      clearTimeout(publicationTimer);
      publicationTimer = null;
    }
    if (!dirty) return;
    dirty = false;
    try {
      options.onPublish?.(snapshot());
    } catch {
      // Presentation observers cannot corrupt the bounded retained output.
    }
  };
  return Object.freeze({
    append(stream: "stderr" | "stdout", data: string, truncated: boolean): void {
      appendTail(tails[stream], data, truncated);
      dirty = true;
      if (options.onPublish && publicationTimer === null) {
        publicationTimer = setTimeout(flush, delay);
      }
    },
    dispose(): void {
      if (publicationTimer !== null) clearTimeout(publicationTimer);
      publicationTimer = null;
    },
    flush,
    snapshot,
  });
}

function createTail(): Utf8ByteTail {
  return {
    bytes: new Uint8Array(MAX_JS_TEST_OUTPUT_STREAM_BYTES),
    length: 0,
    start: 0,
    truncated: false,
  };
}

function appendTail(tail: Utf8ByteTail, data: string, truncated: boolean): void {
  const incoming = UTF8_ENCODER.encode(data);
  tail.truncated ||= truncated;
  if (incoming.byteLength === 0) return;

  if (incoming.byteLength >= MAX_JS_TEST_OUTPUT_STREAM_BYTES) {
    let incomingStart = incoming.byteLength - MAX_JS_TEST_OUTPUT_STREAM_BYTES;
    while (incomingStart < incoming.byteLength && isContinuationByte(incoming[incomingStart]!)) {
      incomingStart += 1;
    }
    const retained = incoming.subarray(incomingStart);
    tail.bytes.set(retained, 0);
    tail.start = 0;
    tail.length = retained.byteLength;
    tail.truncated = true;
    return;
  }

  const overflow = tail.length + incoming.byteLength - MAX_JS_TEST_OUTPUT_STREAM_BYTES;
  if (overflow > 0) {
    dropBytes(tail, overflow);
    while (tail.length > 0 && isContinuationByte(tail.bytes[tail.start]!)) {
      dropBytes(tail, 1);
    }
    tail.truncated = true;
  }

  const end = (tail.start + tail.length) % tail.bytes.length;
  const firstLength = Math.min(incoming.byteLength, tail.bytes.length - end);
  tail.bytes.set(incoming.subarray(0, firstLength), end);
  if (firstLength < incoming.byteLength) {
    tail.bytes.set(incoming.subarray(firstLength), 0);
  }
  tail.length += incoming.byteLength;
}

function dropBytes(tail: Utf8ByteTail, count: number): void {
  const dropped = Math.min(tail.length, Math.max(0, count));
  tail.start = (tail.start + dropped) % tail.bytes.length;
  tail.length -= dropped;
}

function isContinuationByte(value: number): boolean {
  return (value & 0xc0) === 0x80;
}

function snapshotTail(tail: Utf8ByteTail): JsTestTaskOutputStream {
  const contiguous = new Uint8Array(tail.length);
  const firstLength = Math.min(tail.length, tail.bytes.length - tail.start);
  contiguous.set(tail.bytes.subarray(tail.start, tail.start + firstLength), 0);
  if (firstLength < tail.length) {
    contiguous.set(tail.bytes.subarray(0, tail.length - firstLength), firstLength);
  }
  return Object.freeze({
    text: UTF8_DECODER.decode(contiguous),
    truncated: tail.truncated,
  });
}
