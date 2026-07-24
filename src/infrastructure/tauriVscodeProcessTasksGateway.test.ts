import { describe, expect, it, vi } from "vitest";
import {
  TauriVscodeProcessTasksGateway,
  type ListenToVscodeProcessTaskEvents,
} from "./tauriVscodeProcessTasksGateway";
import type { InvokeVscodeProcessTaskCommand } from "./tauriVscodeProcessTasksIpcContract";

const CONFIG_REVISION = `sha256:${"a".repeat(64)}`;
const owner = {
  runId: "run-1",
  workspaceId: "workspace-1",
  sessionId: 4,
  label: "Build",
  configRevision: CONFIG_REVISION,
} as const;

describe("TauriVscodeProcessTasksGateway", () => {
  it("forwards discovery and exact owner lifecycle calls", async () => {
    const invoke = vi
      .fn<InvokeVscodeProcessTaskCommand>()
      .mockResolvedValueOnce({
        configRevision: CONFIG_REVISION,
        tasks: [],
        diagnostics: [],
        truncated: false,
      })
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const gateway = new TauriVscodeProcessTasksGateway(invoke);

    await gateway.discoverVscodeProcessTasks("workspace-1");
    await gateway.startVscodeProcessTask(owner);
    await gateway.acknowledgeVscodeProcessTaskStart(owner);
    await gateway.stopVscodeProcessTask(owner);

    expect(invoke.mock.calls).toEqual([
      ["workspace_discover_vscode_process_tasks", { request: { workspaceId: "workspace-1" } }],
      ["workspace_start_vscode_process_task", { request: owner }],
      ["workspace_acknowledge_vscode_process_task_start", { request: owner }],
      ["workspace_stop_vscode_process_task", { request: owner }],
    ]);
  });

  it("subscribes once, decodes both event tags, and drops malformed payloads", async () => {
    let listener!: (event: { readonly payload: unknown }) => void;
    const unlisten = vi.fn();
    const listen = vi.fn<ListenToVscodeProcessTaskEvents>(async (_name, handler) => {
      listener = handler;
      return unlisten;
    });
    const handler = vi.fn();
    const gateway = new TauriVscodeProcessTasksGateway(vi.fn(), listen);

    const unsubscribe = await gateway.subscribeVscodeProcessTaskEvents(handler);
    expect(listen).toHaveBeenCalledExactlyOnceWith(
      "vscode-process-task://event",
      expect.any(Function),
    );
    listener({ payload: { kind: "output", owner } });
    expect(handler).not.toHaveBeenCalled();
    listener({
      payload: {
        kind: "output",
        owner,
        sequence: 1,
        stream: "stdout",
        data: "built",
        truncated: false,
      },
    });
    listener({
      payload: {
        kind: "status",
        owner,
        sequence: 2,
        status: "exited",
        exitCode: 0,
      },
    });
    expect(handler).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("rejects execution details before transport", async () => {
    const invoke = vi.fn<InvokeVscodeProcessTaskCommand>();
    const gateway = new TauriVscodeProcessTasksGateway(invoke);
    await expect(
      gateway.startVscodeProcessTask({ ...owner, command: "tsc" } as never),
    ).rejects.toThrow(TypeError);
    expect(invoke).not.toHaveBeenCalled();
  });
});
