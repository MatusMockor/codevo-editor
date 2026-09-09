import { describe, expect, it, vi } from "vitest";
import type {
  TerminalGateway,
  TerminalOutputEvent,
  TerminalRuntimeStatus,
} from "../../domain/terminal";
import { TauriTerminalGateway } from "../../infrastructure/tauriTerminalGateway";
import type { ComposerScope } from "./agentComposerTarget";
import {
  NO_AGENT_SURFACE_SCOPE,
  SURFACE_FILES_FOREIGN_ROOT_DESCRIPTION,
  SURFACE_FILES_NO_PROJECT_DESCRIPTION,
  SURFACE_FILES_PROJECT_DESCRIPTION,
  SURFACE_FILES_THREAD_DESCRIPTION,
  SURFACE_FILES_UNTRUSTED_DESCRIPTION,
  SURFACE_FOREIGN_ROOT_TERMINAL_REASON,
  SURFACE_NO_PROJECT_REASON,
  SURFACE_UNTRUSTED_TERMINAL_REASON,
  SURFACE_WORKTREE_GONE_REASON,
  agentSurfaceBlockedReason,
  agentSurfaceFilesDescription,
  agentSurfaceForeignRootMessage,
  agentSurfaceScopeFor,
  agentSurfaceTerminalLaunchTargetFor,
  agentThreadCheckoutRoot,
  withTerminalLaunchTarget,
} from "./agentSurfacePolicy";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceThreadView,
} from "./agentSurfaceTestFixtures";
import { projectFixture } from "./agentThreadsSurfaceTestFixtures";

