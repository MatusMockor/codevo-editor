import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { GitChangedFile, GitChangeStatus, GitGateway } from "../../domain/git";
import type { WorkspaceSettings } from "../../domain/settings";
import type { WorkspaceFileChangeEvent } from "../../domain/workspaceFileChange";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { useGitOperationCurrency } from "../useGitOperationCurrency";
import { useGitStatusSurface } from "../useGitStatusSurface";
import type { AgentWorkspaceGitDiscoveryPort } from "./useAgentWorkspaceTransition";

interface AgentGitDiscoveryTarget {
  readonly reset: (rootPath: string | null) => void;
  readonly runDiscovery: (rootPath: string, settings: WorkspaceSettings) => Promise<void>;
}

export interface AgentGitDiscoveryBridge {
  readonly demandRef: MutableRefObject<boolean>;
  readonly discoveredRootRef: MutableRefObject<string | null>;
  readonly port: AgentWorkspaceGitDiscoveryPort;
  readonly targetRef: MutableRefObject<AgentGitDiscoveryTarget>;
}

const UNBOUND_GIT_DISCOVERY_TARGET: AgentGitDiscoveryTarget = {
  reset: () => undefined,
  runDiscovery: async () => undefined,
};

export function useAgentGitDiscoveryBridge(): AgentGitDiscoveryBridge {
  const demandRef = useRef(false);
  const discoveredRootRef = useRef<string | null>(null);
  const targetRef = useRef(UNBOUND_GIT_DISCOVERY_TARGET);
  const port = useMemo<AgentWorkspaceGitDiscoveryPort>(
    () => ({
      isDemanded: () => demandRef.current,
      reset: (rootPath) => {
        discoveredRootRef.current = null;
        targetRef.current.reset(rootPath);
      },
      runDiscovery: (rootPath, settings) => {
        discoveredRootRef.current = rootPath;
        return targetRef.current.runDiscovery(rootPath, settings);
      },
    }),
    [],
  );
  return useMemo(() => ({ demandRef, discoveredRootRef, port, targetRef }), [port]);
}

export interface AgentGitStatusOptions {
  readonly bridge: AgentGitDiscoveryBridge;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly demanded: boolean;
  readonly discoverGitRepositories: () => Promise<void>;
  readonly gitGateway: GitGateway;
  readonly reportError: (source: string, error: unknown) => void;
  readonly reportErrorForActiveWorkspaceRoot: (
    rootPath: string,
    source: string,
    error: unknown,
  ) => void;
  readonly workspaceRoot: string | null;
}

const NO_GIT_DIFF_DOCUMENT = () => null;
const IGNORE_GIT_DIFF_RECONCILE = () => undefined;
const IGNORE_GIT_MESSAGE = () => undefined;
export const GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS = 120;
const EMPTY_FILE_STATUSES: Readonly<Record<string, GitChangeStatus>> = Object.freeze({});

