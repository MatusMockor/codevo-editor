import {
  MAX_TURN_CHANGED_FILES,
  MAX_TURN_CHANGE_PATH_DEPTH,
  MAX_TURN_CHANGE_PATH_BYTES,
  type AgentTurnChangedFile,
} from "./agentTurnChanges";

export const MAX_TURN_DIFF_TREE_FILES = MAX_TURN_CHANGED_FILES;
export const MAX_TURN_DIFF_TREE_DEPTH = MAX_TURN_CHANGE_PATH_DEPTH;
export interface TurnDiffTreeStats {
  readonly addedLines: number | null;
  readonly deletedLines: number | null;
  readonly unknownFiles: number;
  readonly fileCount: number;
}
export type TurnDiffTreeNode =
  | Readonly<{
      kind: "file";
      path: string;
      name: string;
      file: AgentTurnChangedFile;
      stats: TurnDiffTreeStats;
    }>
  | Readonly<{
      kind: "directory";
      path: string;
      name: string;
      children: readonly TurnDiffTreeNode[];
      stats: TurnDiffTreeStats;
    }>;
interface Directory {
  path: string;
  name: string;
  directories: Map<string, Directory>;
  files: Extract<TurnDiffTreeNode, { kind: "file" }>[];
}
const emptyStats = (): TurnDiffTreeStats => ({
  addedLines: null,
  deletedLines: null,
  unknownFiles: 0,
  fileCount: 0,
});
function sum(stats: readonly TurnDiffTreeStats[]): TurnDiffTreeStats {
  return stats.reduce(
    (total, next) => ({
      addedLines:
        total.addedLines === null && next.addedLines === null
          ? null
          : (total.addedLines ?? 0) + (next.addedLines ?? 0),
      deletedLines:
        total.deletedLines === null && next.deletedLines === null
          ? null
          : (total.deletedLines ?? 0) + (next.deletedLines ?? 0),
      unknownFiles: total.unknownFiles + next.unknownFiles,
      fileCount: total.fileCount + next.fileCount,
    }),
    emptyStats(),
  );
}
function directory(name: string, path: string): Directory {
  return { name, path, directories: new Map(), files: [] };
}
function compare(left: TurnDiffTreeNode, right: TurnDiffTreeNode): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return left.name.localeCompare(right.name, "en", { numeric: true });
}
function nodes(root: Directory): TurnDiffTreeNode[] {
  return [
    ...[...root.directories.values()].map((entry): TurnDiffTreeNode => {
      let children = nodes(entry);
      let name = entry.name;
      let path = entry.path;
      while (children.length === 1 && children[0].kind === "directory") {
        const child = children[0];
        name += `/${child.name}`;
        path = child.path;
        children = [...child.children];
      }
      return { kind: "directory", path, name, children, stats: sum(children.map((n) => n.stats)) };
    }),
    ...root.files,
  ].sort(compare);
}

/** Builds a bounded display projection; omitted or invalid entries are reported as partial. */
export function buildAgentTurnDiffTree(files: readonly AgentTurnChangedFile[]): Readonly<{
  nodes: readonly TurnDiffTreeNode[];
  stats: TurnDiffTreeStats;
  truncated: boolean;
}> {
  const root = directory("", "");
  const seen = new Set<string>();
  let truncated = files.length > MAX_TURN_DIFF_TREE_FILES;
  for (const file of files.slice(0, MAX_TURN_DIFF_TREE_FILES)) {
    const path = file.relativePath.split("\\").join("/");
    const segments = path.split("/");
    if (
      path.length > MAX_TURN_CHANGE_PATH_BYTES ||
      /^[A-Za-z]:/.test(path) ||
      segments.length > MAX_TURN_DIFF_TREE_DEPTH ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
      seen.has(path)
    ) {
      truncated = true;
      continue;
    }
    seen.add(path);
    let parent = root;
    for (const segment of segments.slice(0, -1)) {
      let next = parent.directories.get(segment);
      if (!next) {
        next = directory(segment, parent.path ? `${parent.path}/${segment}` : segment);
        parent.directories.set(segment, next);
      }
      parent = next;
    }
    parent.files.push({
      kind: "file",
      path,
      name: segments[segments.length - 1],
      file,
      stats: {
        addedLines: file.addedLines,
        deletedLines: file.deletedLines,
        unknownFiles: file.addedLines === null || file.deletedLines === null ? 1 : 0,
        fileCount: 1,
      },
    });
  }
  const result = nodes(root);
  return { nodes: result, stats: sum(result.map((node) => node.stats)), truncated };
}
