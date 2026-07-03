/**
 * Git directory mappings, PhpStorm-style. A workspace can hold a main
 * repository at its root plus nested package repositories (the LetsConsult
 * `attendancer` layout: a root `.git` plus ~15 repos under `workbench/lcsk/*`
 * that Composer `path` repositories symlink into `vendor/lcsk/*`). Every git
 * operation is routed, per file, into the repository that actually owns the
 * file so commits/pushes land in the right place.
 *
 * This module is the pure domain core: no filesystem access, no realpath. The
 * integration layer supplies scan results and already-canonical (realpath'd)
 * paths.
 */

import {
  emptyGitStatus,
  type GitChangedFile,
  type GitStatus,
} from "./git";

/** A single git repository directory within a workspace. */
export interface GitRepositoryMapping {
  /**
   * The repository directory relative to the workspace root, using forward
   * slashes and no leading/trailing slash. The empty string `""` denotes the
   * workspace root itself (the main repository).
   */
  rootRelativePath: string;
}

/** The repository that owns a given file, plus the file's in-repo path. */
export interface ResolvedGitRepository {
  /** The winning mapping (deepest match). */
  mapping: GitRepositoryMapping;
  /**
   * Absolute path to the repository root, normalized to forward slashes with no
   * trailing slash.
   */
  repositoryRoot: string;
  /**
   * The file path relative to {@link repositoryRoot}, forward slashes, no
   * leading slash. `""` when the file is the repository directory itself.
   */
  repositoryRelativePath: string;
}

/**
 * Normalizes raw, persisted or scanned git directory mappings into a clean,
 * deduplicated, deterministically sorted list.
 *
 * Accepts a list of relative-path strings or `{ rootRelativePath }` objects.
 * Each entry is normalized to forward slashes with `./`, empty segments and
 * surrounding whitespace stripped. For safety a mapping must stay inside the
 * workspace: absolute paths (`/abs`, `C:\...`) and parent-directory escapes
 * (any `..` segment) are rejected. The empty string `""` (workspace root, the
 * main repository) is allowed.
 *
 * Duplicates are deduped case-insensitively (`Workbench/x` and `workbench/x`
 * are the same directory on a case-insensitive-preserving filesystem such as
 * macOS APFS or Windows), keeping the casing of the first occurrence.
 *
 * Sorted shallow-first (by segment depth) then lexicographically so the output
 * is stable and the root mapping, when present, sorts first.
 */
export function normalizeGitDirectoryMappings(
  raw: unknown,
): GitRepositoryMapping[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const rootRelativePaths: string[] = [];

  for (const entry of raw) {
    const candidate = rawMappingRootRelativePath(entry);

    if (candidate === null) {
      continue;
    }

    const normalized = normalizeRelativeDirectory(candidate);

    if (normalized === null) {
      continue;
    }

    const dedupeKey = normalized.toLowerCase();

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    rootRelativePaths.push(normalized);
  }

  rootRelativePaths.sort(compareRootRelativePaths);

  return rootRelativePaths.map((rootRelativePath) => ({ rootRelativePath }));
}

/** Extracts the relative-path strings, e.g. for JSON persistence or display. */
export function gitDirectoryMappingPaths(
  mappings: GitRepositoryMapping[],
): string[] {
  return mappings.map((mapping) => mapping.rootRelativePath);
}

/**
 * Builds suggested mappings from an auto-detection scan: the relative paths of
 * directories that contain a `.git` entry (relative to the workspace root). An
 * entry may point at the directory itself (`workbench/lcsk/x`) or at its `.git`
 * (`workbench/lcsk/x/.git`); a trailing `.git` segment is stripped either way.
 * The output is normalized and sorted like {@link normalizeGitDirectoryMappings}.
 */
export function gitMappingCandidatesFromDirectoryListing(
  gitDirectoryRelativePaths: string[],
): GitRepositoryMapping[] {
  return normalizeGitDirectoryMappings(
    gitDirectoryRelativePaths.map(stripTrailingGitSegment),
  );
}