export function useAgentGitStatus({
  bridge,
  currentWorkspaceRootRef,
  demanded,
  discoverGitRepositories,
  gitGateway,
  reportError,
  reportErrorForActiveWorkspaceRoot,
  workspaceRoot,
}: AgentGitStatusOptions) {
  const gitRepositoryDiscoveryRequestTokenRef = useRef(0);
  const gitOperationCurrency = useGitOperationCurrency(workspaceRoot);
  const status = useGitStatusSurface({
    activePath: null,
    currentWorkspaceRootRef,
    getSelectedGitDiffDocument: NO_GIT_DIFF_DOCUMENT,
    gitGateway,
    gitOperationCurrency,
    gitRepositoryDiscoveryRequestTokenRef,
    reconcileSelectedGitDiffPreviewForRepository: IGNORE_GIT_DIFF_RECONCILE,
    reportError,
    reportErrorForActiveWorkspaceRoot,
    setMessage: IGNORE_GIT_MESSAGE,
    workspaceRoot,
  });
  const { refreshGitStatus, resetGitStatusSurface, runGitRepositoryDiscovery } = status;
  bridge.targetRef.current = {
    reset: (rootPath) => resetGitStatusSurface(rootPath ?? undefined),
    runDiscovery: runGitRepositoryDiscovery,
  };

  useEffect(() => {
    if (!demanded || workspaceRoot === null) return;
    if (workspaceRootKeysEqual(bridge.discoveredRootRef.current, workspaceRoot)) return;
    void discoverGitRepositories().catch((error) =>
      reportErrorForActiveWorkspaceRoot(workspaceRoot, "Git", error),
    );
  }, [bridge, demanded, discoverGitRepositories, reportErrorForActiveWorkspaceRoot, workspaceRoot]);

  useEffect(() => {
    if (!demanded) return;
    void refreshGitStatus();
  }, [demanded, refreshGitStatus]);

  const refreshOnFileChange = useFileChangeGitRefresh({
    currentWorkspaceRootRef,
    demanded,
    refreshGitStatus,
    workspaceRoot,
  });
  const fileStatusesByPath = useStableFileStatuses(status.gitStatus.changes);

  return {
    fileStatusesByPath,
    gitRepositoryMappings: status.gitRepositoryMappings,
    gitRepositoryStatuses: status.gitRepositoryStatuses,
    refreshGitStatus,
    refreshOnFileChange,
  };
}

interface FileChangeGitRefreshOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly demanded: boolean;
  readonly refreshGitStatus: () => Promise<void>;
  readonly workspaceRoot: string | null;
}

function useFileChangeGitRefresh({
  currentWorkspaceRootRef,
  demanded,
  refreshGitStatus,
  workspaceRoot,
}: FileChangeGitRefreshOptions) {
  const authorityRef = useRef({ demanded, epoch: 0, root: workspaceRoot });
  const previous = authorityRef.current;
  if (previous.demanded !== demanded || previous.root !== workspaceRoot) {
    authorityRef.current = { demanded, epoch: previous.epoch + 1, root: workspaceRoot };
  }
  const refreshRef = useRef(refreshGitStatus);
  refreshRef.current = refreshGitStatus;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [demanded, workspaceRoot]);

  return useCallback(
    (event: WorkspaceFileChangeEvent) => {
      const authority = authorityRef.current;
      if (!authority.demanded || authority.root === null) return;
      if (!workspaceRootKeysEqual(event.rootPath, authority.root)) return;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      const { epoch, root } = authority;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const current = authorityRef.current;
        if (!current.demanded || current.epoch !== epoch) return;
        if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, root)) return;
        void refreshRef.current();
      }, GIT_STATUS_FILE_CHANGE_DEBOUNCE_MS);
    },
    [currentWorkspaceRootRef],
  );
}

function useStableFileStatuses(
  changes: readonly GitChangedFile[],
): Readonly<Record<string, GitChangeStatus>> {
  const previousRef = useRef<Readonly<Record<string, GitChangeStatus>>>(EMPTY_FILE_STATUSES);
  return useMemo(() => {
    const next = fileStatusesFor(changes);
    if (fileStatusesEqual(previousRef.current, next)) return previousRef.current;
    previousRef.current = next;
    return next;
  }, [changes]);
}

function fileStatusesFor(
  changes: readonly GitChangedFile[],
): Readonly<Record<string, GitChangeStatus>> {
  if (changes.length === 0) return EMPTY_FILE_STATUSES;
  const statuses: Record<string, GitChangeStatus> = {};
  for (const change of changes) {
    statuses[change.path] = change.status;
    if (change.oldPath) statuses[change.oldPath] = change.status;
  }
  return statuses;
}

function fileStatusesEqual(
  left: Readonly<Record<string, GitChangeStatus>>,
  right: Readonly<Record<string, GitChangeStatus>>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}
