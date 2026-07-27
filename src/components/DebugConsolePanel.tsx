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
import type { LatencyClock, LatencyTracker } from "../domain/latencyTracker";
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
import { segmentDebugConsoleRenderedRows } from "./debugConsoleRenderedSegments";
import { useWindowedRows } from "./useWindowedRows";

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
  latencyClock = readLatencyClock,
  latencyTracker,
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
  latencyClock?: LatencyClock;
  latencyTracker?: LatencyTracker;
  variablePages?: DebugVariablePagesState;
  workspaceOwnerKey?: string | null;
}) {
  const [value, setValue] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [historyDraft, setHistoryDraft] = useState<string | null>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [activeCompletionIndex, setActiveCompletionIndex] = useState(0);
  const [expandedResultIds, setExpandedResultIds] = useState<ReadonlySet<string>>(() => new Set());
  const [activeResultTreeItemIds, setActiveResultTreeItemIds] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const [pinnedResultTreeItemId, setPinnedResultTreeItemId] = useState<string | null>(null);
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
  const focusedResultTreeItemIdRef = useRef<string | null>(null);
  const focusedResultTreeEntryIdRef = useRef<string | null>(null);
  const pendingResultTreeFocusIdRef = useRef<string | null>(null);
  const pendingResultEntryFocusIdRef = useRef<string | null>(null);
  const resultTreeItemElementsRef = useRef(new Map<string, HTMLElement>());
  const previousResultTreeActiveIndexRef = useRef(new Map<string, number>());
  const latencyInstrumentationRef = useRef({
    clock: latencyClock,
    tracker: latencyTracker,
  });
  latencyInstrumentationRef.current = {
    clock: latencyClock,
    tracker: latencyTracker,
  };
  const committedEntriesRef = useRef(console.state.entries);
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
  const renderModel = useMemo(() => {
    const entries = console.state.entries;
    const { clock, tracker } = latencyInstrumentationRef.current;
    const lastEntry = entries[entries.length - 1];
    const committedEntries = committedEntriesRef.current;
    const committedLastEntryId = committedEntries[committedEntries.length - 1]?.id ?? null;
    const appendStart =
      tracker &&
      lastEntry &&
      lastEntry.kind !== "truncated" &&
      lastEntry.id !== committedLastEntryId
        ? clock()
        : null;
    const items = buildDebugConsoleRenderItems({
      currentResultOwner: console.resultOwner ?? null,
      entries,
      expandedResultIds,
      inspectionOwner,
      resultTreeEnabled: Boolean(onLoadVariablePage),
      variablePages,
      workspaceOwnerKey,
    });
    return {
      entries,
      items,
      latencySample:
        tracker && appendStart !== null ? { durationMs: clock() - appendStart, tracker } : null,
    };
  }, [
    console.resultOwner,
    console.state.entries,
    expandedResultIds,
    inspectionOwner,
    onLoadVariablePage,
    variablePages,
    workspaceOwnerKey,
  ]);
  const lastPublishedRenderModelRef = useRef<typeof renderModel | null>(null);
  useEffect(() => {
    committedEntriesRef.current = renderModel.entries;
    const sample = renderModel.latencySample;
    if (!sample || lastPublishedRenderModelRef.current === renderModel) {
      return;
    }

    lastPublishedRenderModelRef.current = renderModel;
    sample.tracker.record("debug-console-append", sample.durationMs);
  }, [renderModel]);
  const renderItems = renderModel.items;
  const resultTreeItems = useMemo(
    () =>
      renderItems.flatMap((item, index) =>
        item.kind !== "entry"
          ? [{ depth: item.depth, entryId: item.entryId, id: item.id, renderIndex: index }]
          : [],
      ),
    [renderItems],
  );
  const resultTreeItemsByEntry = useMemo(() => {
    const itemsByEntry = new Map<string, typeof resultTreeItems>();
    for (const item of resultTreeItems) {
      const items = itemsByEntry.get(item.entryId);
      if (items) items.push(item);
      else itemsByEntry.set(item.entryId, [item]);
    }
    return itemsByEntry;
  }, [resultTreeItems]);
  const effectiveResultTreeItemIds = useMemo(() => {
    const effective = new Map<string, string>();
    for (const [entryId, items] of resultTreeItemsByEntry) {
      const requestedId = activeResultTreeItemIds.get(entryId);
      const requestedIndex = items.findIndex(({ id }) => id === requestedId);
      const fallbackIndex = Math.min(
        previousResultTreeActiveIndexRef.current.get(entryId) ?? 0,
        items.length - 1,
      );
      effective.set(entryId, items[requestedIndex >= 0 ? requestedIndex : fallbackIndex]!.id);
    }
    return effective;
  }, [activeResultTreeItemIds, resultTreeItemsByEntry]);
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
    const resultTreeIndex = resultTreeItems.find(
      ({ id }) => id === pinnedResultTreeItemId,
    )?.renderIndex;

    if (pinnedResultEntryId) {
      entryIds.add(pinnedResultEntryId);
    }

    if (contextMenu) {
      entryIds.add(contextMenu.entryId);
    }

    if (entryIds.size === 0 && resultTreeIndex === undefined) {
      return [];
    }

    const indices = renderItems.flatMap((item, index) =>
      item.kind === "entry" && entryIds.has(item.entryId) ? [index] : [],
    );
    if (resultTreeIndex !== undefined) indices.push(resultTreeIndex);
    return indices;
  }, [contextMenu, pinnedResultEntryId, pinnedResultTreeItemId, renderItems, resultTreeItems]);
  const {
    containerRef: windowedContainerRef,
    measureRow: measureWindowedRow,
    onScroll: onWindowedScroll,
    rows: windowedRows,
    scrollToBottom: scrollWindowToBottom,
    scrollToIndex: scrollWindowToIndex,
    totalHeight: windowedTotalHeight,
    windowOffsetTop,
  } = useWindowedRows({
    enabled: true,
    estimateHeight,
    itemCount: renderItems.length,
    keyForIndex,
    pinnedIndices,
    preserveScrollAnchor: !stickRef.current,
  });
  useLayoutEffect(() => {
    let changed = activeResultTreeItemIds.size !== effectiveResultTreeItemIds.size;
    for (const [entryId, effectiveId] of effectiveResultTreeItemIds) {
      if (activeResultTreeItemIds.get(entryId) !== effectiveId) changed = true;
      const items = resultTreeItemsByEntry.get(entryId) ?? [];
      previousResultTreeActiveIndexRef.current.set(
        entryId,
        Math.max(
          0,
          items.findIndex(({ id }) => id === effectiveId),
        ),
      );
    }
    if (changed) setActiveResultTreeItemIds(new Map(effectiveResultTreeItemIds));
    const focusedId = focusedResultTreeItemIdRef.current;
    const focusedEntryId = focusedResultTreeEntryIdRef.current;
    if (
      focusedId !== null &&
      focusedEntryId !== null &&
      !resultTreeItems.some(({ id }) => id === focusedId)
    ) {
      const replacementId = effectiveResultTreeItemIds.get(focusedEntryId) ?? null;
      pendingResultTreeFocusIdRef.current = replacementId;
      setPinnedResultTreeItemId(replacementId);
      if (replacementId === null) {
        pendingResultEntryFocusIdRef.current = focusedEntryId;
        setPinnedResultEntryId(focusedEntryId);
      }
    }
    const pendingFocusId = pendingResultTreeFocusIdRef.current;
    const pendingElement =
      pendingFocusId === null ? null : resultTreeItemElementsRef.current.get(pendingFocusId);
    if (pendingElement) {
      pendingResultTreeFocusIdRef.current = null;
      pendingElement.focus();
    }
    const pendingEntryId = pendingResultEntryFocusIdRef.current;
    const pendingEntry =
      pendingEntryId === null
        ? null
        : Array.from(bodyRef.current?.querySelectorAll<HTMLElement>("[data-entry-id]") ?? []).find(
            (element) => element.dataset.entryId === pendingEntryId,
          );
    if (pendingEntry) {
      pendingResultEntryFocusIdRef.current = null;
      pendingEntry.focus();
    }
    const retainedFocusedId = focusedResultTreeItemIdRef.current;
    const retainedFocusedElement =
      retainedFocusedId === null ? null : resultTreeItemElementsRef.current.get(retainedFocusedId);
    if (
      retainedFocusedElement &&
      document.activeElement !== retainedFocusedElement &&
      (document.activeElement === document.body || document.activeElement === null)
    ) {
      retainedFocusedElement.focus();
    }
  }, [
    activeResultTreeItemIds,
    effectiveResultTreeItemIds,
    resultTreeItems,
    resultTreeItemsByEntry,
    windowedRows,
  ]);
  const focusResultTreeItem = (entryId: string, id: string, align: "nearest" | "start" | "end") => {
    const target = resultTreeItems.find((item) => item.id === id);
    if (!target || target.entryId !== entryId) return;
    pendingResultTreeFocusIdRef.current = id;
    setPinnedResultTreeItemId(id);
    setActiveResultTreeItemIds((current) => {
      const next = new Map(current);
      next.set(entryId, id);
      return next;
    });
    scrollWindowToIndex(target.renderIndex, align);
    queueMicrotask(() => {
      const element = resultTreeItemElementsRef.current.get(id);
      if (!element || pendingResultTreeFocusIdRef.current !== id) return;
      pendingResultTreeFocusIdRef.current = null;
      element.focus();
    });
  };
  const handleResultTreeNavigation = (
    event: KeyboardEvent<HTMLElement>,
    entryId: string,
    currentId: string,
  ): boolean => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    const items = resultTreeItemsByEntry.get(entryId) ?? [];
    const currentIndex = items.findIndex(({ id }) => id === currentId);
    if (currentIndex < 0) return false;
    let nextIndex = currentIndex;
    let align: "nearest" | "start" | "end" = "nearest";
    if (event.key === "ArrowDown") nextIndex = Math.min(currentIndex + 1, items.length - 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(currentIndex - 1, 0);
    else if (event.key === "Home") {
      nextIndex = 0;
      align = "start";
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
      align = "end";
    } else {
      return false;
    }
    event.preventDefault();
    focusResultTreeItem(entryId, items[nextIndex]!.id, align);
    return true;
  };
  const focusFirstResultTreeChild = (entryId: string, parentDepth: number) => {
    const child = (resultTreeItemsByEntry.get(entryId) ?? []).find(
      ({ depth }) => depth === parentDepth + 1,
    );
    if (child) focusResultTreeItem(entryId, child.id, "nearest");
  };
  const focusResultTreeParent = (entryId: string, currentId: string, currentDepth: number) => {
    const items = resultTreeItemsByEntry.get(entryId) ?? [];
    const currentIndex = items.findIndex(({ id }) => id === currentId);
    const parent = items
      .slice(0, currentIndex)
      .reverse()
      .find(({ depth }) => depth === currentDepth - 1);
    if (parent) {
      focusResultTreeItem(entryId, parent.id, "nearest");
      return;
    }
    setPinnedResultTreeItemId(null);
    pendingResultEntryFocusIdRef.current = entryId;
    setPinnedResultEntryId(entryId);
    const rootIndex = renderItems.findIndex(
      (item) => item.kind === "entry" && item.entryId === entryId,
    );
    if (rootIndex >= 0) scrollWindowToIndex(rootIndex, "nearest");
    queueMicrotask(() => {
      const root = Array.from(
        bodyRef.current?.querySelectorAll<HTMLElement>("[data-entry-id]") ?? [],
      ).find((element) => element.dataset.entryId === entryId);
      if (!root || pendingResultEntryFocusIdRef.current !== entryId) return;
      pendingResultEntryFocusIdRef.current = null;
      root.focus();
    });
  };
  const releaseResultTreeFocusAfterBlur = () => {
    queueMicrotask(() => {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        activeElement.dataset.resultTreeItemId !== undefined &&
        bodyRef.current?.contains(activeElement)
      ) {
        return;
      }
      focusedResultTreeItemIdRef.current = null;
      focusedResultTreeEntryIdRef.current = null;
      setPinnedResultTreeItemId(null);
    });
  };
  const setBodyElement = useCallback(
    (element: HTMLDivElement | null) => {
      bodyRef.current = element;
      windowedContainerRef(element);
    },
    [windowedContainerRef],
  );
  useEffect(() => {
    if (!stickRef.current) {
      return;
    }

    scrollWindowToBottom();
  }, [console.state.entries, scrollWindowToBottom, windowedTotalHeight]);
  const sessionId = console.state.owner?.sessionId ?? null;
  useEffect(() => {
    setValue("");
    setHistoryIndex(null);
    setHistoryDraft(null);
    setCompletionOpen(false);
    setActiveCompletionIndex(0);
  }, [sessionId]);
  const resultOwnerEpoch = console.resultOwner?.epoch ?? null;
  const inspectionPauseGeneration = inspectionOwner?.pauseGeneration ?? null;
  useEffect(() => {
    setExpandedResultIds(new Set());
    setActiveResultTreeItemIds(new Map());
    setPinnedResultTreeItemId(null);
    focusedResultTreeItemIdRef.current = null;
    focusedResultTreeEntryIdRef.current = null;
    pendingResultTreeFocusIdRef.current = null;
    pendingResultEntryFocusIdRef.current = null;
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
        ? (consoleLiveCopyCandidate(
            focusedEntry,
            console.resultOwner,
            inspectionOwner,
            copyDisplayedValueSurface,
            workspaceOwnerKey,
          ) ??
          consoleDisplayedCopyCandidate(focusedEntry, copyDisplayedValueSurface, workspaceOwnerKey))
        : null;
    if (
      focusedResultCandidateRef.current !== null &&
      !debugCopyValuePresentationCandidatesEqual(
        focusedResultCandidateRef.current,
        focusedCandidate,
      )
    ) {
      focusedResultCandidateRef.current = focusedCandidate;
      if (!focusedCandidate) {
        focusedResultIdRef.current = null;
        setPinnedResultEntryId(null);
      }
      publishDebugCopyValueCandidate(copyDisplayedValueSurface, focusedCandidate);
    }
    if (contextMenu) {
      const currentItem = renderItems.find((item) => item.id === contextMenu.candidate.identity);
      const entryItem = renderItems.find(
        (item) => item.kind === "entry" && item.entryId === contextMenu.entryId,
      );
      const candidate =
        currentItem?.kind === "entry" && currentItem.entry.kind === "result"
          ? (consoleLiveCopyCandidate(
              currentItem.entry,
              console.resultOwner,
              inspectionOwner,
              copyDisplayedValueSurface,
              workspaceOwnerKey,
            ) ??
            consoleDisplayedCopyCandidate(
              currentItem.entry,
              copyDisplayedValueSurface,
              workspaceOwnerKey,
            ))
          : currentItem?.kind === "result-variable"
            ? debugCopyValueCandidateForNode({
                adapterEvaluateName: currentItem.variable.evaluateName,
                displayedValue: currentItem.variable.value,
                identity: currentItem.id,
                owner: entryItem?.kind === "entry" ? entryItem.resultInspectionOwner : null,
                surface: copyDisplayedValueSurface,
              })
            : null;
      if (!candidate) {
        setContextMenu(null);
        publishDebugCopyValueCandidate(copyDisplayedValueSurface, null);
      } else if (!debugCopyValuePresentationCandidatesEqual(contextMenu.candidate, candidate)) {
        publishDebugCopyValueCandidate(copyDisplayedValueSurface, candidate);
        setContextMenu((current) => (current ? { ...current, candidate } : current));
      }
    }
  }, [
    console.resultOwner,
    console.state.entries,
    contextMenu,
    copyDisplayedValueSurface,
    inspectionOwner,
    renderItems,
    workspaceOwnerKey,
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
    setHistoryDraft(null);
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

    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      const start = event.currentTarget.selectionStart ?? event.currentTarget.value.length;
      const end = event.currentTarget.selectionEnd ?? start;
      const currentValue = event.currentTarget.value;
      const expression = `${currentValue.slice(0, start)}\n${currentValue.slice(end)}`;
      const cursor = start + 1;
      dismissCompletion();
      setValue(expression);
      setHistoryIndex(null);
      setHistoryDraft(null);
      onInputChanged?.({ cursor, expression });
      queueMicrotask(() => inputRef.current?.setSelectionRange(cursor, cursor));
    } else if (onRequest && event.ctrlKey && (event.code === "Space" || event.key === " ")) {
      event.preventDefault();
      setCompletionOpen(true);
      setActiveCompletionIndex(0);
      onRequest?.({
        cursor: event.currentTarget.selectionStart ?? value.length,
        expression: value,
      });
    } else if (completionVisible && !eventHasModifier(event) && event.key === "ArrowDown") {
      event.preventDefault();
      if (visibleCompletionItems.length)
        setActiveCompletionIndex((current) => (current + 1) % visibleCompletionItems.length);
    } else if (completionVisible && !eventHasModifier(event) && event.key === "ArrowUp") {
      event.preventDefault();
      if (visibleCompletionItems.length)
        setActiveCompletionIndex(
          (current) =>
            (current - 1 + visibleCompletionItems.length) % visibleCompletionItems.length,
        );
    } else if (
      completionVisible &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (event.key === "Enter" || event.key === "Tab")
    ) {
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
    } else if (
      event.key === "Enter" &&
      !eventHasModifier(event) &&
      enabled &&
      trimBlankLines(value).trim()
    ) {
      event.preventDefault();
      void console.submit(trimBlankLines(value));
      setValue("");
      setHistoryIndex(null);
      setHistoryDraft(null);
    } else if (event.key === "Escape") {
      setValue("");
      setHistoryIndex(null);
      setHistoryDraft(null);
    } else if (
      event.key === "ArrowUp" &&
      !eventHasModifier(event) &&
      history.length &&
      caretIsOnFirstLine(event.currentTarget)
    ) {
      event.preventDefault();
      const next = Math.min(history.length - 1, (historyIndex ?? history.length) - 1);
      if (historyIndex === null) {
        setHistoryDraft(value);
      }
      setHistoryIndex(next);
      setValue(history[next] ?? "");
    } else if (
      event.key === "ArrowDown" &&
      !eventHasModifier(event) &&
      historyIndex !== null &&
      caretIsOnLastLine(event.currentTarget)
    ) {
      event.preventDefault();
      const next = historyIndex + 1;
      setHistoryIndex(next >= history.length ? null : next);
      setValue(next >= history.length ? (historyDraft ?? "") : (history[next] ?? ""));
      if (next >= history.length) {
        setHistoryDraft(null);
      }
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
  const renderedSegments = segmentDebugConsoleRenderedRows(windowedRows, renderItems);
  const contextMenuCanCopyEvaluatePath =
    contextMenu !== null &&
    contextMenu.candidate.adapterEvaluateName !== undefined &&
    canCopyConsoleEvaluatePath(copyDisplayedValueSurface);
  const resultOwnerByEntryId = new Map(
    renderItems.flatMap((item) =>
      item.kind === "entry" && item.resultInspectionOwner
        ? [[item.entryId, item.resultInspectionOwner] as const]
        : [],
    ),
  );
  const renderEntry = (item: Extract<DebugConsoleRenderItem, { readonly kind: "entry" }>) => {
    const { entry } = item;
    const liveCopyCandidate =
      entry.kind === "result"
        ? consoleLiveCopyCandidate(
            entry,
            console.resultOwner,
            inspectionOwner,
            copyDisplayedValueSurface,
            workspaceOwnerKey,
          )
        : null;
    const displayedCopyCandidate =
      entry.kind === "result"
        ? consoleDisplayedCopyCandidate(entry, copyDisplayedValueSurface, workspaceOwnerKey)
        : null;
    const copyCandidate = liveCopyCandidate ?? displayedCopyCandidate;
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
            if (
              activateDebugConsoleCandidate(copyDisplayedValueSurface, copyCandidate) &&
              runDebugCopyDisplayedValue(copyDisplayedValueSurface)
            ) {
              event.preventDefault();
            }
            return;
          }
          if (item.expandable && event.key === "ArrowRight" && !item.expanded) {
            event.preventDefault();
            toggleResult();
            return;
          }
          if (item.expandable && event.key === "ArrowRight" && item.expanded) {
            event.preventDefault();
            focusFirstResultTreeChild(item.entryId, 0);
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
        ref={(element) => measureWindowedRow(item.id, element)}
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
          data-result-tree-item-id={item.id}
          key={item.id}
          onBlur={releaseResultTreeFocusAfterBlur}
          onFocus={() => {
            focusedResultTreeItemIdRef.current = item.id;
            focusedResultTreeEntryIdRef.current = item.entryId;
            setPinnedResultTreeItemId(item.id);
            setActiveResultTreeItemIds((current) => {
              const next = new Map(current);
              next.set(item.entryId, item.id);
              return next;
            });
          }}
          onKeyDown={(event) => {
            if (handleResultTreeNavigation(event, item.entryId, item.id)) return;
            if (event.key !== "ArrowLeft") return;
            event.preventDefault();
            focusResultTreeParent(item.entryId, item.id, item.depth);
          }}
          ref={(element) => {
            if (element) resultTreeItemElementsRef.current.set(item.id, element);
            else resultTreeItemElementsRef.current.delete(item.id);
          }}
          role="treeitem"
          style={{ ...styles.variableRow, ...styles.muted, paddingLeft: 8 + item.depth * 12 }}
          tabIndex={effectiveResultTreeItemIds.get(item.entryId) === item.id ? 0 : -1}
        >
          {item.label}
        </div>
      );
    }

    if (item.kind === "result-load") {
      const load = () => onLoadVariablePage?.(item.owner, item.variablesReference, item.nextStart);
      return (
        <div
          aria-level={item.depth + 1}
          data-result-tree-item-id={item.id}
          key={item.id}
          onBlur={releaseResultTreeFocusAfterBlur}
          onFocus={() => {
            focusedResultTreeItemIdRef.current = item.id;
            focusedResultTreeEntryIdRef.current = item.entryId;
            setPinnedResultTreeItemId(item.id);
            setActiveResultTreeItemIds((current) => {
              const next = new Map(current);
              next.set(item.entryId, item.id);
              return next;
            });
          }}
          onKeyDown={(event) => {
            if (handleResultTreeNavigation(event, item.entryId, item.id)) return;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              focusResultTreeParent(item.entryId, item.id, item.depth);
              return;
            }
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            load();
          }}
          ref={(element) => {
            if (element) resultTreeItemElementsRef.current.set(item.id, element);
            else resultTreeItemElementsRef.current.delete(item.id);
          }}
          role="treeitem"
          style={{ ...styles.variableRow, paddingLeft: 8 + item.depth * 12 }}
          tabIndex={effectiveResultTreeItemIds.get(item.entryId) === item.id ? 0 : -1}
        >
          <button onClick={load} style={styles.disclosure} tabIndex={-1} type="button">
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
        data-result-tree-item-id={item.id}
        key={item.id}
        onBlur={() => {
          releaseResultTreeFocusAfterBlur();
          if (copyCandidate) {
            publishDebugCopyValueCandidate(copyDisplayedValueSurface, null);
          }
        }}
        onClick={
          item.expandable
            ? (event) => {
                event.currentTarget.focus();
                toggle();
              }
            : undefined
        }
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
        onFocus={() => {
          focusedResultTreeItemIdRef.current = item.id;
          focusedResultTreeEntryIdRef.current = item.entryId;
          setPinnedResultTreeItemId(item.id);
          setActiveResultTreeItemIds((current) => {
            const next = new Map(current);
            next.set(item.entryId, item.id);
            return next;
          });
          if (copyCandidate) {
            publishDebugCopyValueCandidate(copyDisplayedValueSurface, copyCandidate);
          }
        }}
        onKeyDown={(event) => {
          if (copyCandidate && isLocalDebugCopyShortcut(event)) {
            if (
              activateDebugConsoleCandidate(copyDisplayedValueSurface, copyCandidate) &&
              runDebugCopyDisplayedValue(copyDisplayedValueSurface)
            ) {
              event.preventDefault();
            }
            return;
          }
          if (handleResultTreeNavigation(event, item.entryId, item.id)) return;
          if (event.key === "ArrowRight" && item.expandable && !item.expanded) {
            event.preventDefault();
            toggle();
            return;
          }
          if (event.key === "ArrowRight" && item.expandable && item.expanded) {
            event.preventDefault();
            const items = resultTreeItemsByEntry.get(item.entryId) ?? [];
            const index = items.findIndex(({ id }) => id === item.id);
            let child: (typeof items)[number] | undefined;
            for (const candidate of items.slice(index + 1)) {
              if (candidate.depth <= item.depth) break;
              if (candidate.depth === item.depth + 1) {
                child = candidate;
                break;
              }
            }
            if (child) focusResultTreeItem(item.entryId, child.id, "nearest");
            return;
          }
          if (event.key === "ArrowLeft" && item.expandable && item.expanded) {
            event.preventDefault();
            toggle();
            return;
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            focusResultTreeParent(item.entryId, item.id, item.depth);
            return;
          }
          if (item.expandable && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            toggle();
          }
        }}
        ref={(element) => {
          if (element) resultTreeItemElementsRef.current.set(item.id, element);
          else resultTreeItemElementsRef.current.delete(item.id);
        }}
        role="treeitem"
        style={{ ...styles.variableRow, paddingLeft: 8 + item.depth * 12 }}
        tabIndex={effectiveResultTreeItemIds.get(item.entryId) === item.id ? 0 : -1}
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
          onWindowedScroll(event);
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
            style={{ height: windowedTotalHeight, position: "relative" }}
          >
            <div
              style={{
                left: 0,
                position: "absolute",
                right: 0,
                top: 0,
                transform: `translateY(${windowOffsetTop}px)`,
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
                    transform: `translateY(${segment.offsetTop - windowOffsetTop}px)`,
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
                copyDisplayedValueFromMenuAndRestoreFocus(
                  copyDisplayedValueSurface,
                  contextMenu.candidate,
                  contextMenu.invoker,
                );
              },
            },
            ...(!contextMenuCanCopyEvaluatePath
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
            setHistoryDraft(null);
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

function eventHasModifier(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

function copyDisplayedValueFromMenuAndRestoreFocus(
  surface: DebugCopyDisplayedValueSurface | undefined,
  candidate: DebugCopyValueCandidate,
  invoker: HTMLElement,
): void {
  try {
    if (!activateDebugConsoleCandidate(surface, candidate) || !surface?.canCopyDisplayedValue()) {
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

function consoleLiveCopyCandidate(
  entry: Extract<UseDebugConsoleResult["state"]["entries"][number], { readonly kind: "result" }>,
  currentResultOwner: UseDebugConsoleResult["resultOwner"],
  owner: DebugInspectionOwner | null,
  surface: DebugCopyDisplayedValueSurface | undefined,
  workspaceOwnerKey: string | null,
): DebugCopyValueCandidate | null {
  if (
    !owner ||
    !entry.resultOwner ||
    !currentResultOwner ||
    !workspaceOwnerKey ||
    entry.resultOwner.workspaceOwnerKey !== workspaceOwnerKey ||
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

function consoleDisplayedCopyCandidate(
  entry: Extract<UseDebugConsoleResult["state"]["entries"][number], { readonly kind: "result" }>,
  surface: DebugCopyDisplayedValueSurface | undefined,
  workspaceOwnerKey: string | null,
): DebugCopyValueCandidate | null {
  const owner = entry.resultOwner;
  if (
    !owner ||
    !surface ||
    !workspaceOwnerKey ||
    owner.workspaceOwnerKey !== workspaceOwnerKey ||
    surface.workspaceOwnerKey !== workspaceOwnerKey
  ) {
    return null;
  }
  return {
    source: "console",
    identity: entry.id,
    rootKey: owner.rootKey,
    workspaceOwnerKey,
    sessionId: owner.sessionId,
    pauseGeneration: owner.pauseGeneration,
    frameId: owner.frameId,
    generation: surface.generation,
    epoch: owner.epoch,
    displayedValue: entry.value,
  };
}

function canCopyConsoleEvaluatePath(surface: DebugCopyDisplayedValueSurface | undefined): boolean {
  try {
    return surface?.canCopyEvaluatePath() === true;
  } catch {
    return false;
  }
}

function activateDebugConsoleCandidate(
  surface: DebugCopyDisplayedValueSurface | undefined,
  candidate: DebugCopyValueCandidate,
): boolean {
  try {
    return surface?.onCandidateChange(candidate) === true;
  } catch {
    return false;
  }
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
  try {
    if (!activateDebugConsoleCandidate(surface, candidate) || !surface?.canCopyEvaluatePath()) {
      queueMicrotask(() => invoker.focus());
      return;
    }
    void Promise.resolve(surface.copyEvaluatePathFromMenu())
      .catch(() => false)
      .finally(() => queueMicrotask(() => invoker.focus()));
  } catch {
    queueMicrotask(() => invoker.focus());
  }
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

function readLatencyClock(): number {
  return performance.now();
}