/**
 * Resolves which repository owns `absoluteFilePath`, deepest match wins: a file
 * under `workbench/lcsk/attendance/src` belongs to the `attendance` repo, not
 * the main repo. Returns `null` when the file lives outside the workspace,
 * inside it but under no mapping (and no `""` root mapping exists), when a
 * `..` in the file path climbs above the workspace root (see
 * {@link collapseRelativeSegments}), or when case-sensitive and
 * case-insensitive matching disagree on the owning mapping (see
 * {@link deepestMatchingMapping}) - commit routing stands on this resolver,
 * so every ambiguous case fails safe to `null` rather than guessing.
 *
 * SYMLINK CONTRACT: the pure layer cannot realpath. Composer `path` repos with
 * `symlink: true` expose `vendor/lcsk/x` as a symlink to `workbench/lcsk/x`; a
 * file opened via the `vendor/...` path must be resolved to its canonical
 * `workbench/...` path by the integration BEFORE calling this resolver, so it
 * is attributed to the workbench repository rather than the main repo. Both
 * `workspaceRoot` and the mappings must likewise be expressed as canonical
 * (realpath'd) paths.
 *
 * Inputs may use `\\` or `/` separators, trailing slashes, doubled `/`
 * separators and `.`/`..` segments; the returned paths are normalized to
 * forward slashes with no trailing slash.
 */
export function resolveGitRepositoryForPath(
  mappings: GitRepositoryMapping[],
  workspaceRoot: string,
  absoluteFilePath: string,
): ResolvedGitRepository | null {
  const normalizedRoot = normalizeAbsolutePath(workspaceRoot);
  const normalizedFile = normalizeAbsolutePath(absoluteFilePath);
  const rawWorkspaceRelativePath = relativeWithin(normalizedRoot, normalizedFile);

  if (rawWorkspaceRelativePath === null) {
    return null;
  }

  // Collapse BEFORE matching so the deepest-match search always runs against
  // a canonical path: a raw `//` or `..` can otherwise make a file look like
  // it belongs to the wrong repository (or the right repository with a
  // malformed, escaping relative path) instead of its actual owner.
  const workspaceRelativePath = collapseRelativeSegments(
    rawWorkspaceRelativePath,
  );

  if (workspaceRelativePath === null) {
    return null;
  }

  const best = deepestMatchingMapping(mappings, workspaceRelativePath);

  if (!best) {
    return null;
  }

  const rootRelativePath = best.mapping.rootRelativePath;
  const repositoryRoot =
    rootRelativePath === ""
      ? normalizedRoot
      : `${normalizedRoot}/${rootRelativePath}`;
  const repositoryRelativePath = stripDirectoryPrefix(
    workspaceRelativePath,
    rootRelativePath,
  );

  // Defense-in-depth: both inputs above are already canonical, so this
  // should always hold. Guards against a future refactor reintroducing a
  // `..`, `.`, empty segment or leading slash into a value callers feed
  // straight into git commands.
  if (!isCanonicalRelativePath(repositoryRelativePath)) {
    return null;
  }

  return {
    mapping: best.mapping,
    repositoryRoot,
    repositoryRelativePath,
  };
}

/**
 * The primary repository: the workspace root itself. Every effective mapping
 * list includes it so a single `gitStatus` view (the pre-multi-repo surface)
 * always has a repository to reflect, even in a workspace whose root is not a
 * git repository (the status then reports `isRepository: false`, exactly as
 * before multi-repo support).
 */
export const WORKSPACE_ROOT_MAPPING: GitRepositoryMapping = {
  rootRelativePath: "",
};

/** One repository's status within a multi-repo workspace (whole-map view). */
export interface GitRepositoryStatus {
  /** The owning mapping. */
  mapping: GitRepositoryMapping;
  /** Absolute repository root, forward slashes, no trailing slash. */
  root: string;
  /** The repository's git status (empty when {@link failed}). */
  status: GitStatus;
  /** True when this repository's status could not be read (isolated failure). */
  failed: boolean;
}

/** A batch of changes routed to the single repository that owns them. */
export interface GitRepositoryChangeGroup {
  mapping: GitRepositoryMapping;
  /** Absolute repository root, forward slashes, no trailing slash. */
  repositoryRoot: string;
  /** The owning repository's changes, in the caller's original order. */
  changes: GitChangedFile[];
}

/**
 * Absolute repository root for a mapping given the (canonical) workspace root:
 * the workspace root itself for the empty (primary) mapping, else the mapping
 * joined onto it. Separators are normalized to forward slashes.
 */
