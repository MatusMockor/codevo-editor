import { describe, expect, it, vi } from "vitest";
import {
  ACKNOWLEDGE_NODE_RUN_TASK_START_IPC_COMMAND,
  invokeAcknowledgeNodeRunTaskStartIpc,
  invokeStartNodeRunTaskIpc,
  invokeStopNodeRunTaskIpc,
  NODE_RUN_TASK_STATUS_EVENT,
  START_NODE_RUN_TASK_IPC_COMMAND,
  STOP_NODE_RUN_TASK_IPC_COMMAND,
} from "./tauriNodeRunTaskIpcContract";

const request = {
  runId: "run-1",
  workspaceId: "ws-1",
  terminalSessionId: 9,
  target: { kind: "node-script", scriptPath: "/workspace/app.js" } as const,
};

describe("Node run task IPC contract", () => {
  it("keeps exact command and event names", () => {
    expect(START_NODE_RUN_TASK_IPC_COMMAND).toBe("workspace_start_node_run_task");
    expect(ACKNOWLEDGE_NODE_RUN_TASK_START_IPC_COMMAND).toBe(
      "workspace_acknowledge_node_run_task_start",
    );
    expect(STOP_NODE_RUN_TASK_IPC_COMMAND).toBe("workspace_stop_node_run_task");
    expect(NODE_RUN_TASK_STATUS_EVENT).toBe("node-run-task-status");
  });

  it("starts with a typed target and requires the echoed run id", async () => {
    const invoke = vi.fn(async () => ({ runId: "run-1" }));
    await expect(invokeStartNodeRunTaskIpc(invoke, request)).resolves.toEqual({ runId: "run-1" });
    expect(invoke).toHaveBeenCalledWith("workspace_start_node_run_task", { request });

    await expect(
      invokeStartNodeRunTaskIpc(
        vi.fn(async () => ({ runId: "other" })),
        request,
      ),
    ).rejects.toThrow("requested run id");
    await expect(
      invokeStartNodeRunTaskIpc(
        vi.fn(async () => ({ runId: "run-1", extra: true })),
        request,
      ),
    ).rejects.toThrow("result");
  });

  it.each([
    { ...request, extra: true },
    { ...request, runId: "" },
    { ...request, workspaceId: "ws\n1" },
    { ...request, terminalSessionId: -1 },
    { ...request, target: { kind: "node-attach", port: 9229 } },
    { ...request, target: { ...request.target, shell: "node app.js" } },
  ])("rejects malformed start requests before transport", async (invalid) => {
    const invoke = vi.fn(async () => ({ runId: "run-1" }));
    await expect(invokeStartNodeRunTaskIpc(invoke, invalid as never)).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("acknowledges and stops through strict id-only requests", async () => {
    const owner = { runId: "run-1", workspaceId: "ws-1" };
    const invoke = vi.fn(async () => null);
    await invokeAcknowledgeNodeRunTaskStartIpc(invoke, owner);
    await invokeStopNodeRunTaskIpc(invoke, owner);
    expect(invoke).toHaveBeenNthCalledWith(1, "workspace_acknowledge_node_run_task_start", {
      request: owner,
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "workspace_stop_node_run_task", { request: owner });
    await expect(
      invokeStopNodeRunTaskIpc(
        vi.fn(async () => ({})),
        owner,
      ),
    ).rejects.toThrow("result");
  });
});
