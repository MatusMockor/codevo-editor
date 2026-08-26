import { describe, expect, it } from "vitest";
import {
  defaultAgentTaskIsolation,
  inPlaceDispatchGuard,
  isTerminalAgentTaskStatus,
  mintAgentTaskId,
  parseAgentTaskOutputEvent,
  parseAgentTaskStatusEvent,
  parseStartAgentTaskResult,
  validateAgentTaskReferenceRequest,
  validateStartAgentTaskRequest,
  validateStopAgentTasksForRootRequest,
  type AgentTaskIsolationContext,
  type AgentTaskStatus,
} from "./agentTask";

function isolationContext(
  overrides: Partial<AgentTaskIsolationContext> = {},
): AgentTaskIsolationContext {
  return {
    workspacePolicy: "auto",
    repositoryStatusKnown: true,
    repositoryDirty: false,
    dirtyEditorDocumentsInRepository: 0,
    liveAgentTasksInRepository: 0,
    plannedParallelDispatch: false,
    ...overrides,
  };
}

function wireStatusEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId: "agt-1-0a1b",
    workspaceId: "ws-1",
    repositoryRoot: "/repo",
    isolation: "in-place",
    worktreePath: null,
    sequence: 3,
    status: "running",
    ...overrides,
  };
}

function startRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId: "agt-1-0a1b",
    workspaceId: "ws-1",
    projectRoot: "/repo",
    repositoryRoot: "/repo",
    cwd: "/repo",
    isolation: "in-place",
    prompt: "do the thing",
    agentCliPath: "/usr/local/bin/claude",
    agentCliKind: "claudeCode",
    resumeSessionId: null,
    launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
    ...overrides,
  };
}

describe("validateStartAgentTaskRequest launch", () => {
  it("accepts a matching provider and returns the parsed launch options", () => {
    const request = validateStartAgentTaskRequest(
      startRequest({
        launch: { provider: "claudeCode", model: "opus", mode: "plan", effort: "high" },
      }),
    );

    expect(request.launch).toEqual({
      provider: "claudeCode",
      model: "opus",
      mode: "plan",
      effort: "high",
    });
  });

  it("rejects a launch whose provider differs from the agent CLI kind", () => {
    expect(() =>
      validateStartAgentTaskRequest(
        startRequest({
          agentCliKind: "codex",
          launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
        }),
      ),
    ).toThrow("Invalid agent task value at request.launch.provider: expected the agent CLI kind.");
    expect(() =>
      validateStartAgentTaskRequest(
        startRequest({
          agentCliKind: "claudeCode",
          launch: { provider: "codex", model: "default", mode: "default" },
        }),
      ),
    ).toThrow(/request\.launch\.provider/);
  });

  it("accepts both providers when the launch provider matches", () => {
    expect(
      validateStartAgentTaskRequest(
        startRequest({
          agentCliKind: "codex",
          launch: { provider: "codex", model: "gpt-5.6-sol", mode: "dangerFullAccess" },
        }),
      ).launch,
    ).toEqual({ provider: "codex", model: "gpt-5.6-sol", mode: "dangerFullAccess" });
  });

  it("rejects a missing, unknown, or cross-provider launch", () => {
    const withoutLaunch = startRequest();
    delete withoutLaunch.launch;

    expect(() => validateStartAgentTaskRequest(withoutLaunch)).toThrow(TypeError);
    expect(() =>
      validateStartAgentTaskRequest(
        startRequest({
          launch: {
            provider: "claudeCode",
            model: "gpt-5.5",
            mode: "default",
            effort: "default",
          },
        }),
      ),
    ).toThrow(TypeError);
    expect(() =>
      validateStartAgentTaskRequest(
        startRequest({
          launch: { provider: "claudeCode", model: "default", mode: "default", effort: "ultra" },
        }),
      ),
    ).toThrow(TypeError);
  });
});

describe("isTerminalAgentTaskStatus", () => {
  it("classifies every status of the closed union", () => {
    const table: ReadonlyArray<readonly [AgentTaskStatus, boolean]> = [
      [{ kind: "pending" }, false],
      [{ kind: "running" }, false],
      [{ kind: "exited", exitCode: 1 }, true],
      [{ kind: "failed", message: "boom" }, true],
      [{ kind: "stopped" }, true],
    ];
    for (const [status, terminal] of table) {
      expect(isTerminalAgentTaskStatus(status)).toBe(terminal);
    }
  });
});

describe("mintAgentTaskId", () => {
  it("mints a safe agent task id", () => {
    expect(mintAgentTaskId(1_735_000_000_000, "0f3a")).toBe("agt-m51q7bwg-0f3a");
  });

  it("rejects invalid clocks and entropy", () => {
    expect(() => mintAgentTaskId(-1, "0f3a")).toThrow("Invalid agent task value");
    expect(() => mintAgentTaskId(1.5, "0f3a")).toThrow("Invalid agent task value");
    expect(() => mintAgentTaskId(1_000, "0F3A")).toThrow("Invalid agent task value");
    expect(() => mintAgentTaskId(1_000, "0f3")).toThrow("Invalid agent task value");
  });
});

