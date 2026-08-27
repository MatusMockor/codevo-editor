import { useCallback, type MutableRefObject } from "react";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type {
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityGateway,
} from "../workspaceIdentityGatewayPort";
import type { LatestWorkspaceRequestTokenRegistry } from "./workspaceRequestTokenRegistry";

interface WorkspaceCloseOwnership {
  readonly isCurrent: () => boolean;
}

interface OpenWorkspacePathOptions {
  readonly cachePreviousWorkspace?: boolean;
}

type PerformOpenWorkspacePath = (
  path: string,
  descriptor: WorkspaceIdentityDescriptor | null,
  adoptIdentity: (() => void) | null,
  requestToken: number,
  options?: OpenWorkspacePathOptions,
) => Promise<void>;

interface WorkspaceOpenRequestLifecycleInput {
  readonly completeDeferredIdentityCleanup: () => void;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly openWorkspaceRequestInFlightTokenRef: MutableRefObject<number | null>;
  readonly openWorkspaceRequestPathRef: MutableRefObject<string | null>;
  readonly openWorkspaceRequestTokenRef: MutableRefObject<number>;
  readonly pendingWorkspaceIdentityRequestTokensRef: MutableRefObject<LatestWorkspaceRequestTokenRegistry>;
  readonly performOpenWorkspacePath: PerformOpenWorkspacePath;
  readonly reportError: (source: string, error: unknown) => void;
  readonly resolveCachedWorkspaceState: (rootPath: string) => Readonly<{
    workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
  }> | null;
  readonly withManagedWorkspaceIdentityLease: (
    descriptor: WorkspaceIdentityDescriptor,
    useLease: (adopt: () => void) => Promise<void>,
  ) => Promise<void>;
  readonly workbenchMountedRef: MutableRefObject<boolean>;
  readonly workspaceCloseGenerationByRootRef: MutableRefObject<Record<string, number>>;
  readonly workspaceCloseOwnershipByKeyRef: MutableRefObject<Record<string, number>>;
  readonly workspaceCloseOwnershipGenerationRef: MutableRefObject<number>;
  readonly workspaceIdentityByRootRef: MutableRefObject<
    Record<string, WorkspaceIdentityDescriptor>
  >;
  readonly workspaceIdentityGateway: WorkspaceIdentityGateway;
  readonly workspaceRoot: string | null;
}

