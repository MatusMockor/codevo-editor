import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorChangeHunk } from "../domain/editorChangeMarkers";
import {
  normalizeLargeSmartDocumentPolicy,
  type LargeSmartDocumentPolicy,
} from "../domain/largeDocumentPolicy";
import { liveDocumentSnapshotUtf16Limit } from "../domain/liveDocumentSnapshot";
import type { EditorChangeHunksComputationGateway } from "./editorChangeHunksComputation";
import {
  baselineMatchesLiveDocument,
  type EditorChangeHunksBaseline,
  type EditorChangeHunksSnapshotPort,
} from "./editorChangeHunksSnapshotPort";
import type { LiveDocumentSnapshot } from "./liveDocumentSnapshotBroker";
import type { LiveModelRevision, LiveModelSourceHandle } from "./liveModelIngressCoordinator";

const EMPTY_HUNKS: readonly EditorChangeHunk[] = Object.freeze([]);
export const EDITOR_CHANGE_HUNKS_COALESCE_MS = 120;

export type OwnedEditorChangeHunksState =
  | { readonly status: "idle"; readonly hunks: readonly EditorChangeHunk[] }
  | { readonly status: "pending"; readonly hunks: readonly EditorChangeHunk[] }
  | { readonly status: "ready"; readonly hunks: readonly EditorChangeHunk[] }
  | {
      readonly status: "degraded";
      readonly hunks: readonly EditorChangeHunk[];
      readonly reason: "large-file";
    }
  | {
      readonly status: "error";
      readonly hunks: readonly EditorChangeHunk[];
      readonly message: string;
    };

export interface SnapshotOwnedEditorChangeHunksInput {
  readonly baseline: EditorChangeHunksBaseline | null;
  readonly gateway: EditorChangeHunksComputationGateway;
  readonly liveDocument: {
    readonly handle: LiveModelSourceHandle;
  } | null;
  readonly mode: "snapshot";
  readonly policy: LargeSmartDocumentPolicy;
  readonly snapshots: EditorChangeHunksSnapshotPort;
  readonly coalesceMs?: number;
}

export interface LegacyOwnedEditorChangeHunksInput {
  readonly baselineContent: string | null;
  readonly content: string | null;
  readonly gateway: EditorChangeHunksComputationGateway;
  readonly mode?: "legacy";
  readonly ownerKey: string | null;
  readonly path: string | null;
  readonly policy: LargeSmartDocumentPolicy;
  readonly coalesceMs?: number;
}

export type OwnedEditorChangeHunksInput =
  SnapshotOwnedEditorChangeHunksInput | LegacyOwnedEditorChangeHunksInput;

const IDLE_STATE: OwnedEditorChangeHunksState = Object.freeze({
  hunks: EMPTY_HUNKS,
  status: "idle",
});
const PENDING_STATE: OwnedEditorChangeHunksState = Object.freeze({
  hunks: EMPTY_HUNKS,
  status: "pending",
});
const LARGE_FILE_STATE: OwnedEditorChangeHunksState = Object.freeze({
  hunks: EMPTY_HUNKS,
  reason: "large-file",
  status: "degraded",
});
const INACTIVE_GATEWAY: EditorChangeHunksComputationGateway = Object.freeze({
  compute: () => Promise.reject(new Error("Inactive change-hunks gateway")),
});
const INACTIVE_SNAPSHOTS: EditorChangeHunksSnapshotPort = Object.freeze({
  capture: () => ({ reason: "aborted" as const, status: "rejected" as const }),
  consumeCurrent: () => false,
  release: () => false,
  subscribe: () => () => undefined,
});
const INACTIVE_POLICY: LargeSmartDocumentPolicy = Object.freeze({
  characterLimit: 1,
  lineLimit: 1,
});
const INACTIVE_SNAPSHOT_INPUT: SnapshotOwnedEditorChangeHunksInput = Object.freeze({
  baseline: null,
  gateway: INACTIVE_GATEWAY,
  liveDocument: null,
  mode: "snapshot",
  policy: INACTIVE_POLICY,
  snapshots: INACTIVE_SNAPSHOTS,
});
const INACTIVE_LEGACY_INPUT: LegacyOwnedEditorChangeHunksInput = Object.freeze({
  baselineContent: null,
  content: null,
  gateway: INACTIVE_GATEWAY,
  mode: "legacy",
  ownerKey: null,
  path: null,
  policy: INACTIVE_POLICY,
});

function createAuthorityToken(...authority: readonly unknown[]): Readonly<Record<string, never>> {
  void authority;
  return Object.freeze({});
}

