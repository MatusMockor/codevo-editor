import { useCallback, type MutableRefObject } from "react";
import type { Breakpoint, BreakpointCreationOwnership } from "../domain/debug";
import { addBreakpoint, relocateBreakpoint, removeBreakpoint } from "../domain/debugBreakpoints";
import { debugBreakpointLocationsEqual } from "../domain/debugBreakpointLocation";
import { isBreakpointPathSupported } from "../domain/debugBreakpointPolicy";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  DebugBreakpointRelocationCandidate,
  DebugInlineBreakpointCandidate,
} from "./debugSessionContracts";
import type { DebugBreakpointMutationOwner } from "./debugBreakpointMutationQueue";

interface UseDebugInlineBreakpointMutationsOptions {
  readonly breakpointCreationOwnersRef: MutableRefObject<Map<string, object>>;
  readonly breakpointRelocationOwnersRef: MutableRefObject<Map<string, object>>;
  readonly breakpointsByRootRef: MutableRefObject<Record<string, Breakpoint[]>>;
  commitBreakpoints(key: string, list: Breakpoint[]): void;
  readonly createBreakpointId: () => string;
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly currentWorkspaceIdRef: MutableRefObject<string | null>;
  syncBreakpointsForFile(
    rootPath: string,
    key: string,
    filePath: string,
    list: readonly Breakpoint[],
    expectedOwner?: DebugBreakpointMutationOwner,
  ): Promise<void>;
}

export interface DebugInlineBreakpointMutations {
  addInlineBreakpoint(
    candidate: DebugInlineBreakpointCandidate,
    expectedOwner?: DebugBreakpointMutationOwner,
  ): Promise<BreakpointCreationOwnership | null>;
  relocateBreakpoint(
    candidate: DebugBreakpointRelocationCandidate,
    expectedOwner?: DebugBreakpointMutationOwner,
  ): Promise<boolean>;
}

