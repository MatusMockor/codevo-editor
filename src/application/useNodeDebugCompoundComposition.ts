import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebugCompoundLaunchTarget } from "../domain/debug";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  createNodeDebugPreLaunchTaskCoordinator,
  type NodeDebugPreLaunchTaskExecution,
} from "./nodeDebugPreLaunchTaskCoordinator";
import { cloneNodeDebugCompoundMembers } from "./nodeDebugCompoundRecipe";
import type { PreparedNodeDebugCompoundLaunch } from "./useNodeDebugConfigurationLauncher";
import type { VscodeProcessTasksState } from "./useVscodeProcessTasks";

const COMPOUND_PRE_LAUNCH_UNAVAILABLE_WARNING =
  "Debug compound pre-launch task is unavailable. Refresh Tasks and try again.";
const COMPOUND_PRE_LAUNCH_FAILED_WARNING = "Debug compound pre-launch task failed.";
const COMPOUND_STALE_WARNING =
  "Debug compound start was cancelled because the workspace or task state changed.";
const COMPOUND_START_WARNING = "Node debug compound could not be started.";

interface CompoundBoundary {
  readonly launchConfigurationVersion: number;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
}

export interface NodeDebugCompoundComposition {
  readonly busy: boolean;
  isBusy(): boolean;
  start(prepared: PreparedNodeDebugCompoundLaunch): Promise<boolean>;
}

/**
 * Owns the application-level compound admission barrier.
 *
 * Compound members are defensively cloned before the optional shared Tasks
 * barrier. The exact workspace generation is then revalidated before and after
 * the atomic compound start port. Post-debug tasks and restart recipes are
 * intentionally outside this composition.
 */
export function useNodeDebugCompoundComposition(options: {
  readonly isWorkspaceCurrent: (rootPath: string, workspaceId: string) => boolean;
  readonly launchConfigurationVersion: number;
  readonly processTasks: VscodeProcessTasksState;
  readonly reportWarning: (message: string) => void;
  readonly rootPath: string | null;
  readonly startCompound: (members: readonly DebugCompoundLaunchTarget[]) => Promise<boolean>;
  readonly stopAcceptedCompound: () => Promise<void>;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
}): NodeDebugCompoundComposition {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const boundaryRef = useRef<CompoundBoundary | null>(null);
  const epochRef = useRef(0);
  const boundary = useMemo<CompoundBoundary>(
    () => ({
      launchConfigurationVersion: options.launchConfigurationVersion,
      rootPath: options.rootPath,
      workspaceId: options.workspaceId,
      workspaceTrusted: options.workspaceTrusted,
    }),
    [
      options.launchConfigurationVersion,
      options.rootPath,
      options.workspaceId,
      options.workspaceTrusted,
    ],
  );
  if (!sameBoundary(boundaryRef.current, boundary)) {
    boundaryRef.current = boundary;
    epochRef.current = nextEpoch(epochRef.current);
  }

  const processTasksRef = useRef(options.processTasks);
  processTasksRef.current = options.processTasks;
  const [execution] = useState<NodeDebugPreLaunchTaskExecution>(() => ({
    startAndWait: (label, onOwned) => processTasksRef.current.startAndWait(label, onOwned),
  }));
  const [coordinator] = useState(() =>
    createNodeDebugPreLaunchTaskCoordinator({
      execution,
      isWorkspaceCurrent: (candidateEpoch, candidateWorkspaceId) =>
        compoundOwnerIsCurrent(
          optionsRef.current,
          boundaryRef.current,
          candidateEpoch,
          candidateWorkspaceId,
          epochRef.current,
        ),
    }),
  );
  const [, setRevision] = useState(0);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const appliedEpochRef = useRef(epochRef.current);
  useEffect(() => {
    if (appliedEpochRef.current === epochRef.current) return;
    appliedEpochRef.current = epochRef.current;
    void coordinator.invalidate().finally(() => {
      if (mountedRef.current) setRevision((current) => current + 1);
    });
  }, [boundary, coordinator]);
  useEffect(
    () => () => {
      void coordinator.invalidate();
    },
    [coordinator],
  );

  const start = useCallback(
    async (prepared: PreparedNodeDebugCompoundLaunch): Promise<boolean> => {
      const captured = boundaryRef.current;
      const capturedEpoch = epochRef.current;
      if (!captured?.rootPath || !captured.workspaceId || !captured.workspaceTrusted) return false;
      const recipes = cloneNodeDebugCompoundMembers(prepared.members);
      if (!recipes) {
        safelyWarn(optionsRef.current.reportWarning, COMPOUND_START_WARNING);
        return false;
      }
      const members = Object.freeze(recipes.map(({ launch }) => launch));
      let accepted = false;
      const pending = coordinator.run(
        {
          task: prepared.preLaunchTask,
          workspaceEpoch: capturedEpoch,
          workspaceId: captured.workspaceId,
        },
        async () => {
          accepted = await optionsRef.current.startCompound(members);
          return accepted;
        },
      );
      if (mountedRef.current) setRevision((current) => current + 1);
      const outcome = await pending;
      if (mountedRef.current) setRevision((current) => current + 1);
      if (outcome.status === "started") return true;
      if (accepted) await safelyStopAcceptedCompound(optionsRef.current.stopAcceptedCompound);
      if (outcome.status === "cancelled") return false;
      const warning =
        outcome.status === "task-unavailable"
          ? COMPOUND_PRE_LAUNCH_UNAVAILABLE_WARNING
          : outcome.status === "task-failed"
            ? COMPOUND_PRE_LAUNCH_FAILED_WARNING
            : outcome.status === "busy" || outcome.status === "stale"
              ? COMPOUND_STALE_WARNING
              : COMPOUND_START_WARNING;
      safelyWarn(optionsRef.current.reportWarning, warning);
      return false;
    },
    [coordinator],
  );
  const isBusy = useCallback(() => coordinator.occupied(), [coordinator]);

  return useMemo(
    () => ({
      busy: coordinator.occupied(),
      isBusy,
      start,
    }),
    [coordinator, isBusy, start],
  );
}