/**
 * Computes change hunks from a broker-retained full-text snapshot.
 *
 * Compact live revisions are observed imperatively, so typing does not update
 * React state. A settled edit first waits for the debounce, captures exactly
 * one bounded snapshot, and publishes only after consuming that snapshot as
 * current.
 */
export function useOwnedEditorChangeHunks(
  input: OwnedEditorChangeHunksInput,
): OwnedEditorChangeHunksState {
  const snapshotInput = input.mode === "snapshot" ? input : null;
  const legacyInput = input.mode === "snapshot" ? null : input;
  const snapshotState = useSnapshotOwnedEditorChangeHunks(snapshotInput);
  const legacyState = useLegacyOwnedEditorChangeHunks(legacyInput);
  return snapshotInput ? snapshotState : legacyState;
}

function useSnapshotOwnedEditorChangeHunks(
  input: SnapshotOwnedEditorChangeHunksInput | null,
): OwnedEditorChangeHunksState {
  const {
    baseline,
    coalesceMs = EDITOR_CHANGE_HUNKS_COALESCE_MS,
    gateway,
    liveDocument,
    policy,
    snapshots,
  } = input ?? INACTIVE_SNAPSHOT_INPUT;
  return useSnapshotOwnedEditorChangeHunksState({
    baseline,
    coalesceMs,
    gateway,
    liveDocument,
    policy,
    snapshots,
    active: input !== null,
  });
}

function useSnapshotOwnedEditorChangeHunksState({
  active: inputActive,
  baseline,
  coalesceMs,
  gateway,
  liveDocument,
  policy,
  snapshots,
}: Omit<SnapshotOwnedEditorChangeHunksInput, "mode"> & {
  readonly active: boolean;
}): OwnedEditorChangeHunksState {
  const normalizedPolicy = normalizeLargeSmartDocumentPolicy(policy);
  const characterLimit = Math.min(
    normalizedPolicy.characterLimit,
    liveDocumentSnapshotUtf16Limit("change-hunks"),
  );
  const lineLimit = normalizedPolicy.lineLimit;
  const handle = liveDocument?.handle ?? null;
  const authorityToken = useMemo(
    () =>
      createAuthorityToken(
        baseline?.authority,
        baseline?.content,
        characterLimit,
        gateway,
        handle,
        lineLimit,
        snapshots,
      ),
    [baseline?.authority, baseline?.content, characterLimit, gateway, handle, lineLimit, snapshots],
  );
  const generationRef = useRef(0);
  const [publication, setPublication] = useState<{
    readonly authorityToken: object;
    readonly state: OwnedEditorChangeHunksState;
  } | null>(null);

  useEffect(() => {
    if (!inputActive || !baseline || !handle || baseline.content.length > characterLimit) {
      return;
    }

    let effectActive = true;
    let activeWork: SnapshotWork | null = null;
    let largeRevisionPublished = false;
    let timeout: number | null = null;

    const releaseWorkSnapshot = (work: SnapshotWork) => {
      if (!work.snapshot) return;
      const snapshot = work.snapshot;
      work.snapshot = null;
      try {
        snapshots.release(handle, snapshot);
      } catch {
        // The broker is bounded and prunes stale snapshots. Cleanup exceptions
        // must not escape a React effect or suppress a newer exact owner.
      }
    };
    const cancelScheduledOrRunning = () => {
      if (timeout !== null) {
        window.clearTimeout(timeout);
        timeout = null;
      }
      const work = activeWork;
      activeWork = null;
      work?.controller.abort();
      if (work) releaseWorkSnapshot(work);
    };
    const remainsCurrent = (generation: number) =>
      effectActive && generationRef.current === generation;
    const schedule = (revision: LiveModelRevision | null) => {
      if (!effectActive) return;
      cancelScheduledOrRunning();
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      if (revision && revision.utf16Length !== null && revision.utf16Length > characterLimit) {
        if (!largeRevisionPublished) {
          largeRevisionPublished = true;
          setPublication({ authorityToken, state: LARGE_FILE_STATE });
        }
        return;
      }
      largeRevisionPublished = false;
      const work: SnapshotWork = {
        controller: new AbortController(),
        snapshot: null,
      };
      activeWork = work;
      timeout = window.setTimeout(
        () => {
          timeout = null;
          if (!remainsCurrent(generation)) return;
          setPublication({ authorityToken, state: PENDING_STATE });
          void runSnapshotComputation({
            abortController: work.controller,
            authorityToken,
            baseline,
            characterLimit,
            gateway,
            generation,
            handle,
            lineLimit,
            clearRetainedSnapshot: (snapshot) => {
              if (work.snapshot === snapshot) work.snapshot = null;
            },
            releaseRetainedSnapshot: () => {
              releaseWorkSnapshot(work);
              if (activeWork === work) activeWork = null;
            },
            remainsCurrent,
            retainSnapshot: (snapshot) => {
              if (
                !effectActive ||
                activeWork !== work ||
                work.controller.signal.aborted ||
                work.snapshot
              ) {
                try {
                  snapshots.release(handle, snapshot);
                } catch {
                  // A stale capture is released best-effort and never admitted.
                }
                return false;
              }
              work.snapshot = snapshot;
              return true;
            },
            setPublication,
            snapshots,
          });
        },
        Math.max(0, coalesceMs ?? EDITOR_CHANGE_HUNKS_COALESCE_MS),
      );
    };

    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = snapshots.subscribe(handle, (revision) => {
        schedule(revision);
      });
      schedule(safeCurrentRevision(handle));
    } catch (error: unknown) {
      setPublication({
        authorityToken,
        state: errorState(error),
      });
    }

    return () => {
      effectActive = false;
      generationRef.current += 1;
      cancelScheduledOrRunning();
      try {
        unsubscribe?.();
      } catch {
        // Subscription cleanup is contained at the application boundary.
      }
    };
  }, [
    authorityToken,
    baseline,
    characterLimit,
    coalesceMs,
    gateway,
    handle,
    inputActive,
    lineLimit,
    snapshots,
  ]);

  if (!inputActive || !baseline || !handle) {
    return IDLE_STATE;
  }
  if (baseline.content.length > characterLimit) {
    return LARGE_FILE_STATE;
  }
  return publication?.authorityToken === authorityToken ? publication.state : PENDING_STATE;
}

