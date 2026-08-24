// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { AgentProjectDescriptor, AgentProjectOrigin } from "../domain/agentProject";
import type { AgentIsolationPolicy } from "../domain/agentSettings";
import type { GitChangedFile, GitStatus } from "../domain/git";
import type { AgentRepositoryStatusSnapshot } from "./agentThreadPorts";
import { projectAuthority } from "./agentProjectAuthority";
import {
  agentIsolationReasonLabel,
  inPlaceGuardReasonLabel,
  useAgentIsolationPreview,
  type AgentIsolationPreviewDependencies,
  type AgentIsolationPreviewSurface,
} from "./useAgentIsolationPreview";

const ROOT = "/workspace/app";
const OWNER = "workspace-a";

interface Environment {
  present: boolean;
  generation: number;
  origin: AgentProjectOrigin;
  policy: AgentIsolationPolicy;
  status: AgentRepositoryStatusSnapshot;
  dirtyEditors: number;
  liveTasks: number;
  gitChanges: number;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("useAgentIsolationPreview", () => {
  it("recommends in-place for a clean active repository and a worktree for a dirty one", () => {
    const clean = renderPreview();
    expect(clean.hook().isolationPreview(ROOT).recommended).toEqual({ kind: "in-place" });
    expect(clean.hook().isolationPreview(ROOT).inPlaceGuard).toEqual({ kind: "safe" });
    expect(clean.hook().isolationPreview(ROOT).inPlaceAllowed).toBe(true);
    clean.unmount();

    const dirty = renderPreview({ status: { known: true, dirty: true } });
    expect(dirty.hook().isolationPreview(ROOT).recommended).toEqual({
      kind: "worktree",
      reason: "dirty-tree",
    });
    expect(dirty.hook().isolationPreview(ROOT).inPlaceGuard).toEqual({
      kind: "unsafe",
      reasons: ["dirty-tree"],
    });
    dirty.unmount();
  });

  it("forces a worktree for background projects and counts running turns as hazards", () => {
    const background = renderPreview({ origin: "background-tab", dirtyEditors: 3 });
    const preview = background.hook().isolationPreview(ROOT);
    expect(preview.inPlaceAllowed).toBe(false);
    expect(preview.recommended).toEqual({ kind: "worktree", reason: "policy" });
    expect(background.hook().isolationContext(ROOT).dirtyEditorDocumentsInRepository).toBe(0);
    background.unmount();

    const busy = renderPreview({ liveTasks: 2 });
    expect(busy.hook().isolationPreview(ROOT).inPlaceGuard).toEqual({
      kind: "unsafe",
      reasons: ["agent-active"],
    });
    busy.unmount();
  });

  it("has no confirmation key until the exact owner refreshed the status", async () => {
    const harness = renderPreview({ status: { known: true, dirty: true }, gitChanges: 1 });
    expect(harness.hook().isolationPreview(ROOT).confirmationKey).toBeNull();

    await act(() => harness.hook().refreshIsolationStatus(ROOT));

    const key = harness.hook().isolationPreview(ROOT).confirmationKey;
    expect(key).not.toBeNull();
    expect(JSON.parse(key ?? "{}")).toMatchObject({
      authority: projectAuthority(harness.project()),
      repositoryRoot: ROOT,
      repositoryDirty: true,
    });
    harness.unmount();
  });

  it("prefers the fresh status over the cached snapshot for the same owner only", async () => {
    const harness = renderPreview({ status: { known: true, dirty: true }, gitChanges: 0 });
    await act(() => harness.hook().refreshIsolationStatus(ROOT));
    expect(harness.hook().isolationContext(ROOT).repositoryDirty).toBe(false);

    harness.environment.generation += 1;

    expect(harness.hook().isolationContext(ROOT).repositoryDirty).toBe(true);
    expect(harness.hook().isolationPreview(ROOT).confirmationKey).toBeNull();
    harness.unmount();
  });

  it("drops a superseded status refresh and keeps the latest result", async () => {
    const harness = renderPreview({ status: { known: false, dirty: false } });
    const slow = createDeferred<GitStatus>();
    harness.git.getStatus.mockImplementationOnce(() => slow.promise);

    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = harness.hook().refreshIsolationStatus(ROOT);
      await harness.hook().refreshIsolationStatus(ROOT);
    });
    expect(harness.hook().isolationContext(ROOT).repositoryStatusKnown).toBe(true);
    expect(harness.hook().isolationContext(ROOT).repositoryDirty).toBe(false);

    await act(async () => {
      slow.resolve({ branch: "main", changes: [change()], isRepository: true, rootPath: ROOT });
      await first;
    });

    expect(harness.hook().isolationContext(ROOT).repositoryDirty).toBe(false);
    harness.unmount();
  });

  it("marks the status unknown when the refresh fails and reports the error", async () => {
    const harness = renderPreview({ status: { known: true, dirty: false } });
    harness.git.getStatus.mockRejectedValueOnce(new Error("git unavailable"));

    await act(() => harness.hook().refreshIsolationStatus(ROOT));

    expect(harness.reportError).toHaveBeenCalledWith("Agents", expect.any(Error));
    expect(harness.hook().isolationContext(ROOT).repositoryStatusKnown).toBe(false);
    expect(harness.hook().isolationPreview(ROOT).confirmationKey).toBeNull();
    harness.unmount();
  });

  it("ignores a late refresh after the project generation changed", async () => {
    const harness = renderPreview({ status: { known: false, dirty: false } });
    const pending = createDeferred<GitStatus>();
    harness.git.getStatus.mockImplementationOnce(() => pending.promise);

    await act(async () => {
      const refresh = harness.hook().refreshIsolationStatus(ROOT);
      harness.environment.generation += 1;
      pending.resolve({ branch: "main", changes: [], isRepository: true, rootPath: ROOT });
      await refresh;
    });

    expect(harness.hook().isolationContext(ROOT).repositoryStatusKnown).toBe(false);
    harness.unmount();
  });

