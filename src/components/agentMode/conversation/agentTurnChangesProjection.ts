import type { TurnDiffTreeNode } from "../../../domain/agentTurnDiffTree";

export type AgentTurnChangeFileNode = Extract<TurnDiffTreeNode, { kind: "file" }>;
export type AgentTurnChangeFolderNode = Extract<TurnDiffTreeNode, { kind: "directory" }>;

export interface AgentTurnChangesOutline {
  readonly folderPaths: ReadonlyArray<string>;
  readonly expandedRows: number;
}

export type AgentTurnChangeRow =
  | Readonly<{ kind: "file"; node: AgentTurnChangeFileNode; depth: number }>
  | Readonly<{
      kind: "directory";
      node: AgentTurnChangeFolderNode;
      depth: number;
      expanded: boolean;
    }>;

export interface AgentTurnChangeRows {
  readonly rows: ReadonlyArray<AgentTurnChangeRow>;
  readonly representedFiles: number;
}

interface PendingNode {
  readonly node: TurnDiffTreeNode;
  readonly depth: number;
}

export function outlineAgentTurnChanges(
  nodes: ReadonlyArray<TurnDiffTreeNode>,
): AgentTurnChangesOutline {
  const folderPaths = folderPathsOf(nodes);
  const files = nodes.reduce((total, node) => total + node.stats.fileCount, 0);
  return { folderPaths, expandedRows: folderPaths.length + files };
}

export function visibleAgentTurnChangeRows(
  nodes: ReadonlyArray<TurnDiffTreeNode>,
  collapsed: ReadonlySet<string>,
  maxRows: number,
): AgentTurnChangeRows {
  const limit = rowLimit(maxRows);
  const rows: AgentTurnChangeRow[] = [];
  const pending = pendingAt(nodes, 0);
  let representedFiles = 0;
  while (rows.length < limit) {
    const next = pending.pop();
    if (next === undefined) break;
    const row = rowFor(next, collapsed);
    rows.push(row);
    representedFiles += filesRepresentedBy(row);
    pending.push(...pendingBelow(row));
  }
  return { rows, representedFiles };
}

export function hasExpandedFolderRow(rows: ReadonlyArray<AgentTurnChangeRow>): boolean {
  return rows.some((row) => row.kind === "directory" && row.expanded);
}

function rowLimit(maxRows: number): number {
  if (!Number.isFinite(maxRows)) return 0;
  return Math.max(Math.trunc(maxRows), 0);
}

function pendingAt(nodes: ReadonlyArray<TurnDiffTreeNode>, depth: number): PendingNode[] {
  return nodes.map((node) => ({ node, depth })).reverse();
}

function rowFor({ depth, node }: PendingNode, collapsed: ReadonlySet<string>): AgentTurnChangeRow {
  switch (node.kind) {
    case "file":
      return { kind: "file", node, depth };
    case "directory":
      return { kind: "directory", node, depth, expanded: !collapsed.has(node.path) };
    default:
      return unsupportedTurnChange(node);
  }
}

function filesRepresentedBy(row: AgentTurnChangeRow): number {
  switch (row.kind) {
    case "file":
      return 1;
    case "directory":
      return row.expanded ? 0 : row.node.stats.fileCount;
    default:
      return unsupportedTurnChange(row);
  }
}

function pendingBelow(row: AgentTurnChangeRow): PendingNode[] {
  switch (row.kind) {
    case "file":
      return [];
    case "directory":
      return row.expanded ? pendingAt(row.node.children, row.depth + 1) : [];
    default:
      return unsupportedTurnChange(row);
  }
}

function folderPathsOf(nodes: ReadonlyArray<TurnDiffTreeNode>): ReadonlyArray<string> {
  return nodes.flatMap((node) => {
    switch (node.kind) {
      case "file":
        return [];
      case "directory":
        return [node.path, ...folderPathsOf(node.children)];
      default:
        return unsupportedTurnChange(node);
    }
  });
}

function unsupportedTurnChange(value: never): never {
  throw new Error(`Unsupported turn change: ${String(value)}`);
}
