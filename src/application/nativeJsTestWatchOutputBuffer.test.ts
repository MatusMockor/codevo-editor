import { describe, expect, it, vi } from "vitest";
import { MAX_JS_TEST_OUTPUT_STREAM_BYTES } from "../domain/jsTestTask";
import { createNativeJsTestWatchOutputBuffer } from "./nativeJsTestWatchOutputBuffer";

describe("native JavaScript test watch output buffer", () => {
  it("retains UTF-8-safe exact byte tails across wrap and partial-character eviction", () => {
    const buffer = createNativeJsTestWatchOutputBuffer();
    buffer.append("stdout", "x".repeat(MAX_JS_TEST_OUTPUT_STREAM_BYTES - 1), false);
    buffer.append("stdout", "ž", false);
    buffer.append("stderr", "ž", false);
    buffer.append("stderr", "x".repeat(MAX_JS_TEST_OUTPUT_STREAM_BYTES - 1), false);

    expect(buffer.snapshot()).toEqual({
      stdout: {
        text: `${"x".repeat(MAX_JS_TEST_OUTPUT_STREAM_BYTES - 2)}ž`,
        truncated: true,
      },
      stderr: {
        text: "x".repeat(MAX_JS_TEST_OUTPUT_STREAM_BYTES - 1),
        truncated: true,
      },
    });
  });

  it("encodes only each incoming small chunk and keeps one exact bounded tail", () => {
    const encoder = vi.spyOn(TextEncoder.prototype, "encode");
    const buffer = createNativeJsTestWatchOutputBuffer();
    const callStart = encoder.mock.calls.length;
    const chunk = "0123456789abcdef";
    const chunkCount = (MAX_JS_TEST_OUTPUT_STREAM_BYTES * 2) / chunk.length;

    for (let index = 0; index < chunkCount; index += 1) {
      buffer.append("stdout", chunk, false);
    }

    const encodedInputs = encoder.mock.calls
      .slice(callStart)
      .reduce((total, [input]) => total + (input?.length ?? 0), 0);
    encoder.mockRestore();
    expect(encodedInputs).toBe(chunk.length * chunkCount);
    expect(buffer.snapshot().stdout).toEqual({
      text: chunk.repeat(MAX_JS_TEST_OUTPUT_STREAM_BYTES / chunk.length),
      truncated: true,
    });
  });

  it("preserves upstream truncation even when an empty chunk carries the signal", () => {
    const buffer = createNativeJsTestWatchOutputBuffer();
    buffer.append("stderr", "partial", false);
    buffer.append("stderr", "", true);

    expect(buffer.snapshot().stderr).toEqual({ text: "partial", truncated: true });
  });

  it("coalesces publication and cancels pending publication on dispose", () => {
    vi.useFakeTimers();
    try {
      const published = vi.fn();
      const buffer = createNativeJsTestWatchOutputBuffer({
        onPublish: published,
        publicationDelayMs: 16,
      });
      for (let index = 0; index < 1_000; index += 1) {
        buffer.append("stdout", "x", false);
      }
      expect(published).not.toHaveBeenCalled();

      vi.advanceTimersByTime(16);
      expect(published).toHaveBeenCalledExactlyOnceWith({
        stderr: { text: "", truncated: false },
        stdout: { text: "x".repeat(1_000), truncated: false },
      });

      buffer.append("stderr", "pending", false);
      buffer.dispose();
      vi.runAllTimers();
      expect(published).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
