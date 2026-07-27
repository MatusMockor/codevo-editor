import { Check, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { validateDebugExpression } from "../domain/debugEvaluationPolicy";
import type { DebugWatchDefinition } from "../domain/debugWatchExpressions";
import type { DebugWatchEvaluation } from "../application/useDebugWatchExpressions";
import type {
  ActiveDebugAdapterKind,
  DebugVariableMutationRows,
  DebugWatchExpressionMutation,
  DebugWatchExpressionMutations,
} from "../application/debugSessionContracts";
import type { DebugCopyValueCandidate } from "../application/debugCopyValue";
import {
  debugInspectionOwnersEqual,
  type DebugInspectionOwner,
  type DebugVariablePagesState,
} from "../domain/debugVariablePages";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { ContextMenu } from "./ContextMenu";
import { DebugVariableTree, MAX_DEBUG_VARIABLE_TREE_ROWS } from "./DebugVariableTree";
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
import type { DebugSetVariableSurface } from "./debugSetVariableSurface";
import { debugWatchValueContextMenuItems } from "./debugWatchValueContextMenuItems";

export interface DebugWatchesPanelProps {
  readonly debugAdapterKind: ActiveDebugAdapterKind;
  readonly definitions: readonly DebugWatchDefinition[];
  readonly evaluations: Readonly<Record<string, DebugWatchEvaluation>>;
  readonly pendingIds: readonly string[];
  readonly sessionState: "inactive" | "starting" | "running" | "stopped" | "terminated";
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
  readonly variablePages?: DebugVariablePagesState;
  readonly variableMutationRows?: DebugVariableMutationRows;
  readonly copyValueSurface?: DebugCopyValueSurface;
  readonly setVariableSurface?: DebugSetVariableSurface;
  readonly expressionMutations?: DebugWatchExpressionMutations;
  readonly canRefresh?: boolean;
  readonly refreshPending?: boolean;
  onAdd(expression: string, enabled?: boolean): void;
  onClear(): void;
  onRefresh?(): void;
  onRemove(id: string): void;
  onSetEnabled(id: string, enabled: boolean): void;
  onUpdate(id: string, expression: string): void;
  onLoadVariablePage?(owner: DebugInspectionOwner, variablesReference: number, start: number): void;
}

interface EditorState {
  readonly id: string | null;
  readonly original: string;
}

interface ValueEditorState {
  readonly draft: string;
  readonly error: string | null;
  readonly mutation: DebugWatchExpressionMutation;
  readonly originalValue: string;
  readonly pending: boolean;
  readonly rowId: string;
}

const styles: Record<string, CSSProperties> = {
  action: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    display: "inline-flex",
    padding: 2,
  },
  editor: {
    background: "transparent",
    border: "1px solid var(--border-subtle)",
    borderRadius: 3,
    color: "inherit",
    flex: 1,
    minWidth: 0,
    padding: "2px 4px",
  },
  error: { color: "var(--status-error, #ef4444)", fontSize: 11 },
  header: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    justifyContent: "space-between",
    padding: "4px 8px",
  },
  message: { color: "var(--text-muted)", padding: 8 },
  muted: { color: "var(--text-muted)" },
  nestedTree: {
    display: "flex",
    flexDirection: "column",
    maxHeight: 360,
    overflow: "hidden",
  },
  row: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "grid",
    gap: 5,
    gridTemplateColumns: "auto minmax(0, 1fr) auto auto",
    padding: "3px 6px",
  },
  rowBody: { minWidth: 0, overflow: "hidden" },
  expression: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  value: {
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono, monospace)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};