export function repositoryRootForMapping(
  mapping: GitRepositoryMapping,
  workspaceRoot: string,
): string {
  const normalizedRoot = normalizeAbsolutePath(workspaceRoot);
  const relative = normalizeRelativeDirectory(mapping.rootRelativePath);

  if (relative === null || relative === "") {
    return normalizedRoot;
  }

  return `${normalizedRoot}/${relative}`;
}

/**
 * The effective repository mappings for a freshly opened workspace: the manual
 * mappings persisted in the workspace settings, unioned with the auto-detected
 * repositories when auto-detection is enabled, and always including the
 * workspace root (primary). Detected directories are `.git`-suffix tolerant.
 *
 * The workspace root is always present so the single-repo/no-repo behaviour is
 * preserved: with no manual mappings and nothing (or `null`) detected the
 * result is exactly `[""]`, the pre-multi-repo default.
 */
export function resolveEffectiveGitRepositoryMappings(options: {
  manualMappings: unknown;
  detectedDirectories?: readonly string[] | null;
  auto: boolean;
}): GitRepositoryMapping[] {
  const manual = Array.isArray(options.manualMappings)
    ? options.manualMappings
    : [];
  const detected =
    options.auto && options.detectedDirectories
      ? gitDirectoryMappingPaths(
          gitMappingCandidatesFromDirectoryListing([
            ...options.detectedDirectories,
          ]),
        )
      : [];

  return normalizeGitDirectoryMappings(["", ...manual, ...detected]);
}

/**
 * Fans out `getStatus` across every mapping, one call per repository root, and
 * collects a status per repository. Each repository is isolated: a rejection
 * from one becomes a `failed` entry with an empty status and never prevents the
 * others from resolving. Never rejects.
 *
 * The caller owns per-workspace isolation: capture the requested workspace root
 * before calling and re-check the active root after the returned promise
 * resolves before publishing the statuses.
 */
export async function fanOutGitRepositoryStatuses(
  mappings: GitRepositoryMapping[],
  workspaceRoot: string,
  getStatus: (repositoryRoot: string) => Promise<GitStatus>,
): Promise<GitRepositoryStatus[]> {
  return Promise.all(
    mappings.map(async (mapping): Promise<GitRepositoryStatus> => {
      const root = repositoryRootForMapping(mapping, workspaceRoot);

      try {
        const status = await getStatus(root);
        return { mapping, root, status, failed: false };
      } catch {
        return { mapping, root, status: emptyGitStatus(root), failed: true };
      }
    }),
  );
}

/**
 * The primary (workspace-root) repository's status, for the single `gitStatus`
 * surface that predates multi-repo support. Falls back to an empty status for
 * the workspace root when, defensively, no primary entry is present.
 */
export function primaryGitStatus(
  statuses: GitRepositoryStatus[],
  workspaceRoot: string,
): GitStatus {
  const normalizedRoot = normalizeAbsolutePath(workspaceRoot);
  const primary = statuses.find(
    (entry) => normalizeAbsolutePath(entry.root) === normalizedRoot,
  );

  if (!primary) {
    return emptyGitStatus(normalizedRoot);
  }

  return primary.status;
}

/** Every change across every repository, flattened in mapping order. */
export function aggregateGitChanges(
  statuses: GitRepositoryStatus[],
): GitChangedFile[] {
  return statuses.flatMap((entry) => entry.status.changes);
}

/**
 * Routes each change into the repository that owns it (deepest match, via
 * {@link resolveGitRepositoryForPath}) and groups them by repository root,
 * preserving the caller's order both within and across groups. Changes that
 * resolve to no repository are collected separately as `unresolved` so callers
 * can skip them and report the fail-safe rather than committing a file into the
 * wrong repository.
 *
 * Each routed change's `relativePath` is rebased to the owning repository's
 * relative path (`repositoryRelativePath`). Callers usually pass already
 * repo-relative paths (a per-repo git status), in which case this is a no-op and
 * the original object is preserved; the rebase is a fail-safe so a workspace-
 * root-relative path handed in for a nested repo is never fed to git against the
 * wrong root. The absolute `path` is left untouched.
 */
