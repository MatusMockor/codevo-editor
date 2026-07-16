import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from "react";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import {
  gitChangeKeyForRepository,
  type GitChangedFile,
  type GitDiffHunk,
  type GitGateway,
  type GitStatus,
} from "../domain/git";
import {
  groupGitChangesByRepository,
  resolveGitRepositoryForPath,
  WORKSPACE_ROOT_MAPPING,
  type GitRepositoryChangeGroup,
  type GitRepositoryMapping,
  type GitRepositoryStatus,
  type ResolvedGitRepository,
} from "../domain/gitRepositoryMapping";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  GitOperationCurrency,
  GitRepositoryOperationReservation,
} from "./useGitOperationCurrency";

const DEFAULT_GIT_REPOSITORY_MAPPINGS: GitRepositoryMapping[] = [
  WORKSPACE_ROOT_MAPPING,
];

const FETCH_REQUEST_EVENT = "editor:git-fetch-request";
const PULL_REQUEST_EVENT = "editor:git-pull-request";

interface RemoteGitGateway extends GitGateway {
  fetch(rootPath: string): Promise<GitStatus>;
  pull(rootPath: string): Promise<GitStatus>;
}

interface GitRemoteRequestDetail {
  rootPath: string;
}

export function requestGitFetch(rootPath: string): void {
  window.dispatchEvent(
    new CustomEvent<GitRemoteRequestDetail>(FETCH_REQUEST_EVENT, {
      detail: { rootPath },
    }),
  );
}

export function requestGitPull(rootPath: string): void {
  window.dispatchEvent(
    new CustomEvent<GitRemoteRequestDetail>(PULL_REQUEST_EVENT, {
      detail: { rootPath },
    }),
  );
}

