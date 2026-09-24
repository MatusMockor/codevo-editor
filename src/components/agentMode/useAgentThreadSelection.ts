import { useCallback, useMemo, useState } from "react";
import {
  applyListSelectionGesture,
  listSelectionCommit,
  hasSelectionBeyond,
  listSelectionOwner,
  orderedSelectionIds,
  ownedListSelection,
  rebaseOwnedSelection,
  reconcileSelection,
  type ListSelection,
  type ListSelectionCommit,
  type ListSelectionGesture,
  type ListSelectionOwner,
  type OwnedListSelection,
} from "../../domain/listSelection";

export const UNSCOPED_SELECTION_OWNER_KEY = "unscoped";

const NO_CAPTURED_OWNERS: ReadonlyMap<string, string> = new Map();

export type AgentThreadSelectionCommit =
  | Extract<ListSelectionCommit, { readonly kind: "ownerChanged" }>
  | (Extract<ListSelectionCommit, { readonly kind: "ready" }> & {
      readonly ownerKeys: ReadonlyMap<string, string>;
    });

export interface AgentThreadSelection {
  readonly owner: ListSelectionOwner;
  readonly selectedIds: ReadonlySet<string>;
  readonly orderedIds: ReadonlyArray<string>;
  readonly count: number;
  hasMarkBeyond(activeId: string | null): boolean;
  apply(threadId: string, gesture: ListSelectionGesture): void;
  clear(): void;
  commit(capturedOwner: ListSelectionOwner): AgentThreadSelectionCommit;
}

interface CapturedSelection extends OwnedListSelection {
  readonly threadOwners: ReadonlyMap<string, string>;
}

export function useAgentThreadSelection(
  ownerKey: string | null,
  visibleIds: ReadonlyArray<string>,
  threadOwners: ReadonlyMap<string, string> = NO_CAPTURED_OWNERS,
): AgentThreadSelection {
  const key = ownerKey ?? UNSCOPED_SELECTION_OWNER_KEY;
  const [state, setState] = useState<CapturedSelection>(() =>
    capturedSelection(ownedListSelection(listSelectionOwner(null, key))),
  );
  const owner = listSelectionOwner(state.owner, key);
  const rebased = rebaseCapturedSelection(state, owner);
  if (rebased !== state) setState(rebased);

  const selection = useMemo(
    () => reconcileSelection(rebased.selection, visibleIds),
    [rebased, visibleIds],
  );

  const apply = useCallback(
    (threadId: string, gesture: ListSelectionGesture) => {
      setState((current) => {
        const held = rebaseCapturedSelection(current, owner);
        const next = applyListSelectionGesture(
          reconcileSelection(held.selection, visibleIds),
          gesture,
          threadId,
          visibleIds,
        );
        if (next === null) return current;
        return {
          owner,
          selection: next,
          threadOwners: captureThreadOwners(
            next,
            gesture === "open" ? NO_CAPTURED_OWNERS : held.threadOwners,
            threadOwners,
          ),
        };
      });
    },
    [owner, threadOwners, visibleIds],
  );

  const clear = useCallback(() => setState(capturedSelection(ownedListSelection(owner))), [owner]);

  const commit = useCallback(
    (capturedOwner: ListSelectionOwner): AgentThreadSelectionCommit => {
      const result = listSelectionCommit(
        { owner: capturedOwner, selection: rebased.selection },
        owner,
        visibleIds,
      );
      if (result.kind === "ownerChanged") return result;
      return { ...result, ownerKeys: ownersOf(result.ids, rebased.threadOwners) };
    },
    [owner, rebased, visibleIds],
  );

  return useMemo(
    () => ({
      owner,
      selectedIds: selection.ids,
      orderedIds: orderedSelectionIds(selection, visibleIds),
      count: selection.ids.size,
      hasMarkBeyond: (activeId: string | null) => hasSelectionBeyond(selection, activeId),
      apply,
      clear,
      commit,
    }),
    [apply, clear, commit, owner, selection, visibleIds],
  );
}

function capturedSelection(owned: OwnedListSelection): CapturedSelection {
  return { ...owned, threadOwners: NO_CAPTURED_OWNERS };
}

function rebaseCapturedSelection(
  current: CapturedSelection,
  owner: ListSelectionOwner,
): CapturedSelection {
  const rebased = rebaseOwnedSelection(current, owner);
  if (rebased === current) return current;
  return capturedSelection(rebased);
}

function captureThreadOwners(
  selection: ListSelection,
  held: ReadonlyMap<string, string>,
  live: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const captured = new Map<string, string>();
  for (const threadId of selection.ids) {
    const owner = held.get(threadId) ?? live.get(threadId);
    if (owner !== undefined) captured.set(threadId, owner);
  }
  return captured;
}

function ownersOf(
  threadIds: ReadonlyArray<string>,
  captured: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  return new Map(
    threadIds.flatMap((threadId) => {
      const owner = captured.get(threadId);
      return owner === undefined ? [] : [[threadId, owner] as const];
    }),
  );
}
