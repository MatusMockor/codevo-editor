import { useCallback, useMemo, useState } from "react";
import type { TurnDiffTreeNode } from "../../../domain/agentTurnDiffTree";
import {
  hasExpandedFolderRow,
  outlineAgentTurnChanges,
  visibleAgentTurnChangeRows,
  type AgentTurnChangeRow,
  type AgentTurnChangesOutline,
} from "./agentTurnChangesProjection";

export interface AgentTurnChangesRowLimits {
  readonly visibleRows: number;
  readonly initiallyExpandedRows: number;
}

export interface AgentTurnChangesFolders {
  readonly rows: ReadonlyArray<AgentTurnChangeRow>;
  readonly representedFiles: number;
  readonly hasFolders: boolean;
  readonly anyExpanded: boolean;
  toggle(path: string): void;
  toggleAll(): void;
}

interface FolderState {
  readonly key: string;
  readonly collapsed: ReadonlySet<string>;
}

const NONE_COLLAPSED: ReadonlySet<string> = new Set<string>();
const FOLDER_KEY_SEPARATOR = "\u0000";

export function useAgentTurnChangesFolders(
  nodes: ReadonlyArray<TurnDiffTreeNode>,
  { initiallyExpandedRows, visibleRows }: AgentTurnChangesRowLimits,
): AgentTurnChangesFolders {
  const outline = useMemo(() => outlineAgentTurnChanges(nodes), [nodes]);
  const initial = useMemo(
    () => initialFolderState(outline, initiallyExpandedRows),
    [outline, initiallyExpandedRows],
  );
  const [state, setState] = useState<FolderState>(initial);
  if (state.key !== initial.key) setState(initial);
  const collapsed = collapsedFor(state, initial);
  const visible = useMemo(
    () => visibleAgentTurnChangeRows(nodes, collapsed, visibleRows),
    [nodes, collapsed, visibleRows],
  );
  const toggle = useCallback(
    (path: string) =>
      setState((current) => ({
        key: initial.key,
        collapsed: toggled(collapsedFor(current, initial), path),
      })),
    [initial],
  );
  const toggleAll = useCallback(
    () =>
      setState((current) => ({
        key: initial.key,
        collapsed: allToggled(collapsedFor(current, initial), nodes, outline, visibleRows),
      })),
    [initial, nodes, outline, visibleRows],
  );
  return {
    rows: visible.rows,
    representedFiles: visible.representedFiles,
    hasFolders: outline.folderPaths.length > 0,
    anyExpanded: hasExpandedFolderRow(visible.rows),
    toggle,
    toggleAll,
  };
}

function initialFolderState(
  { expandedRows, folderPaths }: AgentTurnChangesOutline,
  initiallyExpandedRows: number,
): FolderState {
  const paths = folderPaths.join(FOLDER_KEY_SEPARATOR);
  if (expandedRows <= initiallyExpandedRows)
    return { key: `expanded${FOLDER_KEY_SEPARATOR}${paths}`, collapsed: NONE_COLLAPSED };
  return { key: `collapsed${FOLDER_KEY_SEPARATOR}${paths}`, collapsed: new Set(folderPaths) };
}

function collapsedFor(state: FolderState, initial: FolderState): ReadonlySet<string> {
  if (state.key !== initial.key) return initial.collapsed;
  return state.collapsed;
}

function allToggled(
  collapsed: ReadonlySet<string>,
  nodes: ReadonlyArray<TurnDiffTreeNode>,
  { folderPaths }: AgentTurnChangesOutline,
  visibleRows: number,
): ReadonlySet<string> {
  const { rows } = visibleAgentTurnChangeRows(nodes, collapsed, visibleRows);
  if (hasExpandedFolderRow(rows)) return new Set(folderPaths);
  return NONE_COLLAPSED;
}

function toggled(collapsed: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(collapsed);
  if (!next.delete(path)) next.add(path);
  return next;
}
