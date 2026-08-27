// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings, type AppSettings } from "../domain/settings";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import {
  useWorkbenchWorkspaceTabCloseCoordinator,
  workspaceIdentityForPaths,
  type WorkbenchWorkspaceTabCloseCoordinatorDependencies,
  type WorkspaceTabDisposalResult,
} from "./useWorkbenchWorkspaceTabCloseCoordinator";

const WORKSPACE_A = "/workspace-a";
const WORKSPACE_A_CANONICAL = "/real/workspace-a";
const WORKSPACE_B = "/workspace-b";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function descriptor(): WorkspaceIdentityDescriptor {
  return {
    workspaceId: "workspace-a",
    selectedPath: WORKSPACE_A,
    canonicalRoot: WORKSPACE_A_CANONICAL,
    caseSensitive: true,
    unicodeNormalizationPolicy: "preserved",
    policy: { caseSensitive: true, unicodeNormalization: "none" },
    admissionToken: 7,
  };
}

function renderCoordinator(
  overrides: Partial<WorkbenchWorkspaceTabCloseCoordinatorDependencies> = {},
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const appSettingsRef: { current: AppSettings } = {
    current: {
      ...defaultAppSettings(),
      recentWorkspacePath: WORKSPACE_A,
      workspaceTabs: [WORKSPACE_A, WORKSPACE_B],
    },
  };
  const identity = descriptor();
  const workspaceIdentityByRootRef = {
    current: {
      [WORKSPACE_A]: identity,
      [WORKSPACE_A_CANONICAL]: identity,
    },
  };
  const activeRef = { current: true };
  const authority = { current: true };
  const scopeAuthority = { current: true };
  const persistAppSettings = vi.fn(async (settings: AppSettings) => {
    appSettingsRef.current = settings;
  });
  const disposeWorkspaceTabResources = vi.fn(
    async (): Promise<WorkspaceTabDisposalResult> => "disposed",
  );
  const openWorkspacePath = vi.fn(async () => undefined);
  const clearActiveWorkspace = vi.fn(async () => undefined);
  const cleanup = vi.fn();
  let closeWorkspaceTab: ((path: string) => Promise<void>) | null = null;

  function Harness() {
    closeWorkspaceTab = useWorkbenchWorkspaceTabCloseCoordinator({
      activeRef,
      appSettingsRef,
      workspaceIdentityByRootRef,
      openWorkspaceRequestPathRef: { current: null },
      openWorkspaceRequestTokenRef: { current: 0 },
      openFileRequestTokenRef: { current: 0 },
      gitDiffRequestTokenRef: { current: 0 },
      editorGitBaselineRequestTokenRef: { current: 0 },
      workspaceCloseSession: {
        current: () => ({ activeRoot: WORKSPACE_A, needsAttention: false }),
      },
      captureDirtyCloseTargets: () => [],
      executeDirtyClose: async (_capture, _roots, _scope, commit) =>
        (await commit(() => scopeAuthority.current)) ? "closed" : "stale",
      commitWorkspaceClose: () => ({ isCurrent: () => authority.current }),
      persistAppSettings,
      persistWorkspaceSession: async () => undefined,
      disposeWorkspaceTabResources,
      openWorkspacePath,
      clearActiveWorkspace,
      prepareRetainedStateCleanup: () => cleanup,
      reportError: vi.fn(),
      ...overrides,
    });
    return null;
  }

  act(() => root.render(<Harness />));
  return {
    activeRef,
    appSettingsRef,
    authority,
    cleanup,
    clearActiveWorkspace,
    closeWorkspaceTab: (path: string) => closeWorkspaceTab!(path),
    disposeWorkspaceTabResources,
    openWorkspacePath,
    persistAppSettings,
    scopeAuthority,
    unmount: () => act(() => root.unmount()),
    workspaceIdentityByRootRef,
  };
}