function compoundOwnerIsCurrent(
  options: {
    readonly isWorkspaceCurrent: (rootPath: string, workspaceId: string) => boolean;
    readonly launchConfigurationVersion: number;
    readonly rootPath: string | null;
    readonly workspaceId: string | null;
    readonly workspaceTrusted: boolean;
  },
  boundary: CompoundBoundary | null,
  candidateEpoch: number,
  candidateWorkspaceId: string,
  currentEpoch: number,
): boolean {
  if (
    !boundary?.rootPath ||
    !boundary.workspaceId ||
    !options.workspaceTrusted ||
    !boundary.workspaceTrusted ||
    candidateEpoch !== currentEpoch ||
    candidateWorkspaceId !== boundary.workspaceId ||
    options.workspaceId !== boundary.workspaceId ||
    options.launchConfigurationVersion !== boundary.launchConfigurationVersion ||
    !workspaceRootKeysEqual(options.rootPath, boundary.rootPath)
  ) {
    return false;
  }
  try {
    return options.isWorkspaceCurrent(boundary.rootPath, boundary.workspaceId);
  } catch {
    return false;
  }
}

function sameBoundary(previous: CompoundBoundary | null, next: CompoundBoundary): boolean {
  return (
    previous !== null &&
    previous.launchConfigurationVersion === next.launchConfigurationVersion &&
    workspaceRootKeysEqual(previous.rootPath, next.rootPath) &&
    previous.workspaceId === next.workspaceId &&
    previous.workspaceTrusted === next.workspaceTrusted
  );
}

function nextEpoch(current: number): number {
  return Number.isSafeInteger(current) && current >= 0 && current < Number.MAX_SAFE_INTEGER
    ? current + 1
    : Number.MAX_SAFE_INTEGER;
}

function safelyWarn(reportWarning: (message: string) => void, message: string): void {
  try {
    reportWarning(message);
  } catch {
    // Presentation failures never own task or compound start admission.
  }
}

async function safelyStopAcceptedCompound(
  stopAcceptedCompound: () => Promise<void>,
): Promise<void> {
  try {
    await stopAcceptedCompound();
  } catch {
    // A presentation-level start result must remain generic even if best-effort cleanup rejects.
  }
}
