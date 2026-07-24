import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import type { DebugVariable } from "../domain/debug";
import type { DebugCopyValueCandidate } from "../application/debugCopyValue";
import type {
  DebugVariableMutationRows,
  DebugVariableRowMutation,
} from "../application/debugSessionContracts";
import {
  selectDebugVariableExpansion,
  type DebugInspectionOwner,
  type DebugVariableExpansionState,
  type DebugVariablePagesState,
} from "../domain/debugVariablePages";
import { ContextMenu } from "./ContextMenu";
import {
  debugCopyValueCandidateForNode,
  debugCopyValuePresentationCandidatesEqual,
  isLocalDebugCopyShortcut,
  publishDebugCopyValueCandidate,
  runDebugCopyEvaluatePathFromMenu,
  runDebugCopyValue,
  runDebugCopyValueFromMenu,
  type DebugCopyValueSurface,
} from "./debugCopyValueSurface";
import { debugValueContextMenuItems } from "./debugValueContextMenuItems";
import { isDebugSetVariableShortcut } from "./debugSetVariableKey";
import {
  publishDebugSetVariableFocusedRow,
  type DebugSetVariableSurface,
} from "./debugSetVariableSurface";
import {
  canDebugAddToWatch,
  publishDebugAddToWatchFocusedRow,
  runDebugAddToWatch,
  type DebugAddToWatchVariableSurface,
} from "./debugAddToWatchSurface";

export const MAX_DEBUG_VARIABLE_TREE_ROWS = 500;

export interface DebugVariableTreeRoot {
  readonly id: string;
  readonly label: string;
  readonly owner: DebugInspectionOwner | null;
  readonly variablesReference: number;
  readonly value?: string;
  readonly type?: string | null;
  readonly evaluateName?: string;
  readonly adapterEvaluateName?: string;
  readonly testId?: string;
}

export interface DebugVariableTreeProps {
  readonly ariaLabel: string;
  readonly roots: readonly DebugVariableTreeRoot[];
  readonly variablePages?: DebugVariablePagesState;
  readonly variablesByReference?: Readonly<Record<number, readonly DebugVariable[]>>;
  readonly variableMutationRows?: DebugVariableMutationRows;
  readonly maxRows?: number;
  readonly addToWatchSurface?: DebugAddToWatchVariableSurface;
  readonly copyValueSurface?: DebugCopyValueSurface;
  readonly setVariableSurface?: DebugSetVariableSurface;
  onLoadPage?(owner: DebugInspectionOwner, variablesReference: number, start: number): void;
  onLoadVariables?(variablesReference: number): void;
}

interface TreeRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly kind: "node" | "action" | "status";
  readonly label: string;
  readonly value?: string;
  readonly type?: string | null;
  readonly evaluateName?: string;
  readonly adapterEvaluateName?: string;
  readonly testId?: string;
  readonly owner: DebugInspectionOwner | null;
  readonly variablesReference: number;
  readonly nextStart?: number;
  readonly loadOnExpand?: boolean;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly busy?: boolean;
  readonly terminal?: string;
  readonly mutation?: DebugVariableRowMutation;
  readonly rowIdentity?: object;
}

const styles: Record<string, CSSProperties> = {
  row: {
    alignItems: "baseline",
    background: "transparent",
    border: 0,
    color: "inherit",
    cursor: "default",
    display: "flex",
    font: "inherit",
    gap: 3,
    overflow: "hidden",
    paddingBottom: 2,
    paddingRight: 8,
    paddingTop: 2,
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    width: "100%",
  },
  muted: { color: "var(--text-muted)" },
  error: { color: "var(--status-error, #ef4444)" },
  editor: {
    background: "var(--surface-raised, #1f2937)",
    border: "1px solid var(--accent, #60a5fa)",
    color: "inherit",
    flex: 1,
    font: "inherit",
    minWidth: 40,
  },
};

