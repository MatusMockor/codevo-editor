import type { JsTestExplorerNode } from "../domain/jsTestExplorerTree";

export interface FlatJsTestExplorerRow {
  readonly childCount: number;
  readonly indexInParent: number;
  readonly level: number;
  readonly node: JsTestExplorerNode;
  readonly parentId: string | null;
  readonly siblingCount: number;
}

export function flattenExpandedJsTestExplorerTree(
  root: JsTestExplorerNode,
  collapsedIds: ReadonlySet<string>,
): readonly FlatJsTestExplorerRow[] {
  const rows: FlatJsTestExplorerRow[] = [];
  const pending: FlatJsTestExplorerRow[] = [
    {
      childCount: childrenOf(root).length,
      indexInParent: 0,
      level: 1,
      node: root,
      parentId: null,
      siblingCount: 1,
    },
  ];

  while (pending.length > 0) {
    const row = pending.pop();
    if (!row) break;
    rows.push(row);

    if (collapsedIds.has(row.node.id)) continue;
    const children = childrenOf(row.node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (!child) continue;
      pending.push({
        childCount: childrenOf(child).length,
        indexInParent: index,
        level: row.level + 1,
        node: child,
        parentId: row.node.id,
        siblingCount: children.length,
      });
    }
  }

  return rows;
}

export function childrenOf(node: JsTestExplorerNode): readonly JsTestExplorerNode[] {
  return node.kind === "test" ? [] : node.children;
}

export function boundedListNavigationIndex(
  currentIndex: number,
  itemCount: number,
  key: "ArrowDown" | "ArrowUp" | "End" | "Home",
): number {
  if (itemCount <= 0) return -1;
  const index = Math.max(0, Math.min(itemCount - 1, currentIndex));
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowUp") return Math.max(0, index - 1);
  return Math.min(itemCount - 1, index + 1);
}
