import { describe, expect, it, vi } from "vitest";
import { TauriJsTestWatchGateway, type ListenToJsTestWatchEvents } from "./tauriJsTestWatchGateway";
import type { InvokeJsTestWatchCommand } from "./tauriJsTestWatchIpcContract";

const owner = {
  watchId: "watch-1",
  workspaceId: "workspace-1",
  epoch: 2,
} as const;

describe("TauriJsTestWatchGateway", () => {
  it("forwards the strict start, acknowledge, and stop lifecycle", async () => {
    const invoke = vi
      .fn<InvokeJsTestWatchCommand>()
      .mockResolvedValueOnce({
        owner,
        structuredResults: "unavailable-in-watch-mode",
      })
      .mockResolvedValue(null);
    const gateway = new TauriJsTestWatchGateway(invoke);
    await gateway.startWatch({
      ...owner,
      command: {
        kind: "jest-watch",
        packageRootRelativePath: "packages/web",
        scope: { kind: "file", relativeFilePath: "src/app.test.ts" },
      },
    });
    await gateway.acknowledgeWatchStart(owner);
    await gateway.stopWatch(owner);
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("subscribes to exact events and drops malformed payloads", async () => {
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    const unlisten = vi.fn();
    const listen = vi.fn<ListenToJsTestWatchEvents>(async (event, handler) => {
      listeners.set(event, handler);
      return unlisten;
    });
    const gateway = new TauriJsTestWatchGateway(vi.fn(), listen);
    const statusHandler = vi.fn();
    const outputHandler = vi.fn();
    const unsubscribeStatus = await gateway.subscribeWatchStatus(statusHandler);
    const unsubscribeOutput = await gateway.subscribeWatchOutput(outputHandler);

    listeners.get("js-test-watch://status")?.({
      payload: { owner, status: "running" },
    });
    listeners.get("js-test-watch://status")?.({
      payload: { owner, status: "running", extra: true },
    });
    listeners.get("js-test-watch://output")?.({
      payload: {
        owner,
        sequence: 1,
        stream: "stdout",
        data: "ready",
        truncated: false,
      },
    });
    listeners.get("js-test-watch://output")?.({
      payload: {
        owner,
        sequence: 2,
        stream: "stdout",
        data: "invalid",
        truncated: true,
      },
    });

    expect(statusHandler).toHaveBeenCalledExactlyOnceWith({
      owner,
      status: "running",
    });
    expect(outputHandler).toHaveBeenCalledExactlyOnceWith({
      owner,
      sequence: 1,
      stream: "stdout",
      data: "ready",
      truncated: false,
    });
    unsubscribeStatus();
    unsubscribeOutput();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });
});
