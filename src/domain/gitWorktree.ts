export const MAX_WORKTREES_PER_REPOSITORY = 16;
export const MAX_WORKTREE_PATH_BYTES = 4_096;
export const MAX_WORKTREE_BRANCH_BYTES = 512;
export const WORKTREE_BASE_DIR_NAME = ".worktrees";

export interface GitWorktreeDescriptor {
  readonly worktreePath: string;
  readonly branch: string | null;
  readonly head: string | null;
  readonly isPrimary: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
}

export interface AgentWorktreeReceipt {
  readonly worktreePath: string;
  readonly branch: string;
  readonly trusted: boolean;
}

export interface GitWorktreeGateway {
  listWorktrees(repositoryRoot: string): Promise<ReadonlyArray<GitWorktreeDescriptor>>;
  addAgentWorktree(repositoryRoot: string, taskId: string): Promise<AgentWorktreeReceipt>;
  removeWorktree(repositoryRoot: string, worktreePath: string, force: boolean): Promise<void>;
  pruneWorktrees(repositoryRoot: string): Promise<ReadonlyArray<string>>;
}

interface ParsedGitWorktreeDescriptors {
  readonly worktrees: ReadonlyArray<GitWorktreeDescriptor>;
  readonly truncated: boolean;
}

export function parseGitWorktreeDescriptor(
  value: unknown,
  path = "worktree",
): GitWorktreeDescriptor {
  const descriptor = record(value, path);
  exactKeys(
    descriptor,
    ["worktreePath", "branch", "head", "isPrimary", "locked", "prunable"],
    path,
  );
  return {
    worktreePath: worktreePath(descriptor.worktreePath, `${path}.worktreePath`),
    branch: nullableBranch(descriptor.branch, `${path}.branch`),
    head: nullableHead(descriptor.head, `${path}.head`),
    isPrimary: boolean(descriptor.isPrimary, `${path}.isPrimary`),
    locked: boolean(descriptor.locked, `${path}.locked`),
    prunable: boolean(descriptor.prunable, `${path}.prunable`),
  };
}

export function parseGitWorktreeDescriptors(value: unknown): ParsedGitWorktreeDescriptors {
  if (!Array.isArray(value)) {
    invalid("worktrees", "an array");
  }
  const truncated = value.length > MAX_WORKTREES_PER_REPOSITORY;
  const parsed = value
    .slice(0, MAX_WORKTREES_PER_REPOSITORY)
    .map((descriptor, index) => parseGitWorktreeDescriptor(descriptor, `worktrees[${index}]`));
  return {
    worktrees: parsed,
    truncated,
  };
}

export function parseAgentWorktreeReceipt(value: unknown): AgentWorktreeReceipt {
  const receipt = record(value, "receipt");
  exactKeys(receipt, ["worktreePath", "branch", "trusted"], "receipt");
  return {
    worktreePath: worktreePath(receipt.worktreePath, "receipt.worktreePath"),
    branch: branch(receipt.branch, "receipt.branch"),
    trusted: boolean(receipt.trusted, "receipt.trusted"),
  };
}

export function parsePrunedGitWorktreePaths(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) {
    invalid("prunedWorktreePaths", "an array");
  }
  if (value.length > MAX_WORKTREES_PER_REPOSITORY) {
    invalid("prunedWorktreePaths", `an array of at most ${MAX_WORKTREES_PER_REPOSITORY} paths`);
  }
  return value.map((path, index) => worktreePath(path, `prunedWorktreePaths[${index}]`));
}

export function validateGitWorktreeRepositoryRoot(value: unknown): string {
  return boundedPath(value, "repositoryRoot");
}

export function validateGitWorktreePath(value: unknown): string {
  return boundedPath(value, "worktreePath");
}

export function validateAgentWorktreeTaskId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9-]{2,63}$/.test(value) ||
    value.includes("--")
  ) {
    invalid("taskId", "a safe agent task id");
  }
  if (new TextEncoder().encode(value).length > 64) {
    invalid("taskId", "a safe agent task id of at most 64 UTF-8 bytes");
  }
  return value;
}

function worktreePath(value: unknown, path: string): string {
  return boundedPath(value, path);
}

function boundedPath(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.includes("\0") ||
    new TextEncoder().encode(value).length > MAX_WORKTREE_PATH_BYTES
  ) {
    invalid(path, `a non-blank path of at most ${MAX_WORKTREE_PATH_BYTES} UTF-8 bytes`);
  }
  return value;
}

function nullableBranch(value: unknown, path: string): string | null {
  if (value === null) {
    return null;
  }
  return branch(value, path);
}

function branch(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    new TextEncoder().encode(value).length > MAX_WORKTREE_BRANCH_BYTES
  ) {
    invalid(path, `a non-empty branch of at most ${MAX_WORKTREE_BRANCH_BYTES} UTF-8 bytes`);
  }
  return value;
}

function nullableHead(value: unknown, path: string): string | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    new TextEncoder().encode(value).length > MAX_WORKTREE_BRANCH_BYTES
  ) {
    invalid(path, "a non-empty bounded head string or null");
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    invalid(path, "a boolean");
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    invalid(path, `exactly the fields ${expected.join(", ")}`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid Git worktree value at ${path}: expected ${expectation}.`);
}
