import { useCallback, useRef, type MutableRefObject } from "react";
import { parseComposerScripts, type PackageScript } from "../../domain/packageScripts";
import { joinWorkspacePath, type FileEntry } from "../../domain/workspace";
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
  readonly isOpenIntentCurrent?: () => boolean;
}

interface WorkspacePackageScriptsProjection {
  readonly composerScripts: PackageScript[];
  readonly hasArtisan: boolean;
}

interface WorkspacePackageScriptHydrationOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly readFileIfExists: (path: string) => Promise<string | null>;
  readonly setPackageScriptsByRoot: (
    update: (
      current: Record<string, WorkspacePackageScriptsProjection>,
    ) => Record<string, WorkspacePackageScriptsProjection>,
  ) => void;
}

async function loadWorkspacePackageScriptsForOpen(
  rootPath: string,
  entries: readonly FileEntry[],
  readFileIfExists: (path: string) => Promise<string | null>,
  isCurrent: () => boolean,
  publish: (rootPath: string, projection: WorkspacePackageScriptsProjection) => void,
): Promise<void> {
  const hasComposerManifest = entries.some(
    (entry) => entry.kind === "file" && entry.name === "composer.json",
  );
  const hasArtisan = entries.some((entry) => entry.kind === "file" && entry.name === "artisan");
  const composerJson = await (hasComposerManifest
    ? readFileIfExists(joinWorkspacePath(rootPath, "composer.json"))
    : Promise.resolve(null));
  if (!isCurrent()) return;
  publish(rootPath, {
    composerScripts: composerJson ? parseComposerScripts(composerJson) : [],
    hasArtisan,
  });
}

export function useWorkspacePackageScriptHydration({
  currentWorkspaceRootRef,
  readFileIfExists,
  setPackageScriptsByRoot,
}: WorkspacePackageScriptHydrationOptions) {
  return useCallback(
    (rootPath: string, entries: readonly FileEntry[], isMutationOwnerCurrent?: () => boolean) =>
      loadWorkspacePackageScriptsForOpen(
        rootPath,
        entries,
        readFileIfExists,
        () =>
          workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
          (!isMutationOwnerCurrent || isMutationOwnerCurrent()),
        (projectionRoot, projection) =>
          setPackageScriptsByRoot((current) => ({
            ...current,
            [projectionRoot]: projection,
          })),
      ),
    [currentWorkspaceRootRef, readFileIfExists, setPackageScriptsByRoot],
  );
}

export type WorkspaceOpenReceipt =
  | {
      readonly kind: "legacyWorkspaceOpenReceipt";
      readonly requestToken: number;
      readonly selectedPath: string;
    }
  | {
      readonly admissionGeneration: number;
      readonly admissionToken: number | null;
      readonly canonicalRoot: string;
      readonly descriptor: WorkspaceIdentityDescriptor;
      readonly kind: "registeredWorkspaceOpenReceipt";
      readonly requestToken: number;
      readonly selectedPath: string;
      readonly workspaceId: string;
    };

export type WorkspaceOpenOutcome =
  | { readonly kind: "cancelled"; readonly requestToken: number }
  | { readonly kind: "failed"; readonly requestToken: number }
  | { readonly kind: "opened"; readonly receipt: WorkspaceOpenReceipt }
  | { readonly kind: "stale"; readonly requestToken: number };

export interface WorkspaceStartupRestoreIntent {
  readonly generation: number;
  readonly kind: "workspaceStartupRestoreIntent";
  readonly userIntentGeneration: number;
  isCurrent(): boolean;
  openWorkspacePath(path: string): Promise<WorkspaceOpenOutcome>;
}

type CommitOpenWorkspaceRequest = (
  selectedPath: string,
  admissionGeneration: number | null,
) => void;

type PerformOpenWorkspacePath = (
  path: string,
  descriptor: WorkspaceIdentityDescriptor | null,
  adoptIdentity: (() => number | null) | null,
  requestToken: number,
  commitOpenWorkspaceRequest: CommitOpenWorkspaceRequest,
  options?: OpenWorkspacePathOptions,
) => Promise<void>;

