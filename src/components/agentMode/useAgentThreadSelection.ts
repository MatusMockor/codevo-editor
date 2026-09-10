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
  type ListSelectionCommit,
  type ListSelectionGesture,
  type ListSelectionOwner,
  type OwnedListSelection,
} from "../../domain/listSelection";

export const UNSCOPED_SELECTION_OWNER_KEY = "unscoped";

export interface AgentThreadSelection {
  readonly owner: ListSelectionOwner;
  readonly selectedIds: ReadonlySet<string>;
  readonly orderedIds: ReadonlyArray<string>;
  readonly count: number;
  hasMarkBeyond(activeId: string | null): boolean;
  apply(threadId: string, gesture: ListSelectionGesture): void;
  clear(): void;
  commit(capturedOwner: ListSelectionOwner): ListSelectionCommit;
}

export function useAgentThreadSelection(
  ownerKey: string | null,
  visibleIds: ReadonlyArray<string>,
): AgentThreadSelection {
  const key = ownerKey ?? UNSCOPED_SELECTION_OWNER_KEY;
  const [state, setState] = useState<OwnedListSelection>(() =>
    ownedListSelection(listSelectionOwner(null, key)),
  );
  const owner = listSelectionOwner(state.owner, key);
  const rebased = rebaseOwnedSelection(state, owner);
  if (rebased !== state) setState(rebased);

  const selection = useMemo(
    () => reconcileSelection(rebased.selection, visibleIds),
    [rebased, visibleIds],
  );

  const apply = useCallback(
    (threadId: string, gesture: ListSelectionGesture) => {
      setState((current) => {
        const held = rebaseOwnedSelection(current, owner);
        const next = applyListSelectionGesture(
          reconcileSelection(held.selection, visibleIds),
          gesture,
          threadId,
          visibleIds,
        );
        if (next === null) return current;
        return { owner, selection: next };
      });
    },
    [owner, visibleIds],
  );

  const clear = useCallback(() => setState(ownedListSelection(owner)), [owner]);

  const held = rebased.selection;
  const commit = useCallback(
    (capturedOwner: ListSelectionOwner) =>
      listSelectionCommit({ owner: capturedOwner, selection: held }, owner, visibleIds),
    [held, owner, visibleIds],
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
