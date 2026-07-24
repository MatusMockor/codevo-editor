import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { UseDebugConsoleResult } from "../application/useDebugConsole";
import type { DebugConsoleFocusRequest } from "../application/useDebugConsoleSurfaceCommands";
import type { DebugCopyValueCandidate } from "../application/debugCopyValue";
import type { DebugVariable } from "../domain/debug";
import {
  selectDebugVariableExpansion,
  type DebugInspectionOwner,
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
import {
  buildDebugConsoleRenderItems,
  formatDebugConsoleEntry,
  type DebugConsoleRenderItem,
} from "./debugConsoleRenderItems";
import { useWindowedRows, type WindowedRow } from "./useWindowedRows";

const MAX_VISIBLE_COMPLETION_ITEMS = 100;
const CONSOLE_LINE_HEIGHT = 18;
const CONSOLE_VARIABLE_ROW_HEIGHT = 18;

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
    maxHeight: 100,
    minHeight: 28,
    outline: "none",
    overflowY: "auto",
    padding: "5px 8px",
    resize: "none",
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
  const [pinnedResultEntryId, setPinnedResultEntryId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    readonly candidate: DebugCopyValueCandidate;
    readonly entryId: string;
    readonly invoker: HTMLElement;
    readonly position: { readonly x: number; readonly y: number };
  } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
  const renderItems = useMemo(
    () =>
      buildDebugConsoleRenderItems({
        currentResultOwner: console.resultOwner ?? null,
        entries: console.state.entries,
        expandedResultIds,
        inspectionOwner,
        resultTreeEnabled: Boolean(onLoadVariablePage),
        variablePages,
        workspaceOwnerKey,
      }),
    [
      console.resultOwner,
      console.state.entries,
      expandedResultIds,
      inspectionOwner,
      onLoadVariablePage,
      variablePages,
      workspaceOwnerKey,
    ],
  );
  const keyForIndex = useCallback(
    (index: number) => renderItems[index]?.id ?? `missing-${index}`,
    [renderItems],
  );
  const estimateHeight = useCallback(
    (index: number) => {
      const item = renderItems[index];
      return item?.kind === "entry"
        ? CONSOLE_LINE_HEIGHT * item.lineCount
        : CONSOLE_VARIABLE_ROW_HEIGHT;
    },
    [renderItems],
  );
  const pinnedIndices = useMemo(() => {
    const entryIds = new Set<string>();

    if (pinnedResultEntryId) {
      entryIds.add(pinnedResultEntryId);
    }

    if (contextMenu) {
      entryIds.add(contextMenu.entryId);
    }

    if (entryIds.size === 0) {
      return [];
    }

    return renderItems.flatMap((item, index) =>
      item.kind === "entry" && entryIds.has(item.entryId) ? [index] : [],
    );
  }, [contextMenu, pinnedResultEntryId, renderItems]);
  const windowed = useWindowedRows({
    enabled: true,
    estimateHeight,
    itemCount: renderItems.length,
    keyForIndex,
    pinnedIndices,
    preserveScrollAnchor: !stickRef.current,
  });
  const setBodyElement = useCallback(
    (element: HTMLDivElement | null) => {
      bodyRef.current = element;
      windowed.containerRef(element);
    },
    [windowed.containerRef],
  );
  useEffect(() => {
    if (!stickRef.current) {
      return;
    }

    windowed.scrollToBottom();
  }, [console.state.entries, windowed.scrollToBottom, windowed.totalHeight]);
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
    setPinnedResultEntryId(null);
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
      setPinnedResultEntryId(null);
      publishDebugCopyValueCandidate(copyDisplayedValueSurface, null);
    }
    if (contextMenu) {
      const currentItem = renderItems.find((item) => item.id === contextMenu.candidate.identity);
      const entryItem = renderItems.find(
        (item) => item.kind === "entry" && item.entryId === contextMenu.entryId,
      );
      const candidate =
        currentItem?.kind === "entry" && currentItem.entry.kind === "result"
          ? consoleCopyCandidate(
              currentItem.entry,
              console.resultOwner,
              inspectionOwner,
              copyDisplayedValueSurface,
            )
          : currentItem?.kind === "result-variable"
            ? debugCopyValueCandidateForNode({
                adapterEvaluateName: currentItem.variable.evaluateName,
                displayedValue: currentItem.variable.value,
                identity: currentItem.id,
                owner: entryItem?.kind === "entry" ? entryItem.resultInspectionOwner : null,
                surface: copyDisplayedValueSurface,
              })
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
    renderItems,
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
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.max(28, Math.min(input.scrollHeight, 100))}px`;
  }, [value]);
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
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }

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
    } else if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      const start = event.currentTarget.selectionStart ?? value.length;
      const end = event.currentTarget.selectionEnd ?? start;
      const expression = `${value.slice(0, start)}\n${value.slice(end)}`;
      const cursor = start + 1;
      setValue(expression);
      setHistoryIndex(null);
      onInputChanged?.({ cursor, expression });
      queueMicrotask(() => inputRef.current?.setSelectionRange(cursor, cursor));
    } else if (event.key === "Enter" && enabled && trimBlankLines(value).trim()) {
      event.preventDefault();
      void console.submit(trimBlankLines(value));
      setValue("");
      setHistoryIndex(null);
    } else if (event.key === "Escape") {
      setValue("");
      setHistoryIndex(null);
    } else if (
      event.key === "ArrowUp" &&
      history.length &&
      caretIsOnFirstLine(event.currentTarget)
    ) {
      event.preventDefault();
      const next = Math.min(history.length - 1, (historyIndex ?? history.length) - 1);
      setHistoryIndex(next);
      setValue(history[next] ?? "");
    } else if (
      event.key === "ArrowDown" &&
      historyIndex !== null &&
      caretIsOnLastLine(event.currentTarget)
    ) {
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
  const renderedSegments = segmentRenderedRows(windowed.rows, renderItems);
  const resultOwnerByEntryId = new Map(
    renderItems.flatMap((item) =>
      item.kind === "entry" && item.resultInspectionOwner
        ? [[item.entryId, item.resultInspectionOwner] as const]
        : [],
    ),
  );
  const renderEntry = (item: Extract<DebugConsoleRenderItem, { readonly kind: "entry" }>) => {
    const { entry } = item;
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
    const toggleResult = () => {
      if (
        entry.kind !== "result" ||
        !item.resultInspectionOwner ||
        !item.expandable ||
        !variablePages ||
        !onLoadVariablePage
      ) {
        return;
      }

      setResultExpanded(
        entry.id,
        !item.expanded,
        item.resultInspectionOwner,
        entry.variablesReference,
        [],
        0,
      );
    };
    return (
      <div
        aria-expanded={item.expandable ? item.expanded : undefined}
        aria-haspopup={copyable ? "menu" : undefined}
        aria-label={
          entry.kind === "result" && (copyable || item.expandable)
            ? "Debug console evaluation result"
            : undefined
        }
        data-entry-id={entry.id}
        data-kind={entry.kind}
        data-stream={entry.kind === "stdout" || entry.kind === "stderr" ? entry.kind : undefined}
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
                setPinnedResultEntryId(null);
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
                setPinnedResultEntryId(entry.id);
                publishDebugCopyValueCandidate(copyDisplayedValueSurface, copyCandidate);
                setContextMenu({
                  candidate: copyCandidate,
                  entryId: entry.id,
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
                setPinnedResultEntryId(entry.id);
                publishDebugCopyValueCandidate(copyDisplayedValueSurface, copyCandidate);
              }
            : undefined
        }
        onKeyDown={(event) => {
          if (copyCandidate && isLocalDebugCopyShortcut(event)) {
            publishDebugCopyValueCandidate(copyDisplayedValueSurface, copyCandidate);
            if (runDebugCopyDisplayedValue(copyDisplayedValueSurface)) {
              event.preventDefault();
            }
            return;
          }
          if (item.expandable && event.key === "ArrowRight" && !item.expanded) {
            event.preventDefault();
            toggleResult();
            return;
          }
          if (item.expandable && event.key === "ArrowLeft" && item.expanded) {
            event.preventDefault();
            toggleResult();
            return;
          }
          if (item.expandable && (event.key === "Enter" || event.key === " ")) {
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
            entryId: entry.id,
            invoker: event.currentTarget,
            position: { x: bounds.left + 8, y: bounds.top + 8 },
          });
        }}
        ref={(element) => windowed.measureRow(item.id, element)}
        role={copyable || item.expandable ? "group" : undefined}
        style={
          entry.kind === "stderr" || entry.kind === "error"
            ? { ...styles.entry, ...styles.error }
            : styles.entry
        }
        tabIndex={copyable || item.expandable ? 0 : undefined}
      >
        {item.expandable ? (
          <button
            aria-label={`${item.expanded ? "Collapse" : "Expand"} debug console result`}
            onClick={(event) => {
              event.stopPropagation();
              toggleResult();
            }}
            style={styles.disclosure}
            tabIndex={-1}
            type="button"
          >
            <span aria-hidden="true">{item.expanded ? "▾" : "▸"}</span>
          </button>
        ) : null}
        {formatDebugConsoleEntry(entry)}
      </div>
    );
  };
  const renderResultItem = (item: Exclude<DebugConsoleRenderItem, { readonly kind: "entry" }>) => {
    if (item.kind === "result-status") {
      return (
        <div
          aria-level={item.depth + 1}
          key={item.id}
          role="treeitem"
          style={{ ...styles.variableRow, ...styles.muted, paddingLeft: 8 + item.depth * 12 }}
        >
          {item.label}
        </div>
      );
    }

    if (item.kind === "result-load") {
      return (
        <div
          aria-level={item.depth + 1}
          key={item.id}
          role="treeitem"
          style={{ ...styles.variableRow, paddingLeft: 8 + item.depth * 12 }}
        >
          <button
            onClick={() =>
              onLoadVariablePage?.(item.owner, item.variablesReference, item.nextStart)
            }
            style={styles.disclosure}
            type="button"
          >
            {item.label}
          </button>
        </div>
      );
    }

    const owner = resultOwnerByEntryId.get(item.entryId);
    const copyCandidate = debugCopyValueCandidateForNode({
      adapterEvaluateName: item.variable.evaluateName,
      displayedValue: item.variable.value,
      identity: item.id,
      owner: owner ?? null,
      surface: copyDisplayedValueSurface,
    });
    const toggle = () => {
      if (!owner) {
        return;
      }

      setResultExpanded(
        item.id,
        !item.expanded,
        owner,
        item.variable.variablesReference,
        item.ancestors,
        item.depth,
      );
    };
    return (
      <div
        aria-expanded={item.expandable ? item.expanded : undefined}
        aria-level={item.depth + 1}
        data-testid="debug-console-variable"
        key={item.id}
        onBlur={
          copyCandidate
            ? () => publishDebugCopyValueCandidate(copyDisplayedValueSurface, null)
            : undefined
        }
        onClick={item.expandable ? toggle : undefined}
        onContextMenu={
          copyCandidate
            ? (event) => {
                event.preventDefault();
                publishDebugCopyValueCandidate(copyDisplayedValueSurface, copyCandidate);
                setContextMenu({
                  candidate: copyCandidate,
                  entryId: item.entryId,
                  invoker: event.currentTarget,
                  position: { x: event.clientX, y: event.clientY },
                });
              }
            : undefined
        }
        onFocus={
          copyCandidate
            ? () => publishDebugCopyValueCandidate(copyDisplayedValueSurface, copyCandidate)
            : undefined
        }
        onKeyDown={(event) => {
          if (copyCandidate && isLocalDebugCopyShortcut(event)) {
            publishDebugCopyValueCandidate(copyDisplayedValueSurface, copyCandidate);
            if (runDebugCopyDisplayedValue(copyDisplayedValueSurface)) {
              event.preventDefault();
            }
            return;
          }
          if (event.key === "ArrowRight" && item.expandable && !item.expanded) {
            event.preventDefault();
            toggle();
            return;
          }
          if (event.key === "ArrowLeft" && item.expandable && item.expanded) {
            event.preventDefault();
            toggle();
            return;
          }
          if (item.expandable && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            toggle();
          }
        }}
        role="treeitem"
        style={{ ...styles.variableRow, paddingLeft: 8 + item.depth * 12 }}
        tabIndex={0}
      >
        {item.expandable ? (
          <button
            aria-label={`${item.expanded ? "Collapse" : "Expand"} debug console variable ${item.variable.name}`}
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
            style={styles.disclosure}
            tabIndex={-1}
            type="button"
          >
            <span aria-hidden="true">{item.expanded ? "▾" : "▸"}</span>
          </button>
        ) : (
          <span aria-hidden="true"> </span>
        )}
        <span>{item.variable.name}:</span>
        <span>{formatVariableValue(item.variable)}</span>
      </div>
    );
  };
  return (
    <>
      <div id="debug-console-warning" style={styles.warning}>
        Warning: REPL expressions may execute code in the debugged process.
      </div>
      <div
        aria-label="Debug console output"
        data-testid="debug-console-body"
        onScroll={(event) => {
          windowed.onScroll(event);
          const body = event.currentTarget;
          stickRef.current = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
        }}
        ref={setBodyElement}
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
          <div
            data-testid="debug-console-spacer"
            style={{ height: windowed.totalHeight, position: "relative" }}
          >
            <div
              style={{
                left: 0,
                position: "absolute",
                right: 0,
                top: 0,
                transform: `translateY(${windowed.windowOffsetTop}px)`,
              }}
            >
              {renderedSegments.map((segment) => (
                <div
                  aria-label={
                    segment.kind === "tree" ? "Debug console result variables" : undefined
                  }
                  key={segment.key}
                  role={segment.kind === "tree" ? "tree" : undefined}
                  style={{
                    left: 0,
                    position: "absolute",
                    right: 0,
                    top: 0,
                    transform: `translateY(${segment.offsetTop - windowed.windowOffsetTop}px)`,
                  }}
                >
                  {segment.items.map((item) =>
                    item.kind === "entry" ? renderEntry(item) : renderResultItem(item),
                  )}
                </div>
              ))}
            </div>
          </div>
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
            ...(contextMenu.candidate.adapterEvaluateName === undefined
              ? []
              : [
                  {
                    id: "copy-evaluate-path",
                    label: "Copy as Expression",
                    onSelect: () => {
                      copyConsoleEvaluatePathFromMenuAndRestoreFocus(
                        copyDisplayedValueSurface,
                        contextMenu.candidate,
                        contextMenu.invoker,
                      );
                    },
                  },
                ]),
          ]}
          onClose={(reason) => {
            const invoker = contextMenu.invoker;
            setPinnedResultEntryId(contextMenu.entryId);
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
        <textarea
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
          rows={1}
          role="combobox"
          style={styles.input}
          value={value}
        />
      </div>
    </>
  );
}

interface RenderedSegment {
  readonly items: readonly DebugConsoleRenderItem[];
  readonly key: string;
  readonly kind: "entry" | "tree";
  readonly offsetTop: number;
}

function segmentRenderedRows(
  rows: readonly WindowedRow[],
  items: readonly DebugConsoleRenderItem[],
): readonly RenderedSegment[] {
  const segments: RenderedSegment[] = [];
  let cursor = 0;

  while (cursor < rows.length) {
    const firstRow = rows[cursor]!;
    const firstItem = items[firstRow.index];

    if (!firstItem) {
      cursor += 1;
      continue;
    }

    if (firstItem.kind === "entry") {
      segments.push({
        items: [firstItem],
        key: firstItem.id,
        kind: "entry",
        offsetTop: firstRow.offsetTop,
      });
      cursor += 1;
      continue;
    }

    const segmentItems: DebugConsoleRenderItem[] = [firstItem];
    let nextCursor = cursor + 1;
    let previousIndex = firstRow.index;

    while (nextCursor < rows.length) {
      const nextRow = rows[nextCursor]!;
      const nextItem = items[nextRow.index];

      if (
        !nextItem ||
        nextItem.kind === "entry" ||
        nextItem.entryId !== firstItem.entryId ||
        nextRow.index !== previousIndex + 1
      ) {
        break;
      }

      segmentItems.push(nextItem);
      previousIndex = nextRow.index;
      nextCursor += 1;
    }

    segments.push({
      items: segmentItems,
      key: `tree-${firstItem.entryId}`,
      kind: "tree",
      offsetTop: firstRow.offsetTop,
    });
    cursor = nextCursor;
  }

  return segments;
}

function trimBlankLines(value: string): string {
  return value.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}

function caretIsOnFirstLine(input: HTMLTextAreaElement): boolean {
  if (input.selectionStart !== input.selectionEnd) return false;
  const caret = input.selectionStart ?? 0;
  return input.value.lastIndexOf("\n", Math.max(0, caret - 1)) === -1;
}

function caretIsOnLastLine(input: HTMLTextAreaElement): boolean {
  if (input.selectionStart !== input.selectionEnd) return false;
  const caret = input.selectionStart ?? input.value.length;
  return input.value.indexOf("\n", caret) === -1;
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
    adapterEvaluateName: entry.evaluateName,
    displayedValue: entry.value,
    identity: entry.id,
    owner,
    surface,
  });
}

function copyConsoleEvaluatePathFromMenuAndRestoreFocus(
  surface: DebugCopyDisplayedValueSurface | undefined,
  candidate: DebugCopyValueCandidate,
  invoker: HTMLElement,
): void {
  const evaluateName = candidate.adapterEvaluateName;
  if (evaluateName === undefined) {
    queueMicrotask(() => invoker.focus());
    return;
  }
  publishDebugCopyValueCandidate(surface, {
    ...candidate,
    displayedValue: evaluateName,
  });
  copyDisplayedValueFromMenuAndRestoreFocus(surface, invoker);
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

function formatVariableValue(variable: DebugVariable): string {
  return variable.type ? `${variable.value} (${variable.type})` : variable.value;
}
