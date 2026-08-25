import { describe, expect, it, vi } from "vitest";
import type {
  TerminalGateway,
  TerminalOutputEvent,
  TerminalRuntimeStatus,
} from "../../domain/terminal";
import { TauriTerminalGateway } from "../../infrastructure/tauriTerminalGateway";
import {
  SURFACE_FOREIGN_ROOT_TERMINAL_REASON,
  SURFACE_NO_THREAD_REASON,
  SURFACE_UNTRUSTED_TERMINAL_REASON,
  SURFACE_WORKTREE_GONE_REASON,
  agentSurfaceBlockedReason,
  agentSurfaceTerminalLaunchTargetFor,
  withTerminalLaunchTarget,
} from "./agentSurfacePolicy";
import { SURFACE_FIXTURE_ROOT, surfaceThreadView } from "./agentSurfaceTestFixtures";

describe("withTerminalLaunchTarget", () => {
  it("forwards every port method of a real class gateway and pins the launch target", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "start_terminal_session") return { kind: "starting", sessionId: 7 };
      if (command === "stop_terminal_session") return { kind: "stopped", sessionId: 7 };
      if (command === "list_terminal_profiles") return [{ id: "zsh", label: "zsh", command: null }];
      return undefined;
    });
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    const listen = vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    });
    const inner = new TauriTerminalGateway(invoke, listen, () => true);
    const gateway = withTerminalLaunchTarget(inner, {
      kind: "agentWorktree",
      threadId: "agt-1",
    });

    await expect(
      gateway.start("/workspace/app", { cols: 80, rows: 24 }, "zsh", true),
    ).resolves.toEqual({ kind: "starting", sessionId: 7 });
    expect(invoke).toHaveBeenCalledWith("start_terminal_session", {
      profileId: "zsh",
      rootPath: "/workspace/app",
      target: { kind: "agentWorktree", threadId: "agt-1" },
      terminalShellIntegrationEnabled: true,
      size: { cols: 80, rows: 24 },
    });

    await gateway.acknowledgeStart(7);
    expect(invoke).toHaveBeenCalledWith("acknowledge_terminal_session_start", { sessionId: 7 });
    await gateway.writeInput(7, "ls\n");
    expect(invoke).toHaveBeenCalledWith("write_terminal_input", { data: "ls\n", sessionId: 7 });
    await gateway.resize(7, { cols: 100, rows: 30 });
    expect(invoke).toHaveBeenCalledWith("resize_terminal_session", {
      sessionId: 7,
      size: { cols: 100, rows: 30 },
    });
    await expect(gateway.stop(7)).resolves.toEqual({ kind: "stopped", sessionId: 7 });
    await gateway.stopRoot("/workspace/app");
    expect(invoke).toHaveBeenCalledWith("stop_terminal_sessions_for_root", {
      rootPath: "/workspace/app",
    });
    await gateway.stopAll();
    expect(invoke).toHaveBeenCalledWith("stop_all_terminal_sessions");
    await expect(gateway.listProfiles()).resolves.toEqual([
      { id: "zsh", label: "zsh", command: null },
    ]);

    const outputs: TerminalOutputEvent[] = [];
    const statuses: TerminalRuntimeStatus[] = [];
    const releaseOutput = await gateway.subscribeOutput((event) => outputs.push(event));
    const releaseStatus = await gateway.subscribeStatus!((status) => statuses.push(status));
    handlers.get("terminal://output")?.({ payload: { sessionId: 7, data: "hi" } });
    handlers.get("terminal://status")?.({ payload: { kind: "stopped", sessionId: 7 } });
    expect(outputs).toEqual([{ sessionId: 7, data: "hi" }]);
    expect(statuses).toEqual([{ kind: "stopped", sessionId: 7 }]);
    releaseOutput();
    releaseStatus();
    expect(handlers.size).toBe(0);
  });

  it("leaves subscribeStatus absent when the wrapped gateway has none", () => {
    const inner: TerminalGateway = {
      acknowledgeStart: async () => undefined,
      listProfiles: async () => [],
      resize: async () => undefined,
      start: async () => ({ kind: "stopped", sessionId: 1 }),
      stop: async () => ({ kind: "stopped", sessionId: 1 }),
      stopRoot: async () => undefined,
      stopAll: async () => undefined,
      subscribeOutput: async () => () => undefined,
      writeInput: async () => undefined,
    };
    expect(withTerminalLaunchTarget(inner, { kind: "workspaceRoot" }).subscribeStatus).toBe(
      undefined,
    );
  });
});

describe("agentSurfaceBlockedReason", () => {
  it("blocks the terminal for threads whose repository is not the workspace root", () => {
    const thread = surfaceThreadView();
    expect(agentSurfaceBlockedReason("terminal", thread, true, SURFACE_FIXTURE_ROOT)).toBeNull();
    expect(agentSurfaceBlockedReason("terminal", thread, true, "/workspace/other")).toBe(
      SURFACE_FOREIGN_ROOT_TERMINAL_REASON,
    );
    expect(agentSurfaceBlockedReason("terminal", thread, false, "/workspace/other")).toBe(
      SURFACE_FOREIGN_ROOT_TERMINAL_REASON,
    );
    expect(agentSurfaceBlockedReason("terminal", thread, false, SURFACE_FIXTURE_ROOT)).toBe(
      SURFACE_UNTRUSTED_TERMINAL_REASON,
    );
    expect(agentSurfaceBlockedReason("files", thread, false, "/workspace/other")).toBeNull();
    expect(agentSurfaceBlockedReason("diff", thread, true, null)).toBeNull();
  });

  it("keeps Files open without a thread and blocks the thread-bound surfaces", () => {
    expect(agentSurfaceBlockedReason("files", null, true, SURFACE_FIXTURE_ROOT)).toBeNull();
    expect(agentSurfaceBlockedReason("diff", null, true, SURFACE_FIXTURE_ROOT)).toBe(
      SURFACE_NO_THREAD_REASON,
    );
    expect(agentSurfaceBlockedReason("terminal", null, true, SURFACE_FIXTURE_ROOT)).toBe(
      SURFACE_NO_THREAD_REASON,
    );
    const gone = surfaceThreadView({ worktreeMissing: true });
    expect(agentSurfaceBlockedReason("files", gone, true, SURFACE_FIXTURE_ROOT)).toBe(
      SURFACE_WORKTREE_GONE_REASON,
    );
  });

  it("derives the launch target from the thread id and isolation only", () => {
    expect(agentSurfaceTerminalLaunchTargetFor("agt-1", "worktree")).toEqual({
      kind: "agentWorktree",
      threadId: "agt-1",
    });
    expect(agentSurfaceTerminalLaunchTargetFor("agt-1", "in-place")).toEqual({
      kind: "workspaceRoot",
    });
  });
});