export function DebugVariableTree({
  addToWatchSurface,
  ariaLabel,
  copyValueSurface,
  maxRows = MAX_DEBUG_VARIABLE_TREE_ROWS,
  onLoadPage,
  onLoadVariables,
  roots,
  setVariableSurface,
  variablePages,
  variableMutationRows,
  variablesByReference = {},
}: DebugVariableTreeProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    readonly rowId: string;
    readonly mutation: DebugVariableRowMutation;
    readonly rowIdentity: object;
    readonly originalValue: string;
    readonly draft: string;
    readonly pending: boolean;
    readonly error: string | null;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    readonly addToWatchAdapterEvaluateName: string | null;
    readonly addToWatchIdentity: object | null;
    readonly addToWatchOwner: DebugInspectionOwner | null;
    readonly candidate: DebugCopyValueCandidate | null;
    readonly invoker: HTMLElement;
    readonly mutation: DebugVariableRowMutation | null;
    readonly mutationCurrentValue: string | null;
    readonly rowIdentity: object | null;
    readonly rowId: string;
    readonly position: { readonly x: number; readonly y: number };
  } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const editorRef = useRef<HTMLInputElement | null>(null);
  const treeFocusedRef = useRef(false);
  const focusedRowIdRef = useRef<string | null>(null);
  const lastPublishedCandidateRef = useRef<DebugCopyValueCandidate | null>(null);
  const suppressNextFocusPublishRef = useRef(false);
  const surfaceRef = useRef(copyValueSurface);
  surfaceRef.current = copyValueSurface;
  const setVariableSurfaceRef = useRef(setVariableSurface);
  setVariableSurfaceRef.current = setVariableSurface;
  const setVariablePublicationCleanupRef = useRef<() => void>(() => undefined);
  const addToWatchPublicationCleanupRef = useRef<() => void>(() => undefined);
  const addToWatchSurfaceRef = useRef(addToWatchSurface);
  addToWatchSurfaceRef.current = addToWatchSurface;
  const mutationCacheRef = useRef<{
    readonly provider: DebugVariableMutationRows | undefined;
    readonly rows: WeakMap<object, DebugVariableRowMutation>;
  }>({ provider: variableMutationRows, rows: new WeakMap() });
  if (mutationCacheRef.current.provider !== variableMutationRows) {
    mutationCacheRef.current = { provider: variableMutationRows, rows: new WeakMap() };
  }
  const rows = useMemo(() => {
    const built = buildRows({
      expandedIds,
      roots,
      variablePages,
      variableMutationRows,
      variablesByReference,
      paged: Boolean(variablePages),
      maxRows: Math.max(0, Math.min(MAX_DEBUG_VARIABLE_TREE_ROWS, Math.floor(maxRows))),
    });
    return stabilizeRowMutations(built, mutationCacheRef.current.rows);
  }, [expandedIds, maxRows, roots, variableMutationRows, variablePages, variablesByReference]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const previousRowsRef = useRef<readonly TreeRow[]>([]);
  const resolvedActiveId = resolveActiveRow(activeId, rows, previousRowsRef.current);
  const beginEdit = useCallback((row: TreeRow) => {
    if (!row.mutation || !row.rowIdentity || row.value === undefined) return;
    setEditing({
      rowId: row.id,
      mutation: row.mutation,
      rowIdentity: row.rowIdentity,
      originalValue: row.value,
      draft: row.value,
      pending: false,
      error: null,
    });
  }, []);
  const replaceSetVariablePublication = useCallback(
    (candidate: Parameters<typeof publishDebugSetVariableFocusedRow>[1]) => {
      setVariablePublicationCleanupRef.current();
      setVariablePublicationCleanupRef.current = publishDebugSetVariableFocusedRow(
        setVariableSurfaceRef.current,
        candidate,
      );
    },
    [],
  );
  const publishSetVariableRow = useCallback(
    (row: TreeRow | undefined) => {
      if (!row?.mutation || !row.rowIdentity || row.value === undefined) {
        replaceSetVariablePublication(null);
        return;
      }
      const rowIdentity = row.rowIdentity;
      const originalValue = row.value;
      const isCurrent = () => {
        const current = rowsRef.current.find((candidate) => candidate.id === row.id);
        return (
          focusedRowIdRef.current === row.id &&
          document.activeElement === rowRefs.current.get(row.id) &&
          current?.rowIdentity === rowIdentity &&
          current.mutation !== undefined &&
          current.value === originalValue &&
          current.mutation.currentValue === originalValue
        );
      };
      replaceSetVariablePublication(
        Object.freeze({
          identity: Object.freeze({}),
          isCurrent,
          beginEdit: () => {
            if (!isCurrent()) return false;
            const current = rowsRef.current.find((candidate) => candidate.id === row.id);
            if (!current) return false;
            beginEdit(current);
            return true;
          },
        }),
      );
    },
    [beginEdit, replaceSetVariablePublication],
  );
  const publishAddToWatchRow = useCallback((row: TreeRow | undefined) => {
    addToWatchPublicationCleanupRef.current();
    if (
      !row?.rowIdentity ||
      row.depth === 0 ||
      row.value === undefined ||
      !row.owner ||
      !row.adapterEvaluateName?.trim()
    ) {
      addToWatchPublicationCleanupRef.current = () => undefined;
      return;
    }
    const identity = row.rowIdentity;
    const owner = row.owner;
    const adapterEvaluateName = row.adapterEvaluateName;
    const isCurrent = () => {
      const current = rowsRef.current.find((candidate) => candidate.id === row.id);
      return (
        focusedRowIdRef.current === row.id &&
        current?.rowIdentity === identity &&
        current.owner === owner &&
        current.value !== undefined &&
        current.adapterEvaluateName === adapterEvaluateName
      );
    };
    addToWatchPublicationCleanupRef.current = publishDebugAddToWatchFocusedRow(
      addToWatchSurfaceRef.current,
      Object.freeze({ identity, owner, adapterEvaluateName, isCurrent }),
    );
  }, []);

  useEffect(() => {
    if (activeId === resolvedActiveId) return;
    setActiveId(resolvedActiveId);
    if (treeFocusedRef.current && resolvedActiveId) rowRefs.current.get(resolvedActiveId)?.focus();
  }, [activeId, resolvedActiveId]);

  useEffect(() => {
    previousRowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    if (!editing) return;
    if (
      !rows.some(
        (row) =>
          row.id === editing.rowId &&
          row.rowIdentity === editing.rowIdentity &&
          row.mutation !== undefined &&
          row.value === editing.originalValue &&
          row.mutation.currentValue === editing.originalValue,
      )
    ) {
      setEditing(null);
      return;
    }
    editorRef.current?.focus();
    editorRef.current?.select();
  }, [editing, rows]);

  useEffect(() => {
    if (contextMenu) {
      const row = rows.find((candidate) => candidate.id === contextMenu.rowId);
      const candidate = row ? copyCandidate(row, copyValueSurface) : null;
      if (
        !debugCopyValuePresentationCandidatesEqual(contextMenu.candidate, candidate) ||
        (contextMenu.addToWatchIdentity !== null &&
          ((row?.rowIdentity ?? null) !== contextMenu.addToWatchIdentity ||
            (row?.owner ?? null) !== contextMenu.addToWatchOwner ||
            (row?.adapterEvaluateName ?? null) !== contextMenu.addToWatchAdapterEvaluateName)) ||
        (row?.mutation ?? null) !== contextMenu.mutation ||
        (row?.rowIdentity ?? null) !== contextMenu.rowIdentity ||
        (row?.mutation?.currentValue ?? null) !== contextMenu.mutationCurrentValue
      ) {
        const { invoker, rowId } = contextMenu;
        setContextMenu(null);
        lastPublishedCandidateRef.current = null;
        publishDebugCopyValueCandidate(copyValueSurface, null);
        if (invoker.isConnected && rowRefs.current.get(rowId) === invoker) {
          suppressNextFocusPublishRef.current = true;
          invoker.focus();
        }
      }
      return;
    }
    const focusedRowId = focusedRowIdRef.current;
    if (!focusedRowId || document.activeElement !== rowRefs.current.get(focusedRowId)) return;
    const row = rows.find((candidate) => candidate.id === focusedRowId);
    publishSetVariableRow(row);
    publishAddToWatchRow(row);
    const candidate = row ? copyCandidate(row, copyValueSurface) : null;
    if (debugCopyValuePresentationCandidatesEqual(lastPublishedCandidateRef.current, candidate))
      return;
    lastPublishedCandidateRef.current = candidate;
    publishDebugCopyValueCandidate(copyValueSurface, candidate);
  }, [contextMenu, copyValueSurface, publishAddToWatchRow, publishSetVariableRow, rows]);

  useEffect(
    () => () => {
      if (focusedRowIdRef.current) publishDebugCopyValueCandidate(surfaceRef.current, null);
      setVariablePublicationCleanupRef.current();
      addToWatchPublicationCleanupRef.current();
    },
    [],
  );

  const focusRow = (id: string | null) => {
    if (!id) return;
    setActiveId(id);
    rowRefs.current.get(id)?.focus();
  };
  const setExpanded = (row: TreeRow, expanded: boolean) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(row.id);
      else next.delete(row.id);
      return next;
    });
    if (!expanded || !row.expandable) return;
    if (row.loadOnExpand) {
      requestVariables(row, variablePages, variablesByReference, onLoadPage, onLoadVariables);
    }
  };
  const activate = (row: TreeRow) => {
    if (row.kind === "action") {
      if (row.owner && row.nextStart !== undefined) {
        onLoadPage?.(row.owner, row.variablesReference, row.nextStart);
      }
      return;
    }
    if (row.kind === "node" && row.expandable) setExpanded(row, !row.expanded);
  };
  const commitEdit = async () => {
    const current = editing;
    if (!current || current.pending) return;
    if (current.draft === current.originalValue) {
      setEditing(null);
      return;
    }
    setEditing({ ...current, pending: true, error: null });
    try {
      const result = await current.mutation.commit(current.draft);
      setEditing((latest) => (sameEditAttempt(latest, current) ? null : latest));
      if (!result) return;
    } catch (error) {
      setEditing((latest) => {
        if (!latest || !sameEditAttempt(latest, current)) return latest;
        return {
          ...latest,
          pending: false,
          error: error instanceof Error ? error.message : "Unable to set variable value.",
        };
      });
      queueMicrotask(() => editorRef.current?.focus());
    }
  };
  const cancelEditOnBlur = (event: FocusEvent<HTMLInputElement>) => {
    if (editing?.pending) return;
    if (event.relatedTarget && event.currentTarget.parentElement?.contains(event.relatedTarget)) {
      return;
    }
    setEditing(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, row: TreeRow, index: number) => {
    const candidate = copyCandidate(row, copyValueSurface);
    if (isLocalDebugCopyShortcut(event) && candidate) {
      publishDebugCopyValueCandidate(copyValueSurface, candidate);
      if (runDebugCopyValue(copyValueSurface)) event.preventDefault();
      return;
    }
    if (row.mutation && isDebugSetVariableShortcut(event.key)) {
      event.stopPropagation();
      beginEdit(row);
    } else if (event.key === "ArrowDown") focusRow(rows[index + 1]?.id ?? null);
    else if (event.key === "ArrowUp") focusRow(rows[index - 1]?.id ?? null);
    else if (event.key === "Home") focusRow(rows[0]?.id ?? null);
    else if (event.key === "End") focusRow(rows[rows.length - 1]?.id ?? null);
    else if (event.key === "ArrowRight") {
      if (row.expandable && !row.expanded) setExpanded(row, true);
      else if (row.expanded) focusRow(rows[index + 1]?.id ?? null);
    } else if (event.key === "ArrowLeft") {
      if (row.expandable && row.expanded) setExpanded(row, false);
      else focusRow(row.parentId);
    } else if (event.key === "Enter" || event.key === " ") activate(row);
    else return;
    event.preventDefault();
  };

  return (
    <div
      aria-busy={rows.some((row) => row.busy) || undefined}
      aria-label={ariaLabel}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          treeFocusedRef.current = false;
          lastPublishedCandidateRef.current = null;
          if (!contextMenu) {
            focusedRowIdRef.current = null;
            publishDebugCopyValueCandidate(copyValueSurface, null);
            addToWatchPublicationCleanupRef.current();
          }
          replaceSetVariablePublication(null);
        }
      }}
      onFocusCapture={() => {
        treeFocusedRef.current = true;
      }}
      role="tree"
    >
      <div role="group">
        {rows.map((row, index) => (
          <div
            aria-busy={row.busy || undefined}
            aria-expanded={row.expandable ? row.expanded : undefined}
            aria-label={rowAriaLabel(row)}
            aria-level={row.depth + 1}
            data-testid={
              row.testId ?? (row.kind === "node" && row.depth > 0 ? "debug-variable" : undefined)
            }
            key={row.id}
            onClick={(event) => {
              if ((event.target as Element).closest("[data-debug-variable-value]")) return;
              activate(row);
            }}
            onDoubleClick={(event) => {
              if (
                !row.mutation ||
                !(event.target as Element).closest("[data-debug-variable-value]")
              )
                return;
              event.preventDefault();
              beginEdit(row);
            }}
            onContextMenu={(event) => {
              const candidate = copyCandidate(row, copyValueSurface);
              focusedRowIdRef.current = row.id;
              setActiveId(row.id);
              publishAddToWatchRow(row);
              const canAddToWatch = canDebugAddToWatch(addToWatchSurface);
              if (!candidate && !row.mutation && !canAddToWatch) return;
              event.preventDefault();
              publishDebugCopyValueCandidate(copyValueSurface, candidate);
              lastPublishedCandidateRef.current = candidate;
              setContextMenu({
                addToWatchAdapterEvaluateName: canAddToWatch
                  ? (row.adapterEvaluateName ?? null)
                  : null,
                addToWatchIdentity: canAddToWatch ? (row.rowIdentity ?? null) : null,
                addToWatchOwner: canAddToWatch ? row.owner : null,
                candidate,
                invoker: event.currentTarget,
                mutation: row.mutation ?? null,
                mutationCurrentValue: row.mutation?.currentValue ?? null,
                rowIdentity: row.rowIdentity ?? null,
                rowId: row.id,
                position: { x: event.clientX, y: event.clientY },
              });
            }}
            onFocus={() => {
              setActiveId(row.id);
              focusedRowIdRef.current = row.id;
              const candidate = copyCandidate(row, copyValueSurface);
              lastPublishedCandidateRef.current = candidate;
              if (suppressNextFocusPublishRef.current) {
                suppressNextFocusPublishRef.current = false;
              } else {
                publishDebugCopyValueCandidate(copyValueSurface, candidate);
              }
              publishSetVariableRow(row);
              publishAddToWatchRow(row);
            }}
            onKeyDown={(event) => onKeyDown(event, row, index)}
            ref={(element) => {
              if (element) rowRefs.current.set(row.id, element);
              else rowRefs.current.delete(row.id);
            }}
            role="treeitem"
            style={{ ...styles.row, paddingLeft: 8 + row.depth * 12 }}
            tabIndex={row.id === resolvedActiveId ? 0 : -1}
          >
            <span aria-hidden="true">{row.expandable ? (row.expanded ? "▾" : "▸") : ""}</span>
            <span style={row.kind === "status" ? styles.muted : undefined}>{row.label}</span>
            {editing?.rowId === row.id ? (
              <span style={{ display: "inline-flex", flex: 1, flexDirection: "column" }}>
                <input
                  aria-busy={editing.pending || undefined}
                  aria-disabled={editing.pending || undefined}
                  aria-label={`Set value for ${row.label}`}
                  onBlur={cancelEditOnBlur}
                  onChange={(event) =>
                    setEditing((current) =>
                      current?.rowId === row.id && !current.pending
                        ? { ...current, draft: event.target.value, error: null }
                        : current,
                    )
                  }
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (editing.pending && (event.key === "Enter" || event.key === "Escape")) {
                      event.preventDefault();
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void commitEdit();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setEditing(null);
                      queueMicrotask(() => rowRefs.current.get(row.id)?.focus());
                    }
                  }}
                  ref={editorRef}
                  readOnly={editing.pending}
                  style={styles.editor}
                  value={editing.draft}
                />
                {editing.error ? (
                  <span role="alert" style={styles.error}>
                    {editing.error}
                  </span>
                ) : null}
              </span>
            ) : row.value !== undefined ? (
              <span data-debug-variable-value="true" style={styles.muted}>
                {" = "}
                {row.value}
                {row.type ? ` (${row.type})` : ""}
              </span>
            ) : null}
            {row.terminal ? <span style={styles.muted}> — {row.terminal}</span> : null}
          </div>
        ))}
      </div>
      {contextMenu ? (
        <ContextMenu
          ariaLabel="Variable actions"
          items={debugValueContextMenuItems({
            candidate: contextMenu.candidate,
            surface: copyValueSurface,
            onCopyValue: () => {
              publishDebugCopyValueCandidate(copyValueSurface, contextMenu.candidate);
              lastPublishedCandidateRef.current = contextMenu.candidate;
              if (!runDebugCopyValueFromMenu(copyValueSurface)) {
                lastPublishedCandidateRef.current = null;
                publishDebugCopyValueCandidate(copyValueSurface, null);
              }
            },
            onCopyEvaluatePath: () => {
              if (!contextMenu.candidate) return;
              publishDebugCopyValueCandidate(copyValueSurface, contextMenu.candidate);
              lastPublishedCandidateRef.current = contextMenu.candidate;
              if (!runDebugCopyEvaluatePathFromMenu(copyValueSurface)) {
                lastPublishedCandidateRef.current = null;
                publishDebugCopyValueCandidate(copyValueSurface, null);
              }
            },
            onSetValue: contextMenu.mutation
              ? () => {
                  const row = rows.find((candidate) => candidate.id === contextMenu.rowId);
                  if (
                    row?.mutation === contextMenu.mutation &&
                    row.rowIdentity === contextMenu.rowIdentity &&
                    row.mutation.currentValue === contextMenu.mutationCurrentValue &&
                    contextMenu.mutation !== null
                  ) {
                    beginEdit(row);
                  }
                }
              : undefined,
            onAddToWatch: contextMenu.addToWatchIdentity
              ? () => {
                  runDebugAddToWatch(addToWatchSurface);
                }
              : undefined,
          })}
          onClose={(reason) => {
            const { invoker, rowId } = contextMenu;
            setContextMenu(null);
            if (reason === "cancel") {
              lastPublishedCandidateRef.current = null;
              publishDebugCopyValueCandidate(copyValueSurface, null);
              addToWatchPublicationCleanupRef.current();
            }
            if (invoker.isConnected && rowRefs.current.get(rowId) === invoker) {
              suppressNextFocusPublishRef.current = true;
              invoker.focus();
            }
          }}
          position={contextMenu.position}
        />
      ) : null}
    </div>
  );
}

