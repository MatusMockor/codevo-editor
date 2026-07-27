import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { breakpointGroupRowKey, type BreakpointGroupRow } from "../domain/debugBreakpointGroups";

type ScrollToRowIndex = (index: number, align: "nearest" | "start" | "end") => void;

export interface UseBreakpointRowFocusInput {
  readonly collapsedFilePaths: ReadonlySet<string>;
  readonly rows: readonly BreakpointGroupRow[];
  toggleGroupCollapse(filePath: string): boolean;
}

export interface UseBreakpointRowFocusResult {
  readonly effectiveRovingRowKey: string | null;
  readonly pinnedRowIndices: readonly number[];
  handleBlur(event: FocusEvent<HTMLDivElement>): void;
  handleFocus(event: FocusEvent<HTMLDivElement>): void;
  handleNavigationKey(
    event: KeyboardEvent<HTMLButtonElement>,
    row: BreakpointGroupRow,
    scrollToRowIndex: ScrollToRowIndex,
  ): void;
  registerRowFocusElement(rowKey: string, element: HTMLButtonElement | null): void;
  toggleGroup(filePath: string): void;
}

export function useBreakpointRowFocus({
  collapsedFilePaths,
  rows,
  toggleGroupCollapse,
}: UseBreakpointRowFocusInput): UseBreakpointRowFocusResult {
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
  const [rovingRowKey, setRovingRowKey] = useState<string | null>(null);
  const rowFocusRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusKeyRef = useRef<string | null>(null);
  const focusAnimationFrameRef = useRef<number | null>(null);
  const focusedRowIndex = rows.findIndex(({ key }) => key === focusedRowKey);
  const rovingRowIndex = rows.findIndex(({ key }) => key === rovingRowKey);
  const effectiveRovingRowIndex = rovingRowIndex >= 0 ? rovingRowIndex : rows.length > 0 ? 0 : -1;
  const effectiveRovingRowKey = rows[effectiveRovingRowIndex]?.key ?? null;
  const pinnedRowIndices = useMemo(() => {
    const indices = new Set<number>();
    if (effectiveRovingRowIndex >= 0) {
      indices.add(effectiveRovingRowIndex);
    }
    if (focusedRowIndex >= 0) {
      indices.add(focusedRowIndex);
    }
    return [...indices];
  }, [effectiveRovingRowIndex, focusedRowIndex]);

  useLayoutEffect(() => {
    const pendingFocusKey = pendingFocusKeyRef.current;
    if (pendingFocusKey === null) {
      return;
    }
    const target = rowFocusRefs.current.get(pendingFocusKey);
    if (!target) {
      return;
    }
    pendingFocusKeyRef.current = null;
    target.focus();
  }, [rows]);

  useEffect(
    () => () => {
      if (focusAnimationFrameRef.current === null) {
        return;
      }
      cancelAnimationFrame(focusAnimationFrameRef.current);
      focusAnimationFrameRef.current = null;
      pendingFocusKeyRef.current = null;
    },
    [],
  );

  const focusRow = useCallback(
    (rowKey: string, rowIndex: number, scrollToRowIndex: ScrollToRowIndex) => {
      setRovingRowKey(rowKey);
      scrollToRowIndex(rowIndex, "nearest");
      const mountedRow = rowFocusRefs.current.get(rowKey);
      if (mountedRow) {
        pendingFocusKeyRef.current = null;
        mountedRow.focus();
        return;
      }
      pendingFocusKeyRef.current = rowKey;
      if (focusAnimationFrameRef.current !== null) {
        cancelAnimationFrame(focusAnimationFrameRef.current);
      }
      focusAnimationFrameRef.current = requestAnimationFrame(() => {
        focusAnimationFrameRef.current = null;
        if (pendingFocusKeyRef.current !== rowKey) {
          return;
        }
        const target = rowFocusRefs.current.get(rowKey);
        if (!target) {
          pendingFocusKeyRef.current = null;
          return;
        }
        pendingFocusKeyRef.current = null;
        target.focus();
      });
    },
    [],
  );

  const toggleGroup = useCallback(
    (groupFilePath: string) => {
      const groupKey = breakpointGroupRowKey(groupFilePath);
      const focusedRow = rows.find(({ key }) => key === focusedRowKey);
      const focusWillBeRemoved =
        !collapsedFilePaths.has(groupFilePath) &&
        focusedRow?.kind === "breakpoint" &&
        focusedRow.group.filePath === groupFilePath;
      const toggleApplied = toggleGroupCollapse(groupFilePath);
      if (!toggleApplied || !focusWillBeRemoved) {
        return;
      }
      pendingFocusKeyRef.current = groupKey;
      setFocusedRowKey(groupKey);
      setRovingRowKey(groupKey);
    },
    [collapsedFilePaths, focusedRowKey, rows, toggleGroupCollapse],
  );

  const handleNavigationKey = useCallback(
    (
      event: KeyboardEvent<HTMLButtonElement>,
      row: BreakpointGroupRow,
      scrollToRowIndex: ScrollToRowIndex,
    ) => {
      if (row.kind === "group" && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        toggleGroup(row.group.filePath);
        return;
      }
      const currentIndex = rows.findIndex(({ key }) => key === row.key);
      if (currentIndex < 0) {
        return;
      }
      let nextIndex: number;
      switch (event.key) {
        case "ArrowDown":
          nextIndex = Math.min(currentIndex + 1, rows.length - 1);
          break;
        case "ArrowUp":
          nextIndex = Math.max(currentIndex - 1, 0);
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = rows.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      const nextRow = rows[nextIndex];
      if (!nextRow) {
        return;
      }
      focusRow(nextRow.key, nextIndex, scrollToRowIndex);
    },
    [focusRow, rows, toggleGroup],
  );

  const registerRowFocusElement = useCallback(
    (rowKey: string, element: HTMLButtonElement | null) => {
      if (element) {
        rowFocusRefs.current.set(rowKey, element);
        return;
      }
      rowFocusRefs.current.delete(rowKey);
    },
    [],
  );

  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setFocusedRowKey(null);
  }, []);

  const handleFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-breakpoint-row-key]");
    const rowKey = row?.dataset.breakpointRowKey ?? null;
    setFocusedRowKey(rowKey);
    if (rowKey === null) {
      return;
    }
    setRovingRowKey(rowKey);
  }, []);

  return {
    effectiveRovingRowKey,
    handleBlur,
    handleFocus,
    handleNavigationKey,
    pinnedRowIndices,
    registerRowFocusElement,
    toggleGroup,
  };
}
