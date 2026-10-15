import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { AppSettings } from "../../domain/settings";
import type { WorkspaceFileChangeGateway } from "../../domain/workspaceFileChange";
import type {
  ProjectRuntimeStopResult,
  WorkspaceRuntimeLifecycleGateway,
} from "../../domain/workspaceRuntimeLifecycle";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { CloseCoordinator } from "../closeCoordinator";
import { RegisteredWorkspaceCloseCoordinator } from "../registeredWorkspaceCloseCoordinator";
import type { AgentProjectsSurface } from "../useAgentProjects";
import {
  useWorkbenchWorkspaceTabCloseCoordinator,
  type WorkspaceCloseOwnership,
  type WorkspaceTabCloseSessionPort,
} from "../useWorkbenchWorkspaceTabCloseCoordinator";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import { createCancellableWorkspaceRetryScheduler } from "../workspaceReleaseRetry";
import {
  stopAgentWorkspaceRuntimes,
  type AgentWorkspaceRuntimeGateways,
} from "./agentWorkspaceRuntimes";
import { disposeAgentWorkspaceTab } from "./agentWorkspaceTabDisposal";
import {
  useAgentApplicationShutdown,
  type AgentNativeShutdownPort,
} from "./useAgentApplicationShutdown";
import type { AgentWorkspaceAuthority } from "./useAgentWorkspaceAuthority";
import type { AgentWorkspaceTransition } from "./useAgentWorkspaceTransition";

export interface AgentCloseLifecycleOptions {
  readonly appSettingsRef: MutableRefObject<AppSettings>;
  readonly authority: AgentWorkspaceAuthority;
  readonly fileChangeGateway?: Pick<WorkspaceFileChangeGateway, "releaseRoot">;
  readonly forgetWorkspaceSettings: (canonicalKey: string) => void;
  readonly nativeShutdown?: AgentNativeShutdownPort;
  readonly persistAppSettings: (settings: AppSettings) => Promise<void>;
  readonly prepareAgentQuit: (budgetMs: number) => Promise<void>;
  readonly projects: Pick<AgentProjectsSurface, "closeWorkspaceProject">;
  readonly reportError: (source: string, error: unknown) => void;
  readonly runtimeGateways: AgentWorkspaceRuntimeGateways;
  readonly runtimeLifecycleGateway: Pick<
    WorkspaceRuntimeLifecycleGateway,
    "disposeRegisteredWorkspace"
  >;
  readonly transition: Pick<
    AgentWorkspaceTransition,
    "beginWorkspaceClose" | "clearActiveWorkspace" | "openWorkspacePath"
  >;
}

type CloseScopeGuard = () => boolean;