function stabilizeRowMutations(
  rows: readonly TreeRow[],
  cache: WeakMap<object, DebugVariableRowMutation>,
): TreeRow[] {
  return rows.map((row) => {
    if (!row.rowIdentity || !row.mutation) return row;
    const cached = cache.get(row.rowIdentity);
    if (cached?.currentValue === row.mutation.currentValue) return { ...row, mutation: cached };
    cache.set(row.rowIdentity, row.mutation);
    return row;
  });
}

function sameEditAttempt(
  latest: {
    readonly rowId: string;
    readonly mutation: DebugVariableRowMutation;
    readonly rowIdentity: object;
  } | null,
  settled: {
    readonly rowId: string;
    readonly mutation: DebugVariableRowMutation;
    readonly rowIdentity: object;
  },
): boolean {
  return (
    latest?.rowId === settled.rowId &&
    latest.mutation === settled.mutation &&
    latest.rowIdentity === settled.rowIdentity
  );
}

function buildRows({
  expandedIds,
  maxRows,
  paged,
  roots,
  variablePages,
  variableMutationRows,
  variablesByReference,
}: {
  expandedIds: ReadonlySet<string>;
  maxRows: number;
  paged: boolean;
  roots: readonly DebugVariableTreeRoot[];
  variablePages: DebugVariablePagesState | undefined;
  variableMutationRows: DebugVariableMutationRows | undefined;
  variablesByReference: Readonly<Record<number, readonly DebugVariable[]>>;
}): TreeRow[] {
  const rows: TreeRow[] = [];
  if (maxRows === 0) return rows;
  let overflowed = false;
  const append = (row: TreeRow) => {
    if (rows.length < maxRows) rows.push(row);
    else overflowed = true;
  };
  const visit = (
    id: string,
    parentId: string | null,
    depth: number,
    label: string,
    value: string | undefined,
    type: string | null | undefined,
    evaluateName: string | undefined,
    adapterEvaluateName: string | undefined,
    variablesReference: number,
    owner: DebugInspectionOwner | null,
    ancestors: readonly number[],
    testId?: string,
    mutation?: DebugVariableRowMutation,
    rowIdentity?: object,
  ) => {
    if (rows.length >= maxRows) {
      overflowed = true;
      return;
    }
    const expansion = expansionFor(
      paged,
      variablePages,
      variablesByReference,
      owner,
      variablesReference,
      ancestors,
      depth,
    );
    const terminalExpansion =
      expansion.kind === "circular" || expansion.kind === "limit" || expansion.kind === "stale";
    const terminal = terminalExpansion ? terminalExpansionLabel(expansion) : undefined;
    const expandable = variablesReference > 0 && expansion.kind !== "leaf" && !terminalExpansion;
    const expanded = expandable && expandedIds.has(id);
    append({
      id,
      parentId,
      depth,
      kind: "node",
      label,
      value,
      type,
      evaluateName,
      adapterEvaluateName,
      testId,
      owner,
      variablesReference,
      expandable,
      expanded,
      busy: expanded && expansion.kind === "loading",
      terminal,
      mutation,
      rowIdentity,
      loadOnExpand: expansion.kind === "idle",
    });
    if (terminalExpansion) return;
    if (!expanded) return;
    const variables = "variables" in expansion ? expansion.variables : [];
    variables.forEach((variable, index) => {
      const location = variablePages
        ? findPagedVariableLocation(variablePages, variablesReference, variable)
        : null;
      const mutation =
        owner && location
          ? (variableMutationRows?.forRow(
              owner,
              variablesReference,
              location.pageStart,
              location.index,
            ) ?? undefined)
          : undefined;
      visit(
        `${id}/${index}:${variable.name}`,
        id,
        depth + 1,
        variable.name,
        variable.value,
        variable.type,
        variable.evaluateName,
        variable.evaluateName,
        variable.variablesReference,
        owner,
        [...ancestors, variablesReference],
        undefined,
        mutation,
        variable,
      );
    });
    if (expansion.kind === "idle" || expansion.kind === "loading") {
      append(statusRow(id, depth + 1, "Loading…"));
    } else if (expansion.kind === "error") {
      append(
        actionRow(
          id,
          depth + 1,
          `Retry: ${expansion.message}`,
          owner,
          variablesReference,
          expansion.nextStart,
        ),
      );
    } else if (expansion.kind === "ready" && expansion.nextStart !== null) {
      append(actionRow(id, depth + 1, "Load more", owner, variablesReference, expansion.nextStart));
    }
  };
  roots.forEach((root) =>
    visit(
      `root:${root.id}`,
      null,
      0,
      root.label,
      root.value,
      root.type,
      root.evaluateName,
      root.adapterEvaluateName,
      root.variablesReference,
      root.owner,
      [],
      root.testId,
      undefined,
      undefined,
    ),
  );
  if (overflowed) {
    rows[maxRows - 1] = statusRow(null, 0, "Display limit reached");
  }
  return rows;
}

