import type { GitChangedFile } from "./git";

export type AgentCommitSelection =
  | { readonly kind: "all" }
  | { readonly kind: "paths"; readonly relativePaths: ReadonlyArray<string> }
  | { readonly kind: "rows"; readonly rowKeys: ReadonlyArray<string> };

export function gitChangeRowKey(change: Pick<GitChangedFile, "relativePath" | "status">): string {
  const side = change.status === "untracked" ? "untracked" : "tracked";
  return `${side}:${change.relativePath}`;
}

export const ALL_CHANGES: AgentCommitSelection = Object.freeze({ kind: "all" });
export const STALE_COMMIT_SELECTION_MESSAGE =
  "The change list changed. Review the selection and commit again.";

export type CommitChangesSelection =
  | { readonly kind: "ok"; readonly changes: ReadonlyArray<GitChangedFile> }
  | { readonly kind: "empty" }
  | { readonly kind: "stale"; readonly missing: ReadonlyArray<string> };

export interface CommitIncludeSummary {
  readonly included: number;
  readonly total: number;
  readonly checked: boolean | "mixed";
}

export function selectCommitChanges(
  changes: ReadonlyArray<GitChangedFile>,
  selection: AgentCommitSelection,
): CommitChangesSelection {
  if (selection.kind === "all") {
    if (changes.length === 0) return { kind: "empty" };
    return { kind: "ok", changes };
  }
  const keyOf =
    selection.kind === "rows"
      ? gitChangeRowKey
      : (change: GitChangedFile): string => change.relativePath;
  const wanted = new Set(selection.kind === "rows" ? selection.rowKeys : selection.relativePaths);
  if (wanted.size === 0) return { kind: "empty" };
  const present = new Set(changes.map(keyOf));
  const missing = [...wanted].filter((key) => !present.has(key));
  if (missing.length > 0) return { kind: "stale", missing };
  return { kind: "ok", changes: changes.filter((change) => wanted.has(keyOf(change))) };
}

export function includeSelection(
  paths: ReadonlyArray<string>,
  excluded: ReadonlySet<string>,
): AgentCommitSelection {
  const effective = pruneExcluded(excluded, paths);
  return { kind: "rows", rowKeys: paths.filter((path) => !effective.has(path)) };
}

export function mergeChangesByPath(
  changes: ReadonlyArray<GitChangedFile>,
): ReadonlyArray<GitChangedFile> {
  const merged = new Map<string, GitChangedFile>();
  for (const change of changes) {
    const key = gitChangeRowKey(change);
    const previous = merged.get(key);
    merged.set(key, previous === undefined ? change : mergeChange(previous, change));
  }
  return [...merged.values()];
}

function mergeChange(first: GitChangedFile, second: GitChangedFile): GitChangedFile {
  const staged = first.isStaged ? first : second;
  const status =
    first.status === "conflicted" || second.status === "conflicted" ? "conflicted" : staged.status;
  return { ...staged, status, isStaged: first.isStaged && second.isStaged };
}

export function includeSummary(
  paths: ReadonlyArray<string>,
  excluded: ReadonlySet<string>,
): CommitIncludeSummary {
  const included = paths.length - pruneExcluded(excluded, paths).size;
  if (included === 0) return { included, total: paths.length, checked: false };
  if (included === paths.length) return { included, total: paths.length, checked: true };
  return { included, total: paths.length, checked: "mixed" };
}

export function setIncluded(
  excluded: ReadonlySet<string>,
  path: string,
  include: boolean,
): ReadonlySet<string> {
  const next = new Set(excluded);
  if (include) {
    next.delete(path);
    return next;
  }
  next.add(path);
  return next;
}

export function setAllIncluded(
  paths: ReadonlyArray<string>,
  include: boolean,
): ReadonlySet<string> {
  if (include) return new Set();
  return new Set(paths);
}

export function pruneExcluded(
  excluded: ReadonlySet<string>,
  paths: ReadonlyArray<string>,
): ReadonlySet<string> {
  const present = new Set(paths);
  return new Set([...excluded].filter((path) => present.has(path)));
}
