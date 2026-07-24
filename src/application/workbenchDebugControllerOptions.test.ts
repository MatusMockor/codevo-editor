import { describe, expect, it, vi } from "vitest";
import { createJsTestRerunLastRunCommands } from "./workbenchDebugControllerOptions";

describe("createJsTestRerunLastRunCommands", () => {
  it("projects only live rerun verbs from the private Explorer runner", async () => {
    const canCancelTestRun = vi.fn(() => true);
    const canRerunFailedTests = vi.fn(() => true);
    const canRerunLastRun = vi.fn(() => true);
    const cancelTestRun = vi.fn(async () => true);
    const rerunFailedTests = vi.fn(async () => true);
    const rerunLastRun = vi.fn(async () => true);
    const commands = createJsTestRerunLastRunCommands({
      canCancelTestRun,
      canRerunFailedTests,
      canRerunLastRun,
      canRunScope: () => true,
      cancelTestRun,
      rerunFailedTests,
      rerunLastRun,
      runScope: async () => true,
    });

    expect(commands).toEqual({
      canCancelTestRun: expect.any(Function),
      canRerunFailedTests: expect.any(Function),
      canRerunLastRun: expect.any(Function),
      cancelTestRun: expect.any(Function),
      rerunFailedTests: expect.any(Function),
      rerunLastRun: expect.any(Function),
    });
    expect(commands.canCancelTestRun()).toBe(true);
    expect(commands.canRerunFailedTests()).toBe(true);
    expect(commands.canRerunLastRun()).toBe(true);
    await expect(commands.cancelTestRun()).resolves.toBe(true);
    await expect(commands.rerunFailedTests()).resolves.toBe(true);
    await expect(commands.rerunLastRun()).resolves.toBe(true);
    expect(canCancelTestRun).toHaveBeenCalledOnce();
    expect(canRerunFailedTests).toHaveBeenCalledOnce();
    expect(canRerunLastRun).toHaveBeenCalledOnce();
    expect(cancelTestRun).toHaveBeenCalledOnce();
    expect(rerunFailedTests).toHaveBeenCalledOnce();
    expect(rerunLastRun).toHaveBeenCalledOnce();
  });

  it("fails closed without a runner and across synchronous or asynchronous failures", async () => {
    const unavailable = createJsTestRerunLastRunCommands(undefined);
    expect(unavailable.canCancelTestRun()).toBe(false);
    expect(unavailable.canRerunFailedTests()).toBe(false);
    expect(unavailable.canRerunLastRun()).toBe(false);
    await expect(unavailable.cancelTestRun()).resolves.toBe(false);
    await expect(unavailable.rerunFailedTests()).resolves.toBe(false);
    await expect(unavailable.rerunLastRun()).resolves.toBe(false);

    const failing = createJsTestRerunLastRunCommands({
      canCancelTestRun: () => {
        throw new Error("can cancel");
      },
      canRerunFailedTests: () => {
        throw new Error("can failed");
      },
      canRerunLastRun: () => {
        throw new Error("can");
      },
      canRunScope: () => false,
      cancelTestRun: async () => Promise.reject(new Error("cancel")),
      rerunFailedTests: async () => Promise.reject(new Error("failed")),
      rerunLastRun: async () => Promise.reject(new Error("rerun")),
      runScope: async () => false,
    });
    expect(failing.canCancelTestRun()).toBe(false);
    expect(failing.canRerunFailedTests()).toBe(false);
    expect(failing.canRerunLastRun()).toBe(false);
    await expect(failing.cancelTestRun()).resolves.toBe(false);
    await expect(failing.rerunFailedTests()).resolves.toBe(false);
    await expect(failing.rerunLastRun()).resolves.toBe(false);
  });
});
