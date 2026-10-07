import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attempt } from "./agentProjectAuthority";
import {
  AGENT_ATTACHMENT_READ_QUEUE_FULL_REASON,
  AGENT_ATTACHMENT_READ_RETRY_DELAYS_MS,
  createAgentAttachmentReadLimiter,
  isTransientRunnerBusyError,
} from "./agentAttachmentReadLimiter";

describe("isTransientRunnerBusyError", () => {
  it.each([
    "Runner request failed (HTTP 503).",
    "Runner is busy; retry shortly",
    new Error("Runner request failed (HTTP 503)."),
    new Error("Runner is busy; retry shortly"),
  ])("classifies %s as transient", (error) => {
    expect(isTransientRunnerBusyError(error)).toBe(true);
  });

  it.each([
    "Runner request failed (HTTP 500).",
    "Runner request failed (HTTP 404).",
    "Runner request failed (HTTP 5030).",
    new Error("The image owner changed."),
    "",
    null,
    undefined,
    { message: "Runner is busy; retry shortly" },
  ])("does not classify %s as transient", (error) => {
    expect(isTransientRunnerBusyError(error)).toBe(false);
  });
});

describe("createAgentAttachmentReadLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("settles overflow fail-closed instead of growing the queue", () => {
    const limiter = createAgentAttachmentReadLimiter<number>(1);
    const settled: Attempt<number>[] = [];
    const job = {
      read: () => new Promise<number>(() => {}),
      isCurrent: () => true,
      settle: (result: Attempt<number>) => settled.push(result),
    };

    for (let index = 0; index < 4; index += 1) limiter.schedule(job);

    expect(settled).toEqual([
      { ok: false, error: new Error(AGENT_ATTACHMENT_READ_QUEUE_FULL_REASON) },
    ]);
    limiter.dispose();
  });

  it("retries only the failures its injected predicate accepts", async () => {
    vi.useFakeTimers();
    const limiter = createAgentAttachmentReadLimiter<number>(4, (error) => error === "again");
    const transient = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce("again")
      .mockResolvedValue(7);
    const runnerBusy = vi.fn(async (): Promise<number> => {
      throw "Runner is busy; retry shortly";
    });
    const settled: Attempt<number>[] = [];
    const settle = (result: Attempt<number>) => settled.push(result);

    limiter.schedule({ read: transient, isCurrent: () => true, settle });
    limiter.schedule({ read: runnerBusy, isCurrent: () => true, settle });
    await vi.advanceTimersByTimeAsync(0);

    expect(settled).toEqual([{ ok: false, error: "Runner is busy; retry shortly" }]);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(AGENT_ATTACHMENT_READ_RETRY_DELAYS_MS[0] ?? 0);

    expect(transient).toHaveBeenCalledTimes(2);
    expect(runnerBusy).toHaveBeenCalledTimes(1);
    expect(settled).toEqual([
      { ok: false, error: "Runner is busy; retry shortly" },
      { ok: true, value: 7 },
    ]);
    expect(vi.getTimerCount()).toBe(0);
    limiter.dispose();
  });

  it("stops all work after dispose", async () => {
    vi.useFakeTimers();
    const limiter = createAgentAttachmentReadLimiter<number>(4);
    const read = vi.fn(async (): Promise<number> => {
      throw "Runner is busy; retry shortly";
    });
    const settle = vi.fn();

    limiter.schedule({ read, isCurrent: () => true, settle });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    limiter.dispose();
    limiter.schedule({ read, isCurrent: () => true, settle });

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(settle).not.toHaveBeenCalled();
  });
});