function findPagedVariableLocation(
  state: DebugVariablePagesState,
  parentVariablesReference: number,
  variable: DebugVariable,
): { readonly pageStart: number; readonly index: number } | null {
  const pages = state.references[parentVariablesReference]?.pages;
  if (!pages) return null;
  for (const [pageStart, page] of Object.entries(pages)) {
    const index = page.variables.indexOf(variable);
    if (index >= 0) return { pageStart: Number(pageStart), index };
  }
  return null;
}

function expansionFor(
  paged: boolean,
  variablePages: DebugVariablePagesState | undefined,
  variablesByReference: Readonly<Record<number, readonly DebugVariable[]>>,
  owner: DebugInspectionOwner | null,
  variablesReference: number,
  ancestors: readonly number[],
  depth: number,
): DebugVariableExpansionState {
  if (variablesReference <= 0) return { kind: "leaf" };
  if (paged) {
    if (!variablePages || !owner) return { kind: "stale" };
    return selectDebugVariableExpansion(variablePages, owner, variablesReference, ancestors, depth);
  }
  if (ancestors.includes(variablesReference)) return { kind: "circular" };
  if (depth >= 10) return { kind: "limit", reason: "depth" };
  const variables = variablesByReference[variablesReference];
  return variables ? { kind: "ready", variables, nextStart: null } : { kind: "idle", nextStart: 0 };
}