describe("defaultAgentTaskIsolation", () => {
  it("resolves the pinned precedence order", () => {
    expect(defaultAgentTaskIsolation(isolationContext({ workspacePolicy: "worktree" }))).toEqual({
      kind: "worktree",
      reason: "policy",
    });
    expect(
      defaultAgentTaskIsolation(
        isolationContext({ workspacePolicy: "in-place", liveAgentTasksInRepository: 1 }),
      ),
    ).toEqual({ kind: "worktree", reason: "agent-active" });
    expect(
      defaultAgentTaskIsolation(
        isolationContext({ workspacePolicy: "in-place", plannedParallelDispatch: true }),
      ),
    ).toEqual({ kind: "worktree", reason: "parallel-dispatch" });
    expect(
      defaultAgentTaskIsolation(
        isolationContext({
          workspacePolicy: "in-place",
          repositoryStatusKnown: false,
          repositoryDirty: true,
          dirtyEditorDocumentsInRepository: 3,
        }),
      ),
    ).toEqual({ kind: "in-place" });
    expect(defaultAgentTaskIsolation(isolationContext({ repositoryStatusKnown: false }))).toEqual({
      kind: "worktree",
      reason: "status-unknown",
    });
    expect(defaultAgentTaskIsolation(isolationContext({ repositoryDirty: true }))).toEqual({
      kind: "worktree",
      reason: "dirty-tree",
    });
    expect(
      defaultAgentTaskIsolation(isolationContext({ dirtyEditorDocumentsInRepository: 1 })),
    ).toEqual({ kind: "worktree", reason: "dirty-editors" });
    expect(defaultAgentTaskIsolation(isolationContext())).toEqual({ kind: "in-place" });
  });
});

describe("inPlaceDispatchGuard", () => {
  it("reports a safe clean repository", () => {
    expect(inPlaceDispatchGuard(isolationContext())).toEqual({ kind: "safe" });
  });

  it("ignores a planned parallel dispatch, which is a preference and not a hazard", () => {
    expect(inPlaceDispatchGuard(isolationContext({ plannedParallelDispatch: true }))).toEqual({
      kind: "safe",
    });
  });

  it("collects every hazard in a deterministic order", () => {
    expect(
      inPlaceDispatchGuard(
        isolationContext({
          liveAgentTasksInRepository: 2,
          repositoryDirty: true,
          dirtyEditorDocumentsInRepository: 1,
        }),
      ),
    ).toEqual({ kind: "unsafe", reasons: ["agent-active", "dirty-tree", "dirty-editors"] });
  });

  it("reports an unknown repository status without claiming a dirty tree", () => {
    expect(
      inPlaceDispatchGuard(
        isolationContext({ repositoryStatusKnown: false, repositoryDirty: true }),
      ),
    ).toEqual({ kind: "unsafe", reasons: ["status-unknown"] });
  });
});

describe("parseAgentTaskStatusEvent", () => {
  it("parses every status variant of the wire union", () => {
    expect(parseAgentTaskStatusEvent(wireStatusEvent({ status: "pending" })).status).toEqual({
      kind: "pending",
    });
    expect(
      parseAgentTaskStatusEvent(wireStatusEvent({ status: "exited", exitCode: -1 })).status,
    ).toEqual({ kind: "exited", exitCode: -1 });
    expect(
      parseAgentTaskStatusEvent(wireStatusEvent({ status: "failed", message: "boom" })).status,
    ).toEqual({ kind: "failed", message: "boom" });
    expect(parseAgentTaskStatusEvent(wireStatusEvent({ status: "stopped" })).status).toEqual({
      kind: "stopped",
    });
  });

  it("parses a worktree event with its worktree path", () => {
    const event = parseAgentTaskStatusEvent(
      wireStatusEvent({ isolation: "worktree", worktreePath: "/repo/.worktrees/agt-1-0a1b" }),
    );
    expect(event.worktreePath).toBe("/repo/.worktrees/agt-1-0a1b");
  });

  it("rejects malformed events fail closed", () => {
    const rejected: readonly unknown[] = [
      null,
      [],
      wireStatusEvent({ extra: 1 }),
      wireStatusEvent({ status: "unknown" }),
      wireStatusEvent({ status: "exited" }),
      wireStatusEvent({ status: "exited", exitCode: 1.5 }),
      wireStatusEvent({ status: "failed" }),
      wireStatusEvent({ status: "failed", message: "" }),
      wireStatusEvent({ sequence: -1 }),
      wireStatusEvent({ taskId: "AGT-1" }),
      wireStatusEvent({ taskId: "-agt-1" }),
      wireStatusEvent({ workspaceId: "" }),
      wireStatusEvent({ repositoryRoot: "   " }),
      wireStatusEvent({ isolation: "inPlace" }),
      wireStatusEvent({ worktreePath: "/repo/.worktrees/agt-1-0a1b" }),
      wireStatusEvent({ isolation: "worktree", worktreePath: null }),
    ];
    for (const value of rejected) {
      expect(() => parseAgentTaskStatusEvent(value)).toThrow(TypeError);
    }
  });
});

