// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  createStartupShell,
  STARTUP_SHELL_PAINT_TIMEOUT_MS,
  startupShellPaintWasObserved,
  waitForStartupShellPaint,
} from "./startupShell";

describe("createStartupShell", () => {
  it("renders a neutral activity skeleton without claiming an active product mode", () => {
    const shell = createStartupShell();

    expect(shell.querySelector('[role="status"]')?.textContent).toBe("Loading Codevo…");
    expect(shell.querySelector("nav")?.getAttribute("aria-label")).toBe("Primary activity loading");
    expect(shell.textContent).not.toContain("Agent");
    expect(shell.textContent).not.toContain("AI");
    expect(shell.querySelector('[aria-current="page"]')).toBeNull();
  });

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