export function DebugWatchesPanel({
  canRefresh = false,
  copyValueSurface,
  debugAdapterKind,
  definitions,
  evaluations,
  expressionMutations,
  onAdd,
  onClear,
  onRefresh,
  onRemove,
  onSetEnabled,
  onUpdate,
  onLoadVariablePage,
  pendingIds,
  refreshPending = false,
  setVariableSurface,
  sessionState,
  variableMutationRows,
  workspaceRoot,
  workspaceTrusted,
  variablePages,
}: DebugWatchesPanelProps) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [valueEditor, setValueEditor] = useState<ValueEditorState | null>(null);
  const [draft, setDraft] = useState("");
  const [activeRowId, setActiveRowId] = useState<string | null>(definitions[0]?.id ?? null);
  const [contextMenu, setContextMenu] = useState<{
    readonly copyCandidate: DebugCopyValueCandidate | null;
    readonly invoker: HTMLDivElement;
    readonly mutation: DebugWatchExpressionMutation | null;
    readonly rowId: string;
    readonly position: { readonly x: number; readonly y: number };
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const valueInputRef = useRef<HTMLInputElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocusRef = useRef<string | "add" | null>(null);
  const pendingExpressionRef = useRef<string | null>(null);
  const focusedRootIdRef = useRef<string | null>(null);
  const lastPublishedCandidateRef = useRef<DebugCopyValueCandidate | null>(null);
  const suppressNextFocusPublishRef = useRef(false);
  const surfaceRef = useRef(copyValueSurface);
  surfaceRef.current = copyValueSurface;
  const errorId = `${useId()}-watch-error`;
  const validation = editor ? validateDebugExpression(draft) : null;
  const visibleDefinitions = definitions.slice(0, MAX_DEBUG_VARIABLE_TREE_ROWS);
  const mutationFor = useCallback(
    (id: string): DebugWatchExpressionMutation | null => {
      const definition = definitions
        .slice(0, MAX_DEBUG_VARIABLE_TREE_ROWS)
        .find((item) => item.id === id);
      if (!definition) return null;
      return watchExpressionMutation({
        debugAdapterKind,
        definition,
        editorOpen: editor !== null,
        evaluation: evaluations[id],
        expressionMutations,
        pending: pendingIds.includes(id),
        sessionState,
        workspaceRoot,
        workspaceTrusted,
      });
    },
    [
      debugAdapterKind,
      definitions,
      editor,
      evaluations,
      expressionMutations,
      pendingIds,
      sessionState,
      workspaceRoot,
      workspaceTrusted,
    ],
  );
  const mutationForRef = useRef(mutationFor);
  mutationForRef.current = mutationFor;
  const editedValueMutation = valueEditor?.mutation ?? null;
  const editedValueRowId = valueEditor?.rowId ?? null;
  const expandableWatchIds = visibleDefinitions.flatMap((definition) => {
    const result = evaluations[definition.id]?.result;
    return editor?.id !== definition.id &&
      result?.status === "ok" &&
      (result.variablesReference ?? 0) > 0
      ? [definition.id]
      : [];
  });
  const nestedRowsBudget = Math.max(0, MAX_DEBUG_VARIABLE_TREE_ROWS - visibleDefinitions.length);
  const resolvedActiveRowId = visibleDefinitions.some((definition) => definition.id === activeRowId)
    ? activeRowId
    : (visibleDefinitions[0]?.id ?? null);

  useEffect(() => {
    if (editor) inputRef.current?.focus();
  }, [editor]);

  useEffect(() => {
    if (!editedValueMutation || !editedValueRowId) return;
    if (!sameWatchMutation(editedValueMutation, mutationForRef.current(editedValueRowId))) {
      setValueEditor(null);
      pendingFocusRef.current = editedValueRowId;
      return;
    }
    valueInputRef.current?.focus();
    valueInputRef.current?.select();
  }, [editedValueMutation, editedValueRowId, mutationFor]);

  useEffect(() => {
    if (activeRowId !== resolvedActiveRowId) setActiveRowId(resolvedActiveRowId);
  }, [activeRowId, resolvedActiveRowId]);

  useEffect(() => {
    const expression = pendingExpressionRef.current;
    if (expression !== null) {
      const added = definitions.find((definition) => definition.expression === expression);
      if (added) {
        rowRefs.current.get(added.id)?.focus();
        pendingExpressionRef.current = null;
      }
    }
    const target = pendingFocusRef.current;
    if (target === null) return;
    if (target === "add") addButtonRef.current?.focus();
    else rowRefs.current.get(target)?.focus();
    pendingFocusRef.current = null;
  }, [definitions, editor, valueEditor?.rowId]);

  useEffect(() => {
    const candidateFor = (id: string): DebugCopyValueCandidate | null => {
      const definition = visibleDefinitions.find((item) => item.id === id);
      if (!definition) return null;
      return watchCopyCandidate({
        copyValueSurface,
        definition,
        editorId: editor?.id,
        evaluation: evaluations[id],
        pending: pendingIds.includes(id),
        debugAdapterKind,
        sessionState,
        workspaceRoot,
        workspaceTrusted,
      });
    };
    if (contextMenu) {
      const copyCandidate = candidateFor(contextMenu.rowId);
      const mutation = mutationFor(contextMenu.rowId);
      if (
        !debugCopyValuePresentationCandidatesEqual(contextMenu.copyCandidate, copyCandidate) ||
        !sameWatchMutation(contextMenu.mutation, mutation)
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
    const focusedRootId = focusedRootIdRef.current;
    if (!focusedRootId || document.activeElement !== rowRefs.current.get(focusedRootId)) return;
    const candidate = candidateFor(focusedRootId);
    if (debugCopyValuePresentationCandidatesEqual(lastPublishedCandidateRef.current, candidate))
      return;
    lastPublishedCandidateRef.current = candidate;
    publishDebugCopyValueCandidate(copyValueSurface, candidate);
  }, [
    contextMenu,
    copyValueSurface,
    debugAdapterKind,
    editor?.id,
    evaluations,
    expressionMutations,
    mutationFor,
    pendingIds,
    sessionState,
    valueEditor,
    visibleDefinitions,
    workspaceRoot,
    workspaceTrusted,
  ]);

  useEffect(
    () => () => {
      if (focusedRootIdRef.current) publishDebugCopyValueCandidate(surfaceRef.current, null);
    },
    [],
  );

  const beginAdd = () => {
    if (!workspaceRoot || valueEditor) return;
    setDraft("");
    setEditor({ id: null, original: "" });
  };
  const beginEdit = (definition: DebugWatchDefinition) => {
    if (valueEditor) return;
    setDraft(definition.expression);
    setEditor({ id: definition.id, original: definition.expression });
  };
  const cancel = () => {
    pendingFocusRef.current = editor?.id ?? "add";
    setEditor(null);
  };
  const beginValueEdit = (rowId: string, captured: DebugWatchExpressionMutation): boolean => {
    const current = mutationForRef.current(rowId);
    if (!current || !sameWatchMutation(captured, current)) return false;
    setValueEditor({
      draft: current.currentValue,
      error: null,
      mutation: current,
      originalValue: current.currentValue,
      pending: false,
      rowId,
    });
    return true;
  };
  const cancelValueEdit = () => {
    if (!valueEditor || valueEditor.pending) return;
    pendingFocusRef.current = valueEditor.rowId;
    setValueEditor(null);
  };
  const commitValueEdit = async () => {
    const current = valueEditor;
    if (!current || current.pending || !current.draft.trim()) return;
    if (!sameWatchMutation(current.mutation, mutationForRef.current(current.rowId))) {
      setValueEditor(null);
      return;
    }
    if (current.draft === current.originalValue) {
      pendingFocusRef.current = current.rowId;
      setValueEditor(null);
      return;
    }
    setValueEditor({ ...current, error: null, pending: true });
    try {
      const result = await current.mutation.setValue(current.draft);
      if (!sameWatchMutation(current.mutation, mutationForRef.current(current.rowId))) return;
      if (!result) {
        setValueEditor((latest) =>
          sameValueEditAttempt(latest, current)
            ? {
                ...latest!,
                error: "Unable to set the watch value in the current debug context.",
                pending: false,
              }
            : latest,
        );
        queueMicrotask(() => valueInputRef.current?.focus());
        return;
      }
      pendingFocusRef.current = current.rowId;
      setValueEditor((latest) => (sameValueEditAttempt(latest, current) ? null : latest));
    } catch (error) {
      if (!sameWatchMutation(current.mutation, mutationForRef.current(current.rowId))) return;
      setValueEditor((latest) =>
        sameValueEditAttempt(latest, current)
          ? {
              ...latest!,
              error: error instanceof Error ? error.message : "Unable to set watch value.",
              pending: false,
            }
          : latest,
      );
      queueMicrotask(() => valueInputRef.current?.focus());
    }
  };
  const commit = () => {
    if (!editor || !validation?.ok) return;
    if (editor.id === null) {
      pendingExpressionRef.current = validation.expression;
      onAdd(validation.expression);
    } else {
      pendingFocusRef.current = editor.id;
      if (validation.expression !== editor.original) onUpdate(editor.id, validation.expression);
    }
    setEditor(null);
  };
  const remove = (id: string) => {
    const index = definitions.findIndex((definition) => definition.id === id);
    pendingFocusRef.current = definitions[index + 1]?.id ?? definitions[index - 1]?.id ?? "add";
    onRemove(id);
  };
  const focusSibling = (id: string, offset: -1 | 1) => {
    const index = visibleDefinitions.findIndex((definition) => definition.id === id);
    const target = visibleDefinitions[index + offset];
    if (target) rowRefs.current.get(target.id)?.focus();
  };
  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, definition: DebugWatchDefinition) => {
    if (event.target !== event.currentTarget) return;
    const candidate = watchCopyCandidate({
      copyValueSurface,
      definition,
      editorId: editor?.id,
      evaluation: evaluations[definition.id],
      pending: pendingIds.includes(definition.id),
      debugAdapterKind,
      sessionState,
      workspaceRoot,
      workspaceTrusted,
    });
    if (isLocalDebugCopyShortcut(event) && candidate) {
      publishDebugCopyValueCandidate(copyValueSurface, candidate);
      if (runDebugCopyValue(copyValueSurface)) event.preventDefault();
      return;
    }
    if (event.key === "Enter" || event.key === " " || event.key === "F2") {
      event.preventDefault();
      beginEdit(definition);
    } else if (event.key === "Delete") {
      event.preventDefault();
      remove(definition.id);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusSibling(definition.id, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusSibling(definition.id, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      rowRefs.current.get(visibleDefinitions[0]?.id ?? "")?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      rowRefs.current.get(visibleDefinitions[visibleDefinitions.length - 1]?.id ?? "")?.focus();
    }
  };

  const contextMessage = watchContextMessage({
    debugAdapterKind,
    sessionState,
    workspaceRoot,
    workspaceTrusted,
  });

  return (
    <section aria-label="Watch expressions">
      <div style={styles.header}>
        <strong>Watch</strong>
        <span>
          <button
            aria-label="Add watch"
            disabled={!workspaceRoot || editor !== null || valueEditor !== null}
            onClick={beginAdd}
            ref={addButtonRef}
            style={styles.action}
            title="Add watch expression"
            type="button"
          >
            <Plus aria-hidden="true" size={13} />
          </button>
          <button
            aria-busy={refreshPending || undefined}
            aria-label="Refresh watches"
            disabled={refreshPending || !canRefresh || !onRefresh}
            onClick={() => onRefresh?.()}
            style={styles.action}
            title="Refresh watch expressions"
            type="button"
          >
            <RefreshCw aria-hidden="true" size={13} />
          </button>
          <button
            aria-label="Clear watches"
            disabled={definitions.length === 0}
            onClick={onClear}
            style={styles.action}
            title="Clear watch expressions"
            type="button"
          >
            <Trash2 aria-hidden="true" size={13} />
          </button>
        </span>
      </div>
      {contextMessage ? (
        <div data-testid="debug-watch-context" style={styles.message}>
          {contextMessage}
        </div>
      ) : null}
      {editor?.id === null ? (
        <WatchEditor
          draft={draft}
          errorId={errorId}
          inputRef={inputRef}
          onCancel={cancel}
          onChange={setDraft}
          onCommit={commit}
          valid={validation?.ok === true}
          validationReason={validation?.ok === false ? validation.reason : null}
        />
      ) : null}
      {definitions.length === 0 && editor === null ? (
        <div style={styles.message}>No watch expressions</div>
      ) : (
        <div
          aria-label="Watch expressions"
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !contextMenu) {
              publishDebugCopyValueCandidate(copyValueSurface, null);
            }
          }}
          role="tree"
        >
          <div role="group">
            {visibleDefinitions.map((definition) => {
              const evaluation = evaluations[definition.id];
              const pending = pendingIds.includes(definition.id);
              const mutationEnabled =
                definition.enabled &&
                !pending &&
                debugAdapterKind === "node" &&
                sessionState === "stopped" &&
                workspaceTrusted &&
                evaluation?.result.status === "ok" &&
                evaluation.definitionRevision === definition.revision &&
                evaluation.frameId === evaluation.owner.frameId &&
                debugInspectionOwnersEqual(evaluation.owner, variablePages?.owner ?? null) &&
                workspaceRootKeysEqual(evaluation.owner.rootKey, workspaceRoot);
              const variableRowBudget = distributedBudget(
                definition.id,
                expandableWatchIds,
                nestedRowsBudget,
              );
              const copyCandidate = watchCopyCandidate({
                copyValueSurface,
                definition,
                editorId: editor?.id,
                evaluation,
                pending,
                debugAdapterKind,
                sessionState,
                workspaceRoot,
                workspaceTrusted,
              });
              return (
                <div
                  aria-label={definition.expression}
                  aria-level={1}
                  data-testid="debug-watch-row"
                  key={definition.id}
                  onContextMenu={(event) => {
                    if (valueEditor) return;
                    const mutation = mutationFor(definition.id);
                    if (
                      (!copyCandidate && !mutation) ||
                      (event.target instanceof Element &&
                        (event.target.closest("input,button") ||
                          event.target.closest('[role="treeitem"]') !== event.currentTarget))
                    )
                      return;
                    event.preventDefault();
                    publishDebugCopyValueCandidate(copyValueSurface, copyCandidate);
                    lastPublishedCandidateRef.current = copyCandidate;
                    setContextMenu({
                      copyCandidate,
                      invoker: event.currentTarget,
                      mutation,
                      rowId: definition.id,
                      position: { x: event.clientX, y: event.clientY },
                    });
                  }}
                  onKeyDown={(event) => onRowKeyDown(event, definition)}
                  onFocus={(event) => {
                    setActiveRowId(definition.id);
                    if (event.target === event.currentTarget) {
                      focusedRootIdRef.current = definition.id;
                      lastPublishedCandidateRef.current = copyCandidate;
                      if (suppressNextFocusPublishRef.current) {
                        suppressNextFocusPublishRef.current = false;
                      } else {
                        publishDebugCopyValueCandidate(copyValueSurface, copyCandidate);
                      }
                    } else if (
                      event.target instanceof Element &&
                      event.target.closest('[role="treeitem"]') === event.currentTarget
                    ) {
                      focusedRootIdRef.current = null;
                      lastPublishedCandidateRef.current = null;
                      publishDebugCopyValueCandidate(copyValueSurface, null);
                    }
                  }}
                  ref={(element) => {
                    if (element) rowRefs.current.set(definition.id, element);
                    else rowRefs.current.delete(definition.id);
                  }}
                  role="treeitem"
                  style={styles.row}
                  tabIndex={definition.id === resolvedActiveRowId ? 0 : -1}
                >
                  <input
                    aria-label={`Enable watch ${definition.expression}`}
                    checked={definition.enabled}
                    onChange={(event) => onSetEnabled(definition.id, event.target.checked)}
                    type="checkbox"
                  />
                  {editor?.id === definition.id ? (
                    <WatchEditor
                      draft={draft}
                      errorId={errorId}
                      inputRef={inputRef}
                      onCancel={cancel}
                      onChange={setDraft}
                      onCommit={commit}
                      valid={validation?.ok === true}
                      validationReason={validation?.ok === false ? validation.reason : null}
                    />
                  ) : (
                    <div style={styles.rowBody}>
                      <div style={styles.expression}>{definition.expression}</div>
                      {valueEditor?.rowId === definition.id ? (
                        <WatchValueEditor
                          editing={valueEditor}
                          inputRef={valueInputRef}
                          onCancel={cancelValueEdit}
                          onChange={(next) =>
                            setValueEditor((current) =>
                              current?.rowId === definition.id && !current.pending
                                ? { ...current, draft: next, error: null }
                                : current,
                            )
                          }
                          onCommit={() => void commitValueEdit()}
                        />
                      ) : (
                        <WatchValue
                          enabled={definition.enabled}
                          evaluation={evaluation}
                          pending={pending}
                          sessionState={sessionState}
                        />
                      )}
                      {evaluation?.result.status === "ok" &&
                      valueEditor?.rowId !== definition.id &&
                      (evaluation.result.variablesReference ?? 0) > 0 ? (
                        variableRowBudget > 0 ? (
                          <div style={styles.nestedTree}>
                            <DebugVariableTree
                              ariaLabel={`${definition.expression} value`}
                              copyValueSurface={copyValueSurface}
                              maxRows={variableRowBudget}
                              onLoadPage={onLoadVariablePage}
                              roots={[
                                {
                                  id: definition.id,
                                  label: definition.expression,
                                  owner: evaluation.owner,
                                  evaluateName: definition.expression,
                                  adapterEvaluateName: evaluation.result.evaluateName,
                                  variablesReference: evaluation.result.variablesReference ?? 0,
                                  value: evaluation.result.value,
                                  type: evaluation.result.type,
                                },
                              ]}
                              setVariableSurface={mutationEnabled ? setVariableSurface : undefined}
                              variablePages={variablePages}
                              variableMutationRows={
                                mutationEnabled ? variableMutationRows : undefined
                              }
                              virtualizeRows
                            />
                          </div>
                        ) : (
                          <span role="status" style={styles.muted}>
                            Variable display limit reached
                          </span>
                        )
                      ) : null}
                    </div>
                  )}
                  <button
                    aria-label={`Edit watch ${definition.expression}`}
                    disabled={editor !== null || valueEditor !== null}
                    onClick={() => beginEdit(definition)}
                    style={styles.action}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={12} />
                  </button>
                  <button
                    aria-label={`Remove watch ${definition.expression}`}
                    onClick={() => remove(definition.id)}
                    style={styles.action}
                    type="button"
                  >
                    <X aria-hidden="true" size={12} />
                  </button>
                </div>
              );
            })}
            {definitions.length > visibleDefinitions.length ? (
              <div role="status" style={styles.message}>
                Watch display limit reached
              </div>
            ) : null}
          </div>
        </div>
      )}
      {contextMenu ? (
        <ContextMenu
          ariaLabel="Watch value actions"
          items={debugWatchValueContextMenuItems({
            candidate: contextMenu.copyCandidate,
            surface: copyValueSurface,
            onCopyValue: () => {
              publishDebugCopyValueCandidate(copyValueSurface, contextMenu.copyCandidate);
              lastPublishedCandidateRef.current = contextMenu.copyCandidate;
              if (!runDebugCopyValueFromMenu(copyValueSurface)) {
                lastPublishedCandidateRef.current = null;
                publishDebugCopyValueCandidate(copyValueSurface, null);
              }
            },
            onCopyEvaluatePath: () => {
              if (!contextMenu.copyCandidate) return;
              publishDebugCopyValueCandidate(copyValueSurface, contextMenu.copyCandidate);
              lastPublishedCandidateRef.current = contextMenu.copyCandidate;
              if (!runDebugCopyEvaluatePathFromMenu(copyValueSurface)) {
                lastPublishedCandidateRef.current = null;
                publishDebugCopyValueCandidate(copyValueSurface, null);
              }
            },
            onSetValue: contextMenu.mutation
              ? () => {
                  const captured = contextMenu.mutation;
                  if (!captured) return;
                  const current = mutationForRef.current(contextMenu.rowId);
                  if (sameWatchMutation(captured, current)) {
                    beginValueEdit(contextMenu.rowId, captured);
                  }
                }
              : undefined,
          })}
          onClose={(reason) => {
            const { invoker, rowId } = contextMenu;
            setContextMenu(null);
            if (reason === "cancel") {
              lastPublishedCandidateRef.current = null;
              publishDebugCopyValueCandidate(copyValueSurface, null);
            }
            if (invoker.isConnected && rowRefs.current.get(rowId) === invoker) {
              suppressNextFocusPublishRef.current = true;
              invoker.focus();
            }
          }}
          position={contextMenu.position}
        />
      ) : null}
    </section>
  );
}

