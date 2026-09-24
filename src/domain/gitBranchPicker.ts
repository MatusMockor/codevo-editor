export type GitBranchPickerBadge = "current" | "default" | "worktree" | "remote";

export interface GitBranchPickerItem {
  readonly name: string;
  readonly kind: "local" | "remote";
  readonly badge: GitBranchPickerBadge | null;
}

export type NewBranchNameValidation =
  | { readonly kind: "ok"; readonly name: string }
  | { readonly kind: "invalid"; readonly reason: string };

export const MAX_GIT_BRANCH_PICKER_ITEMS = 100;
export const MAX_NEW_BRANCH_NAME_BYTES = 200;
export const INVALID_BRANCH_NAME_REASON = "Use a branch name without spaces or special characters.";

const FORBIDDEN_BRANCH_CHARACTERS = new Set(["~", "^", ":", "?", "*", "[", "\\"]);

export function gitBranchPickerItems(
  branches: ReadonlyArray<string>,
  remotes: ReadonlyArray<string>,
  worktrees: ReadonlyArray<string>,
  current: string | null,
  defaultBranch: string | null,
  query: string,
  limit: number = MAX_GIT_BRANCH_PICKER_ITEMS,
): ReadonlyArray<GitBranchPickerItem> {
  const needle = query.trim().toLowerCase();
  const localSet = new Set(branches);
  const worktreeSet = new Set(worktrees);
  const pinned = [current, defaultBranch].filter(
    (name, index, all): name is string =>
      name !== null && localSet.has(name) && all.indexOf(name) === index,
  );
  const localNames = [...pinned, ...[...branches].sort().filter((name) => !pinned.includes(name))];
  const locals = localNames.map((name): GitBranchPickerItem => ({
    name,
    kind: "local",
    badge: localBadge(name, current, defaultBranch, worktreeSet),
  }));
  const remoteItems = [...remotes]
    .sort()
    .filter((name) => !localSet.has(name.slice(name.indexOf("/") + 1)))
    .map((name): GitBranchPickerItem => ({ name, kind: "remote", badge: "remote" }));
  return [...locals, ...remoteItems]
    .filter((item) => needle.length === 0 || item.name.toLowerCase().includes(needle))
    .slice(0, Math.max(0, limit));
}

export function validateNewBranchName(name: string): NewBranchNameValidation {
  const trimmed = name.trim();
  if (!validBranchName(trimmed)) return { kind: "invalid", reason: INVALID_BRANCH_NAME_REASON };
  return { kind: "ok", name: trimmed };
}

function validBranchName(name: string): boolean {
  if (name.length === 0 || name === "@") return false;
  if (new TextEncoder().encode(name).length > MAX_NEW_BRANCH_NAME_BYTES) return false;
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) return false;
  if (name.endsWith(".") || name.endsWith(".lock")) return false;
  if (name.includes("..") || name.includes("//") || name.includes("@{")) return false;
  if (name.split("/").some((component) => component.startsWith("."))) return false;
  return [...name].every(allowedBranchCharacter);
}

function allowedBranchCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  if (code <= 0x20 || code === 0x7f) return false;
  if (/\s/u.test(character)) return false;
  return !FORBIDDEN_BRANCH_CHARACTERS.has(character);
}

function localBadge(
  name: string,
  current: string | null,
  defaultBranch: string | null,
  worktrees: ReadonlySet<string>,
): GitBranchPickerBadge | null {
  if (name === current) return "current";
  if (name === defaultBranch) return "default";
  if (worktrees.has(name)) return "worktree";
  return null;
}
