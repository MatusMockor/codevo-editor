import { describe, expect, it } from "vitest";
import {
  FIRST_CONTENTFUL_PAINT_ENTRY,
  FIRST_PAINT_ENTRY,
  measureStartupShellPaint,
  STARTUP_SHELL_PAINT_TIMEOUT_MS,
  startupShellPaintWasObserved,
  waitForStartupShellPaint,
} from "./startupShell";

describe("measureStartupShellPaint", () => {
  it("prefers the browser-reported first contentful paint over the observed frame", () => {
    const measurement = measureStartupShellPaint(48.5, [
      { name: FIRST_PAINT_ENTRY, startTime: 9 },
      { name: FIRST_CONTENTFUL_PAINT_ENTRY, startTime: 11.25 },
    ]);

    expect(measurement).toEqual({ rendererElapsedMs: 11.25, source: "paint-timing" });
  });

  it("accepts first-paint when no contentful paint was reported", () => {
    const measurement = measureStartupShellPaint(48.5, [{ name: FIRST_PAINT_ENTRY, startTime: 9 }]);

    expect(measurement).toEqual({ rendererElapsedMs: 9, source: "paint-timing" });
  });

  it("falls back to the observed frame when paint timing is unavailable", () => {
    expect(measureStartupShellPaint(48.5, [])).toEqual({
      rendererElapsedMs: 48.5,
      source: "frame",
    });
  });

  it("ignores unusable paint entries", () => {
    const measurement = measureStartupShellPaint(48.5, [
      { name: FIRST_CONTENTFUL_PAINT_ENTRY, startTime: Number.NaN },
      { name: FIRST_PAINT_ENTRY, startTime: -3 },
      { name: "largest-contentful-paint", startTime: 4 },
    ]);

    expect(measurement).toEqual({ rendererElapsedMs: 48.5, source: "frame" });
  });

  it("reports nothing measurable rather than logging a bogus mark", () => {
    expect(measureStartupShellPaint(Number.NaN, [])).toBeNull();
    expect(measureStartupShellPaint(-1, [])).toBeNull();
    expect(measureStartupShellPaint(Number.POSITIVE_INFINITY, [])).toBeNull();
  });
});

describe("waitForStartupShellPaint", () => {
  it("prefers the real two-frame paint path and cancels the fallback", async () => {
    const frames: FrameRequestCallback[] = [];
    let timeoutMs = 0;
    let timerCancelled = false;
    const ready = waitForStartupShellPaint({
      cancelTimer: () => {
        timerCancelled = true;
      },
      requestFrame: (callback) => frames.push(callback),
      scheduleTimer: (_callback, delay) => {
        timeoutMs = delay;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
    });

    expect(timeoutMs).toBe(STARTUP_SHELL_PAINT_TIMEOUT_MS);
    expect(frames).toHaveLength(1);
    frames.shift()?.(0);
    expect(frames).toHaveLength(1);
    frames.shift()?.(16);
    await expect(ready).resolves.toBe("painted");
    expect(timerCancelled).toBe(true);
  });

  it("falls back when animation frames are unavailable", async () => {
    let fallback: (() => void) | null = null;
    const ready = waitForStartupShellPaint({
      cancelTimer: () => undefined,
      requestFrame: () => 1,
      scheduleTimer: (callback) => {
        fallback = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
    });

    expect(fallback).not.toBeNull();
    (fallback as (() => void) | null)?.();
    const outcome = await ready;
    expect(outcome).toBe("timeout");
    expect(startupShellPaintWasObserved(outcome)).toBe(false);
  });
});