export function groupGitChangesByRepository(
  mappings: GitRepositoryMapping[],
  workspaceRoot: string,
  changes: GitChangedFile[],
): { groups: GitRepositoryChangeGroup[]; unresolved: GitChangedFile[] } {
  const groupsByRoot = new Map<string, GitRepositoryChangeGroup>();
  const order: string[] = [];
  const unresolved: GitChangedFile[] = [];

  for (const change of changes) {
    const resolved = resolveGitRepositoryForPath(
      mappings,
      workspaceRoot,
      change.path,
    );

    if (!resolved) {
      unresolved.push(change);
      continue;
    }

    const routedChange =
      resolved.repositoryRelativePath === change.relativePath
        ? change
        : { ...change, relativePath: resolved.repositoryRelativePath };

    const existing = groupsByRoot.get(resolved.repositoryRoot);

    if (existing) {
      existing.changes.push(routedChange);
      continue;
    }

    groupsByRoot.set(resolved.repositoryRoot, {
      mapping: resolved.mapping,
      repositoryRoot: resolved.repositoryRoot,
      changes: [routedChange],
    });
    order.push(resolved.repositoryRoot);
  }

  return {
    groups: order.map((root) => groupsByRoot.get(root)!),
    unresolved,
  };
}

/**
 * Merges freshly produced per-repository statuses (from a git operation) into
 * the current whole-map view: touched repositories are replaced by root, the
 * others are preserved in place, and any brand-new repository is appended.
 */
export function mergeGitRepositoryStatuses(
  current: GitRepositoryStatus[],
  updates: GitRepositoryStatus[],
): GitRepositoryStatus[] {
  const updateByRoot = new Map(
    updates.map((entry) => [normalizeAbsolutePath(entry.root), entry]),
  );
  const merged = current.map((entry) => {
    const update = updateByRoot.get(normalizeAbsolutePath(entry.root));

    if (!update) {
      return entry;
    }

    updateByRoot.delete(normalizeAbsolutePath(entry.root));
    return update;
  });

  for (const entry of updates) {
    if (updateByRoot.has(normalizeAbsolutePath(entry.root))) {
      merged.push(entry);
      updateByRoot.delete(normalizeAbsolutePath(entry.root));
    }
  }

  return merged;
}

function rawMappingRootRelativePath(entry: unknown): string | null {
  if (typeof entry === "string") {
    return entry;
  }

  if (isRecord(entry) && typeof entry.rootRelativePath === "string") {
    return entry.rootRelativePath;
  }

  return null;
}

/**
 * Normalizes a workspace-relative directory to forward slashes with no `./`,
 * empty or trailing segments. Returns `null` for anything that escapes the
 * workspace (absolute paths, `..` segments) so callers can reject it.
 */
function normalizeRelativeDirectory(value: string): string | null {
  const forwardSlashes = value.split("\\").join("/").trim();

  if (isAbsolutePath(forwardSlashes)) {
    return null;
  }

  const segments: string[] = [];

  for (const segment of forwardSlashes.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }

    if (segment === "..") {
      return null;
    }

    segments.push(segment);
  }

  return segments.join("/");
}

function stripTrailingGitSegment(value: string): string {
  const forwardSlashes = value.split("\\").join("/").replace(/\/+$/, "");

  if (forwardSlashes === ".git") {
    return "";
  }

  if (forwardSlashes.endsWith("/.git")) {
    return forwardSlashes.slice(0, -"/.git".length);
  }

  return forwardSlashes;
}

function normalizeAbsolutePath(path: string): string {
  return path.split("\\").join("/").replace(/\/+$/, "");
}

/**
 * Collapses `.`, `..` and empty segments (from a doubled `//`, a leading `/`
 * left over from {@link relativeWithin}, or a literal `.`/`..` in the input)
 * in a workspace-relative path into canonical form.
 *
 * Returns `null` when a `..` climbs above the workspace root: fail-safe,
 * because {@link resolveGitRepositoryForPath} must treat that the same as
 * "outside the workspace" rather than resolve it into some other, unintended
 * repository with an escaping relative path.
 */
function collapseRelativeSegments(path: string): string | null {
  const segments: string[] = [];

  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }

      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return segments.join("/");
}

/**
 * Defense-in-depth check for a value about to be used as a
 * `repositoryRelativePath`: no `..`/`.`/empty segments, no leading slash.
 */