describe("useWorkbenchWorkspaceTabCloseCoordinator", () => {
  it("coalesces selected and canonical aliases into one close transaction", async () => {
    const disposal = deferred<WorkspaceTabDisposalResult>();
    const disposeWorkspaceTabResources = vi.fn(() => disposal.promise);
    const harness = renderCoordinator({ disposeWorkspaceTabResources });

    const selectedClose = harness.closeWorkspaceTab(WORKSPACE_A);
    const canonicalClose = harness.closeWorkspaceTab(WORKSPACE_A_CANONICAL);
    await vi.waitFor(() => expect(disposeWorkspaceTabResources).toHaveBeenCalledOnce());
    disposal.resolve("disposed");
    await act(async () => Promise.all([selectedClose, canonicalClose]));

    expect(harness.openWorkspacePath).toHaveBeenCalledOnce();
    expect(harness.cleanup).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("does not publish a completed switch after ownership changes while next-tab open is pending", async () => {
    const opening = deferred<void>();
    const openWorkspacePath = vi.fn(() => opening.promise);
    const harness = renderCoordinator({ openWorkspacePath });

    const closing = harness.closeWorkspaceTab(WORKSPACE_A);
    await vi.waitFor(() =>
      expect(openWorkspacePath).toHaveBeenCalledWith(WORKSPACE_B, {
        cachePreviousWorkspace: false,
      }),
    );
    harness.authority.current = false;
    opening.resolve();
    await act(async () => closing);

    expect(harness.cleanup).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("closes an inactive tab without opening another workspace", async () => {
    const harness = renderCoordinator({
      workspaceCloseSession: {
        current: () => ({ activeRoot: WORKSPACE_B, needsAttention: false }),
      },
    });

    await act(async () => harness.closeWorkspaceTab(WORKSPACE_A));

    expect(harness.openWorkspacePath).not.toHaveBeenCalled();
    expect(harness.appSettingsRef.current.workspaceTabs).toEqual([WORKSPACE_B]);
    expect(harness.appSettingsRef.current.recentWorkspacePath).toBe(WORKSPACE_B);
    expect(harness.cleanup).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("compensates settings and keeps retained state after an incomplete backend close", async () => {
    const harness = renderCoordinator({
      disposeWorkspaceTabResources: vi.fn(
        async (): Promise<WorkspaceTabDisposalResult> => "runtime-stop-incomplete",
      ),
    });

    await act(async () => harness.closeWorkspaceTab(WORKSPACE_A));

    expect(harness.persistAppSettings).toHaveBeenCalledTimes(2);
    expect(harness.appSettingsRef.current.workspaceTabs).toContain(WORKSPACE_A);
    expect(harness.cleanup).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("does not reopen after unmount when backend closure settles stale", async () => {
    const disposal = deferred<WorkspaceTabDisposalResult>();
    const harness = renderCoordinator({
      disposeWorkspaceTabResources: vi.fn(() => disposal.promise),
    });
    const closing = harness.closeWorkspaceTab(WORKSPACE_A);
    await vi.waitFor(() => expect(harness.persistAppSettings).toHaveBeenCalledOnce());
    harness.activeRef.current = false;
    disposal.resolve("backend-closed-local-stale");
    await act(async () => closing);

    expect(harness.openWorkspacePath).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not overwrite a same-path replacement after authority transfer", async () => {
    const persistence = deferred<void>();
    const replacement: AppSettings = {
      ...defaultAppSettings(),
      workspaceTabs: [WORKSPACE_A],
    };
    const harness = renderCoordinator({
      persistAppSettings: vi.fn(async () => persistence.promise),
    });
    const closing = harness.closeWorkspaceTab(WORKSPACE_A);
    await Promise.resolve();
    harness.authority.current = false;
    harness.appSettingsRef.current = replacement;
    persistence.resolve();
    await act(async () => closing);

    expect(harness.appSettingsRef.current).toBe(replacement);
    expect(harness.disposeWorkspaceTabResources).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("does not let a delayed A1 close retire an A2 admission after switching through B", async () => {
    const disposal = deferred<WorkspaceTabDisposalResult>();
    const disposeWorkspaceTabResources = vi.fn(() => disposal.promise);
    const harness = renderCoordinator({
      disposeWorkspaceTabResources,
    });
    const closing = harness.closeWorkspaceTab(WORKSPACE_A);
    await vi.waitFor(() => expect(disposeWorkspaceTabResources).toHaveBeenCalledOnce());

    const replacement = { ...descriptor(), admissionToken: 8 };
    harness.authority.current = false;
    harness.workspaceIdentityByRootRef.current = {
      [WORKSPACE_A]: replacement,
      [WORKSPACE_A_CANONICAL]: replacement,
    };
    harness.appSettingsRef.current = {
      ...defaultAppSettings(),
      recentWorkspacePath: WORKSPACE_A,
      workspaceTabs: [WORKSPACE_B, WORKSPACE_A],
    };
    disposal.resolve("stale");
    await act(async () => closing);

    expect(harness.appSettingsRef.current.workspaceTabs).toEqual([WORKSPACE_B, WORKSPACE_A]);
    expect(harness.workspaceIdentityByRootRef.current[WORKSPACE_A]).toBe(replacement);
    expect(harness.cleanup).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("preserves unrelated settings updates while compensating a failed close", async () => {
    const disposal = deferred<WorkspaceTabDisposalResult>();
    const harness = renderCoordinator({
      disposeWorkspaceTabResources: vi.fn(() => disposal.promise),
    });
    const closing = harness.closeWorkspaceTab(WORKSPACE_A);
    await vi.waitFor(() => expect(harness.persistAppSettings).toHaveBeenCalledOnce());
    harness.appSettingsRef.current = {
      ...harness.appSettingsRef.current,
      agentAppearanceVariant: "paper",
      workspaceTabs: [WORKSPACE_B, "/workspace-c"],
    };
    disposal.resolve("runtime-stop-incomplete");
    await act(async () => closing);

    expect(harness.appSettingsRef.current.agentAppearanceVariant).toBe("paper");
    expect(harness.appSettingsRef.current.workspaceTabs).toEqual([
      WORKSPACE_A,
      WORKSPACE_B,
      "/workspace-c",
    ]);
    harness.unmount();
  });

  it("fails closed when dirty-close scope changes during inactive disposal", async () => {
    const disposal = deferred<WorkspaceTabDisposalResult>();
    const harness = renderCoordinator({
      disposeWorkspaceTabResources: vi.fn(() => disposal.promise),
      workspaceCloseSession: {
        current: () => ({ activeRoot: WORKSPACE_B, needsAttention: false }),
      },
    });
    const closing = harness.closeWorkspaceTab(WORKSPACE_A);
    await vi.waitFor(() => expect(harness.persistAppSettings).toHaveBeenCalledOnce());
    harness.scopeAuthority.current = false;
    disposal.resolve("backend-closed-local-stale");
    await act(async () => closing);

    expect(harness.openWorkspacePath).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("resolves a normalized alias to the matching identity among multiple workspaces", () => {
    const workspaceB = {
      ...descriptor(),
      workspaceId: "workspace-b",
      selectedPath: WORKSPACE_B,
      canonicalRoot: "/real/workspace-b",
    };
    const workspaceA = descriptor();
    expect(
      workspaceIdentityForPaths({ [WORKSPACE_B]: workspaceB, [WORKSPACE_A]: workspaceA }, [
        `${WORKSPACE_A_CANONICAL}/`,
      ]),
    ).toBe(workspaceA);
  });
});