function projectDescriptor() {
  return projectFixture({ rootKey: "key:app", ownerId: "owner-1", generation: 3 });
}

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
      SURFACE_NO_PROJECT_REASON,
    );
    expect(agentSurfaceBlockedReason("terminal", null, true, SURFACE_FIXTURE_ROOT)).toBe(
      SURFACE_NO_PROJECT_REASON,
    );
    const gone = surfaceThreadView({ worktreeMissing: true });
    expect(agentSurfaceBlockedReason("files", gone, true, SURFACE_FIXTURE_ROOT)).toBe(
      SURFACE_WORKTREE_GONE_REASON,
    );
  });

  it("resolves the surface scope from the composer scope and the live project authority", () => {
    const scope: ComposerScope = {
      kind: "repository",
      projectRootKey: "key:app",
      repositoryRoot: SURFACE_FIXTURE_ROOT,
      ownerId: "owner-1",
      generation: 3,
    };
    const project = projectDescriptor();

    expect(agentSurfaceScopeFor(scope, [project], SURFACE_FIXTURE_ROOT)).toEqual({
      kind: "repository",
      projectRootKey: "key:app",
      repositoryRoot: SURFACE_FIXTURE_ROOT,
      rootPath: SURFACE_FIXTURE_ROOT,
      ownerId: "owner-1",
      generation: 3,
    });
    expect(
      agentSurfaceScopeFor(scope, [{ ...project, trust: "untrusted" }], SURFACE_FIXTURE_ROOT),
    ).toEqual({
      kind: "untrusted",
      projectRootKey: "key:app",
      repositoryRoot: SURFACE_FIXTURE_ROOT,
    });
    expect(
      agentSurfaceScopeFor(scope, [{ ...project, trust: "unknown" }], SURFACE_FIXTURE_ROOT).kind,
    ).toBe("untrusted");

    expect(agentSurfaceScopeFor(null, [project], SURFACE_FIXTURE_ROOT)).toBe(
      NO_AGENT_SURFACE_SCOPE,
    );
    expect(
      agentSurfaceScopeFor(
        { kind: "missing", projectRootKey: "key:app", repositoryRoot: SURFACE_FIXTURE_ROOT },
        [project],
        SURFACE_FIXTURE_ROOT,
      ),
    ).toBe(NO_AGENT_SURFACE_SCOPE);
    expect(agentSurfaceScopeFor(scope, [], SURFACE_FIXTURE_ROOT)).toBe(NO_AGENT_SURFACE_SCOPE);
    expect(agentSurfaceScopeFor(scope, [{ ...project, generation: 4 }], SURFACE_FIXTURE_ROOT)).toBe(
      NO_AGENT_SURFACE_SCOPE,
    );
    expect(
      agentSurfaceScopeFor(scope, [{ ...project, ownerId: "owner-2" }], SURFACE_FIXTURE_ROOT),
    ).toBe(NO_AGENT_SURFACE_SCOPE);
    expect(
      agentSurfaceScopeFor(
        scope,
        [{ ...project, origin: "closed-tab-live-tasks" }],
        SURFACE_FIXTURE_ROOT,
      ),
    ).toBe(NO_AGENT_SURFACE_SCOPE);
    expect(
      agentSurfaceScopeFor(
        { ...scope, repositoryRoot: `${SURFACE_FIXTURE_ROOT}/elsewhere` },
        [{ ...project, repositories: [] }],
        SURFACE_FIXTURE_ROOT,
      ),
    ).toBe(NO_AGENT_SURFACE_SCOPE);
  });

  it("roots the Files scope at the project folder even when only nested repositories exist", () => {
    const nested = `${SURFACE_FIXTURE_ROOT}/pa-ai-be`;
    const project = {
      ...projectDescriptor(),
      repositories: [
        {
          mapping: { rootRelativePath: "pa-ai-be" },
          repositoryRoot: nested,
          repositoryRelativePath: "",
        },
      ],
    };
    const scope: ComposerScope = {
      kind: "repository",
      projectRootKey: "key:app",
      repositoryRoot: SURFACE_FIXTURE_ROOT,
      ownerId: "owner-1",
      generation: 3,
    };

    const folder = agentSurfaceScopeFor(scope, [project], SURFACE_FIXTURE_ROOT);
    expect(folder.kind).toBe("repository");
    expect(folder.kind === "repository" && folder.rootPath).toBe(SURFACE_FIXTURE_ROOT);

    const scopedToNested = agentSurfaceScopeFor(
      { ...scope, repositoryRoot: nested },
      [project],
      SURFACE_FIXTURE_ROOT,
    );
    expect(scopedToNested.kind === "repository" && scopedToNested.rootPath).toBe(
      SURFACE_FIXTURE_ROOT,
    );
  });

  it("browses an in-place thread at its project folder and a worktree thread at its checkout", () => {
    const nested = `${SURFACE_FIXTURE_ROOT}/pa-ai-be`;
    const project = {
      ...projectFixture(),
      repositories: [
        {
          mapping: { rootRelativePath: "pa-ai-be" },
          repositoryRoot: nested,
          repositoryRelativePath: "",
        },
      ],
    };
    const inPlace = surfaceThreadView({
      thread: {
        ...surfaceThreadView().thread,
        owner: { ...surfaceThreadView().thread.owner, repositoryRoot: nested },
        target: { isolation: "in-place", worktreePath: null },
      },
    });
    const worktree = surfaceThreadView();
    const stranger = surfaceThreadView({
      thread: {
        ...surfaceThreadView().thread,
        owner: { rootKey: "key:other", ownerId: "owner-9", repositoryRoot: "/workspace/other" },
        target: { isolation: "in-place", worktreePath: null },
      },
    });

    expect(agentThreadCheckoutRoot(inPlace, [project])).toBe(SURFACE_FIXTURE_ROOT);
    expect(agentThreadCheckoutRoot(worktree, [project])).toBe(SURFACE_FIXTURE_WORKTREE);
    expect(agentThreadCheckoutRoot(stranger, [project])).toBe("/workspace/other");
    expect(agentThreadCheckoutRoot(inPlace, [{ ...project, ownerId: "owner-2" }])).toBe(nested);
  });

  it("describes the Files card by thread first, then by scope", () => {
    const repository = agentSurfaceScopeFor(
      {
        kind: "repository",
        projectRootKey: "key:app",
        repositoryRoot: SURFACE_FIXTURE_ROOT,
        ownerId: "owner-1",
        generation: 3,
      },
      [projectDescriptor()],
      SURFACE_FIXTURE_ROOT,
    );
    expect(agentSurfaceFilesDescription(surfaceThreadView(), NO_AGENT_SURFACE_SCOPE)).toBe(
      SURFACE_FILES_THREAD_DESCRIPTION,
    );
    expect(agentSurfaceFilesDescription(null, repository)).toBe(SURFACE_FILES_PROJECT_DESCRIPTION);
    expect(
      agentSurfaceFilesDescription(null, {
        kind: "untrusted",
        projectRootKey: "key:app",
        repositoryRoot: SURFACE_FIXTURE_ROOT,
      }),
    ).toBe(SURFACE_FILES_UNTRUSTED_DESCRIPTION);
    expect(agentSurfaceFilesDescription(null, NO_AGENT_SURFACE_SCOPE)).toBe(
      SURFACE_FILES_NO_PROJECT_DESCRIPTION,
    );
    expect(
      agentSurfaceFilesDescription(null, {
        kind: "foreignRoot",
        projectRootKey: "key:other",
        repositoryRoot: "/workspace/other",
        rootPath: "/workspace/other",
        label: "other",
      }),
    ).toBe(SURFACE_FILES_FOREIGN_ROOT_DESCRIPTION);
    expect(agentSurfaceForeignRootMessage("other")).toBe(
      "Files browse the active workspace only. Switch to other to browse its files.",
    );
  });

  it("marks a scope outside the active workspace root as foreign before trust applies", () => {
    const scope: ComposerScope = {
      kind: "repository",
      projectRootKey: "key:app",
      repositoryRoot: SURFACE_FIXTURE_ROOT,
      ownerId: "owner-1",
      generation: 3,
    };
    const project = projectDescriptor();
    const foreign = {
      kind: "foreignRoot",
      projectRootKey: "key:app",
      repositoryRoot: SURFACE_FIXTURE_ROOT,
      rootPath: SURFACE_FIXTURE_ROOT,
      label: "app",
    };
    expect(agentSurfaceScopeFor(scope, [project], "/workspace/other")).toEqual(foreign);
    expect(agentSurfaceScopeFor(scope, [project], null)).toEqual(foreign);
    expect(agentSurfaceScopeFor(scope, [project], "/workspace/ap")).toEqual(foreign);
    expect(agentSurfaceScopeFor(scope, [{ ...project, trust: "untrusted" }], null)).toEqual(
      foreign,
    );
    expect(agentSurfaceScopeFor(scope, [project], "/workspace").kind).toBe("foreignRoot");
    expect(
      agentSurfaceScopeFor(
        { ...scope, repositoryRoot: "/workspace/other" },
        [project],
        SURFACE_FIXTURE_ROOT,
      ),
    ).toBe(NO_AGENT_SURFACE_SCOPE);
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
