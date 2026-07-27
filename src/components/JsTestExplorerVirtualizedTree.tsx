import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { JsTestRunScope } from "../domain/jsTestRunScope";
import type {
  JsTestExplorerNode,
  JsTestExplorerTestNode,
  JsTestExplorerWorkspaceNode,
} from "../domain/jsTestExplorerTree";
import {
  boundedListNavigationIndex,
  flattenExpandedJsTestExplorerTree,
  type FlatJsTestExplorerRow,
} from "./jsTestExplorerPanelProjection";
import { JsTestExplorerTreeRow } from "./JsTestExplorerTreeRow";
import { useWindowedRows } from "./useWindowedRows";

const ROW_HEIGHT = 26;
const WINDOWING_THRESHOLD = 80;

interface JsTestExplorerVirtualizedTreeProps {
  readonly debugDisabled: boolean;
  readonly disabled: boolean;
  readonly onDebugNode: (
    node: Exclude<JsTestExplorerNode, JsTestExplorerWorkspaceNode>,
  ) => Promise<void>;
  readonly onOpenTest: (test: JsTestExplorerTestNode) => void;
  readonly onRunScope: (scope: JsTestRunScope) => void;
  readonly root: JsTestExplorerWorkspaceNode;
  readonly rootPath: string;
}

const styles: Record<string, CSSProperties> = {
  container: { maxHeight: 360, overflow: "auto" },
  tree: {
    fontSize: 12,
    listStyle: "none",
    margin: 0,
    padding: "4px 0",
    position: "relative",
  },
};

export function JsTestExplorerVirtualizedTree({
  root,
  ...props
}: JsTestExplorerVirtualizedTreeProps): ReactNode {
  return <OwnedJsTestExplorerVirtualizedTree key={root.id} root={root} {...props} />;
}

function OwnedJsTestExplorerVirtualizedTree({
  debugDisabled,
  disabled,
  onDebugNode,
  onOpenTest,
  onRunScope,
  root,
  rootPath,
}: JsTestExplorerVirtualizedTreeProps): ReactNode {
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo(
    () => flattenExpandedJsTestExplorerTree(root, collapsedIds),
    [collapsedIds, root],
  );
  const rowIndexById = useMemo(
    () => new Map(rows.map(({ node }, index) => [node.id, index] as const)),
    [rows],
  );
  const [activeId, setActiveId] = useState(root.id);
  const activeIndex = rowIndexById.get(activeId) ?? 0;
  const rowElementsRef = useRef<Map<string, HTMLLIElement>>(new Map());
  const estimateHeight = useCallback(() => ROW_HEIGHT, []);
  const keyForIndex = useCallback(
    (index: number) => rows[index]?.node.id ?? `missing-${index}`,
    [rows],
  );
  const windowed = useWindowedRows({
    enabled: rows.length > WINDOWING_THRESHOLD,
    estimateHeight,
    itemCount: rows.length,
    keyForIndex,
    overscan: 8,
    pinnedIndices: [activeIndex],
  });

  useEffect(() => {
    if (rowIndexById.has(activeId)) return;
    setActiveId(rows[0]?.node.id ?? root.id);
  }, [activeId, root.id, rowIndexById, rows]);

  const focusIndex = (index: number): void => {
    const row = rows[index];
    if (!row) return;
    setActiveId(row.node.id);
    windowed.scrollToIndex(index, "nearest");
    requestAnimationFrame(() => rowElementsRef.current.get(row.node.id)?.focus());
  };
  const toggle = (row: FlatJsTestExplorerRow, forceExpanded?: boolean): void => {
    if (row.childCount === 0) return;
    setCollapsedIds((current) => {
      const next = new Set(current);
      const shouldCollapse = forceExpanded === undefined ? !next.has(row.node.id) : !forceExpanded;
      if (shouldCollapse) next.add(row.node.id);
      else next.delete(row.node.id);
      return next;
    });
  };
  const onTreeKeyDown = (event: KeyboardEvent<HTMLLIElement>, row: FlatJsTestExplorerRow): void => {
    if (event.target !== event.currentTarget) return;
    const index = rowIndexById.get(row.node.id) ?? 0;
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.preventDefault();
      focusIndex(boundedListNavigationIndex(index, rows.length, event.key));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (row.childCount > 0 && collapsedIds.has(row.node.id)) toggle(row, true);
      else if (row.childCount > 0) focusIndex(index + 1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.childCount > 0 && !collapsedIds.has(row.node.id)) {
        toggle(row, false);
        return;
      }
      const parentIndex = row.parentId ? (rowIndexById.get(row.parentId) ?? -1) : -1;
      if (parentIndex >= 0) focusIndex(parentIndex);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && row.childCount > 0) {
      event.preventDefault();
      toggle(row);
    }
  };
  const isWindowed = rows.length > WINDOWING_THRESHOLD;

  return (
    <div
      aria-label="JavaScript tests viewport"
      onScroll={windowed.onScroll}
      ref={windowed.containerRef}
      style={styles.container}
    >
      <ul
        aria-label="JavaScript tests"
        role="tree"
        style={{ ...styles.tree, height: isWindowed ? windowed.totalHeight : undefined }}
      >
        {windowed.rows.map(({ index, offsetTop }) => {
          const row = rows[index];
          if (!row) return null;
          return (
            <JsTestExplorerTreeRow
              active={row.node.id === activeId}
              collapsed={collapsedIds.has(row.node.id)}
              debugDisabled={debugDisabled}
              disabled={disabled}
              key={row.node.id}
              onDebugNode={onDebugNode}
              onFocus={() => setActiveId(row.node.id)}
              onKeyDown={(event) => onTreeKeyDown(event, row)}
              onOpenTest={onOpenTest}
              onRunScope={onRunScope}
              ref={(element) => {
                if (element) rowElementsRef.current.set(row.node.id, element);
                else rowElementsRef.current.delete(row.node.id);
                windowed.measureRow(row.node.id, element);
              }}
              rootPath={rootPath}
              row={row}
              style={
                isWindowed ? { left: 0, position: "absolute", right: 0, top: offsetTop } : undefined
              }
            />
          );
        })}
      </ul>
    </div>
  );
}