function useLegacyOwnedEditorChangeHunks(
  input: LegacyOwnedEditorChangeHunksInput | null,
): OwnedEditorChangeHunksState {
  const inputActive = input !== null;
  const {
    baselineContent,
    coalesceMs = EDITOR_CHANGE_HUNKS_COALESCE_MS,
    content,
    gateway,
    ownerKey,
    path,
    policy,
  } = input ?? INACTIVE_LEGACY_INPUT;
  const normalizedPolicy = normalizeLargeSmartDocumentPolicy(policy);
  const characterLimit = normalizedPolicy.characterLimit;
  const lineLimit = normalizedPolicy.lineLimit;
  const authorityToken = useMemo(
    () =>
      createAuthorityToken(
        baselineContent,
        characterLimit,
        content,
        gateway,
        lineLimit,
        ownerKey,
        path,
      ),
    [baselineContent, characterLimit, content, gateway, lineLimit, ownerKey, path],
  );
  const generationRef = useRef(0);
  const [publication, setPublication] = useState<{
    readonly authorityToken: object;
    readonly state: OwnedEditorChangeHunksState;
  } | null>(null);

  useEffect(() => {
    if (!inputActive || !ownerKey || !path || baselineContent === null || content === null) {
      return;
    }
    if (content.length > characterLimit || baselineContent.length > characterLimit) {
      return;
    }
    if (baselineContent === content) {
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const abortController = new AbortController();
    const timeout = window.setTimeout(
      () => {
        void gateway
          .compute(
            {
              baselineContent,
              content,
              generation,
              ownerKey,
              path,
              policy: { characterLimit, lineLimit },
            },
            abortController.signal,
          )
          .then((response) => {
            if (
              abortController.signal.aborted ||
              response.generation !== generation ||
              response.ownerKey !== ownerKey ||
              response.path !== path
            ) {
              return;
            }
            setPublication({
              authorityToken,
              state:
                response.status === "degraded"
                  ? LARGE_FILE_STATE
                  : { hunks: response.hunks, status: "ready" },
            });
          })
          .catch((error: unknown) => {
            if (abortController.signal.aborted) return;
            setPublication({ authorityToken, state: errorState(error) });
          });
      },
      Math.max(0, coalesceMs),
    );

    return () => {
      window.clearTimeout(timeout);
      abortController.abort();
    };
  }, [
    authorityToken,
    baselineContent,
    characterLimit,
    coalesceMs,
    content,
    gateway,
    inputActive,
    lineLimit,
    ownerKey,
    path,
  ]);

  if (!inputActive || !ownerKey || !path || baselineContent === null || content === null) {
    return IDLE_STATE;
  }
  if (content.length > characterLimit || baselineContent.length > characterLimit) {
    return LARGE_FILE_STATE;
  }
  if (baselineContent === content) {
    return { hunks: EMPTY_HUNKS, status: "ready" };
  }
  return publication?.authorityToken === authorityToken ? publication.state : PENDING_STATE;
}

interface SnapshotComputationInput {
  readonly abortController: AbortController;
  readonly authorityToken: object;
  readonly baseline: EditorChangeHunksBaseline;
  readonly characterLimit: number;
  readonly gateway: EditorChangeHunksComputationGateway;
  readonly generation: number;
  readonly handle: LiveModelSourceHandle;
  readonly lineLimit: number;
  readonly clearRetainedSnapshot: (snapshot: LiveDocumentSnapshot) => void;
  readonly releaseRetainedSnapshot: () => void;
  readonly remainsCurrent: (generation: number) => boolean;
  readonly retainSnapshot: (snapshot: LiveDocumentSnapshot) => boolean;
  readonly setPublication: (publication: {
    readonly authorityToken: object;
    readonly state: OwnedEditorChangeHunksState;
  }) => void;
  readonly snapshots: EditorChangeHunksSnapshotPort;
}

async function runSnapshotComputation({
  abortController,
  authorityToken,
  baseline,
  characterLimit,
  gateway,
  generation,
  handle,
  lineLimit,
  clearRetainedSnapshot,
  releaseRetainedSnapshot,
  remainsCurrent,
  retainSnapshot,
  setPublication,
  snapshots,
}: SnapshotComputationInput): Promise<void> {
  try {
    const captured = snapshots.capture(handle, abortController.signal);
    if (captured.status === "rejected") {
      if (!abortController.signal.aborted && remainsCurrent(generation)) {
        setPublication({
          authorityToken,
          state:
            captured.reason === "document-too-large"
              ? LARGE_FILE_STATE
              : snapshotErrorState(captured.reason),
        });
      }
      return;
    }

    const snapshot = captured.snapshot;
    if (!retainSnapshot(snapshot)) return;
    if (
      abortController.signal.aborted ||
      !remainsCurrent(generation) ||
      snapshot.purpose !== "change-hunks" ||
      snapshot.modelAuthority !== handle.modelAuthority ||
      snapshot.utf16Length !== snapshot.content.length ||
      snapshot.utf16Length > characterLimit ||
      !baselineMatchesLiveDocument(baseline, snapshot.authority)
    ) {
      if (
        !abortController.signal.aborted &&
        remainsCurrent(generation) &&
        snapshot.utf16Length > characterLimit
      ) {
        setPublication({ authorityToken, state: LARGE_FILE_STATE });
      }
      return;
    }

    const response = await gateway.compute(
      {
        baselineContent: baseline.content,
        content: snapshot.content,
        generation,
        ownerKey: snapshot.authority.ownerKey,
        path: snapshot.authority.path,
        policy: { characterLimit, lineLimit },
      },
      abortController.signal,
    );
    if (
      abortController.signal.aborted ||
      !remainsCurrent(generation) ||
      response.generation !== generation ||
      response.ownerKey !== snapshot.authority.ownerKey ||
      response.path !== snapshot.authority.path
    ) {
      return;
    }

    const consumed = snapshots.consumeCurrent(handle, snapshot);
    if (consumed) clearRetainedSnapshot(snapshot);
    if (!consumed || abortController.signal.aborted || !remainsCurrent(generation)) {
      return;
    }

    setPublication({
      authorityToken,
      state:
        response.status === "degraded"
          ? LARGE_FILE_STATE
          : { hunks: response.hunks, status: "ready" },
    });
  } catch (error: unknown) {
    if (!abortController.signal.aborted && remainsCurrent(generation)) {
      setPublication({
        authorityToken,
        state: errorState(error),
      });
    }
  } finally {
    releaseRetainedSnapshot();
  }
}

interface SnapshotWork {
  readonly controller: AbortController;
  snapshot: LiveDocumentSnapshot | null;
}

function safeCurrentRevision(handle: LiveModelSourceHandle): LiveModelRevision | null {
  try {
    return handle.currentRevision();
  } catch {
    return null;
  }
}

function errorState(error: unknown): OwnedEditorChangeHunksState {
  return {
    hunks: EMPTY_HUNKS,
    message: error instanceof Error ? error.message : String(error),
    status: "error",
  };
}

function snapshotErrorState(reason: string): OwnedEditorChangeHunksState {
  return {
    hunks: EMPTY_HUNKS,
    message: `Editor snapshot unavailable (${reason}).`,
    status: "error",
  };
}
