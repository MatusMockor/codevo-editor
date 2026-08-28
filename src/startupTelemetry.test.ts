import { describe, expect, it, vi } from "vitest";
import { logStartupShellPaint } from "./startupTelemetry";

describe("logStartupShellPaint", () => {
  it("loads the native logger and submits the measured mark", async () => {
    const invoke = vi.fn(async () => undefined);
    logStartupShellPaint(12.5, 1_800_000_000_012.5, async () => {
      return invoke;
    });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    expect(invoke).toHaveBeenCalledWith("log_startup_shell_painted", {
      paintEpochMs: 1_800_000_000_012.5,
      rendererElapsedMs: 12.5,
    });
  });

  it("does not load the logger when the performance entry is invalid", () => {
    const loadInvoke = vi.fn(async () => vi.fn(async () => undefined));
    logStartupShellPaint(Number.NaN, 1_800_000_000_000, loadInvoke);

    expect(loadInvoke).not.toHaveBeenCalled();
  });
});
