import { describe, expect, it, vi } from "vitest";
import {
  MAX_NODE_DEBUG_COMPOUND_MEMBERS,
  type NodeDebugCompoundOwner,
} from "./nodeDebugCompoundSessionCoordinator";
import {
  NODE_DEBUG_COMPOUND_PRE_LAUNCH_ERROR,
  NODE_DEBUG_COMPOUND_ROLLBACK_ERROR,
  NODE_DEBUG_COMPOUND_STALE_ERROR,
  NODE_DEBUG_COMPOUND_START_ERROR,
  NODE_DEBUG_COMPOUND_STOP_ERROR,
  NodeDebugCompoundStartCoordinator,
  type NodeDebugCompoundMembersStartResult,
  type NodeDebugCompoundStartPort,
} from "./nodeDebugCompoundStartCoordinator";
import type { PreparedNodeDebugLaunch } from "./useNodeDebugConfigurationLauncher";

const OWNER: NodeDebugCompoundOwner = {
  launchConfigurationVersion: 3,
  rootPath: "/workspace",
  workspaceEpoch: 7,
  workspaceId: "workspace-a",
};
const EXACT_UTF8_ROOT = `/${"😀".repeat(1_023)}abc`;
const OVERSIZED_UTF8_ROOT = `${EXACT_UTF8_ROOT}😀`;

