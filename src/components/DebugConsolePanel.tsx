import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { UseDebugConsoleResult } from "../application/useDebugConsole";
import type { DebugConsoleFocusRequest } from "../application/useDebugConsoleSurfaceCommands";
import type { DebugCopyValueCandidate } from "../application/debugCopyValue";
import type { DebugVariable } from "../domain/debug";
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
  runDebugCopyDisplayedValue,
  type DebugCopyDisplayedValueSurface,
} from "./debugCopyValueSurface";

const MAX_VISIBLE_COMPLETION_ITEMS = 100;
const MAX_DEBUG_CONSOLE_RESULT_ROWS = 500;

export interface DebugConsoleCompletionItem {
  readonly detail?: string | null;
  readonly id: string;
  readonly label: string;
}

export interface DebugConsoleCompletionModel {
  readonly incomplete?: boolean;
  readonly items: readonly DebugConsoleCompletionItem[];
  readonly pending: boolean;
  readonly unavailable: string | null;
}

export interface DebugConsoleCompletionRequest {
  readonly cursor: number;
  readonly expression: string;
}

export interface DebugConsoleCompletionReplacement {
  readonly cursor: number;
  readonly expression: string;
}

const styles: Record<string, CSSProperties> = {
  body: {
    flex: 1,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    overflow: "auto",
    padding: "4px 8px",
  },
  entry: { whiteSpace: "pre-wrap" },
  disclosure: {
    background: "transparent",
    border: 0,
    color: "inherit",
    font: "inherit",
    padding: "0 3px 0 0",
  },
  error: { color: "var(--status-error, #ef4444)" },
  input: {
    background: "transparent",
    border: 0,
    borderTop: "1px solid var(--border-subtle)",
    boxSizing: "border-box",
    color: "inherit",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    outline: "none",
    padding: "5px 8px",
    width: "100%",
  },
  muted: { color: "var(--text-muted)" },
  variableRow: {
    alignItems: "baseline",
    cursor: "default",
    display: "flex",
    gap: 3,
    overflow: "hidden",
    paddingBottom: 2,
    paddingRight: 8,
    paddingTop: 2,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  completionDetail: {
    color: "var(--text-muted)",
    marginLeft: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  completionItem: {
    alignItems: "center",
    cursor: "default",
    display: "flex",
    justifyContent: "space-between",
    minHeight: 24,
    padding: "2px 8px",
  },
  completionPopup: {
    background: "var(--panel-bg, #18181b)",
    border: "1px solid var(--border-subtle)",
    bottom: "100%",
    boxSizing: "border-box",
    left: 8,
    maxHeight: 240,
    overflow: "auto",
    position: "absolute",
    right: 8,
    zIndex: 2,
  },
  completionStatus: {
    color: "var(--text-muted)",
    padding: "5px 8px",
  },
  inputSurface: {
    position: "relative",
  },
  warning: { color: "var(--text-muted)", fontSize: 11, padding: "3px 8px" },
};

export function DebugConsolePanel({
  completion = null,
  console,
  copyDisplayedValueSurface,
  enabled,
  focusRequest = null,
  onAccept,
  onDismiss,
  onFocusRequestHandled,
  onInputChanged,
  onLoadVariablePage,
  onRequest,
  inspectionOwner = null,
  variablePages,
  workspaceOwnerKey = null,
}: {
  completion?: DebugConsoleCompletionModel | null;
  console: UseDebugConsoleResult;
  copyDisplayedValueSurface?: DebugCopyDisplayedValueSurface;
  enabled: boolean;
  focusRequest?: DebugConsoleFocusRequest | null;
  onAccept?(
    item: DebugConsoleCompletionItem,
    request: DebugConsoleCompletionRequest,
  ): DebugConsoleCompletionReplacement | null;
  onDismiss?(): void;
  onFocusRequestHandled?(request: DebugConsoleFocusRequest): void;
  onInputChanged?(request: DebugConsoleCompletionRequest): void;
  onLoadVariablePage?(owner: DebugInspectionOwner, variablesReference: number, start: number): void;
  onRequest?(request: DebugConsoleCompletionRequest): void;
  inspectionOwner?: DebugInspectionOwner | null;
  variablePages?: DebugVariablePagesState;
  workspaceOwnerKey?: string | null;
}) {
  const [value, setValue] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [activeCompletionIndex, setActiveCompletionIndex] = useState(0);
  const [expandedResultIds, setExpandedResultIds] = useState<ReadonlySet<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<{
    readonly candidate: DebugCopyValueCandidate;
    readonly invoker: HTMLElement;
    readonly position: { readonly x: number; readonly y: number };
  } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const completionListId = useId();
  const completionStatusId = useId();
  const previousCompletionRef = useRef(completion);
  const handledFocusGenerationRef = useRef(0);
  const stickRef = useRef(true);
  const copyDisplayedValueSurfaceRef = useRef(copyDisplayedValueSurface);
  copyDisplayedValueSurfaceRef.current = copyDisplayedValueSurface;
  const focusedResultCandidateRef = useRef<DebugCopyValueCandidate | null>(null);
  const focusedResultIdRef = useRef<string | null>(null);
  const visibleCompletionItems = completion?.items.slice(0, MAX_VISIBLE_COMPLETION_ITEMS) ?? [];
  const completionVisible = completionOpen && completion !== null;
  const activeCompletionItem = completionVisible
    ? (visibleCompletionItems[activeCompletionIndex] ?? null)
    : null;
  const completionStatus =
    completionVisible && visibleCompletionItems.length === 0
      ? completion?.pending
        ? "Loading suggestions…"
        : (completion?.unavailable ?? "No suggestions")
      : completionVisible && completion?.incomplete
        ? "More suggestions available — keep typing."
        : null;
  useEffect(() => {
    if (stickRef.current && bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [console.state.entries]);
  const sessionId = console.state.owner?.sessionId ?? null;
  useEffect(() => {
    setValue("");
    setHistoryIndex(null);
    setCompletionOpen(false);
    setActiveCompletionIndex(0);
  }, [sessionId]);
  const resultOwnerEpoch = console.resultOwner?.epoch ?? null;
  const inspectionPauseGeneration = inspectionOwner?.pauseGeneration ?? null;
  useEffect(() => {
    setExpandedResultIds(new Set());
  }, [inspectionPauseGeneration, resultOwnerEpoch, sessionId, workspaceOwnerKey]);
  useEffect(() => {
    setActiveCompletionIndex((current) =>
      Math.min(current, Math.max(0, visibleCompletionItems.length - 1)),
    );
  }, [visibleCompletionItems.length]);
  useEffect(() => {
    if (enabled) return;
    setCompletionOpen(false);
    setActiveCompletionIndex(0);
  }, [enabled]);
  useEffect(() => {
    const changed = previousCompletionRef.current !== completion;
    previousCompletionRef.current = completion;
    if (
      !changed ||
      !enabled ||
      !completion ||
      (!completion.pending && completion.items.length === 0 && completion.unavailable === null)
    ) {
      return;
    }
    setCompletionOpen(true);
    setActiveCompletionIndex(0);
  }, [completion, enabled]);
  useEffect(() => {
    setCompletionOpen(false);
    setActiveCompletionIndex(0);
    setContextMenu(null);
    focusedResultCandidateRef.current = null;
    focusedResultIdRef.current = null;
    publishDebugCopyValueCandidate(copyDisplayedValueSurfaceRef.current, null);
  }, [workspaceOwnerKey]);
  useEffect(() => {
    const focusedId = focusedResultIdRef.current;
    const focusedEntry =
      focusedId === null
        ? null
        : console.state.entries.find((entry) => entry.kind === "result" && entry.id === focusedId);
    const focusedCandidate =
      focusedEntry?.kind === "result"
        ? consoleCopyCandidate(
            focusedEntry,
            console.resultOwner,
            inspectionOwner,
            copyDisplayedValueSurface,
          )
        : null;
    if (
      focusedResultCandidateRef.current !== null &&
      !debugCopyValuePresentationCandidatesEqual(
        focusedResultCandidateRef.current,
        focusedCandidate,
      )
    ) {
      focusedResultCandidateRef.current = null;
      focusedResultIdRef.current = null;
      publishDebugCopyValueCandidate(copyDisplayedValueSurface, null);
    }
    if (contextMenu) {
      const current = console.state.entries.find(
        (entry) => entry.kind === "result" && entry.id === contextMenu.candidate.identity,
      );
      const candidate =
        current?.kind === "result"
          ? consoleCopyCandidate(
              current,
              console.resultOwner,
              inspectionOwner,
              copyDisplayedValueSurface,
            )
          : null;
      if (!debugCopyValuePresentationCandidatesEqual(contextMenu.candidate, candidate)) {
        setContextMenu(null);
        publishDebugCopyValueCandidate(copyDisplayedValueSurface, null);
      }
    }
  }, [
    console.resultOwner,
    console.state.entries,
    contextMenu,
    copyDisplayedValueSurface,
    inspectionOwner,
  ]);
  useEffect(
    () => () => publishDebugCopyValueCandidate(copyDisplayedValueSurfaceRef.current, null),
    [],
  );
  useEffect(() => {
    if (!focusRequest || focusRequest.generation <= handledFocusGenerationRef.current) return;
    if (focusRequest.workspaceOwnerKey !== workspaceOwnerKey) return;
    const target = enabled ? inputRef.current : bodyRef.current;
    if (!target) return;
    target.focus();
    if (target.ownerDocument.activeElement !== target) return;
    handledFocusGenerationRef.current = focusRequest.generation;
    onFocusRequestHandled?.(focusRequest);
  }, [enabled, focusRequest, onFocusRequestHandled, workspaceOwnerKey]);
  const history = console.state.history;
  const dismissCompletion = () => {
    if (!completionOpen) return;
    setCompletionOpen(false);
    setActiveCompletionIndex(0);
    onDismiss?.();
  };
  const invalidateCompletion = () => {
    if (completionOpen) {
      dismissCompletion();
    } else {
      onDismiss?.();
    }
  };
  const acceptCompletion = (item: DebugConsoleCompletionItem) => {
    const input = inputRef.current;
    const request = {
      cursor: input?.selectionStart ?? value.length,
      expression: value,
    };
    const replacement = onAccept?.(item, request);
    if (!replacement) {
      dismissCompletion();
      return;
    }
    setValue(replacement.expression);
    setHistoryIndex(null);
    setCompletionOpen(false);
    setActiveCompletionIndex(0);
    queueMicrotask(() => {
      const target = inputRef.current;
      if (!target) return;
      const cursor = Math.max(0, Math.min(replacement.cursor, replacement.expression.length));
      target.focus();
      target.setSelectionRange(cursor, cursor);
    });
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (onRequest && event.ctrlKey && (event.code === "Space" || event.key === " ")) {
      event.preventDefault();
      setCompletionOpen(true);
      setActiveCompletionIndex(0);
      onRequest?.({
        cursor: event.currentTarget.selectionStart ?? value.length,
        expression: value,
      });
    } else if (completionVisible && event.key === "ArrowDown") {
      event.preventDefault();
      if (visibleCompletionItems.length)
        setActiveCompletionIndex((current) => (current + 1) % visibleCompletionItems.length);
    } else if (completionVisible && event.key === "ArrowUp") {
      event.preventDefault();
      if (visibleCompletionItems.length)
        setActiveCompletionIndex(
          (current) =>
            (current - 1 + visibleCompletionItems.length) % visibleCompletionItems.length,
        );
    } else if (completionVisible && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      if (activeCompletionItem) acceptCompletion(activeCompletionItem);
    } else if (completionVisible && event.key === "Escape") {
      event.preventDefault();
      dismissCompletion();
    } else if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      invalidateCompletion();
    } else if (event.key === "Enter" && enabled && value.trim()) {
      event.preventDefault();
      void console.submit(value.trim());
      setValue("");
      setHistoryIndex(null);
    } else if (event.key === "Escape") {
      setValue("");
      setHistoryIndex(null);
    } else if (event.key === "ArrowUp" && history.length) {
      event.preventDefault();
      const next = Math.min(history.length - 1, (historyIndex ?? history.length) - 1);
      setHistoryIndex(next);
      setValue(history[next] ?? "");
    } else if (event.key === "ArrowDown" && historyIndex !== null) {
      event.preventDefault();
      const next = historyIndex + 1;
      setHistoryIndex(next >= history.length ? null : next);
      setValue(next >= history.length ? "" : (history[next] ?? ""));
    }
  };
  const setResultExpanded = (
    id: string,
    expanded: boolean,
    owner: DebugInspectionOwner,
    variablesReference: number,
    ancestors: readonly number[],
    depth: number,
  ) => {
    const expansion = variablePages
      ? selectDebugVariableExpansion(variablePages, owner, variablesReference, ancestors, depth)
      : { kind: "stale" as const };
    if (
      expansion.kind === "stale" ||
      expansion.kind === "leaf" ||
      expansion.kind === "circular" ||
      expansion.kind === "limit"
    ) {
      return;
    }
    setExpandedResultIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(id);
      else next.delete(id);
      return next;
    });
    if (expanded && expansion.kind === "idle") {
      onLoadVariablePage?.(owner, variablesReference, 0);
    }
  };
  const childBudget = { count: 0, exhausted: false };
  return (
    <>
      <div id="debug-console-warning" style={styles.warning}>
        Warning: REPL expressions may execute code in the debugged process.
      </div>
      <div
        aria-label="Debug console output"
        data-testid="debug-console-body"
        onScroll={() => {
          const body = bodyRef.current;
          if (body) stickRef.current = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
        }}
        ref={bodyRef}
        role="log"
        tabIndex={-1}
        aria-busy={console.state.pendingRequestIds.length > 0}
        aria-live="polite"
        aria-relevant="additions text"
        style={styles.body}
      >
        {console.state.entries.length === 0 ? (
          <span data-testid="debug-output-empty" style={styles.muted}>
            No output
          </span>
        ) : (
          console.state.entries.map((entry) => {
            const copyCandidate =
              entry.kind === "result"
                ? consoleCopyCandidate(
                    entry,
                    console.resultOwner,
                    inspectionOwner,
                    copyDisplayedValueSurface,
                  )
                : null;
            const copyable = copyCandidate !== null;
            const resultInspectionOwner =
              entry.kind === "result"
                ? consoleResultInspectionOwner(
                    entry,
                    console.resultOwner,
                    inspectionOwner,
                    workspaceOwnerKey,
                  )
                : null;
            const expansion =
              entry.kind === "result" &&
              entry.variablesReference > 0 &&
              resultInspectionOwner &&
              variablePages &&
              onLoadVariablePage
                ? selectDebugVariableExpansion(
                    variablePages,
                    resultInspectionOwner,
                    entry.variablesReference,
                  )
                : null;
            const expandable = expansion ? isExpandableResultState(expansion) : false;
            const expanded = expandable && expandedResultIds.has(entry.id);
            const toggleResult = () => {
              if (
                entry.kind !== "result" ||
                !resultInspectionOwner ||
                !expandable ||
                !variablePages ||
                !onLoadVariablePage
              ) {
                return;
              }
              setResultExpanded(
                entry.id,
                !expanded,
                resultInspectionOwner,
                entry.variablesReference,
                [],
                0,
              );
            };
            return (
              <Fragment key={entry.id}>
                <div
                  aria-expanded={expandable ? expanded : undefined}
                  aria-haspopup={copyable ? "menu" : undefined}
                  aria-label={
                    entry.kind === "result" && (copyable || expandable)
                      ? "Debug console evaluation result"
                      : undefined
                  }
                  data-kind={entry.kind}
                  data-stream={
                    entry.kind === "stdout" || entry.kind === "stderr" ? entry.kind : undefined
                  }
                  data-testid={
                    entry.kind === "stdout" || entry.kind === "stderr"
                      ? "debug-output-line"
                      : entry.kind === "result" || entry.kind === "error"
                        ? "debug-evaluation"
                        : undefined
                  }
                  onBlur={
                    copyable
                      ? () => {
                          if (focusedResultIdRef.current !== entry.id) return;
                          focusedResultCandidateRef.current = null;
                          focusedResultIdRef.current = null;
                          publishDebugCopyValueCandidate(copyDisplayedValueSurface, null);
                        }
                      : undefined
                  }
                  onContextMenu={
                    copyCandidate
                      ? (event) => {
                          event.preventDefault();
                          focusedResultCandidateRef.current = copyCandidate;
                          focusedResultIdRef.current = entry.id;
                          publishDebugCopyValueCandidate(copyDisplayedValueSurface, copyCandidate);
                          setContextMenu({
                            candidate: copyCandidate,
                            invoker: event.currentTarget,
                            position: { x: event.clientX, y: event.clientY },
                          });
                        }
                      : undefined
                  }
                  onFocus={
                    copyCandidate
                      ? () => {
                          focusedResultCandidateRef.current = copyCandidate;
                          focusedResultIdRef.current = entry.id;
                          publishDebugCopyValueCandidate(copyDisplayedValueSurface, copyCandidate);
                        }
                      : undefined
                  }
                  onKeyDown={(event) => {
                    if (copyCandidate) {
                      if (isLocalDebugCopyShortcut(event)) {
                        publishDebugCopyValueCandidate(copyDisplayedValueSurface, copyCandidate);
                        if (runDebugCopyDisplayedValue(copyDisplayedValueSurface)) {
                          event.preventDefault();
                        }
                        return;
                      }
                    }
                    if (expandable && event.key === "ArrowRight" && !expanded) {
                      event.preventDefault();
                      toggleResult();
                      return;
                    }
                    if (expandable && event.key === "ArrowLeft" && expanded) {
                      event.preventDefault();
                      toggleResult();
                      return;
                    }
                    if (expandable && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      toggleResult();
                      return;
                    }
                    if (
                      !copyCandidate ||
                      (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
                    ) {
                      return;
                    }
                    event.preventDefault();
                    publishDebugCopyValueCandidate(copyDisplayedValueSurface, copyCandidate);
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setContextMenu({
                      candidate: copyCandidate,
                      invoker: event.currentTarget,
                      position: { x: bounds.left + 8, y: bounds.top + 8 },
                    });
                  }}
                  role={copyable || expandable ? "group" : undefined}
                  style={
                    entry.kind === "stderr" || entry.kind === "error"
                      ? { ...styles.entry, ...styles.error }
                      : styles.entry
                  }
                  tabIndex={copyable || expandable ? 0 : undefined}
                >
                  {expandable ? (
                    <button
                      aria-label={`${expanded ? "Collapse" : "Expand"} debug console result`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleResult();
                      }}
                      style={styles.disclosure}
                      tabIndex={-1}
                      type="button"
                    >
                      <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
                    </button>
                  ) : null}
                  {formatEntry(entry)}
                </div>
                {entry.kind === "result" &&
                expanded &&
                expansion &&
                resultInspectionOwner &&
                variablePages &&
                onLoadVariablePage ? (
                  <div aria-label="Debug console result variables" role="tree">
                    {renderResultExpansion({
                      ancestors: [],
                      budget: childBudget,
                      depth: 0,
                      expandedIds: expandedResultIds,
                      expansion,
                      id: entry.id,
                      onLoadVariablePage,
                      owner: resultInspectionOwner,
                      setExpanded: setResultExpanded,
                      variablePages,
                      variablesReference: entry.variablesReference,
                    })}
                  </div>
                ) : null}
              </Fragment>
            );
          })
        )}
      </div>
      {contextMenu ? (
        <ContextMenu
          ariaLabel="Debug console value actions"
          items={[
            {
              id: "copy-value",
              label: "Copy Value",
              onSelect: () => {
                publishDebugCopyValueCandidate(copyDisplayedValueSurface, contextMenu.candidate);
                copyDisplayedValueFromMenuAndRestoreFocus(
                  copyDisplayedValueSurface,
                  contextMenu.invoker,
                );
              },
            },
          ]}
          onClose={(reason) => {
            const invoker = contextMenu.invoker;
            setContextMenu(null);
            if (reason === "cancel") {
              publishDebugCopyValueCandidate(copyDisplayedValueSurface, null);
            }
            if (reason === "cancel") queueMicrotask(() => invoker.focus());
          }}
          position={contextMenu.position}
        />
      ) : null}
      <div style={styles.inputSurface}>
        {completionVisible ? (
          <div id={completionListId} role="listbox" style={styles.completionPopup}>
            {visibleCompletionItems.map((item, index) => (
              <div
                aria-selected={index === activeCompletionIndex}
                id={`${completionListId}-option-${index}`}
                key={item.id}
                onClick={() => acceptCompletion(item)}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                style={{
                  ...styles.completionItem,
                  background:
                    index === activeCompletionIndex
                      ? "var(--selection-bg, rgba(59, 130, 246, 0.25))"
                      : undefined,
                }}
              >
                <span>{item.label}</span>
                {item.detail ? <span style={styles.completionDetail}>{item.detail}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {completionStatus ? (
          <div id={completionStatusId} role="status" style={styles.completionStatus}>
            {completionStatus}
          </div>
        ) : null}
        <input
          aria-activedescendant={
            activeCompletionItem ? `${completionListId}-option-${activeCompletionIndex}` : undefined
          }
          aria-autocomplete="list"
          aria-busy={completionVisible && completion?.pending ? true : undefined}
          aria-controls={completionVisible ? completionListId : undefined}
          aria-describedby={
            completionStatus
              ? `debug-console-warning ${completionStatusId}`
              : "debug-console-warning"
          }
          aria-expanded={completionVisible}
          aria-haspopup="listbox"
          aria-label="Debug expression"
          disabled={!enabled}
          onChange={(event) => {
            setValue(event.target.value);
            setHistoryIndex(null);
            dismissCompletion();
            onInputChanged?.({
              cursor: event.target.selectionStart ?? event.target.value.length,
              expression: event.target.value,
            });
          }}
          onKeyDown={keyDown}
          onMouseUp={invalidateCompletion}
          onSelect={() => {
            if (completionOpen) dismissCompletion();
          }}
          placeholder={enabled ? "Evaluate expression" : "Pause to evaluate"}
          ref={inputRef}
          role="combobox"
          style={styles.input}
          value={value}
        />
      </div>
    </>
  );
}

function copyDisplayedValueFromMenuAndRestoreFocus(
  surface: DebugCopyDisplayedValueSurface | undefined,
  invoker: HTMLElement,
): void {
  try {
    if (!surface?.canCopyDisplayedValue()) {
      queueMicrotask(() => invoker.focus());
      return;
    }
    void Promise.resolve(surface.copyDisplayedValueFromMenu())
      .catch(() => false)
      .finally(() => queueMicrotask(() => invoker.focus()));
  } catch {
    queueMicrotask(() => invoker.focus());
  }
}

function consoleCopyCandidate(
  entry: Extract<UseDebugConsoleResult["state"]["entries"][number], { readonly kind: "result" }>,
  currentResultOwner: UseDebugConsoleResult["resultOwner"],
  owner: DebugInspectionOwner | null,
  surface: DebugCopyDisplayedValueSurface | undefined,
): DebugCopyValueCandidate | null {
  if (
    !owner ||
    !entry.resultOwner ||
    !currentResultOwner ||
    entry.resultOwner.epoch !== currentResultOwner.epoch ||
    entry.resultOwner.rootKey !== currentResultOwner.rootKey ||
    entry.resultOwner.workspaceOwnerKey !== currentResultOwner.workspaceOwnerKey ||
    entry.resultOwner.sessionId !== currentResultOwner.sessionId ||
    entry.resultOwner.pauseGeneration !== currentResultOwner.pauseGeneration ||
    entry.resultOwner.frameId !== currentResultOwner.frameId ||
    !consoleResultOwnersEqual(entry.resultOwner, surface, owner) ||
    owner.rootKey !== entry.resultOwner.rootKey ||
    owner.sessionId !== entry.resultOwner.sessionId ||
    owner.pauseGeneration !== entry.resultOwner.pauseGeneration ||
    owner.frameId !== entry.resultOwner.frameId ||
    surface?.workspaceOwnerKey !== entry.resultOwner.workspaceOwnerKey
  ) {
    return null;
  }
  return debugCopyValueCandidateForNode({
    displayedValue: entry.value,
    identity: entry.id,
    owner,
    surface,
  });
}

function consoleResultOwnersEqual(
  entryOwner: NonNullable<
    Extract<
      UseDebugConsoleResult["state"]["entries"][number],
      { readonly kind: "result" }
    >["resultOwner"]
  >,
  surface: DebugCopyDisplayedValueSurface | undefined,
  owner: DebugInspectionOwner,
): boolean {
  return (
    entryOwner.rootKey === owner.rootKey &&
    entryOwner.workspaceOwnerKey === surface?.workspaceOwnerKey &&
    entryOwner.sessionId === owner.sessionId &&
    entryOwner.pauseGeneration === owner.pauseGeneration &&
    entryOwner.frameId === owner.frameId
  );
}

function consoleResultInspectionOwner(
  entry: Extract<UseDebugConsoleResult["state"]["entries"][number], { readonly kind: "result" }>,
  currentResultOwner: UseDebugConsoleResult["resultOwner"],
  owner: DebugInspectionOwner | null,
  workspaceOwnerKey: string | null,
): DebugInspectionOwner | null {
  if (
    !entry.resultOwner ||
    !currentResultOwner ||
    !owner ||
    entry.resultOwner.epoch !== currentResultOwner.epoch ||
    entry.resultOwner.rootKey !== currentResultOwner.rootKey ||
    entry.resultOwner.workspaceOwnerKey !== currentResultOwner.workspaceOwnerKey ||
    entry.resultOwner.sessionId !== currentResultOwner.sessionId ||
    entry.resultOwner.pauseGeneration !== currentResultOwner.pauseGeneration ||
    entry.resultOwner.frameId !== currentResultOwner.frameId ||
    entry.resultOwner.workspaceOwnerKey !== workspaceOwnerKey ||
    entry.resultOwner.rootKey !== owner.rootKey ||
    entry.resultOwner.sessionId !== owner.sessionId ||
    entry.resultOwner.pauseGeneration !== owner.pauseGeneration ||
    entry.resultOwner.frameId !== owner.frameId
  ) {
    return null;
  }
  return owner;
}

function isExpandableResultState(expansion: DebugVariableExpansionState): boolean {
  return (
    expansion.kind !== "stale" &&
    expansion.kind !== "leaf" &&
    expansion.kind !== "circular" &&
    expansion.kind !== "limit"
  );
}

interface ResultExpansionRenderOptions {
  readonly ancestors: readonly number[];
  readonly budget: { count: number; exhausted: boolean };
  readonly depth: number;
  readonly expandedIds: ReadonlySet<string>;
  readonly expansion: DebugVariableExpansionState;
  readonly id: string;
  readonly onLoadVariablePage: NonNullable<
    ComponentProps<typeof DebugConsolePanel>["onLoadVariablePage"]
  >;
  readonly owner: DebugInspectionOwner;
  readonly setExpanded: (
    id: string,
    expanded: boolean,
    owner: DebugInspectionOwner,
    variablesReference: number,
    ancestors: readonly number[],
    depth: number,
  ) => void;
  readonly variablePages: DebugVariablePagesState;
  readonly variablesReference: number;
}

function renderResultExpansion(options: ResultExpansionRenderOptions): ReactNode {
  const {
    ancestors,
    budget,
    depth,
    expandedIds,
    expansion,
    id,
    onLoadVariablePage,
    owner,
    setExpanded,
    variablePages,
    variablesReference,
  } = options;
  const rows: ReactNode[] = [];
  const variables = "variables" in expansion ? expansion.variables : [];
  for (let index = 0; index < variables.length; index += 1) {
    if (budget.count >= MAX_DEBUG_CONSOLE_RESULT_ROWS) {
      if (!budget.exhausted) {
        budget.exhausted = true;
        rows.push(resultStatusRow(`${id}/limit`, depth + 2, "Display limit reached"));
      }
      break;
    }
    const variable = variables[index]!;
    const variableId = `${id}/${index}:${variable.name}`;
    budget.count += 1;
    rows.push(
      renderResultVariable({
        ancestors: [...ancestors, variablesReference],
        budget,
        depth: depth + 1,
        expandedIds,
        id: variableId,
        key: variableId,
        onLoadVariablePage,
        owner,
        setExpanded,
        variable,
        variablePages,
      }),
    );
  }
  if (budget.count >= MAX_DEBUG_CONSOLE_RESULT_ROWS) return rows;
  if (expansion.kind === "idle" || expansion.kind === "loading") {
    rows.push(resultStatusRow(`${id}/loading`, depth + 2, "Loading…"));
  } else if (expansion.kind === "error") {
    rows.push(
      resultLoadRow(
        `${id}/retry:${expansion.nextStart}`,
        depth + 2,
        `Retry: ${expansion.message}`,
        () => onLoadVariablePage(owner, variablesReference, expansion.nextStart),
      ),
    );
  } else if (expansion.kind === "ready" && expansion.nextStart !== null) {
    const nextStart = expansion.nextStart;
    rows.push(
      resultLoadRow(`${id}/more:${nextStart}`, depth + 2, "Load more", () =>
        onLoadVariablePage(owner, variablesReference, nextStart),
      ),
    );
  }
  return rows;
}

function renderResultVariable({
  ancestors,
  budget,
  depth,
  expandedIds,
  id,
  key,
  onLoadVariablePage,
  owner,
  setExpanded,
  variable,
  variablePages,
}: {
  readonly ancestors: readonly number[];
  readonly budget: { count: number; exhausted: boolean };
  readonly depth: number;
  readonly expandedIds: ReadonlySet<string>;
  readonly id: string;
  readonly key: string;
  readonly onLoadVariablePage: ResultExpansionRenderOptions["onLoadVariablePage"];
  readonly owner: DebugInspectionOwner;
  readonly setExpanded: ResultExpansionRenderOptions["setExpanded"];
  readonly variable: DebugVariable;
  readonly variablePages: DebugVariablePagesState;
}): ReactNode {
  const expansion = selectDebugVariableExpansion(
    variablePages,
    owner,
    variable.variablesReference,
    ancestors,
    depth,
  );
  const expandable = isExpandableResultState(expansion);
  const expanded = expandable && expandedIds.has(id);
  const toggle = () =>
    setExpanded(id, !expanded, owner, variable.variablesReference, ancestors, depth);
  return (
    <Fragment key={key}>
      <div
        aria-expanded={expandable ? expanded : undefined}
        aria-level={depth + 1}
        data-testid="debug-console-variable"
        onClick={expandable ? toggle : undefined}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" && expandable && !expanded) {
            event.preventDefault();
            toggle();
          } else if (event.key === "ArrowLeft" && expandable && expanded) {
            event.preventDefault();
            toggle();
          } else if (expandable && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            toggle();
          }
        }}
        role="treeitem"
        style={{ ...styles.variableRow, paddingLeft: 8 + depth * 12 }}
        tabIndex={0}
      >
        {expandable ? (
          <button
            aria-label={`${expanded ? "Collapse" : "Expand"} debug console variable ${variable.name}`}
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
            style={styles.disclosure}
            tabIndex={-1}
            type="button"
          >
            <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          </button>
        ) : (
          <span aria-hidden="true"> </span>
        )}
        <span>{variable.name}:</span>
        <span>{formatVariableValue(variable)}</span>
      </div>
      {expanded
        ? renderResultExpansion({
            ancestors,
            budget,
            depth,
            expandedIds,
            expansion,
            id,
            onLoadVariablePage,
            owner,
            setExpanded,
            variablePages,
            variablesReference: variable.variablesReference,
          })
        : null}
    </Fragment>
  );
}

function resultStatusRow(id: string, ariaLevel: number, label: string): ReactNode {
  return (
    <div
      aria-level={ariaLevel}
      key={id}
      role="treeitem"
      style={{ ...styles.variableRow, ...styles.muted, paddingLeft: 8 + (ariaLevel - 1) * 12 }}
    >
      {label}
    </div>
  );
}

function resultLoadRow(id: string, ariaLevel: number, label: string, load: () => void): ReactNode {
  return (
    <div
      aria-level={ariaLevel}
      key={id}
      role="treeitem"
      style={{ ...styles.variableRow, paddingLeft: 8 + (ariaLevel - 1) * 12 }}
    >
      <button onClick={load} style={styles.disclosure} type="button">
        {label}
      </button>
    </div>
  );
}

function formatVariableValue(variable: DebugVariable): string {
  return variable.type ? `${variable.value} (${variable.type})` : variable.value;
}

function formatEntry(entry: UseDebugConsoleResult["state"]["entries"][number]): string {
  switch (entry.kind) {
    case "stdout":
    case "stderr":
      return entry.text;
    case "pending":
      return `> ${entry.expression}`;
    case "result":
      return entry.valueType ? `${entry.value} (${entry.valueType})` : entry.value;
    case "error":
      return entry.message;
    case "truncated":
      return `Earlier debug console entries were truncated (${entry.omittedEntries}).`;
  }
}