/** Owns inline creation/relocation transactions while the session owns storage and adapter sync. */
export function useDebugInlineBreakpointMutations({
  breakpointCreationOwnersRef,
  breakpointRelocationOwnersRef,
  breakpointsByRootRef,
  commitBreakpoints,
  createBreakpointId,
  currentRootRef,
  currentWorkspaceIdRef,
  syncBreakpointsForFile,
}: UseDebugInlineBreakpointMutationsOptions): DebugInlineBreakpointMutations {
  const addInlineBreakpoint = useCallback(
    async (
      candidate: DebugInlineBreakpointCandidate,
      expectedOwner?: DebugBreakpointMutationOwner,
    ): Promise<BreakpointCreationOwnership | null> => {
      const root = currentRootRef.current;
      const workspaceId = currentWorkspaceIdRef.current;
      if (!eligibleCandidate(root, workspaceId, candidate) || !captureIsCurrent(candidate)) {
        return null;
      }

      const key = normalizedWorkspaceRootKey(root);
      const location = {
        ...(candidate.columnNumber === undefined ? {} : { columnNumber: candidate.columnNumber }),
        filePath: candidate.filePath,
        lineNumber: candidate.lineNumber,
      };
      const current = breakpointsByRootRef.current[key] ?? [];
      if (current.some((breakpoint) => debugBreakpointLocationsEqual(breakpoint, location))) {
        return null;
      }

      let createdId: string | null = null;
      const next = addBreakpoint(current, location, () => {
        let id = createBreakpointId();
        while (current.some((entry) => entry.id === id)) id = createBreakpointId();
        createdId = id;
        return id;
      });
      if (createdId === null || next === current || !captureIsCurrent(candidate)) return null;

      const ownedId = createdId as string;
      const ownerToken = {};
      const creationOwnerKey = `${key}\0${ownedId}`;
      breakpointCreationOwnersRef.current.set(creationOwnerKey, ownerToken);
      commitBreakpoints(key, next);

      const rollback = async (synchronize: boolean) => {
        if (breakpointCreationOwnersRef.current.get(creationOwnerKey) !== ownerToken) return;
        breakpointCreationOwnersRef.current.delete(creationOwnerKey);
        const owned = breakpointsByRootRef.current[key] ?? [];
        const stillOwned = owned.some(
          (entry) => entry.id === ownedId && debugBreakpointLocationsEqual(entry, location),
        );
        if (!stillOwned) return;
        const rolledBack = removeBreakpoint(owned, ownedId);
        commitBreakpoints(key, rolledBack);
        if (
          synchronize &&
          currentWorkspaceIdRef.current === workspaceId &&
          workspaceRootKeysEqual(root, currentRootRef.current)
        ) {
          await syncBreakpointsForFile(root, key, candidate.filePath, rolledBack, expectedOwner);
        }
      };

      try {
        await syncBreakpointsForFile(root, key, candidate.filePath, next, expectedOwner);
      } catch (error) {
        await rollback(false);
        throw error;
      }
      return {
        breakpointId: ownedId,
        ...(candidate.columnNumber === undefined ? {} : { columnNumber: candidate.columnNumber }),
        filePath: candidate.filePath,
        lineNumber: candidate.lineNumber,
        isCurrent: () =>
          breakpointCreationOwnersRef.current.get(creationOwnerKey) === ownerToken &&
          (breakpointsByRootRef.current[key] ?? []).some(
            (entry) => entry.id === ownedId && debugBreakpointLocationsEqual(entry, location),
          ),
        rollback: () => rollback(true),
      };
    },
    [
      breakpointCreationOwnersRef,
      breakpointsByRootRef,
      commitBreakpoints,
      createBreakpointId,
      currentRootRef,
      currentWorkspaceIdRef,
      syncBreakpointsForFile,
    ],
  );

  const relocateInlineBreakpoint = useCallback(
    async (
      candidate: DebugBreakpointRelocationCandidate,
      expectedOwner?: DebugBreakpointMutationOwner,
    ): Promise<boolean> => {
      const root = currentRootRef.current;
      const workspaceId = currentWorkspaceIdRef.current;
      if (!eligibleCandidate(root, workspaceId, candidate) || !captureIsCurrent(candidate)) {
        return false;
      }

      const key = normalizedWorkspaceRootKey(root);
      const current = breakpointsByRootRef.current[key] ?? [];
      const original = current.find((entry) => entry.id === candidate.breakpointId);
      if (!original || original.filePath !== candidate.filePath) return false;
      const location = {
        ...(candidate.columnNumber === undefined ? {} : { columnNumber: candidate.columnNumber }),
        filePath: candidate.filePath,
        lineNumber: candidate.lineNumber,
      };
      const next = relocateBreakpoint(current, candidate.breakpointId, location);
      if (next === current || !captureIsCurrent(candidate)) return false;

      const ownerKey = `${key}\0${candidate.breakpointId}`;
      const ownerToken = {};
      breakpointRelocationOwnersRef.current.set(ownerKey, ownerToken);
      commitBreakpoints(key, next);

      const rollback = async (synchronize: boolean) => {
        if (breakpointRelocationOwnersRef.current.get(ownerKey) !== ownerToken) return;
        const owned = breakpointsByRootRef.current[key] ?? [];
        const relocated = owned.find((entry) => entry.id === candidate.breakpointId);
        if (!relocated || !debugBreakpointLocationsEqual(relocated, location)) return;
        if (
          owned.some(
            (entry) =>
              entry.id !== candidate.breakpointId && debugBreakpointLocationsEqual(entry, original),
          )
        ) {
          return;
        }
        breakpointRelocationOwnersRef.current.delete(ownerKey);
        const rolledBack = owned.map((entry) =>
          entry.id === candidate.breakpointId ? original : entry,
        );
        commitBreakpoints(key, rolledBack);
        if (
          synchronize &&
          currentWorkspaceIdRef.current === workspaceId &&
          workspaceRootKeysEqual(root, currentRootRef.current)
        ) {
          await syncBreakpointsForFile(root, key, candidate.filePath, rolledBack, expectedOwner);
        }
      };

      try {
        await syncBreakpointsForFile(root, key, candidate.filePath, next, expectedOwner);
        if (breakpointRelocationOwnersRef.current.get(ownerKey) !== ownerToken) return false;
        if (!captureIsCurrent(candidate)) {
          await rollback(true);
          return false;
        }
        breakpointRelocationOwnersRef.current.delete(ownerKey);
        return true;
      } catch (error) {
        await rollback(false);
        throw error;
      }
    },
    [
      breakpointRelocationOwnersRef,
      breakpointsByRootRef,
      commitBreakpoints,
      currentRootRef,
      currentWorkspaceIdRef,
      syncBreakpointsForFile,
    ],
  );

  return { addInlineBreakpoint, relocateBreakpoint: relocateInlineBreakpoint };
}

interface WorkspaceOwnedCandidate {
  readonly filePath: string;
  readonly workspaceOwnerKey: string;
  readonly workspaceRoot: string;
  isCurrent(): boolean;
}

function eligibleCandidate(
  root: string | null,
  workspaceId: string | null,
  candidate: WorkspaceOwnedCandidate,
): root is string {
  return (
    root !== null &&
    workspaceId !== null &&
    workspaceId === candidate.workspaceOwnerKey &&
    workspaceRootKeysEqual(root, candidate.workspaceRoot) &&
    isBreakpointPathSupported(root, "node", candidate.filePath)
  );
}

function captureIsCurrent(candidate: WorkspaceOwnedCandidate): boolean {
  try {
    return candidate.isCurrent();
  } catch {
    return false;
  }
}