describe("NodeDebugCompoundStartCoordinator", () => {
  it("runs one optional pre-launch task, accepts a batch and consumes Stop All exactly once", async () => {
    const ui = port();
    ui.startMembers.mockResolvedValue({ kind: "batch", sessionIds: [11, 12] });
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);

    const started = await coordinator.start({
      members: compoundMembers(),
      preLaunchTask: { label: "build all" },
    });

    expect(started.kind).toBe("started");
    expect(ui.runPreLaunchTask).toHaveBeenCalledOnce();
    expect(ui.runPreLaunchTask.mock.calls[0]?.[0]).toEqual({ label: "build all" });
    expect(ui.startMembers).toHaveBeenCalledOnce();
    if (started.kind !== "started") throw new Error("expected a group lease");
    expect(await coordinator.stopAll(started.lease)).toEqual({ kind: "stopped" });
    expect(await coordinator.stopAll(started.lease)).toEqual({ kind: "rejected" });
    expect(ui.stopGroup.mock.calls.map(([sessionId]) => sessionId)).toEqual([11]);
  });

  it("passes the exact immutable batch recipe to the start port", async () => {
    const ui = port();
    ui.startMembers.mockResolvedValue({ kind: "batch", sessionIds: [21, 22] });
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);

    const started = await coordinator.start({ members: compoundMembers() });

    expect(started.kind).toBe("started");
    expect(ui.startMembers.mock.calls[0]?.[0].members.map(({ launch }) => launch)).toEqual([
      { kind: "node-script", scriptPath: "/workspace/api.ts" },
      { kind: "node-script", scriptPath: "/workspace/worker.ts" },
    ]);
    expect(Object.isFrozen(ui.startMembers.mock.calls[0]?.[0].members)).toBe(true);
    expect(Object.isFrozen(ui.startMembers.mock.calls[0]?.[0].members[0]?.launch)).toBe(true);
  });

  it("starts eight members and rejects nine before reaching the start port", async () => {
    const ui = port();
    ui.startMembers.mockResolvedValue({
      kind: "batch",
      sessionIds: Array.from({ length: MAX_NODE_DEBUG_COMPOUND_MEMBERS }, (_, index) => index + 1),
    });
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);

    await expect(
      coordinator.start({ members: compoundMembers(MAX_NODE_DEBUG_COMPOUND_MEMBERS + 1) }),
    ).resolves.toEqual({
      kind: "invalid",
    });
    expect(ui.startMembers).not.toHaveBeenCalled();

    await expect(
      coordinator.start({ members: compoundMembers(MAX_NODE_DEBUG_COMPOUND_MEMBERS) }),
    ).resolves.toMatchObject({ kind: "started" });
    expect(ui.startMembers).toHaveBeenCalledOnce();
    expect(ui.startMembers.mock.calls[0]?.[0].members).toHaveLength(
      MAX_NODE_DEBUG_COMPOUND_MEMBERS,
    );
  });

  it("bounds captured owner identities by UTF-8 bytes and rejects control characters", async () => {
    expect(new TextEncoder().encode(EXACT_UTF8_ROOT).byteLength).toBe(4_096);
    const exactPort = port();
    exactPort.captureOwner.mockReturnValue({ ...OWNER, rootPath: EXACT_UTF8_ROOT });
    exactPort.startMembers.mockResolvedValue({ kind: "batch", sessionIds: [17, 18] });
    const exact = new NodeDebugCompoundStartCoordinator(exactPort);
    expect((await exact.start({ members: compoundMembers() })).kind).toBe("started");

    for (const rootPath of [OVERSIZED_UTF8_ROOT, "/workspace\nsecret"]) {
      const invalidPort = port();
      invalidPort.captureOwner.mockReturnValue({ ...OWNER, rootPath });
      const coordinator = new NodeDebugCompoundStartCoordinator(invalidPort);
      await expect(coordinator.start({ members: compoundMembers() })).resolves.toEqual({
        kind: "stale",
      });
      expect(invalidPort.startMembers).not.toHaveBeenCalled();
    }
  });

  it("keeps two same-count compound recipes exact without out-of-band selection state", async () => {
    const ui = port();
    ui.startMembers
      .mockResolvedValueOnce({ kind: "batch", sessionIds: [23, 24] })
      .mockResolvedValueOnce({ kind: "batch", sessionIds: [25, 26] });
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);

    const first = await coordinator.start({ members: compoundMembers("first") });
    if (first.kind !== "started") throw new Error("expected first group lease");
    await coordinator.stopAll(first.lease);
    const second = await coordinator.start({ members: compoundMembers("second") });
    expect(second.kind).toBe("started");

    expect(
      ui.startMembers.mock.calls.map(([request]) =>
        request.members.map(({ launch }) =>
          "scriptPath" in launch ? launch.scriptPath : launch.kind,
        ),
      ),
    ).toEqual([
      ["/workspace/first-api.ts", "/workspace/first-worker.ts"],
      ["/workspace/second-api.ts", "/workspace/second-worker.ts"],
    ]);
  });

  it("captures member args and environment before caller mutation across the pre-task await", async () => {
    const ui = port();
    const preTaskGate = deferred<boolean>();
    ui.runPreLaunchTask.mockReturnValue(preTaskGate.promise);
    ui.startMembers.mockResolvedValue({ kind: "batch", sessionIds: [27, 28] });
    const args = ["--watch"];
    const env = { PRIVATE_TOKEN: "original" };
    const members = compoundMembers("mutable");
    members[0] = {
      launch: {
        args,
        env,
        kind: "node-configured-script",
        scriptPath: "/workspace/mutable-api.ts",
      },
      preLaunchTask: null,
    };
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);

    const pending = coordinator.start({
      members,
      preLaunchTask: { label: "build all" },
    });
    args[0] = "--mutated";
    env.PRIVATE_TOKEN = "mutated";
    preTaskGate.resolve(true);
    expect((await pending).kind).toBe("started");

    expect(ui.startMembers.mock.calls[0]?.[0].members[0]?.launch).toMatchObject({
      args: ["--watch"],
      env: { PRIVATE_TOKEN: "original" },
    });
  });

  it("does not start members when the compound pre-launch task fails", async () => {
    const ui = port();
    ui.runPreLaunchTask.mockResolvedValue(false);
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);

    await expect(
      coordinator.start({
        members: compoundMembers(),
        preLaunchTask: { label: "build all" },
      }),
    ).resolves.toEqual({ kind: "prelaunch-failed" });

    expect(ui.startMembers).not.toHaveBeenCalled();
    expect(ui.reportError).toHaveBeenCalledWith(NODE_DEBUG_COMPOUND_PRE_LAUNCH_ERROR);
  });

  it.each([
    ["incomplete", [31]],
    ["oversized", [31, 32, 33]],
    ["duplicate", [31, 31]],
    ["invalid", [31, 0]],
  ])("rejects an %s batch before it can acquire rollback ownership", async (_label, sessionIds) => {
    const ui = port();
    ui.startMembers.mockResolvedValue({ kind: "batch", sessionIds });
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);

    await expect(coordinator.start({ members: compoundMembers() })).resolves.toEqual({
      kind: "start-failed",
    });

    expect(ui.stopGroup).not.toHaveBeenCalled();
    expect(ui.reportError).toHaveBeenCalledExactlyOnceWith(NODE_DEBUG_COMPOUND_START_ERROR);
  });

  it("does not issue a backend group stop when no member was accepted", async () => {
    const ui = port();
    ui.startMembers.mockResolvedValue({ kind: "failed" });
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);

    await expect(coordinator.start({ members: compoundMembers() })).resolves.toEqual({
      kind: "start-failed",
    });

    expect(ui.stopGroup).not.toHaveBeenCalled();
    expect(ui.reportError).toHaveBeenCalledExactlyOnceWith(NODE_DEBUG_COMPOUND_START_ERROR);
  });

  it("fails closed across an A-B-A owner race and rolls back the exact batch", async () => {
    const ui = port();
    const gate = deferred<NodeDebugCompoundMembersStartResult>();
    ui.startMembers.mockReturnValue(gate.promise);
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);
    const pending = coordinator.start({ members: compoundMembers() });

    ui.captureOwner.mockReturnValue({
      ...OWNER,
      rootPath: "/other",
      workspaceEpoch: 8,
      workspaceId: "workspace-b",
    });
    ui.captureOwner.mockReturnValue({
      ...OWNER,
      workspaceEpoch: 9,
    });
    gate.resolve({ kind: "batch", sessionIds: [41, 42] });

    await expect(pending).resolves.toEqual({ kind: "stale" });
    expect(ui.stopGroup.mock.calls.map(([sessionId]) => sessionId)).toEqual([41]);
    expect(ui.reportError).toHaveBeenCalledWith(NODE_DEBUG_COMPOUND_STALE_ERROR);
  });

  it("rolls back exact accepted sessions when trust is revoked during start", async () => {
    const ui = port();
    const gate = deferred<NodeDebugCompoundMembersStartResult>();
    ui.startMembers.mockReturnValue(gate.promise);
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);
    const pending = coordinator.start({ members: compoundMembers() });

    ui.isWorkspaceTrusted.mockReturnValue(false);
    gate.resolve({ kind: "batch", sessionIds: [45, 46] });

    await expect(pending).resolves.toEqual({ kind: "stale" });
    expect(ui.stopGroup.mock.calls.map(([sessionId]) => sessionId)).toEqual([45]);
  });

  it("treats a terminal-before-batch-return as an all-or-nothing start failure", async () => {
    const ui = port();
    const gate = deferred<NodeDebugCompoundMembersStartResult>();
    ui.startMembers.mockReturnValue(gate.promise);
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);
    const pending = coordinator.start({ members: compoundMembers() });

    expect(
      coordinator.handleEvent({
        kind: "terminated",
        rootPath: "/workspace/",
        sessionId: 51,
      }),
    ).toBe(false);
    gate.resolve({ kind: "batch", sessionIds: [51, 52] });

    await expect(pending).resolves.toEqual({ kind: "start-failed" });
    expect(ui.stopGroup.mock.calls.map(([sessionId]) => sessionId)).toEqual([52]);
  });

  it("keeps an ending group occupied until every backend terminal event drains", async () => {
    const ui = port();
    ui.startMembers.mockResolvedValue({ kind: "batch", sessionIds: [55, 56] });
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);
    const started = await coordinator.start({ members: compoundMembers() });
    if (started.kind !== "started") throw new Error("expected a group lease");

    expect(
      coordinator.handleEvent({
        kind: "terminated",
        rootPath: "/workspace/",
        sessionId: 55,
      }),
    ).toBe(true);
    expect(coordinator.occupied()).toBe(true);
    await expect(coordinator.start({ members: compoundMembers() })).resolves.toEqual({
      kind: "busy",
    });
    expect(
      coordinator.handleEvent({
        kind: "stopped",
        rootPath: "/workspace",
        sessionId: 56,
      }),
    ).toBe(true);
    expect(ui.stopGroup).not.toHaveBeenCalled();

    expect(
      coordinator.handleEvent({
        kind: "terminated",
        rootPath: "/workspace",
        sessionId: 56,
      }),
    ).toBe(true);
    expect(coordinator.occupied()).toBe(false);
    await expect(coordinator.stopAll(started.lease)).resolves.toEqual({ kind: "rejected" });
  });

  it("reports rollback failure generically without leaking backend errors", async () => {
    const ui = port();
    const gate = deferred<NodeDebugCompoundMembersStartResult>();
    ui.startMembers.mockReturnValue(gate.promise);
    ui.stopGroup.mockRejectedValue(new Error("secret rollback failure"));
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);
    const pending = coordinator.start({ members: compoundMembers() });
    coordinator.handleEvent({
      kind: "terminated",
      rootPath: "/workspace",
      sessionId: 61,
    });
    gate.resolve({ kind: "batch", sessionIds: [61, 62] });

    await expect(pending).resolves.toEqual({
      kind: "rollback-failed",
    });

    expect(ui.reportError.mock.calls).toEqual([
      [NODE_DEBUG_COMPOUND_START_ERROR],
      [NODE_DEBUG_COMPOUND_ROLLBACK_ERROR],
    ]);
    expect(JSON.stringify(ui.reportError.mock.calls)).not.toContain("secret");
  });

  it("rejects a duplicate concurrent start while preserving the first single flight", async () => {
    const ui = port();
    const gate = deferred<NodeDebugCompoundMembersStartResult>();
    ui.startMembers.mockReturnValue(gate.promise);
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);
    const first = coordinator.start({ members: compoundMembers() });

    await expect(coordinator.start({ members: compoundMembers() })).resolves.toEqual({
      kind: "busy",
    });
    gate.resolve({ kind: "batch", sessionIds: [71, 72] });
    expect((await first).kind).toBe("started");
    expect(ui.startMembers).toHaveBeenCalledOnce();
  });

  it("invalidates an in-flight exact owner and awaits rollback of late acceptances", async () => {
    const ui = port();
    const gate = deferred<NodeDebugCompoundMembersStartResult>();
    ui.startMembers.mockReturnValue(gate.promise);
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);
    const pending = coordinator.start({ members: compoundMembers() });
    const invalidated = coordinator.invalidate({ ...OWNER, rootPath: "/workspace/" });

    gate.resolve({ kind: "batch", sessionIds: [81, 82] });

    await expect(invalidated).resolves.toBe(true);
    await expect(pending).resolves.toEqual({ kind: "stale" });
    expect(ui.stopGroup.mock.calls.map(([sessionId]) => sessionId)).toEqual([81]);
  });

  it("gives exact invalidation priority when an awaited pre-launch task later fails", async () => {
    const ui = port();
    const gate = deferred<boolean>();
    ui.runPreLaunchTask.mockReturnValue(gate.promise);
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);
    const pending = coordinator.start({
      members: compoundMembers(),
      preLaunchTask: { label: "build all" },
    });
    const invalidated = coordinator.invalidate(OWNER);

    gate.resolve(false);

    await expect(invalidated).resolves.toBe(true);
    await expect(pending).resolves.toEqual({ kind: "stale" });
    expect(ui.startMembers).not.toHaveBeenCalled();
    expect(ui.stopGroup).not.toHaveBeenCalled();
    expect(ui.reportError).toHaveBeenCalledExactlyOnceWith(NODE_DEBUG_COMPOUND_STALE_ERROR);
    expect(ui.reportError).not.toHaveBeenCalledWith(NODE_DEBUG_COMPOUND_PRE_LAUNCH_ERROR);
  });

  it("consumes an active lease even when its one exact backend group stop fails", async () => {
    const ui = port();
    ui.startMembers.mockResolvedValue({ kind: "batch", sessionIds: [91, 92] });
    ui.stopGroup.mockResolvedValue(false);
    const coordinator = new NodeDebugCompoundStartCoordinator(ui);
    const started = await coordinator.start({ members: compoundMembers() });
    if (started.kind !== "started") throw new Error("expected a group lease");

    await expect(coordinator.stopAll(started.lease)).resolves.toEqual({ kind: "failed" });
    await expect(coordinator.stopAll(started.lease)).resolves.toEqual({ kind: "rejected" });
    expect(ui.stopGroup.mock.calls.map(([sessionId]) => sessionId)).toEqual([91]);
    expect(ui.reportError).toHaveBeenCalledWith(NODE_DEBUG_COMPOUND_STOP_ERROR);
  });
});

