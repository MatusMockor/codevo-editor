import { describe, expect, it, vi } from "vitest";
import { TauriNodeRunTaskGateway, type ListenToNodeRunTaskStatus } from "./tauriNodeRunTaskGateway";
import type { InvokeNodeRunTaskCommand } from "./tauriNodeRunTaskIpcContract";

describe("TauriNodeRunTaskGateway", () => {
  it("forwards only typed lifecycle requests", async () => {
    const invoke = vi
      .fn<InvokeNodeRunTaskCommand>()
      .mockResolvedValueOnce({ runId: "run-1" })
      .mockResolvedValue(null);
    const gateway = new TauriNodeRunTaskGateway(invoke);
    const request = {
      runId: "run-1",
      workspaceId: "ws-1",
      terminalSessionId: 3,
      target: { kind: "node-script", scriptPath: "/workspace/app.js" } as const,
    };
    await gateway.startNodeRunTask(request);
    await gateway.acknowledgeNodeRunTaskStart({ runId: "run-1", workspaceId: "ws-1" });
    await gateway.stopNodeRunTask({ runId: "run-1", workspaceId: "ws-1" });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("subscribes to the exact status event and drops malformed payloads", async () => {
    let listener!: (event: { payload: unknown }) => void;
    const unlisten = vi.fn();
    const listen = vi.fn<ListenToNodeRunTaskStatus>(async (name, handler) => {
      expect(name).toBe("node-run-task-status");
      listener = handler;
      return unlisten;
    });
    const gateway = new TauriNodeRunTaskGateway(vi.fn(), listen);
    const handler = vi.fn();
    const unsubscribe = await gateway.subscribeNodeRunTaskStatus(handler);

    listener({ payload: { status: "running", runId: "run-1" } });
    listener({
      payload: {
        status: "running",
        runId: "run-1",
        workspaceId: "ws-1",
        terminalSessionId: 3,
      },
    });
    expect(handler).toHaveBeenCalledOnce();
    unsubscribe();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