interface WorkspaceOpenRequestLifecycleInput {
  readonly completeDeferredIdentityCleanup: () => void;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly openWorkspaceRequestInFlightTokenRef: MutableRefObject<number | null>;
  readonly openWorkspaceRequestPathRef: MutableRefObject<string | null>;
  readonly openWorkspaceRequestTokenRef: MutableRefObject<number>;
  readonly ownedWorkspaceIdentityGenerationByIdRef: MutableRefObject<Record<string, number>>;
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
  openWorkspaceRequestInFlightTokenRef,
  openWorkspaceRequestPathRef,
  openWorkspaceRequestTokenRef,
  ownedWorkspaceIdentityGenerationByIdRef,
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
  const startupRestoreGenerationRef = useRef(0);
  const activeStartupRestoreGenerationRef = useRef<number | null>(null);
  const userOpenIntentGenerationRef = useRef(0);
  const openReceiptByRequestTokenRef = useRef<Record<number, WorkspaceOpenReceipt>>({});
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
  const retireStartupRestoreIntent = useCallback(() => {
    userOpenIntentGenerationRef.current += 1;
    activeStartupRestoreGenerationRef.current = null;
  }, []);
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
      delete openReceiptByRequestTokenRef.current[requestToken];
    },
    [
      completeDeferredIdentityCleanup,
      openWorkspaceRequestInFlightTokenRef,
      pendingWorkspaceIdentityRequestTokensRef,
    ],
  );
  const recordOpenWorkspaceCommit = useCallback(
    (
      requestToken: number,
      descriptor: WorkspaceIdentityDescriptor | null,
      selectedPath: string,
      admissionGeneration: number | null,
    ) => {
      if (!workbenchMountedRef.current || openWorkspaceRequestTokenRef.current !== requestToken) {
        return;
      }
      if (!descriptor) {
        openReceiptByRequestTokenRef.current[requestToken] = {
          kind: "legacyWorkspaceOpenReceipt",
          requestToken,
          selectedPath,
        };
        return;
      }
      if (admissionGeneration === null) return;
      if (!workspaceRootKeysEqual(selectedPath, descriptor.selectedPath)) return;
      openReceiptByRequestTokenRef.current[requestToken] = {
        admissionGeneration,
        admissionToken: descriptor.admissionToken ?? null,
        canonicalRoot: descriptor.canonicalRoot,
        descriptor,
        kind: "registeredWorkspaceOpenReceipt",
        requestToken,
        selectedPath: descriptor.selectedPath,
        workspaceId: descriptor.workspaceId,
      };
    },
    [openWorkspaceRequestTokenRef, workbenchMountedRef],
  );
  const resolveOpenWorkspaceOutcome = useCallback(
    (
      requestToken: number,
      settlement: "cancelled" | "completed" | "failed",
      isOpenIntentCurrent?: () => boolean,
    ) => {
      if (
        !workbenchMountedRef.current ||
        openWorkspaceRequestTokenRef.current !== requestToken ||
        (isOpenIntentCurrent && !isOpenIntentCurrent())
      ) {
        return { kind: "stale", requestToken } as const;
      }
      const receipt = openReceiptByRequestTokenRef.current[requestToken];
      if (receipt) return { kind: "opened", receipt } as const;
      switch (settlement) {
        case "cancelled":
          return { kind: "cancelled", requestToken } as const;
        case "failed":
          return { kind: "failed", requestToken } as const;
        case "completed":
          return { kind: "stale", requestToken } as const;
      }
    },
    [openWorkspaceRequestTokenRef, workbenchMountedRef],
  );
  const requestOpenWorkspacePath = useCallback(
    async (
      path: string,
      options: OpenWorkspacePathOptions = {},
      isStartupIntentCurrent?: () => boolean,
    ): Promise<WorkspaceOpenOutcome> => {
      if (isStartupIntentCurrent && !isStartupIntentCurrent()) {
        return { kind: "stale", requestToken: openWorkspaceRequestTokenRef.current };
      }
      const requestToken = issueOpenWorkspaceRequest(path);
      const performOptions = isStartupIntentCurrent
        ? { ...options, isOpenIntentCurrent: isStartupIntentCurrent }
        : options;
      let settlement: "completed" | "failed" = "completed";
      try {
        const openPath = workspaceIdentityGateway.openPath;
        if (openPath) {
          let descriptor: WorkspaceIdentityDescriptor;
          try {
            descriptor = await openPath.call(workspaceIdentityGateway, path);
          } catch (error) {
            settlement = "failed";
            if (
              workbenchMountedRef.current &&
              openWorkspaceRequestTokenRef.current === requestToken &&
              (!isStartupIntentCurrent || isStartupIntentCurrent())
            ) {
              reportError("Workspace", error);
            }
            return resolveOpenWorkspaceOutcome(requestToken, settlement, isStartupIntentCurrent);
          }

          await withManagedWorkspaceIdentityLease(descriptor, async (adoptIdentity) => {
            if (
              !workbenchMountedRef.current ||
              openWorkspaceRequestTokenRef.current !== requestToken ||
              (isStartupIntentCurrent && !isStartupIntentCurrent())
            ) {
              return;
            }
            invalidateWorkspaceCloseOwnership(path, descriptor);
            const adoptExactIdentity = () => {
              const previousGeneration =
                ownedWorkspaceIdentityGenerationByIdRef.current[descriptor.workspaceId] ?? null;
              adoptIdentity();
              const adoptedGeneration =
                ownedWorkspaceIdentityGenerationByIdRef.current[descriptor.workspaceId] ?? null;
              if (adoptedGeneration === previousGeneration) return null;
              return adoptedGeneration;
            };
            await performOpenWorkspacePath(
              descriptor.selectedPath,
              descriptor,
              adoptExactIdentity,
              requestToken,
              (selectedPath, admissionGeneration) => {
                if (isStartupIntentCurrent && !isStartupIntentCurrent()) return;
                recordOpenWorkspaceCommit(
                  requestToken,
                  descriptor,
                  selectedPath,
                  admissionGeneration,
                );
              },
              performOptions,
            );
          });
          return resolveOpenWorkspaceOutcome(requestToken, settlement, isStartupIntentCurrent);
        }

        const cachedWorkspaceState = resolveCachedWorkspaceState(path);
        const identityDescriptor =
          workspaceIdentityByRootRef.current[path] ??
          cachedWorkspaceState?.workspaceIdentityDescriptor ??
          null;
        if (isStartupIntentCurrent && !isStartupIntentCurrent()) {
          return resolveOpenWorkspaceOutcome(requestToken, settlement, isStartupIntentCurrent);
        }
        invalidateWorkspaceCloseOwnership(path, identityDescriptor);
        await performOpenWorkspacePath(
          identityDescriptor?.selectedPath ?? path,
          identityDescriptor,
          null,
          requestToken,
          (selectedPath, admissionGeneration) => {
            if (isStartupIntentCurrent && !isStartupIntentCurrent()) return;
            recordOpenWorkspaceCommit(
              requestToken,
              identityDescriptor,
              selectedPath,
              admissionGeneration,
            );
          },
          performOptions,
        );
        return resolveOpenWorkspaceOutcome(requestToken, settlement, isStartupIntentCurrent);
      } finally {
        completeOpenWorkspaceRequest(requestToken);
      }
    },
    [
      completeOpenWorkspaceRequest,
      invalidateWorkspaceCloseOwnership,
      issueOpenWorkspaceRequest,
      openWorkspaceRequestTokenRef,
      ownedWorkspaceIdentityGenerationByIdRef,
      performOpenWorkspacePath,
      recordOpenWorkspaceCommit,
      reportError,
      resolveCachedWorkspaceState,
      resolveOpenWorkspaceOutcome,
      withManagedWorkspaceIdentityLease,
      workbenchMountedRef,
      workspaceIdentityByRootRef,
      workspaceIdentityGateway,
    ],
  );
  const requestUserOpenWorkspacePath = useCallback(
    (path: string, options: OpenWorkspacePathOptions = {}) => {
      retireStartupRestoreIntent();
      return requestOpenWorkspacePath(path, options);
    },
    [requestOpenWorkspacePath, retireStartupRestoreIntent],
  );
  const openWorkspacePath = useCallback(
    async (path: string, options: OpenWorkspacePathOptions = {}): Promise<void> => {
      await requestUserOpenWorkspacePath(path, options);
    },
    [requestUserOpenWorkspacePath],
  );
  const beginStartupRestore = useCallback((): WorkspaceStartupRestoreIntent => {
    const generation = startupRestoreGenerationRef.current + 1;
    startupRestoreGenerationRef.current = generation;
    activeStartupRestoreGenerationRef.current = generation;
    const userIntentGeneration = userOpenIntentGenerationRef.current;
    const isCurrent = () =>
      activeStartupRestoreGenerationRef.current === generation &&
      userOpenIntentGenerationRef.current === userIntentGeneration;
    return {
      generation,
      kind: "workspaceStartupRestoreIntent",
      userIntentGeneration,
      isCurrent,
      openWorkspacePath: (path) => requestOpenWorkspacePath(path, {}, isCurrent),
    };
  }, [requestOpenWorkspacePath]);
  const openWorkspace = useCallback(async () => {
    retireStartupRestoreIntent();
    const requestToken = issueOpenWorkspaceRequest(null);
    let settlement: "cancelled" | "completed" | "failed" = "completed";
    try {
      const result = await workspaceIdentityGateway.openFromPicker();
      if (result.status === "cancelled") {
        settlement = "cancelled";
        return;
      }
      await withManagedWorkspaceIdentityLease(result.descriptor, async (adoptIdentity) => {
        if (!workbenchMountedRef.current || openWorkspaceRequestTokenRef.current !== requestToken) {
          return;
        }
        invalidateWorkspaceCloseOwnership(result.descriptor.selectedPath, result.descriptor);
        const adoptExactIdentity = () => {
          const previousGeneration =
            ownedWorkspaceIdentityGenerationByIdRef.current[result.descriptor.workspaceId] ?? null;
          adoptIdentity();
          const adoptedGeneration =
            ownedWorkspaceIdentityGenerationByIdRef.current[result.descriptor.workspaceId] ?? null;
          if (adoptedGeneration === previousGeneration) return null;
          return adoptedGeneration;
        };
        await performOpenWorkspacePath(
          result.descriptor.selectedPath,
          result.descriptor,
          adoptExactIdentity,
          requestToken,
          (selectedPath, admissionGeneration) =>
            recordOpenWorkspaceCommit(
              requestToken,
              result.descriptor,
              selectedPath,
              admissionGeneration,
            ),
        );
      });
    } catch (error) {
      settlement = "failed";
      if (workbenchMountedRef.current && openWorkspaceRequestTokenRef.current === requestToken) {
        reportError("Workspace", error);
      }
    } finally {
      resolveOpenWorkspaceOutcome(requestToken, settlement);
      completeOpenWorkspaceRequest(requestToken);
    }
  }, [
    completeOpenWorkspaceRequest,
    invalidateWorkspaceCloseOwnership,
    issueOpenWorkspaceRequest,
    openWorkspaceRequestTokenRef,
    ownedWorkspaceIdentityGenerationByIdRef,
    performOpenWorkspacePath,
    recordOpenWorkspaceCommit,
    reportError,
    resolveOpenWorkspaceOutcome,
    retireStartupRestoreIntent,
    withManagedWorkspaceIdentityLease,
    workbenchMountedRef,
    workspaceIdentityGateway,
  ]);
  const openWorkspaceRoot = useCallback(
    async (path: string): Promise<boolean> => {
      const outcome = await requestUserOpenWorkspacePath(path);
      switch (outcome.kind) {
        case "opened":
          return true;
        case "cancelled":
        case "failed":
        case "stale":
          return false;
      }
    },
    [requestUserOpenWorkspacePath],
  );
  const activateWorkspaceTab = useCallback(
    async (path: string) => {
      retireStartupRestoreIntent();
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
      await requestOpenWorkspacePath(path);
    },
    [
      invalidateWorkspaceCloseOwnership,
      openWorkspaceRequestInFlightTokenRef,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      requestOpenWorkspacePath,
      retireStartupRestoreIntent,
      workspaceIdentityByRootRef,
      workspaceRoot,
    ],
  );

  return {
    activateWorkspaceTab,
    beginStartupRestore,
    beginWorkspaceClose,
    invalidateWorkspaceCloseOwnership,
    openWorkspace,
    openWorkspacePath,
    openWorkspaceRoot,
  } as const;
}