describe("parseAgentTaskOutputEvent", () => {
  it("parses a bounded chunk including the empty truncation marker", () => {
    expect(
      parseAgentTaskOutputEvent({
        taskId: "agt-1-0a1b",
        sequence: 7,
        stream: "stderr",
        chunk: "",
        truncated: true,
      }),
    ).toEqual({
      taskId: "agt-1-0a1b",
      sequence: 7,
      stream: "stderr",
      chunk: "",
      truncated: true,
    });
  });

  it("rejects malformed chunks fail closed", () => {
    const base = {
      taskId: "agt-1-0a1b",
      sequence: 7,
      stream: "stdout",
      chunk: "ok",
      truncated: false,
    };
    const rejected: readonly unknown[] = [
      { ...base, stream: "both" },
      { ...base, truncated: "yes" },
      { ...base, chunk: "x".repeat(8 * 1_024 + 1) },
      { ...base, chunk: "nul\u0000" },
      { ...base, extra: true },
    ];
    for (const value of rejected) {
      expect(() => parseAgentTaskOutputEvent(value)).toThrow(TypeError);
    }
  });
});

describe("validateStartAgentTaskRequest", () => {
  it("accepts a bounded in-place request whose cwd is the repository root", () => {
    expect(validateStartAgentTaskRequest(startRequest())).toEqual(startRequest());
  });

  it("accepts a worktree request whose cwd differs from the repository root", () => {
    const request = startRequest({
      isolation: "worktree",
      cwd: "/repo/.worktrees/agt-1-0a1b",
      agentCliKind: "codex",
      launch: { provider: "codex", model: "gpt-5.5", mode: "readOnly" },
    });
    expect(validateStartAgentTaskRequest(request)).toEqual(request);
  });

  it("accepts a resume session id within the safe pattern", () => {
    const request = startRequest({ resumeSessionId: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b" });
    expect(validateStartAgentTaskRequest(request)).toEqual(request);
  });

  it("rejects out-of-bounds and inconsistent requests", () => {
    const rejected: readonly unknown[] = [
      startRequest({ resumeSessionId: "-flag-looking-id" }),
      startRequest({ resumeSessionId: "short" }),
      startRequest({ resumeSessionId: "a".repeat(129) }),
      startRequest({ resumeSessionId: undefined }),
      startRequest({ resumeSessionId: "has space in it" }),
      startRequest({ cwd: "/repo/.worktrees/agt-1-0a1b" }),
      startRequest({ prompt: "" }),
      startRequest({ prompt: "x".repeat(32 * 1_024 + 1) }),
      startRequest({ agentCliPath: "" }),
      startRequest({ agentCliKind: "codexExec" }),
      startRequest({ taskId: "ag" }),
      startRequest({ workspaceId: "ws" }),
      startRequest({ projectRoot: "" }),
      startRequest({ projectRoot: "/repo\nforeign" }),
      startRequest({ projectRoot: `/${"x".repeat(4_096)}` }),
      startRequest({ projectRoot: undefined }),
      startRequest({ extra: 1 }),
    ];
    for (const value of rejected) {
      expect(() => validateStartAgentTaskRequest(value)).toThrow(TypeError);
    }
  });
});

describe("agent task reference requests", () => {
  it("validates the acknowledge and stop payloads", () => {
    expect(
      validateAgentTaskReferenceRequest({ taskId: "agt-1-0a1b", workspaceId: "ws-1" }),
    ).toEqual({ taskId: "agt-1-0a1b", workspaceId: "ws-1" });
    expect(() =>
      validateAgentTaskReferenceRequest({ taskId: "agt-1-0a1b", workspaceId: "ws-1", extra: 1 }),
    ).toThrow(TypeError);
  });

  it("validates the stop-for-root payload", () => {
    expect(
      validateStopAgentTasksForRootRequest({ workspaceId: "ws-1", repositoryRoot: "/repo" }),
    ).toEqual({ workspaceId: "ws-1", repositoryRoot: "/repo" });
    expect(() =>
      validateStopAgentTasksForRootRequest({ workspaceId: "ws-1", repositoryRoot: "" }),
    ).toThrow(TypeError);
  });

  it("parses the echoed start result", () => {
    expect(parseStartAgentTaskResult({ taskId: "agt-1-0a1b" })).toEqual({ taskId: "agt-1-0a1b" });
    expect(() => parseStartAgentTaskResult({ taskId: "agt-1-0a1b", extra: 1 })).toThrow(TypeError);
  });
});