function copyCandidate(
  row: TreeRow,
  surface: DebugCopyValueSurface | undefined,
): DebugCopyValueCandidate | null {
  if (row.kind !== "node") return null;
  return debugCopyValueCandidateForNode({
    adapterEvaluateName: row.adapterEvaluateName,
    displayedValue: row.value,
    evaluateName: row.evaluateName,
    identity: row.id,
    owner: row.owner,
    surface,
  });
}

function requestVariables(
  row: TreeRow,
  variablePages: DebugVariablePagesState | undefined,
  variablesByReference: Readonly<Record<number, readonly DebugVariable[]>>,
  onLoadPage: DebugVariableTreeProps["onLoadPage"],
  onLoadVariables: DebugVariableTreeProps["onLoadVariables"],
) {
  if (variablePages && onLoadPage && row.owner) {
    onLoadPage(row.owner, row.variablesReference, 0);
  } else if (!variablesByReference[row.variablesReference]) {
    onLoadVariables?.(row.variablesReference);
  }
}

function statusRow(parentId: string | null, depth: number, label: string): TreeRow {
  return {
    id: `${parentId ?? "tree"}/status:${label}`,
    parentId,
    depth,
    kind: "status",
    label,
    owner: null,
    variablesReference: 0,
    expandable: false,
    expanded: false,
  };
}