function isCanonicalRelativePath(path: string): boolean {
  if (path === "") {
    return true;
  }

  if (path.startsWith("/")) {
    return false;
  }

  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * Finds the deepest mapping owning `workspaceRelativePath`.
 *
 * FAIL-SAFE, NOT CASE-FOLDING: on a case-insensitive-preserving filesystem
 * (macOS APFS default, Windows), a file can be *opened* through a path whose
 * case differs from the mapping's recorded case (e.g. a mapping saved as
 * `workbench/lcsk/attendance` while the file is opened through
 * `.../Attendance/...`) and still refer to the exact same on-disk directory.
 * Matching case-sensitively alone would then silently fall through to a
 * shallower mapping - typically the `""` root - committing the file into the
 * wrong repository without any signal that routing went wrong.
 *
 * This resolver still matches case-sensitively (case-folding every match
 * would risk the opposite failure: an unrelated, differently-cased sibling
 * directory being folded into the wrong repository). It additionally computes
 * the deepest case-INsensitive match purely as a corruption detector: if the
 * case-sensitive and case-insensitive winners disagree, the case-sensitive
 * result is untrustworthy, so this returns `null` instead of it. Routing a
 * file into the wrong repository is worse than not routing it at all - the
 * integration layer must then fall back to the workspace root deliberately,
 * not because this resolver silently mis-attributed the file.
 */
function deepestMatchingMapping(
  mappings: GitRepositoryMapping[],
  workspaceRelativePath: string,
): { mapping: GitRepositoryMapping; depth: number } | null {
  const caseSensitiveBest = bestMatchingMapping(
    mappings,
    workspaceRelativePath,
    false,
  );
  const caseInsensitiveBest = bestMatchingMapping(
    mappings,
    workspaceRelativePath,
    true,
  );

  if (
    matchedRootRelativePath(caseSensitiveBest) !==
    matchedRootRelativePath(caseInsensitiveBest)
  ) {
    return null;
  }

  return caseSensitiveBest;
}

function matchedRootRelativePath(
  match: { mapping: GitRepositoryMapping; depth: number } | null,
): string | null {
  return match ? match.mapping.rootRelativePath : null;
}

function bestMatchingMapping(
  mappings: GitRepositoryMapping[],
  workspaceRelativePath: string,
  foldCase: boolean,
): { mapping: GitRepositoryMapping; depth: number } | null {
  const target = foldCase
    ? workspaceRelativePath.toLowerCase()
    : workspaceRelativePath;
  let best: { mapping: GitRepositoryMapping; depth: number } | null = null;

  for (const mapping of mappings) {
    const normalized = normalizeRelativeDirectory(mapping.rootRelativePath);

    if (normalized === null) {
      continue;
    }

    const candidate = foldCase ? normalized.toLowerCase() : normalized;

    if (!directoryContains(candidate, target)) {
      continue;
    }

    const depth = directoryDepth(normalized);

    if (best && best.depth >= depth) {
      continue;
    }

    best = { mapping: { rootRelativePath: normalized }, depth };
  }

  return best;
}

function isAbsolutePath(forwardSlashes: string): boolean {
  return forwardSlashes.startsWith("/") || /^[A-Za-z]:\//.test(forwardSlashes);
}

/**
 * The path of `file` relative to `root`, forward slashes, or `null` when `file`
 * is not within `root`. `""` when `file` equals `root`.
 */
function relativeWithin(root: string, file: string): string | null {
  if (file === root) {
    return "";
  }

  if (!file.startsWith(`${root}/`)) {
    return null;
  }

  return file.slice(root.length + 1);
}

/** True when `directory` is (or contains, on a segment boundary) `filePath`. */
function directoryContains(directory: string, filePath: string): boolean {
  if (directory === "") {
    return true;
  }

  return filePath === directory || filePath.startsWith(`${directory}/`);
}

function stripDirectoryPrefix(filePath: string, directory: string): string {
  if (directory === "") {
    return filePath;
  }

  if (filePath === directory) {
    return "";
  }

  return filePath.slice(directory.length + 1);
}

function directoryDepth(directory: string): number {
  if (directory === "") {
    return 0;
  }

  return directory.split("/").length;
}

function compareRootRelativePaths(left: string, right: string): number {
  const depthDelta = directoryDepth(left) - directoryDepth(right);

  if (depthDelta !== 0) {
    return depthDelta;
  }

  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