function port(): {
  captureOwner: ReturnType<typeof vi.fn<NodeDebugCompoundStartPort["captureOwner"]>>;
  isWorkspaceTrusted: ReturnType<typeof vi.fn<NodeDebugCompoundStartPort["isWorkspaceTrusted"]>>;
  reportError: ReturnType<typeof vi.fn<NonNullable<NodeDebugCompoundStartPort["reportError"]>>>;
  runPreLaunchTask: ReturnType<typeof vi.fn<NodeDebugCompoundStartPort["runPreLaunchTask"]>>;
  startMembers: ReturnType<typeof vi.fn<NodeDebugCompoundStartPort["startMembers"]>>;
  stopGroup: ReturnType<typeof vi.fn<NodeDebugCompoundStartPort["stopGroup"]>>;
} & NodeDebugCompoundStartPort {
  return {
    captureOwner: vi.fn<NodeDebugCompoundStartPort["captureOwner"]>(() => ({ ...OWNER })),
    isWorkspaceTrusted: vi.fn<NodeDebugCompoundStartPort["isWorkspaceTrusted"]>(() => true),
    reportError: vi.fn<NonNullable<NodeDebugCompoundStartPort["reportError"]>>(),
    runPreLaunchTask: vi.fn<NodeDebugCompoundStartPort["runPreLaunchTask"]>(async () => true),
    startMembers: vi.fn<NodeDebugCompoundStartPort["startMembers"]>(async () => ({
      kind: "failed",
    })),
    stopGroup: vi.fn<NodeDebugCompoundStartPort["stopGroup"]>(async () => true),
  };
}

function compoundMembers(prefixOrCount: string | number = ""): PreparedNodeDebugLaunch[] {
  if (typeof prefixOrCount === "number") {
    return Array.from({ length: prefixOrCount }, (_, index) => ({
      launch: { kind: "node-script", scriptPath: `/workspace/service-${index}.ts` },
      preLaunchTask: null,
    }));
  }
  const stem = prefixOrCount ? `${prefixOrCount}-` : "";
  return [
    {
      launch: { kind: "node-script", scriptPath: `/workspace/${stem}api.ts` },
      preLaunchTask: null,
    },
    {
      launch: { kind: "node-script", scriptPath: `/workspace/${stem}worker.ts` },
      preLaunchTask: null,
    },
  ];
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