export function useWorkspaceOpenRequestLifecycle({
  completeDeferredIdentityCleanup,
  currentWorkspaceRootRef,
  openWorkspaceRequestInFlightTokenRef,
  openWorkspaceRequestPathRef,
  openWorkspaceRequestTokenRef,
  pendingWorkspaceIdentityRequestTokensRef,
  performOpenWorkspacePath,
  reportError,
  resolveCachedWorkspaceState,
  withManagedWorkspaceIdentityLease,
  workbenchMountedRef,
  workspaceCloseGenerationByRootRef,
  workspaceCloseOwnershipByKeyRef,
  workspaceCloseOwnershipGenerationRef,
  workspaceIdentityByRootRef,
  workspaceIdentityGateway,
  workspaceRoot,
}: WorkspaceOpenRequestLifecycleInput) {
  const advanceWorkspaceCloseOwnership = useCallback(
    (path: string | null, identity: WorkspaceIdentityDescriptor | null) => {
      const generation = workspaceCloseOwnershipGenerationRef.current + 1;
      workspaceCloseOwnershipGenerationRef.current = generation;
      const rootPaths = [path, identity?.selectedPath ?? null, identity?.canonicalRoot ?? null];
      const keys = rootPaths.flatMap((rootPath) => {
        const rootKey = normalizedWorkspaceRootKey(rootPath);
        if (!rootKey) return [];
        workspaceCloseGenerationByRootRef.current[rootKey] =
          (workspaceCloseGenerationByRootRef.current[rootKey] ?? 0) + 1;
        return [`root:${rootKey}`];
      });
      if (identity) keys.push(`workspace:${identity.workspaceId}`);

      const uniqueKeys = [...new Set(keys)];
      for (const key of uniqueKeys) {
        workspaceCloseOwnershipByKeyRef.current[key] = generation;
      }
      return { generation, keys: uniqueKeys };
    },
    [
      workspaceCloseGenerationByRootRef,
      workspaceCloseOwnershipByKeyRef,
      workspaceCloseOwnershipGenerationRef,
    ],
  );
  const invalidateWorkspaceCloseOwnership = useCallback(
    (path: string | null, identity: WorkspaceIdentityDescriptor | null) => {
      advanceWorkspaceCloseOwnership(path, identity);
    },
    [advanceWorkspaceCloseOwnership],
  );
  const beginWorkspaceClose = useCallback(
    (rootPath: string, identity: WorkspaceIdentityDescriptor | null): WorkspaceCloseOwnership => {
      const { generation, keys } = advanceWorkspaceCloseOwnership(rootPath, identity);
      return {
        isCurrent: () =>
          keys.every((key) => workspaceCloseOwnershipByKeyRef.current[key] === generation),
      };
    },
    [advanceWorkspaceCloseOwnership, workspaceCloseOwnershipByKeyRef],
  );
  const issueOpenWorkspaceRequest = useCallback(
    (path: string | null) => {
      const identity = path ? (workspaceIdentityByRootRef.current[path] ?? null) : null;
      invalidateWorkspaceCloseOwnership(path, identity);
      const requestToken = openWorkspaceRequestTokenRef.current + 1;
      openWorkspaceRequestTokenRef.current = requestToken;
      openWorkspaceRequestPathRef.current = path;
      openWorkspaceRequestInFlightTokenRef.current = requestToken;
      pendingWorkspaceIdentityRequestTokensRef.current.issue(requestToken);
      return requestToken;
    },
    [
      invalidateWorkspaceCloseOwnership,
      openWorkspaceRequestInFlightTokenRef,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      pendingWorkspaceIdentityRequestTokensRef,
      workspaceIdentityByRootRef,
    ],
  );
  const completeOpenWorkspaceRequest = useCallback(
    (requestToken: number) => {
      pendingWorkspaceIdentityRequestTokensRef.current.complete(requestToken);
      completeDeferredIdentityCleanup();
      if (openWorkspaceRequestInFlightTokenRef.current === requestToken) {
        openWorkspaceRequestInFlightTokenRef.current = null;
      }
    },
    [
      completeDeferredIdentityCleanup,
      openWorkspaceRequestInFlightTokenRef,
      pendingWorkspaceIdentityRequestTokensRef,
    ],
  );
  const openWorkspacePath = useCallback(
    (path: string, options: OpenWorkspacePathOptions = {}): Promise<void> => {
      const requestToken = issueOpenWorkspaceRequest(path);
      const request = (async () => {
        const openPath = workspaceIdentityGateway.openPath;
        if (openPath) {
          let descriptor: WorkspaceIdentityDescriptor;
          try {
            descriptor = await openPath.call(workspaceIdentityGateway, path);
          } catch (error) {
            if (openWorkspaceRequestTokenRef.current === requestToken) {
              reportError("Workspace", error);
            }
            return;
          }

          await withManagedWorkspaceIdentityLease(descriptor, async (adoptIdentity) => {
            if (
              !workbenchMountedRef.current ||
              openWorkspaceRequestTokenRef.current !== requestToken
            ) {
              return;
            }
            invalidateWorkspaceCloseOwnership(path, descriptor);
            await performOpenWorkspacePath(
              descriptor.selectedPath,
              descriptor,
              adoptIdentity,
              requestToken,
              options,
            );
          });
          return;
        }

        const cachedWorkspaceState = resolveCachedWorkspaceState(path);
        const identityDescriptor =
          workspaceIdentityByRootRef.current[path] ??
          cachedWorkspaceState?.workspaceIdentityDescriptor ??
          null;
        invalidateWorkspaceCloseOwnership(path, identityDescriptor);
        await performOpenWorkspacePath(
          identityDescriptor?.selectedPath ?? path,
          identityDescriptor,
          null,
          requestToken,
          options,
        );
      })();
      return request.finally(() => completeOpenWorkspaceRequest(requestToken));
    },
    [
      completeOpenWorkspaceRequest,
      invalidateWorkspaceCloseOwnership,
      issueOpenWorkspaceRequest,
      openWorkspaceRequestTokenRef,
      performOpenWorkspacePath,
      reportError,
      resolveCachedWorkspaceState,
      withManagedWorkspaceIdentityLease,
      workbenchMountedRef,
      workspaceIdentityByRootRef,
      workspaceIdentityGateway,
    ],
  );
  const openWorkspace = useCallback(async () => {
    const requestToken = issueOpenWorkspaceRequest(null);
    try {
      const result = await workspaceIdentityGateway.openFromPicker();
      if (result.status === "cancelled") return;
      await withManagedWorkspaceIdentityLease(result.descriptor, async (adoptIdentity) => {
        if (!workbenchMountedRef.current || openWorkspaceRequestTokenRef.current !== requestToken) {
          return;
        }
        invalidateWorkspaceCloseOwnership(result.descriptor.selectedPath, result.descriptor);
        await performOpenWorkspacePath(
          result.descriptor.selectedPath,
          result.descriptor,
          adoptIdentity,
          requestToken,
        );
      });
    } catch (error) {
      if (openWorkspaceRequestTokenRef.current === requestToken) {
        reportError("Workspace", error);
      }
    } finally {
      completeOpenWorkspaceRequest(requestToken);
    }
  }, [
    completeOpenWorkspaceRequest,
    invalidateWorkspaceCloseOwnership,
    issueOpenWorkspaceRequest,
    openWorkspaceRequestTokenRef,
    performOpenWorkspacePath,
    reportError,
    withManagedWorkspaceIdentityLease,
    workbenchMountedRef,
    workspaceIdentityGateway,
  ]);
  const openWorkspaceRoot = useCallback(
    async (path: string): Promise<boolean> => {
      await openWorkspacePath(path);
      return workspaceRootKeysEqual(currentWorkspaceRootRef.current, path);
    },
    [currentWorkspaceRootRef, openWorkspacePath],
  );
  const activateWorkspaceTab = useCallback(
    async (path: string) => {
      invalidateWorkspaceCloseOwnership(path, workspaceIdentityByRootRef.current[path] ?? null);
      if (workspaceRootKeysEqual(path, workspaceRoot)) {
        const inFlightToken = openWorkspaceRequestInFlightTokenRef.current;
        if (
          inFlightToken === openWorkspaceRequestTokenRef.current &&
          !workspaceRootKeysEqual(openWorkspaceRequestPathRef.current, path)
        ) {
          openWorkspaceRequestTokenRef.current += 1;
          openWorkspaceRequestPathRef.current = path;
          openWorkspaceRequestInFlightTokenRef.current = null;
        }
        return;
      }
      await openWorkspacePath(path);
    },
    [
      invalidateWorkspaceCloseOwnership,
      openWorkspacePath,
      openWorkspaceRequestInFlightTokenRef,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      workspaceIdentityByRootRef,
      workspaceRoot,
    ],
  );

  return {
    activateWorkspaceTab,
    beginWorkspaceClose,
    invalidateWorkspaceCloseOwnership,
    openWorkspace,
    openWorkspacePath,
    openWorkspaceRoot,
  } as const;
}
