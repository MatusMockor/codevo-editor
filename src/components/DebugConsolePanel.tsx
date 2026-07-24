import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { UseDebugConsoleResult } from "../application/useDebugConsole";
import type { DebugConsoleFocusRequest } from "../application/useDebugConsoleSurfaceCommands";
import type { DebugCopyValueCandidate } from "../application/debugCopyValue";
import type { DebugInspectionOwner } from "../domain/debugVariablePages";
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
  onRequest,
  inspectionOwner = null,
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
  onRequest?(request: DebugConsoleCompletionRequest): void;
  inspectionOwner?: DebugInspectionOwner | null;
  workspaceOwnerKey?: string | null;
}) {
  const [value, setValue] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [activeCompletionIndex, setActiveCompletionIndex] = useState(0);
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
            return (
              <div
                aria-haspopup={copyable ? "menu" : undefined}
                aria-label={copyable ? "Debug console evaluation result" : undefined}
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
                key={entry.id}
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
                onKeyDown={
                  copyCandidate
                    ? (event) => {
                        if (isLocalDebugCopyShortcut(event)) {
                          publishDebugCopyValueCandidate(copyDisplayedValueSurface, copyCandidate);
                          if (runDebugCopyDisplayedValue(copyDisplayedValueSurface)) {
                            event.preventDefault();
                          }
                          return;
                        }
                        if (
                          event.key !== "ContextMenu" &&
                          !(event.shiftKey && event.key === "F10")
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
                      }
                    : undefined
                }
                role={copyable ? "group" : undefined}
                style={
                  entry.kind === "stderr" || entry.kind === "error"
                    ? { ...styles.entry, ...styles.error }
                    : styles.entry
                }
                tabIndex={copyable ? 0 : undefined}
              >
                {formatEntry(entry)}
              </div>
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