/** A human-readable label for a repository in status-bar messages. */
function repositoryLabel(mapping: GitRepositoryMapping): string {
  return mapping.rootRelativePath || "workspace root";
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Routes a hunk operation to the repository that actually owns the changed file,
 * resolved from the file's ABSOLUTE path (`change.path`), which is unique across
 * every repository in the workspace. Returns `null` when the file resolves to no
 * repository so the caller fails safe: the operation is skipped rather than
 * routed into the wrong repo. A nested repository reports its changes with
 * repo-root-relative paths (`src/foo.php`), so the pre-fix approach of joining
 * that path onto the workspace root silently mis-attributed a nested file's
 * hunks to the primary (workspace-root) repository - resolving from the absolute
 * path instead lands every hunk in its owning repository.
 */
function resolveHunkRepository(
  mappings: GitRepositoryMapping[],
  workspaceRoot: string,
  change: GitChangedFile,
): ResolvedGitRepository | null {
  return resolveGitRepositoryForPath(mappings, workspaceRoot, change.path);
}

/**
 * The status-bar message for the fail-safe when the resolver could not
 * attribute one or more changes to any repository (they are skipped, never
 * routed into the wrong repo). `null` for the common case of nothing skipped,
 * which also clears any prior message on a clean operation.
 */
function skippedChangesMessage(unresolved: GitChangedFile[]): string | null {
  if (unresolved.length === 0) {
    return null;
  }

  return `Skipped ${unresolved.length} file(s) with no matching Git repository`;
}

/** A per-repository operation failure, for aggregated reporting. */
interface RepositoryFailure {
  mapping: GitRepositoryMapping;
  error: unknown;
}

/**
 * Sentinel returned by {@link commitOneRepository} when the active workspace
 * changed mid-operation, so the caller aborts without publishing stale state.
 */
const STALE = Symbol("stale");

type CommitOneResult =
  | { failed: false; status: GitStatus }
  | { failed: true; error: unknown };

/**
 * Stages any unstaged changes in the group, then commits them, all within the
 * group's owning repository. Isolates its own failure so one repository's
 * commit failure never aborts the others. Re-checks the active workspace root
 * after each await and returns {@link STALE} to abort on a mid-flight switch.
 */
async function commitOneRepository(
  gitGateway: GitGateway,
  group: GitRepositoryChangeGroup,
  message: string,
  requestedRoot: string,
  isActiveRoot: (requestedRoot: string) => boolean,
  isOperationCurrent: () => boolean,
  amend: boolean,
): Promise<CommitOneResult | typeof STALE> {
  try {
    if (group.changes.some((change) => !change.isStaged)) {
      await gitGateway.stageFiles(group.repositoryRoot, group.changes);

      if (!isActiveRoot(requestedRoot) || !isOperationCurrent()) {
        return STALE;
      }
    }

    const operation = amend ? gitGateway.amend : gitGateway.commit;
    if (!operation) {
      throw new Error("Git amend is unavailable.");
    }
    const status = await operation.call(
      gitGateway,
      group.repositoryRoot,
      message,
      group.changes,
    );

    if (!isActiveRoot(requestedRoot)) {
      return STALE;
    }

    return { failed: false, status };
  } catch (error) {
    return { failed: true, error };
  }
}

function pluralRepositories(count: number): string {
  return `${count} ${count === 1 ? "repository" : "repositories"}`;
}

function describeFailures(failures: RepositoryFailure[]): string {
  return failures
    .map(
      (failure) =>
        `${repositoryLabel(failure.mapping)}: ${errorText(failure.error)}`,
    )
    .join("; ");
}

/**
 * Reports the commit outcome. Single-repo keeps the exact pre-multi-repo copy
 * (`null` / "Commit created. Pushing..." on success, `reportError("Git")` on
 * failure); multi-repo aggregates ("Committed to N repositories", per-repo
 * failure list).
 */
function announceCommitOutcome(options: {
  setMessage: (message: string | null) => void;
  reportError: (source: string, error: unknown) => void;
  singleRepo: boolean;
  committed: GitRepositoryStatus[];
  commitFailures: RepositoryFailure[];
  pushAfterCommit: boolean;
}): void {
  const {
    setMessage,
    reportError,
    singleRepo,
    committed,
    commitFailures,
    pushAfterCommit,
  } = options;

  if (committed.length > 0 && singleRepo) {
    setMessage(pushAfterCommit ? "Commit created. Pushing..." : null);
  }

  if (committed.length > 0 && !singleRepo) {
    const suffix = pushAfterCommit ? ". Pushing..." : "";
    setMessage(`Committed to ${pluralRepositories(committed.length)}${suffix}`);
  }

  if (commitFailures.length === 0) {
    return;
  }

  if (singleRepo) {
    reportError("Git", commitFailures[0].error);
    return;
  }

  setMessage(`Commit failed for ${describeFailures(commitFailures)}`);
}

/**
 * Reports the push outcome. Single-repo keeps the exact pre-multi-repo copy
 * ("Pushed current branch" / `reportError("Git Push")`); multi-repo aggregates
 * ("Pushed N repositories", "Push failed for <repo>: ...").
 */
function announcePushOutcome(options: {
  setMessage: (message: string | null) => void;
  reportError: (source: string, error: unknown) => void;
  singleRepo: boolean;
  pushed: GitRepositoryStatus[];
  pushFailures: RepositoryFailure[];
}): void {
  const { setMessage, reportError, singleRepo, pushed, pushFailures } = options;

  if (singleRepo && pushFailures.length > 0) {
    reportError("Git Push", pushFailures[0].error);
    return;
  }

  if (singleRepo) {
    if (pushed.length > 0) {
      setMessage("Pushed current branch");
    }

    return;
  }

  if (pushFailures.length === 0) {
    setMessage(`Pushed ${pluralRepositories(pushed.length)}`);
    return;
  }

  setMessage(`Push failed for ${describeFailures(pushFailures)}`);
}

/**
 * Git staging / commit / hunk operations for the active workspace's Changes
 * panel. This hook owns the commit-panel-local state (the commit message, the
 * set of included change keys, and the operation-in-flight flag) and the
 * staging/unstaging/hunk/revert/commit/push handlers plus the two reconciling
 * effects that keep the included set and the commit panel consistent as the
 * status and the active workspace change. Every handler captures the requested
 * root up front and re-checks the active root after each await so a switched-away
 * tab's late resolve can never mutate another tab's panel (per-tab isolation).
 *
 * The git STATUS/DIFF-PREVIEW surface (refreshGitStatus, previewGitChange,
 * closeGitDiffPreview, the editor gutter baselines, and the shared gitStatus /
 * selectedGitChange / gitDiffPreview state) stays in the workbench shell: it
 * drives the editor tab lifecycle (documents/openPaths/previewPath/activePath)
 * and is consumed by non-git editor flows, so it is not cleanly git-owned.
 * `applyGitOperationStatus` is the seam the shell exposes so a completed git
 * operation can publish its fresh status and close a now-stale diff preview.
 *
 * MULTI-REPO (directory mappings, PhpStorm-style): a workspace can hold a main
 * repository at its root plus nested package repositories. Every change is
 * routed, per file, into the repository that actually owns it (deepest match,
 * via `gitRepositoryMapping.ts`) so stage/unstage/hunk/revert/commit/push land
 * in the right place. `gitStatus` stays the PRIMARY (workspace-root) repo for
 * the pre-multi-repo UI; `gitRepositoryStatuses` is the whole-map view.
 *
 * SINGLE-REPO IDENTITY: with the default `[""]` mapping every change resolves to
 * the workspace root, so grouping yields a single group and the behaviour is
 * byte-for-byte the pre-multi-repo one (one gateway call, one applied status).
 */
export interface GitWorkspaceDependencies {
  gitGateway: GitGateway;
  gitOperationCurrency: GitOperationCurrency;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  workspaceRoot: string | null;
  // Read by runGitCommit (to pick the included changes) and by the reconciling
  // effect (to prune stale included keys). Owned by the shell; the diff-preview
  // surface writes it. Stays the PRIMARY (workspace-root) repo status.
  gitStatus: GitStatus;
  // Publishes a fresh PRIMARY-repo status after an operation and closes a
  // now-stale diff preview. Lives in the shell because it touches the editor
  // tab lifecycle.
  applyGitOperationStatuses: (statuses: GitRepositoryStatus[]) => void;
  reportError: (source: string, error: unknown) => void;
  setMessage: (message: string | null) => void;
  prompter: WorkbenchPrompter;
  // Effective repository mappings (manual + auto-detected, always incl. `""`).
  // Defaults to `[""]` (single-repo / workspace root) when omitted.
  gitRepositoryMappings?: GitRepositoryMapping[];
  // Whole-map status view (every repository's status). The Changes panel now
  // shows the aggregate grouped view (PhpStorm multi-repo), so `committableChanges`
  // (below) derives from every entry here: the user can commit/reconcile across
  // the whole visible set. Keys are repo-qualified (`gitChangeKeyForRepository`),
  // so two repos holding the same relative path never collide. Defaults to the
  // primary-only `gitStatus.changes` when omitted (single-repo / hook tests).
  gitRepositoryStatuses?: GitRepositoryStatus[];
  // Publishes fresh per-repository statuses after a multi-repo operation so the
  // shell can update the whole-map view. Optional: when omitted only the
  gitCommitMessageHistory?: string[];
  recordGitCommitMessage?: (
    workspaceRoot: string,
    message: string,
  ) => void | Promise<void>;
}

export interface GitWorkspace {
  gitAmendEnabled: boolean;
  gitCommitMessage: string;
  gitCommitMessageHistory: string[];
  includedGitChangePaths: Set<string>;
  gitOperationLoading: boolean;
  setGitAmendEnabled: Dispatch<SetStateAction<boolean>>;
  setGitCommitMessage: Dispatch<SetStateAction<string>>;
  toggleGitChangeIncluded: (
    change: GitChangedFile,
    repositoryRootRelative?: string,
  ) => void;
  stageGitChanges: (changes: GitChangedFile[]) => Promise<void>;
  unstageGitChanges: (changes: GitChangedFile[]) => Promise<void>;
  loadGitFileHunks: (
    change: GitChangedFile,
    staged: boolean,
  ) => Promise<GitDiffHunk[]>;
  stageGitHunk: (
    change: GitChangedFile,
    hunkIndex: number,
    expectedIdentity: string,
  ) => Promise<void>;
  unstageGitHunk: (
    change: GitChangedFile,
    hunkIndex: number,
    expectedIdentity: string,
  ) => Promise<void>;
  revertGitChanges: (changes: GitChangedFile[]) => Promise<void>;
  runGitCommit: (options: { pushAfterCommit: boolean }) => Promise<void>;
  amendGitChanges: () => Promise<void>;
  commitGitChanges: () => Promise<void>;
  commitAndPushGitChanges: () => Promise<void>;
  fetchGitChanges: () => Promise<void>;
  pullGitChanges: () => Promise<void>;
}

export function useGitWorkspace(
  dependencies: GitWorkspaceDependencies,
): GitWorkspace {
  const {
    gitGateway,
    gitOperationCurrency,
    currentWorkspaceRootRef,
    workspaceRoot,
    gitStatus,
    applyGitOperationStatuses,
    reportError,
    setMessage,
    prompter,
    gitRepositoryMappings,
    gitRepositoryStatuses,
    gitCommitMessageHistory = [],
    recordGitCommitMessage,
  } = dependencies;

  const mappings = gitRepositoryMappings ?? DEFAULT_GIT_REPOSITORY_MAPPINGS;

  // The changes the commit panel can select, commit and auto-include, each
  // carrying the workspace-root-relative directory of its owning repository so
  // its inclusion key can be qualified (see `gitChangeKeyForRepository`).
  //
  // The panel shows the aggregate grouped view (every repository the whole-map
  // status surfaces), so this spans every `gitRepositoryStatuses` entry - the
  // primary ("") repo plus each nested one, each change tagged with its owning
  // repository's directory. Two repositories that each hold the same relative
  // path (a primary `README.md` and a nested `workbench/lcsk/x/README.md`) key
  // distinctly, so selecting one never sweeps in the other.
  //
  // Falls back to the primary-only `gitStatus.changes` (empty "" prefix) when no
  // whole-map view is wired (single-repo / hook tests); the primary entry's
  // changes are `gitStatus.changes`, so every primary key stays byte-identical
  // to the pre-multi-repo `gitChangeKey(change)`.
  const committableChanges = useMemo<
    Array<{ repositoryRootRelative: string; change: GitChangedFile }>
  >(() => {
    if (gitRepositoryStatuses && gitRepositoryStatuses.length > 0) {
      return gitRepositoryStatuses.flatMap((entry) =>
        entry.status.changes.map((change) => ({
          repositoryRootRelative: entry.mapping.rootRelativePath,
          change,
        })),
      );
    }

    return gitStatus.changes.map((change) => ({
      repositoryRootRelative: "",
      change,
    }));
  }, [gitRepositoryStatuses, gitStatus.changes]);

  const gitOperationInFlightRef = useRef(false);
  const gitExclusiveOperationGenerationRef = useRef(0);
  const [gitAmendEnabled, setGitAmendEnabled] = useState(false);
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [includedGitChangePaths, setIncludedGitChangePaths] = useState<
    Set<string>
  >(new Set());

  const isActiveRoot = useCallback(
    (requestedRoot: string): boolean =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot),
    [currentWorkspaceRootRef],
  );

  const publishStatuses = useCallback(
    (statuses: GitRepositoryStatus[]) => {
      applyGitOperationStatuses(statuses);
    },
    [applyGitOperationStatuses],
  );

  const isGitMutationCurrent = useCallback(
    (
      reservation: GitRepositoryOperationReservation,
      requestedRoot: string,
      repositoryRoot: string,
    ) => {
      return (
        gitOperationCurrency.isRepositoryCurrent(
          reservation,
          repositoryRoot,
        ) &&
        isActiveRoot(requestedRoot)
      );
    },
    [gitOperationCurrency, isActiveRoot],
  );

  const isGitMutationOwnerCurrent = useCallback(
    (
      reservation: GitRepositoryOperationReservation,
      requestedRoot: string,
      repositoryRoot: string,
    ) =>
      isActiveRoot(requestedRoot) &&
      gitOperationCurrency.isOperationCurrent(reservation, repositoryRoot),
    [gitOperationCurrency, isActiveRoot],
  );

  // Routes a set of changes into their owning repositories and runs `operation`
  // once per repository. Failures are isolated per repo; the first is surfaced.
  // With the default `[""]` mapping this is a single call to the workspace root.
  const runFileOperation = useCallback(
    async (
      changes: GitChangedFile[],
      operation: (
        repositoryRoot: string,
        changes: GitChangedFile[],
      ) => Promise<GitStatus>,
    ) => {
      if (!workspaceRoot || changes.length === 0) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const { groups, unresolved } = groupGitChangesByRepository(
        mappings,
        workspaceRoot,
        changes,
      );

      if (groups.length === 0) {
        setMessage(skippedChangesMessage(unresolved));
        return;
      }

      const reservation = gitOperationCurrency.reserveOperation(
        groups.map((group) => group.repositoryRoot),
      );

      const statuses: GitRepositoryStatus[] = [];
      const failures: Array<{ error: unknown; repositoryRoot: string }> = [];

      try {
        for (const group of groups) {
          if (
            !isGitMutationOwnerCurrent(
              reservation,
              requestedRoot,
              group.repositoryRoot,
            )
          ) {
            continue;
          }

          try {
            const execution = await gitOperationCurrency.runRepositoryMutation(
              reservation,
              group.repositoryRoot,
              () => operation(group.repositoryRoot, group.changes),
            );

            if (!execution.executed) {
              continue;
            }

            if (
              !isGitMutationCurrent(
                reservation,
                requestedRoot,
                group.repositoryRoot,
              )
            ) {
              continue;
            }

            statuses.push({
              mapping: group.mapping,
              root: group.repositoryRoot,
              status: execution.value,
              failed: false,
            });
          } catch (error) {
            if (
              isGitMutationCurrent(
                reservation,
                requestedRoot,
                group.repositoryRoot,
              )
            ) {
              failures.push({ error, repositoryRoot: group.repositoryRoot });
            }
          }
        }

        const currentStatuses = statuses.filter((entry) =>
          isGitMutationCurrent(reservation, requestedRoot, entry.root),
        );
        const currentFailure = failures.find((entry) =>
          isGitMutationCurrent(
            reservation,
            requestedRoot,
            entry.repositoryRoot,
          ),
        );

        if (currentStatuses.length > 0) {
          publishStatuses(currentStatuses);
        }

        if (currentFailure) {
          reportError("Git", currentFailure.error);
          return;
        }

        if (
          !groups.some((group) =>
            isGitMutationCurrent(
              reservation,
              requestedRoot,
              group.repositoryRoot,
            ),
          ) ||
          !isActiveRoot(requestedRoot)
        ) {
          return;
        }

        setMessage(skippedChangesMessage(unresolved));
      } finally {
        gitOperationCurrency.releaseOperation(reservation);
      }
    },
    [
      isGitMutationCurrent,
      isGitMutationOwnerCurrent,
      isActiveRoot,
      mappings,
      publishStatuses,
      gitOperationCurrency,
      reportError,
      setMessage,
      workspaceRoot,
    ],
  );

  const toggleGitChangeIncluded = useCallback(
    (change: GitChangedFile, repositoryRootRelative = "") => {
      setIncludedGitChangePaths((current) => {
        const next = new Set(current);

        // Qualified with the owning repository's directory so the aggregate
        // grouped panel keys each repo's changes distinctly. The primary ("")
        // repo yields the same key as `gitChangeKey(change)`, so single-repo
        // toggling stays byte-identical to the pre-multi-repo behaviour.
        const changeKey = gitChangeKeyForRepository(
          repositoryRootRelative,
          change,
        );

        if (next.has(changeKey)) {
          next.delete(changeKey);
        } else {
          next.add(changeKey);
        }

        return next;
      });
    },
    [],
  );

  const stageGitChanges = useCallback(
    async (changes: GitChangedFile[]) =>
      runFileOperation(changes, (root, groupChanges) =>
        gitGateway.stageFiles(root, groupChanges),
      ),
    [gitGateway, runFileOperation],
  );

  const unstageGitChanges = useCallback(
    async (changes: GitChangedFile[]) =>
      runFileOperation(changes, (root, groupChanges) =>
        gitGateway.unstageFiles(root, groupChanges),
      ),
    [gitGateway, runFileOperation],
  );

  const loadGitFileHunks = useCallback(
    async (
      change: GitChangedFile,
      staged: boolean,
    ): Promise<GitDiffHunk[]> => {
      if (!workspaceRoot) {
        return [];
      }

      const requestedRoot = workspaceRoot;
      const resolved = resolveHunkRepository(mappings, workspaceRoot, change);

      // Fail-safe: a file that resolves to no repository is never read against
      // the workspace root (a nested repo's diff must not query the primary
      // repo). No hunks means the diff preview still renders, just without the
      // per-hunk overlay.
      if (!resolved) {
        return [];
      }

      const readReservation = gitOperationCurrency.reserveRead(
        resolved.repositoryRoot,
        resolved.repositoryRelativePath,
        staged,
      );

      try {
        const hunks = await gitGateway.getFileHunks(
          resolved.repositoryRoot,
          resolved.repositoryRelativePath,
          staged,
        );

        // Drop stale results: the active workspace may have changed while the
        // diff resolved (per-tab isolation).
        if (
          !isActiveRoot(requestedRoot) ||
          !gitOperationCurrency.isReadCurrent(readReservation)
        ) {
          return [];
        }

        return hunks;
      } catch (error) {
        if (
          isActiveRoot(requestedRoot) &&
          gitOperationCurrency.isReadCurrent(readReservation)
        ) {
          reportError("Git", error);
        }

        return [];
      }
    },
    [
      gitGateway,
      gitOperationCurrency,
      isActiveRoot,
      mappings,
      reportError,
      workspaceRoot,
    ],
  );

  const runHunkOperation = useCallback(
    async (
      change: GitChangedFile,
      hunkIndex: number,
      expectedIdentity: string,
      operation: (
        repositoryRoot: string,
        repositoryRelativePath: string,
        hunkIndex: number,
        expectedIdentity: string,
      ) => Promise<GitStatus>,
      messagePrefix: string,
    ) => {
      if (!workspaceRoot) {
        return;
      }

      if (!expectedIdentity) {
        reportError(
          "Git",
          new Error("Expected Git hunk identity is required; refresh the diff and try again."),
        );
        return;
      }

      const requestedRoot = workspaceRoot;
      const resolved = resolveHunkRepository(mappings, workspaceRoot, change);

      // Fail-safe: never stage/unstage a hunk against the wrong repository. A
      // file that resolves to no repository is skipped and reported, not routed
      // to the workspace root. Bails before the loading flag so no spinner
      // flickers for a no-op.
      if (!resolved) {
        setMessage(skippedChangesMessage([change]));
        return;
      }

      const { mapping, repositoryRoot, repositoryRelativePath } = resolved;
      const reservation = gitOperationCurrency.reserveOperation([repositoryRoot]);
      const isCurrentMutation = () =>
        isGitMutationCurrent(reservation, requestedRoot, repositoryRoot);

      try {
        const execution = await gitOperationCurrency.runRepositoryMutation(
          reservation,
          repositoryRoot,
          () =>
            operation(
              repositoryRoot,
              repositoryRelativePath,
              hunkIndex,
              expectedIdentity,
            ),
        );

        if (!execution.executed || !isCurrentMutation()) {
          return;
        }

        publishStatuses([
          {
            mapping,
            root: repositoryRoot,
            status: execution.value,
            failed: false,
          },
        ]);
        setMessage(`${messagePrefix} ${change.relativePath}`);
      } catch (error) {
        // A rejected patch (stale hunk / already staged) fails atomically on
        // the Rust side - the index is untouched, so this is a safe no-op.
        if (isCurrentMutation()) {
          reportError("Git", error);
        }
      } finally {
        gitOperationCurrency.releaseOperation(reservation);
      }
    },
    [
      isGitMutationCurrent,
      mappings,
      publishStatuses,
      gitOperationCurrency,
      reportError,
      setMessage,
      workspaceRoot,
    ],
  );

  const stageGitHunk = useCallback(
    async (change: GitChangedFile, hunkIndex: number, expectedIdentity: string) =>
      runHunkOperation(
        change,
        hunkIndex,
        expectedIdentity,
        (root, repoRelative, index, identity) =>
          gitGateway.stageHunk(root, repoRelative, index, identity),
        "Staged hunk in",
      ),
    [gitGateway, runHunkOperation],
  );

  const unstageGitHunk = useCallback(
    async (change: GitChangedFile, hunkIndex: number, expectedIdentity: string) =>
      runHunkOperation(
        change,
        hunkIndex,
        expectedIdentity,
        (root, repoRelative, index, identity) =>
          gitGateway.unstageHunk(root, repoRelative, index, identity),
        "Unstaged hunk in",
      ),
    [gitGateway, runHunkOperation],
  );

  const revertGitChanges = useCallback(
    async (changes: GitChangedFile[]) => {
      if (!workspaceRoot || changes.length === 0) {
        return;
      }

      if (!prompter.confirm("Revert selected Git changes? This discards local changes.")) {
        return;
      }

      await runFileOperation(changes, (root, groupChanges) =>
        gitGateway.revertFiles(root, groupChanges),
      );
    },
    [gitGateway, prompter, runFileOperation, workspaceRoot],
  );

  const runGitCommit = useCallback(
    async ({
      amend = false,
      pushAfterCommit,
    }: {
      amend?: boolean;
      pushAfterCommit: boolean;
    }) => {
      if (!workspaceRoot || gitOperationInFlightRef.current) {
        return;
      }

      const message = gitCommitMessage.trim();
      const includedChanges = committableChanges
        .filter((item) =>
          includedGitChangePaths.has(
            gitChangeKeyForRepository(item.repositoryRootRelative, item.change),
          ),
        )
        .map((item) => item.change);

      if ((!amend && !message) || includedChanges.length === 0) {
        return;
      }

      const requestedRoot = workspaceRoot;
      // Each file lands in the repository that owns it; a file that resolves to
      // no repository is skipped (never committed into the wrong repo).
      const { groups, unresolved } = groupGitChangesByRepository(
        mappings,
        workspaceRoot,
        includedChanges,
      );

      if (groups.length === 0) {
        setMessage(skippedChangesMessage(unresolved));
        return;
      }

      const singleRepo = groups.length === 1;
      const reservation = gitOperationCurrency.reserveOperation(
        groups.map((group) => group.repositoryRoot),
      );
      const exclusiveOperationGeneration =
        gitExclusiveOperationGenerationRef.current + 1;
      gitExclusiveOperationGenerationRef.current = exclusiveOperationGeneration;
      gitOperationInFlightRef.current = true;

      try {
        const committed: GitRepositoryStatus[] = [];
        const commitFailures: Array<{
          mapping: GitRepositoryMapping;
          error: unknown;
        }> = [];

        for (const group of groups) {
          if (
            !isGitMutationOwnerCurrent(
              reservation,
              requestedRoot,
              group.repositoryRoot,
            )
          ) {
            continue;
          }

          const execution = await gitOperationCurrency.runRepositoryMutation(
            reservation,
            group.repositoryRoot,
            () =>
              commitOneRepository(
                gitGateway,
                group,
                message,
                requestedRoot,
                isActiveRoot,
                () =>
                  gitOperationCurrency.isOperationCurrent(
                    reservation,
                    group.repositoryRoot,
                  ),
                amend,
              ),
          );

          if (!execution.executed) {
            continue;
          }

          const committedStatus = execution.value;

          if (committedStatus === STALE) {
            return;
          }

          if (committedStatus.failed) {
            if (
              isGitMutationCurrent(
                reservation,
                requestedRoot,
                group.repositoryRoot,
              )
            ) {
              commitFailures.push({
                mapping: group.mapping,
                error: committedStatus.error,
              });
            }
            continue;
          }

          if (
            !isGitMutationCurrent(
              reservation,
              requestedRoot,
              group.repositoryRoot,
            )
          ) {
            continue;
          }

          committed.push({
            mapping: group.mapping,
            root: group.repositoryRoot,
            status: committedStatus.status,
            failed: false,
          });
        }

        if (!isActiveRoot(requestedRoot)) {
          return;
        }

        const currentCommitted = committed.filter((entry) =>
          isGitMutationCurrent(reservation, requestedRoot, entry.root),
        );

        if (currentCommitted.length > 0) {
          await recordGitCommitMessage?.(requestedRoot, message);

          if (!isActiveRoot(requestedRoot)) {
            return;
          }

          const publishableCommitted = currentCommitted.filter((entry) =>
            isGitMutationCurrent(reservation, requestedRoot, entry.root),
          );
          if (publishableCommitted.length === 0) {
            return;
          }

          publishStatuses(publishableCommitted);
          setGitAmendEnabled(false);
          setIncludedGitChangePaths(new Set());
          setGitCommitMessage("");
        }

        announceCommitOutcome({
          setMessage,
          reportError,
          singleRepo,
          committed: currentCommitted,
          commitFailures,
          pushAfterCommit,
        });

        if (!pushAfterCommit || currentCommitted.length === 0) {
          return;
        }

        const pushed: GitRepositoryStatus[] = [];
        const pushFailures: Array<{
          mapping: GitRepositoryMapping;
          error: unknown;
        }> = [];

        for (const entry of currentCommitted) {
          if (
            !isGitMutationOwnerCurrent(
              reservation,
              requestedRoot,
              entry.root,
            )
          ) {
            continue;
          }

          try {
            const execution = await gitOperationCurrency.runRepositoryMutation(
              reservation,
              entry.root,
              () => gitGateway.push(entry.root),
            );

            if (!execution.executed) {
              continue;
            }

            if (!isGitMutationCurrent(reservation, requestedRoot, entry.root)) {
              continue;
            }

            pushed.push({ ...entry, status: execution.value });
          } catch (error) {
            if (
              isGitMutationCurrent(reservation, requestedRoot, entry.root)
            ) {
              pushFailures.push({ mapping: entry.mapping, error });
            }
          }
        }

        if (!isActiveRoot(requestedRoot)) {
          return;
        }

        if (pushed.length > 0) {
          publishStatuses(pushed);
        }

        announcePushOutcome({
          setMessage,
          reportError,
          singleRepo,
          pushed,
          pushFailures,
        });
      } finally {
        gitOperationCurrency.releaseOperation(reservation);
        if (
          gitExclusiveOperationGenerationRef.current ===
          exclusiveOperationGeneration
        ) {
          gitOperationInFlightRef.current = false;
        }
      }
    },
    [
      committableChanges,
      gitCommitMessage,
      gitGateway,
      gitOperationCurrency,
      includedGitChangePaths,
      isGitMutationCurrent,
      isGitMutationOwnerCurrent,
      isActiveRoot,
      mappings,
      publishStatuses,
      reportError,
      setMessage,
      workspaceRoot,
      recordGitCommitMessage,
    ],
  );

  const commitGitChanges = useCallback(
    async () => runGitCommit({ pushAfterCommit: false }),
    [runGitCommit],
  );

  const commitAndPushGitChanges = useCallback(
    async () => runGitCommit({ pushAfterCommit: true }),
    [runGitCommit],
  );

  const amendGitChanges = useCallback(
    async () => runGitCommit({ amend: true, pushAfterCommit: false }),
    [runGitCommit],
  );

  const runRemoteOperation = useCallback(
    async (
      operationName: "Fetch" | "Pull",
      operation: (gateway: RemoteGitGateway, root: string) => Promise<GitStatus>,
    ) => {
      if (!workspaceRoot || gitOperationInFlightRef.current) {
        return;
      }

      const requestedRoot = workspaceRoot;
      const remoteGateway = gitGateway as RemoteGitGateway;
      const singleRepo = mappings.length === 1;
      const completed: GitRepositoryStatus[] = [];
      const failures: RepositoryFailure[] = [];
      const repositoryRoots = mappings.map((mapping) =>
        mapping.rootRelativePath
          ? `${workspaceRoot.replace(/[\\/]+$/, "")}/${mapping.rootRelativePath}`
          : workspaceRoot,
      );
      const reservation =
        gitOperationCurrency.reserveOperation(repositoryRoots);
      const exclusiveOperationGeneration =
        gitExclusiveOperationGenerationRef.current + 1;
      gitExclusiveOperationGenerationRef.current = exclusiveOperationGeneration;
      gitOperationInFlightRef.current = true;

      try {
        for (const [index, mapping] of mappings.entries()) {
          const root = repositoryRoots[index];

          if (
            !isGitMutationOwnerCurrent(reservation, requestedRoot, root)
          ) {
            continue;
          }

          try {
            const execution = await gitOperationCurrency.runRepositoryMutation(
              reservation,
              root,
              () => operation(remoteGateway, root),
            );

            if (!execution.executed) {
              continue;
            }

            if (!isGitMutationCurrent(reservation, requestedRoot, root)) {
              continue;
            }

            completed.push({
              mapping,
              root,
              status: execution.value,
              failed: false,
            });
          } catch (error) {
            if (isGitMutationCurrent(reservation, requestedRoot, root)) {
              failures.push({ mapping, error });
            }
          }
        }

        if (!isActiveRoot(requestedRoot)) {
          return;
        }

        const currentCompleted = completed.filter((entry) =>
          isGitMutationCurrent(reservation, requestedRoot, entry.root),
        );
        if (currentCompleted.length > 0) {
          publishStatuses(currentCompleted);
        }

        if (singleRepo && failures.length > 0) {
          reportError("Git", failures[0].error);
          return;
        }

        if (singleRepo) {
          setMessage(operationName === "Fetch" ? "Fetched remote changes" : "Pulled current branch");
          return;
        }

        if (failures.length > 0) {
          setMessage(`${operationName} failed for ${describeFailures(failures)}`);
          return;
        }

        const verb = operationName === "Fetch" ? "Fetched" : "Pulled";
        setMessage(`${verb} ${pluralRepositories(currentCompleted.length)}`);
      } finally {
        gitOperationCurrency.releaseOperation(reservation);
        if (
          gitExclusiveOperationGenerationRef.current ===
          exclusiveOperationGeneration
        ) {
          gitOperationInFlightRef.current = false;
        }
      }
    },
    [
      gitGateway,
      gitOperationCurrency,
      isActiveRoot,
      isGitMutationCurrent,
      isGitMutationOwnerCurrent,
      mappings,
      publishStatuses,
      reportError,
      setMessage,
      workspaceRoot,
    ],
  );

  const fetchGitChanges = useCallback(
    async () =>
      runRemoteOperation("Fetch", (gateway, root) => gateway.fetch(root)),
    [runRemoteOperation],
  );

  const pullGitChanges = useCallback(
    async () =>
      runRemoteOperation("Pull", (gateway, root) => gateway.pull(root)),
    [runRemoteOperation],
  );

  useEffect(() => {
    const handleFetch = (event: Event) => {
      const request = event as CustomEvent<GitRemoteRequestDetail>;
      if (!workspaceRootKeysEqual(request.detail.rootPath, workspaceRoot)) {
        return;
      }

      void fetchGitChanges();
    };
    const handlePull = (event: Event) => {
      const request = event as CustomEvent<GitRemoteRequestDetail>;
      if (!workspaceRootKeysEqual(request.detail.rootPath, workspaceRoot)) {
        return;
      }

      void pullGitChanges();
    };
    window.addEventListener(FETCH_REQUEST_EVENT, handleFetch);
    window.addEventListener(PULL_REQUEST_EVENT, handlePull);

    return () => {
      window.removeEventListener(FETCH_REQUEST_EVENT, handleFetch);
      window.removeEventListener(PULL_REQUEST_EVENT, handlePull);
    };
  }, [fetchGitChanges, pullGitChanges, workspaceRoot]);

  // Reconcile the included set whenever the status changes: keep every staged
  // change auto-included and drop keys whose change no longer exists. Bails out
  // (returns the same Set) when nothing changed so it never triggers a needless
  // re-render.
  useEffect(() => {
    setIncludedGitChangePaths((current) => {
      const validKeys = new Set(
        committableChanges.map((item) =>
          gitChangeKeyForRepository(item.repositoryRootRelative, item.change),
        ),
      );
      const next = new Set<string>();

      committableChanges.forEach((item) => {
        const changeKey = gitChangeKeyForRepository(
          item.repositoryRootRelative,
          item.change,
        );

        if (item.change.isStaged || current.has(changeKey)) {
          next.add(changeKey);
        }
      });

      current.forEach((changeKey) => {
        if (validKeys.has(changeKey)) {
          next.add(changeKey);
        }
      });

      if (
        next.size === current.size &&
        [...next].every((path) => current.has(path))
      ) {
        return current;
      }

      return next;
    });
  }, [committableChanges]);

  // On workspace switch, reset the commit panel so a switched-to tab never
  // inherits another workspace's draft message / selection / in-flight flag.
  useEffect(() => {
    gitExclusiveOperationGenerationRef.current += 1;
    gitOperationInFlightRef.current = false;
    setGitAmendEnabled(false);
    setGitCommitMessage("");
    setIncludedGitChangePaths(new Set());

    return () => {
      gitExclusiveOperationGenerationRef.current += 1;
      gitOperationInFlightRef.current = false;
    };
  }, [workspaceRoot]);

  return {
    gitAmendEnabled,
    gitCommitMessage,
    gitCommitMessageHistory,
    includedGitChangePaths,
    gitOperationLoading: gitOperationCurrency.operationLoading,
    setGitAmendEnabled,
    setGitCommitMessage,
    toggleGitChangeIncluded,
    stageGitChanges,
    unstageGitChanges,
    loadGitFileHunks,
    stageGitHunk,
    unstageGitHunk,
    revertGitChanges,
    runGitCommit,
    amendGitChanges,
    commitGitChanges,
    commitAndPushGitChanges,
    fetchGitChanges,
    pullGitChanges,
  };
}