function watchExpressionMutation({
  debugAdapterKind,
  definition,
  editorOpen,
  evaluation,
  expressionMutations,
  pending,
  sessionState,
  workspaceRoot,
  workspaceTrusted,
}: {
  readonly debugAdapterKind: ActiveDebugAdapterKind;
  readonly definition: DebugWatchDefinition;
  readonly editorOpen: boolean;
  readonly evaluation?: DebugWatchEvaluation;
  readonly expressionMutations?: DebugWatchExpressionMutations;
  readonly pending: boolean;
  readonly sessionState: DebugWatchesPanelProps["sessionState"];
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
}): DebugWatchExpressionMutation | null {
  if (
    !expressionMutations ||
    editorOpen ||
    !definition.enabled ||
    pending ||
    debugAdapterKind !== "node" ||
    sessionState !== "stopped" ||
    !workspaceRoot ||
    !workspaceTrusted ||
    !evaluation ||
    evaluation.definitionRevision !== definition.revision ||
    evaluation.frameId !== evaluation.owner.frameId ||
    !workspaceRootKeysEqual(evaluation.owner.rootKey, workspaceRoot) ||
    evaluation.result.status !== "ok"
  ) {
    return null;
  }
  try {
    const mutation = expressionMutations.forWatch(definition, evaluation);
    if (
      !mutation ||
      mutation.identity.definitionId !== definition.id ||
      mutation.identity.definitionRevision !== definition.revision ||
      mutation.identity.expression !== definition.expression ||
      mutation.currentValue !== evaluation.result.value ||
      typeof mutation.setValue !== "function"
    ) {
      return null;
    }
    return mutation;
  } catch {
    return null;
  }
}