export function useAgentCloseLifecycle({
  appSettingsRef,
  authority,
  fileChangeGateway,
  forgetWorkspaceSettings,
  nativeShutdown,
  persistAppSettings,
  prepareAgentQuit,
  projects,
  reportError,
  runtimeGateways,
  runtimeLifecycleGateway,
  transition,
}: AgentCloseLifecycleOptions) {
  const {
    currentWorkspaceRootRef,
    managedIdentity,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    releaseWorkspaceTrustOwner,
    resolveWorkspaceRuntimeOwner,
    retireWorkspaceRuntimeOwnerClaim,
    workspaceIdentityByRootRef,
    workspaceRuntimeOwnerByTabRef,
    workspaceRuntimeOwnerClaimsRef,
    workspaceRuntimeRootByTabRef,
  } = authority;
  const { beginWorkspaceClose, clearActiveWorkspace, openWorkspacePath } = transition;
  const { closeApplicationWindow, quitApplication } = useAgentApplicationShutdown({
    nativeShutdown,
    prepareAgentQuit,
    reportError,
  });
  const activeRef = useRef(true);
  const releaseRetryScheduler = useMemo(() => createCancellableWorkspaceRetryScheduler(), []);
  const registeredClose = useMemo(
    () =>
      new RegisteredWorkspaceCloseCoordinator(new CloseCoordinator(), releaseRetryScheduler.delay),
    [releaseRetryScheduler],
  );

  useEffect(() => {
    activeRef.current = true;
    releaseRetryScheduler.activate();
    return () => {
      activeRef.current = false;
      releaseRetryScheduler.cancelAll();
    };
  }, [releaseRetryScheduler]);

  const stopRuntimesForClose = useCallback(
    async (
      rootPath: string,
      ownership: WorkspaceCloseOwnership | null,
    ): Promise<ProjectRuntimeStopResult> => {
      if (ownership && !ownership.isCurrent()) return "stale";
      const identity = workspaceIdentityByRootRef.current[rootPath];
      const runtimeRootPath =
        workspaceRuntimeRootByTabRef.current[rootPath] ?? identity?.selectedPath ?? rootPath;
      const owner = workspaceRuntimeOwnerByTabRef.current[rootPath] ?? null;
      const generation = owner
        ? workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey)
        : undefined;
      return stopAgentWorkspaceRuntimes(runtimeGateways, {
        isCurrent: () =>
          (!ownership || ownership.isCurrent()) &&
          (workspaceRuntimeOwnerByTabRef.current[rootPath] ?? null) === owner &&
          (!owner ||
            workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey) === generation),
        reportError: (error) => reportError("Runtime cleanup", error),
        rootPath: runtimeRootPath,
      });
    },
    [
      reportError,
      runtimeGateways,
      workspaceIdentityByRootRef,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeOwnerClaimsRef,
      workspaceRuntimeRootByTabRef,
    ],
  );

  const forgetRuntimeOwner = useCallback(
    (rootPath: string) => {
      const owner = workspaceRuntimeOwnerByTabRef.current[rootPath];
      if (owner) {
        retireWorkspaceRuntimeOwnerClaim(
          owner.ownerKey,
          workspaceRuntimeOwnerClaimsRef.current.generationFor(owner.ownerKey),
        );
      }
      delete workspaceRuntimeOwnerByTabRef.current[rootPath];
    },
    [
      retireWorkspaceRuntimeOwnerClaim,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeOwnerClaimsRef,
    ],
  );

  const disposeWorkspaceTabResources = useCallback(
    (
      tabPath: string,
      targetRootPath: string,
      identity: WorkspaceIdentityDescriptor | null,
      ownership: WorkspaceCloseOwnership,
      scopeIsCurrent: CloseScopeGuard,
      legacyOwnership: boolean,
    ) =>
      disposeAgentWorkspaceTab(
        {
          closeAgents: async (descriptor, isCurrent) =>
            projects.closeWorkspaceProject
              ? projects.closeWorkspaceProject(descriptor, isCurrent)
              : { status: "closed", settlement: settledAgentProjectClose },
          disposeRegisteredWorkspace: async (target) => {
            if (!runtimeLifecycleGateway.disposeRegisteredWorkspace) {
              throw new Error("Registered workspace disposal is unavailable.");
            }
            return runtimeLifecycleGateway.disposeRegisteredWorkspace(target);
          },
          forgetRuntimeOwner,
          identities: () => workspaceIdentityByRootRef.current,
          prepareIdentitySettlement: managedIdentity.prepareBackendClosedSettlement,
          registeredClose,
          releaseResourceRoot: (rootPath) => releaseFileChangeRoot(fileChangeGateway, rootPath),
          reportError,
          stopRuntimes: stopRuntimesForClose,
          unregisterWorkspace: managedIdentity.releaseOwned,
        },
        {
          closeIsCurrent: () => activeRef.current && ownership.isCurrent() && scopeIsCurrent(),
          identity,
          legacyOwnership,
          ownership,
          tabPath,
          targetRootPath,
        },
      ),
    [
      fileChangeGateway,
      forgetRuntimeOwner,
      managedIdentity,
      projects,
      registeredClose,
      reportError,
      runtimeLifecycleGateway,
      stopRuntimesForClose,
      workspaceIdentityByRootRef,
    ],
  );

  const prepareRetainedStateCleanup = useCallback(
    (path: string, identity: WorkspaceIdentityDescriptor | null) => {
      const resolvedTabPath = identity?.selectedPath ?? path;
      const runtimeRootPath =
        workspaceRuntimeRootByTabRef.current[resolvedTabPath] ?? resolvedTabPath;
      const runtimeOwner =
        resolveWorkspaceRuntimeOwner(resolvedTabPath) ?? resolveWorkspaceRuntimeOwner(path);
      const roots = [path, resolvedTabPath, runtimeRootPath];
      return () => {
        const replaced = identity
          ? Object.values(workspaceIdentityByRootRef.current).some(
              (candidate) =>
                candidate !== identity &&
                (candidate.workspaceId === identity.workspaceId ||
                  workspaceRootKeysEqual(candidate.selectedPath, identity.selectedPath) ||
                  workspaceRootKeysEqual(candidate.canonicalRoot, identity.canonicalRoot)),
            )
          : false;
        const stillOpen = appSettingsRef.current.workspaceTabs.some((tabPath) =>
          roots.some((root) => workspaceRootKeysEqual(tabPath, root)),
        );
        if (replaced || stillOpen) return;
        forgetWorkspaceSettings(identity?.canonicalRoot ?? path);
        for (const root of roots) {
          if (workspaceRuntimeRootByTabRef.current[root] === runtimeRootPath) {
            delete workspaceRuntimeRootByTabRef.current[root];
          }
          if (workspaceRuntimeOwnerByTabRef.current[root] === runtimeOwner) {
            delete workspaceRuntimeOwnerByTabRef.current[root];
          }
        }
        if (runtimeOwner) releaseWorkspaceTrustOwner(runtimeOwner.ownerKey);
      };
    },
    [
      appSettingsRef,
      forgetWorkspaceSettings,
      releaseWorkspaceTrustOwner,
      resolveWorkspaceRuntimeOwner,
      workspaceIdentityByRootRef,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeRootByTabRef,
    ],
  );

  const workspaceCloseSession = useMemo<WorkspaceTabCloseSessionPort>(
    () => ({ current: () => ({ activeRoot: currentWorkspaceRootRef.current }) }),
    [currentWorkspaceRootRef],
  );

  const closeWorkspaceTab = useWorkbenchWorkspaceTabCloseCoordinator({
    activeRef,
    appSettingsRef,
    clearActiveWorkspace,
    commitWorkspaceClose: beginWorkspaceClose,
    disposeWorkspaceTabResources,
    openWorkspacePath,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    persistAppSettings,
    prepareRetainedStateCleanup,
    reportError,
    workspaceCloseSession,
    workspaceIdentityByRootRef,
  });

  return { closeApplicationWindow, closeWorkspaceTab, quitApplication };
}

export type AgentCloseLifecycle = ReturnType<typeof useAgentCloseLifecycle>;

const settledAgentProjectClose = {
  complete: async () => undefined,
  finalizeBackendClosed: () => undefined,
};

function releaseFileChangeRoot(
  gateway: Pick<WorkspaceFileChangeGateway, "releaseRoot"> | undefined,
  rootPath: string,
): void {
  if (!gateway?.releaseRoot) return;
  try {
    void Promise.resolve(gateway.releaseRoot(rootPath)).catch(() => undefined);
  } catch {
    return;
  }
}