function actionRow(
  parentId: string,
  depth: number,
  label: string,
  owner: DebugInspectionOwner | null,
  variablesReference: number,
  nextStart: number,
): TreeRow {
  return {
    id: `${parentId}/action:${nextStart}`,
    parentId,
    depth,
    kind: "action",
    label,
    owner,
    variablesReference,
    nextStart,
    expandable: false,
    expanded: false,
  };
}

function rowAriaLabel(row: TreeRow): string {
  if (row.kind !== "node") return row.label;
  if (row.expandable) return `${row.expanded ? "Collapse" : "Expand"} ${row.label}`;
  const value = row.value === undefined ? "" : `, ${row.value}`;
  const type = row.type ? `, ${row.type}` : "";
  const terminal = row.terminal ? `, ${row.terminal}` : "";
  return `${row.label}${value}${type}${terminal}`;
}

function terminalExpansionLabel(
  expansion: Extract<DebugVariableExpansionState, { kind: "circular" | "limit" | "stale" }>,
): string {
  if (expansion.kind === "circular") return "Circular reference";
  if (expansion.kind === "limit") return `Limit reached: ${expansion.reason}`;
  return "No longer available";
}

function resolveActiveRow(
  activeId: string | null,
  rows: readonly TreeRow[],
  previousRows: readonly TreeRow[],
): string | null {
  if (activeId && rows.some((row) => row.id === activeId)) return activeId;
  if (!activeId) return rows[0]?.id ?? null;
  const previousActive = previousRows.find((row) => row.id === activeId);
  if (!previousActive) return rows[0]?.id ?? null;
  const previousIds = new Set(previousRows.map((row) => row.id));
  const newSibling = rows.find(
    (row) => row.parentId === previousActive.parentId && !previousIds.has(row.id),
  );
  if (newSibling) return newSibling.id;
  const replacementState = rows.find(
    (row) => row.parentId === previousActive.parentId && row.kind !== "node",
  );
  if (replacementState) return replacementState.id;
  if (previousActive.parentId && rows.some((row) => row.id === previousActive.parentId)) {
    return previousActive.parentId;
  }
  return rows[0]?.id ?? null;
}