  describe("preflightInPlace", () => {
    it("passes a clean repository and records the fresh status", async () => {
      const harness = renderPreview({ status: { known: false, dirty: false } });
      const authority = projectAuthority(harness.project());

      const result = await act(() => harness.hook().preflightInPlace(ROOT, authority, null));

      expect(result).toEqual({ kind: "ok" });
      expect(harness.hook().isolationPreview(ROOT).confirmationKey).not.toBeNull();
      harness.unmount();
    });

    it("refuses an unsafe repository unless the exact confirmation key is presented", async () => {
      const harness = renderPreview({ gitChanges: 1 });
      const authority = projectAuthority(harness.project());

      const refused = await act(() => harness.hook().preflightInPlace(ROOT, authority, null));
      expect(refused).toEqual({ kind: "unsafe", label: inPlaceGuardReasonLabel("dirty-tree") });

      const key = harness.hook().isolationPreview(ROOT).confirmationKey;
      const confirmed = await act(() => harness.hook().preflightInPlace(ROOT, authority, key));
      expect(confirmed).toEqual({ kind: "ok" });
      harness.unmount();
    });

    it("fails closed when the owner changes during the status refresh", async () => {
      const harness = renderPreview();
      const authority = projectAuthority(harness.project());
      const pending = createDeferred<GitStatus>();
      harness.git.getStatus.mockImplementationOnce(() => pending.promise);

      let result: unknown = null;
      await act(async () => {
        const preflight = harness.hook().preflightInPlace(ROOT, authority, null);
        harness.environment.generation += 1;
        pending.resolve({ branch: "main", changes: [], isRepository: true, rootPath: ROOT });
        result = await preflight;
      });

      expect(result).toEqual({ kind: "owner-lost" });
      harness.unmount();
    });

    it("reports a failed status read and a superseded request distinctly", async () => {
      const harness = renderPreview();
      const authority = projectAuthority(harness.project());
      harness.git.getStatus.mockRejectedValueOnce(new Error("git unavailable"));
      const failed = await act(() => harness.hook().preflightInPlace(ROOT, authority, null));
      expect(failed).toMatchObject({ kind: "status-failed" });

      const slow = createDeferred<GitStatus>();
      harness.git.getStatus.mockImplementationOnce(() => slow.promise);
      let superseded: unknown = null;
      await act(async () => {
        const first = harness.hook().preflightInPlace(ROOT, authority, null);
        await harness.hook().refreshIsolationStatus(ROOT);
        slow.resolve({ branch: "main", changes: [], isRepository: true, rootPath: ROOT });
        superseded = await first;
      });
      expect(superseded).toEqual({ kind: "superseded" });
      harness.unmount();
    });
  });

  it("labels every isolation reason and guard reason", () => {
    expect(agentIsolationReasonLabel({ kind: "in-place" })).toContain("clean");
    for (const reason of [
      "policy",
      "agent-active",
      "parallel-dispatch",
      "status-unknown",
      "dirty-tree",
      "dirty-editors",
    ] as const) {
      expect(agentIsolationReasonLabel({ kind: "worktree", reason })).not.toBe("");
    }
    for (const reason of [
      "agent-active",
      "dirty-tree",
      "dirty-editors",
      "status-unknown",
    ] as const) {
      expect(inPlaceGuardReasonLabel(reason)).not.toBe("");
    }
  });
});

function change(): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path: `${ROOT}/src/app.ts`,
    relativePath: "src/app.ts",
    status: "modified",
  };
}

function renderPreview(overrides: Partial<Environment> = {}) {
  const environment: Environment = {
    present: true,
    generation: 1,
    origin: "active-tab",
    policy: "auto",
    status: { known: true, dirty: false },
    dirtyEditors: 0,
    liveTasks: 0,
    gitChanges: 0,
    ...overrides,
  };
  const git = {
    getStatus: vi.fn(async (rootPath: string): Promise<GitStatus> => ({
      branch: "main",
      changes: Array.from({ length: environment.gitChanges }, () => change()),
      isRepository: true,
      rootPath,
    })),
  };
  const reportError = vi.fn();
  const project = (): AgentProjectDescriptor => ({
    rootKey: ROOT,
    rootPath: ROOT,
    ownerId: OWNER,
    label: "app",
    generation: environment.generation,
    trust: "trusted",
    origin: environment.origin,
    repositories: [
      { mapping: { rootRelativePath: "" }, repositoryRoot: ROOT, repositoryRelativePath: "" },
    ],
    isolationPolicy: environment.policy,
    leaseToken: 1,
  });
  const dependencies: AgentIsolationPreviewDependencies = {
    get projects() {
      return environment.present ? [project()] : [];
    },
    gitGateway: git,
    getRepositoryStatus: () => environment.status,
    getDirtyEditorDocumentCount: () => environment.dirtyEditors,
    liveAgentTasksInRepository: () => environment.liveTasks,
    reportError,
  };

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let current: AgentIsolationPreviewSurface | null = null;

  function Harness() {
    current = useAgentIsolationPreview(dependencies);
    return null;
  }

  act(() => root.render(createElement(Harness)));

  return {
    environment,
    git,
    reportError,
    project,
    hook(): AgentIsolationPreviewSurface {
      expect(current).not.toBeNull();
      return current as AgentIsolationPreviewSurface;
    },
    unmount(): void {
      act(() => root.unmount());
      host.remove();
    },
  };
}