function sameWatchMutation(
  left: DebugWatchExpressionMutation | null,
  right: DebugWatchExpressionMutation | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.identity === right.identity &&
      left.currentValue === right.currentValue)
  );
}

function sameValueEditAttempt(
  latest: ValueEditorState | null,
  settled: Pick<ValueEditorState, "mutation" | "rowId">,
): boolean {
  return (
    latest !== null &&
    latest.rowId === settled.rowId &&
    sameWatchMutation(latest.mutation, settled.mutation)
  );
}

function WatchValueEditor({
  editing,
  inputRef,
  onCancel,
  onChange,
  onCommit,
}: {
  readonly editing: ValueEditorState;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  onCancel(): void;
  onChange(value: string): void;
  onCommit(): void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <input
        aria-busy={editing.pending || undefined}
        aria-disabled={editing.pending || undefined}
        aria-label={`Set value for ${editing.mutation.identity.expression}`}
        onBlur={() => {
          if (!editing.pending) onCancel();
        }}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (editing.pending && (event.key === "Enter" || event.key === "Escape")) {
            event.preventDefault();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        readOnly={editing.pending}
        ref={inputRef}
        style={styles.editor}
        value={editing.draft}
      />
      {editing.error ? (
        <div role="alert" style={styles.error}>
          {editing.error}
        </div>
      ) : null}
    </div>
  );
}

function watchCopyCandidate({
  copyValueSurface,
  debugAdapterKind,
  definition,
  editorId,
  evaluation,
  pending,
  sessionState,
  workspaceRoot,
  workspaceTrusted,
}: {
  readonly copyValueSurface?: DebugCopyValueSurface;
  readonly debugAdapterKind: ActiveDebugAdapterKind;
  readonly definition: DebugWatchDefinition;
  readonly editorId?: string | null;
  readonly evaluation?: DebugWatchEvaluation;
  readonly pending: boolean;
  readonly sessionState: DebugWatchesPanelProps["sessionState"];
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
}): DebugCopyValueCandidate | null {
  if (
    !copyValueSurface ||
    copyValueSurface.source !== "watch" ||
    !definition.enabled ||
    editorId === definition.id ||
    pending ||
    debugAdapterKind !== "node" ||
    sessionState !== "stopped" ||
    !workspaceRoot ||
    !workspaceTrusted ||
    !evaluation ||
    evaluation.definitionRevision !== definition.revision ||
    evaluation.frameId !== evaluation.owner.frameId ||
    evaluation.result.status !== "ok"
  ) {
    return null;
  }
  return debugCopyValueCandidateForNode({
    adapterEvaluateName: evaluation.result.evaluateName,
    displayedValue: evaluation.result.value,
    evaluateName: definition.expression,
    identity: `watch:${definition.id}:${definition.revision}`,
    owner: evaluation.owner,
    surface: copyValueSurface,
  });
}

function distributedBudget(id: string, ids: readonly string[], total: number): number {
  const index = ids.indexOf(id);
  if (index < 0 || ids.length === 0) return 0;
  const base = Math.floor(total / ids.length);
  return base + (index < total % ids.length ? 1 : 0);
}

function WatchEditor({
  draft,
  errorId,
  inputRef,
  onCancel,
  onChange,
  onCommit,
  valid,
  validationReason,
}: {
  readonly draft: string;
  readonly errorId: string;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onCancel: () => void;
  readonly onChange: (value: string) => void;
  readonly onCommit: () => void;
  readonly valid: boolean;
  readonly validationReason: "empty" | "control" | "too-large" | "type" | null;
}) {
  const error = validationReason ? validationMessage(validationReason) : null;
  return (
    <div style={styles.rowBody}>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? "true" : undefined}
        aria-label="Watch expression"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        ref={inputRef}
        style={styles.editor}
        value={draft}
      />
      <button
        aria-label="Save watch"
        disabled={!valid}
        onClick={onCommit}
        style={styles.action}
        type="button"
      >
        <Check aria-hidden="true" size={12} />
      </button>
      <button aria-label="Cancel watch edit" onClick={onCancel} style={styles.action} type="button">
        <X aria-hidden="true" size={12} />
      </button>
      {error ? (
        <div id={errorId} role="alert" style={styles.error}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

function WatchValue({
  enabled,
  evaluation,
  pending,
  sessionState,
}: {
  readonly enabled: boolean;
  readonly evaluation: DebugWatchEvaluation | undefined;
  readonly pending: boolean;
  readonly sessionState: DebugWatchesPanelProps["sessionState"];
}) {
  if (!enabled) return <div style={styles.muted}>Disabled</div>;
  if (pending)
    return (
      <div aria-live="polite" style={styles.muted}>
        Loading…
      </div>
    );
  if (evaluation?.result.status === "error") {
    return (
      <div role="status" style={styles.error}>
        {evaluation.result.message}
      </div>
    );
  }
  if (evaluation?.result.status === "ok") {
    return (
      <div style={styles.value} title={evaluation.result.value}>
        {evaluation.result.value}
        {evaluation.result.type ? ` (${evaluation.result.type})` : ""}
      </div>
    );
  }
  return <div style={styles.muted}>{sessionState === "running" ? "Running" : "Not available"}</div>;
}

function watchContextMessage({
  debugAdapterKind,
  sessionState,
  workspaceRoot,
  workspaceTrusted,
}: Pick<
  DebugWatchesPanelProps,
  "debugAdapterKind" | "sessionState" | "workspaceRoot" | "workspaceTrusted"
>): string | null {
  if (!workspaceRoot) return "Open a workspace to add watch expressions.";
  if (!workspaceTrusted) return "Trust this workspace to evaluate watch expressions.";
  if (debugAdapterKind === "php") return "Watch expressions are not supported for PHP debugging.";
  if (sessionState === "running" || sessionState === "starting") {
    return "Watch values refresh automatically when execution pauses.";
  }
  if (sessionState !== "stopped") return "Start Node debugging and pause to evaluate watches.";
  return null;
}

function validationMessage(reason: "empty" | "control" | "too-large" | "type"): string {
  switch (reason) {
    case "empty":
      return "Enter a watch expression.";
    case "control":
      return "Control characters are not allowed.";
    case "too-large":
      return "Watch expression is too large.";
    case "type":
      return "Watch expression must be text.";
  }
}
