import { memo, useCallback, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  Download,
  FileEdit,
  FileMinus,
  FilePlus,
  FileQuestion,
  FileSymlink,
  FileWarning,
  GitBranch,
  Plus,
  RefreshCw,
  RotateCcw,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  gitChangeKeyForRepository,
  groupGitChanges,
  gitStatusLabel,
  gitStatusTitle,
  type GitChangedFile,
  type GitChangeGroup,
  type GitChangeStatus,
  type GitStatus,
} from "../domain/git";
import {
  gitRepositoryDisplayName,
  type GitRepositoryStatus,
} from "../domain/gitRepositoryMapping";
import { getTreeGitStatusClassName } from "./gitStatusClassName";
import { requestGitFetch, requestGitPull } from "../application/useGitWorkspace";

interface GitChangesPanelProps {
  activeChange: GitChangedFile | null;
  commitMessage: string;
  gitOperationLoading: boolean;
  includedChangePaths: Set<string>;
  isLoading: boolean;
  /**
   * Whole-map status view (PhpStorm directory mappings): one entry per mapped
   * repository. When two or more repositories have changes the panel groups them
   * under a per-repo header; a single repository keeps the pre-multi-repo look
   * (no header). Omitted / empty falls back to {@link status} (single-repo).
   */
  repositoryStatuses?: GitRepositoryStatus[];
  rootPath: string | null;
  status: GitStatus;
  /** Workspace root, used to label the primary repository's section header. */
  workspaceRoot?: string | null;
  onCommit(): void;
  onCommitAndPush(): void;
  onFetch?(): void;
  onCommitMessageChange(message: string): void;
  onOpenChange(change: GitChangedFile): void;
  onPreviewChange(change: GitChangedFile): void;
  onPull?(): void;
  onRefresh(): void;
  onRevertChanges(changes: GitChangedFile[]): void;
  onStageChanges(changes: GitChangedFile[]): void;
  onToggleChangeIncluded(
    change: GitChangedFile,
    repositoryRootRelative?: string,
  ): void;
  onUnstageChanges(changes: GitChangedFile[]): void;
}

/** One repository's changes, resolved for a section header in the panel. */
interface RepositorySection {
  rootRelativePath: string;
  label: string;
  branch: string | null;
  changes: GitChangedFile[];
}

/**
 * The repositories to show as grouped sections: every mapped repository that is
 * a git repository and currently has changes, labelled for its header. Repos
 * with no changes are omitted so the panel mirrors PhpStorm (only repositories
 * with pending changes appear).
 */
function buildRepositorySections(
  repositoryStatuses: GitRepositoryStatus[],
  workspaceRoot: string,
): RepositorySection[] {
  return repositoryStatuses
    .filter(
      (entry) => entry.status.isRepository && entry.status.changes.length > 0,
    )
    .map((entry) => ({
      rootRelativePath: entry.mapping.rootRelativePath,
      label: gitRepositoryDisplayName(
        entry.mapping.rootRelativePath,
        workspaceRoot,
      ),
      branch: entry.status.branch,
      changes: entry.status.changes,
    }));
}

function selectedChangesForRepository(
  changes: GitChangedFile[],
  repositoryRootRelative: string,
  includedChangePaths: Set<string>,
): GitChangedFile[] {
  return changes.filter((change) =>
    includedChangePaths.has(
      gitChangeKeyForRepository(repositoryRootRelative, change),
    ),
  );
}

/**
 * Binds a repository to the include-toggle so the change groups/rows stay
 * repo-agnostic. The primary ("") repository invokes the callback with a single
 * argument - byte-identical to the pre-multi-repo call - so its inclusion key
 * matches `gitChangeKey`; a nested repository passes its directory so the key is
 * qualified (`gitChangeKeyForRepository`).
 */
function bindRepositoryToggle(
  onToggleChangeIncluded: (
    change: GitChangedFile,
    repositoryRootRelative?: string,
  ) => void,
  repositoryRootRelative: string,
): (change: GitChangedFile) => void {
  if (repositoryRootRelative === "") {
    return (change) => onToggleChangeIncluded(change);
  }

  return (change) => onToggleChangeIncluded(change, repositoryRootRelative);
}

function GitChangesPanelComponent({
  activeChange,
  commitMessage,
  gitOperationLoading,
  includedChangePaths,
  isLoading,
  onCommit,
  onCommitAndPush,
  onFetch,
  onCommitMessageChange,
  onOpenChange,
  onPreviewChange,
  onPull,
  onRefresh,
  onRevertChanges,
  onStageChanges,
  onToggleChangeIncluded,
  onUnstageChanges,
  repositoryStatuses,
  rootPath,
  status,
  workspaceRoot,
}: GitChangesPanelProps) {
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    new Set(),
  );

  const sections = useMemo(
    () =>
      buildRepositorySections(
        repositoryStatuses ?? [],
        workspaceRoot ?? status.rootPath ?? "",
      ),
    [repositoryStatuses, status.rootPath, workspaceRoot],
  );

  // Single-repo view source: an explicit single section (nested-only or the
  // primary with changes when the whole-map view is wired), else the primary
  // `status` prop (pre-multi-repo path / single-repo tests). The repo prefix
  // stays "" for the primary so every key is byte-identical to `gitChangeKey`.
  const singleSection = sections.length === 1 ? sections[0] : null;
  const singleBranch = singleSection ? singleSection.branch : status.branch;
  const singleChanges = singleSection ? singleSection.changes : status.changes;
  const singleRepoRootRelative = singleSection
    ? singleSection.rootRelativePath
    : "";
  const singleIsRepository = singleSection ? true : status.isRepository;

  const singleGroups = useMemo(
    () => groupGitChanges(singleChanges),
    [singleChanges],
  );
  const singleSelectedChanges = useMemo(
    () =>
      selectedChangesForRepository(
        singleChanges,
        singleRepoRootRelative,
        includedChangePaths,
      ),
    [includedChangePaths, singleChanges, singleRepoRootRelative],
  );
  const singleToggleChangeIncluded = useMemo(
    () => bindRepositoryToggle(onToggleChangeIncluded, singleRepoRootRelative),
    [onToggleChangeIncluded, singleRepoRootRelative],
  );

  const onToggleGroupCollapsed = useCallback((collapseKey: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);

      if (next.has(collapseKey)) {
        next.delete(collapseKey);
        return next;
      }

      next.add(collapseKey);
      return next;
    });
  }, []);

  if (!rootPath) {
    return (
      <div className="empty-tree">
        <p>No workspace</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="empty-tree">
        <p>Loading Git status</p>
      </div>
    );
  }

  const fetchChanges = onFetch ?? (() => requestGitFetch(rootPath));
  const pullChanges = onPull ?? (() => requestGitPull(rootPath));

  // Multi-repo grouped view (PhpStorm directory mappings): two or more
  // repositories have changes, each under its own header.
  if (sections.length >= 2) {
    const selectedChanges = sections.flatMap((section) =>
      selectedChangesForRepository(
        section.changes,
        section.rootRelativePath,
        includedChangePaths,
      ),
    );
    const totalChangeCount = sections.reduce(
      (total, section) => total + section.changes.length,
      0,
    );

    return (
      <section aria-label="Commit" className="git-commit-panel">
        <GitCommitHeader
          branch={null}
          changeCount={totalChangeCount}
          disabled={gitOperationLoading}
          hideBranch
          onRefresh={onRefresh}
          onFetch={fetchChanges}
          onPull={pullChanges}
          onRevertChanges={onRevertChanges}
          onStageChanges={onStageChanges}
          onUnstageChanges={onUnstageChanges}
          selectedChanges={selectedChanges}
        />
        <nav aria-label="Git changes" className="git-changes">
          {sections.map((section) => (
            <GitRepositorySectionView
              activeChange={activeChange}
              collapsedGroupIds={collapsedGroupIds}
              disabled={gitOperationLoading}
              includedChangePaths={includedChangePaths}
              key={section.rootRelativePath || "/primary"}
              onOpenChange={onOpenChange}
              onPreviewChange={onPreviewChange}
              onToggleChangeIncluded={onToggleChangeIncluded}
              onToggleCollapsed={onToggleGroupCollapsed}
              section={section}
            />
          ))}
        </nav>
        <GitCommitFooter
          canCommit={
            selectedChanges.length > 0 &&
            commitMessage.trim().length > 0 &&
            !gitOperationLoading
          }
          commitMessage={commitMessage}
          disabled={gitOperationLoading}
          onCommit={onCommit}
          onCommitAndPush={onCommitAndPush}
          onCommitMessageChange={onCommitMessageChange}
        />
      </section>
    );
  }

  if (!singleIsRepository) {
    return (
      <div className="empty-tree">
        <p>No Git repository</p>
      </div>
    );
  }

  if (singleChanges.length === 0) {
    return (
      <section aria-label="Commit" className="git-commit-panel">
        <GitCommitHeader
          branch={singleBranch}
          changeCount={0}
          disabled={gitOperationLoading}
          onRefresh={onRefresh}
          onFetch={fetchChanges}
          onPull={pullChanges}
          onRevertChanges={() => undefined}
          onStageChanges={() => undefined}
          onUnstageChanges={() => undefined}
          selectedChanges={[]}
        />
        <div className="empty-tree">
          <p>No changes</p>
        </div>
      </section>
    );
  }

  const canCommit =
    singleSelectedChanges.length > 0 &&
    commitMessage.trim().length > 0 &&
    !gitOperationLoading;

  return (
    <section aria-label="Commit" className="git-commit-panel">
      <GitCommitHeader
        branch={singleBranch}
        changeCount={singleChanges.length}
        disabled={gitOperationLoading}
        onRefresh={onRefresh}
        onFetch={fetchChanges}
        onPull={pullChanges}
        onRevertChanges={onRevertChanges}
        onStageChanges={onStageChanges}
        onUnstageChanges={onUnstageChanges}
        selectedChanges={singleSelectedChanges}
      />
      <nav aria-label="Git changes" className="git-changes">
        {singleGroups.map((group) => (
          <GitChangeGroupView
            activeChange={activeChange}
            collapseKey={`${singleRepoRootRelative}:${group.id}`}
            disabled={gitOperationLoading}
            group={group}
            includedChangePaths={includedChangePaths}
            isCollapsed={collapsedGroupIds.has(
              `${singleRepoRootRelative}:${group.id}`,
            )}
            key={group.id}
            onOpenChange={onOpenChange}
            onPreviewChange={onPreviewChange}
            onToggleChangeIncluded={singleToggleChangeIncluded}
            onToggleCollapsed={onToggleGroupCollapsed}
            repositoryRootRelative={singleRepoRootRelative}
          />
        ))}
      </nav>
      <GitCommitFooter
        canCommit={canCommit}
        commitMessage={commitMessage}
        disabled={gitOperationLoading}
        onCommit={onCommit}
        onCommitAndPush={onCommitAndPush}
        onCommitMessageChange={onCommitMessageChange}
      />
    </section>
  );
}

export const GitChangesPanel = memo(GitChangesPanelComponent);

interface GitCommitFooterProps {
  canCommit: boolean;
  commitMessage: string;
  disabled: boolean;
  onCommit(): void;
  onCommitAndPush(): void;
  onCommitMessageChange(message: string): void;
}

function GitCommitFooter({
  canCommit,
  commitMessage,
  disabled,
  onCommit,
  onCommitAndPush,
  onCommitMessageChange,
}: GitCommitFooterProps) {
  return (
    <footer className="git-commit-footer">
      <textarea
        aria-label="Commit message"
        className="git-commit-message"
        disabled={disabled}
        onInput={(event) => onCommitMessageChange(event.currentTarget.value)}
        placeholder="Commit message"
        value={commitMessage}
      />
      <div className="git-commit-actions">
        <button
          className="git-commit-button"
          disabled={!canCommit}
          onClick={onCommit}
          type="button"
        >
          Commit
        </button>
        <button
          className="git-commit-button git-commit-push-button"
          disabled={!canCommit}
          onClick={onCommitAndPush}
          type="button"
        >
          Commit and Push
        </button>
      </div>
    </footer>
  );
}

interface GitRepositorySectionViewProps {
  activeChange: GitChangedFile | null;
  collapsedGroupIds: Set<string>;
  disabled: boolean;
  includedChangePaths: Set<string>;
  section: RepositorySection;
  onOpenChange(change: GitChangedFile): void;
  onPreviewChange(change: GitChangedFile): void;
  onToggleChangeIncluded(
    change: GitChangedFile,
    repositoryRootRelative?: string,
  ): void;
  onToggleCollapsed(collapseKey: string): void;
}

// A single repository's changes under a PhpStorm-style repo header (name +
// branch + change count), each of its Changes/Unversioned groups rendered with
// the repository's directory so inclusion keys stay repo-qualified.
function GitRepositorySectionViewComponent({
  activeChange,
  collapsedGroupIds,
  disabled,
  includedChangePaths,
  onOpenChange,
  onPreviewChange,
  onToggleChangeIncluded,
  onToggleCollapsed,
  section,
}: GitRepositorySectionViewProps) {
  const groups = useMemo(
    () => groupGitChanges(section.changes),
    [section.changes],
  );
  const toggleChangeIncluded = useMemo(
    () => bindRepositoryToggle(onToggleChangeIncluded, section.rootRelativePath),
    [onToggleChangeIncluded, section.rootRelativePath],
  );

  return (
    <section className="git-repository-section">
      <header className="git-repository-header">
        <span className="git-repository-name">{section.label}</span>
        <small className="git-repository-branch">
          <GitBranch aria-hidden="true" size={12} />
          {section.branch || "detached"}
        </small>
        <span
          aria-label={changeCountLabel(section.changes.length)}
          className="git-repository-count"
        >
          {section.changes.length}
        </span>
      </header>
      {groups.map((group) => {
        const collapseKey = `${section.rootRelativePath}:${group.id}`;

        return (
          <GitChangeGroupView
            activeChange={activeChange}
            collapseKey={collapseKey}
            disabled={disabled}
            group={group}
            includedChangePaths={includedChangePaths}
            isCollapsed={collapsedGroupIds.has(collapseKey)}
            key={collapseKey}
            onOpenChange={onOpenChange}
            onPreviewChange={onPreviewChange}
            onToggleChangeIncluded={toggleChangeIncluded}
            onToggleCollapsed={onToggleCollapsed}
            repositoryRootRelative={section.rootRelativePath}
          />
        );
      })}
    </section>
  );
}

const GitRepositorySectionView = memo(GitRepositorySectionViewComponent);

interface GitCommitHeaderProps {
  branch: string | null;
  changeCount: number;
  disabled: boolean;
  /**
   * Hides the single-branch line. In the multi-repo grouped view each repo shows
   * its own branch in its section header, so the top header omits it.
   */
  hideBranch?: boolean;
  selectedChanges: GitChangedFile[];
  onFetch(): void;
  onPull(): void;
  onRefresh(): void;
  onRevertChanges(changes: GitChangedFile[]): void;
  onStageChanges(changes: GitChangedFile[]): void;
  onUnstageChanges(changes: GitChangedFile[]): void;
}

function GitCommitHeader({
  branch,
  changeCount,
  disabled,
  hideBranch = false,
  onRefresh,
  onFetch,
  onPull,
  onRevertChanges,
  onStageChanges,
  onUnstageChanges,
  selectedChanges,
}: GitCommitHeaderProps) {
  const hasSelection = selectedChanges.length > 0;

  return (
    <header className="git-commit-header">
      <div className="git-commit-title">
        <span className="git-commit-title-row">
          <span>Commit</span>
          {changeCount > 0 ? (
            <span
              aria-label={changeCountLabel(changeCount)}
              className="git-changes-summary"
            >
              {changeCount}
            </span>
          ) : null}
        </span>
        {hideBranch ? null : (
          <small>
            <GitBranch aria-hidden="true" size={13} />
            {branch || "detached"}
          </small>
        )}
      </div>
      <div className="git-commit-toolbar" aria-label="Git actions">
        <button
          aria-label="Fetch"
          disabled={disabled}
          onClick={onFetch}
          title="Fetch remote changes"
          type="button"
        >
          <CloudDownload aria-hidden="true" size={14} />
        </button>
        <button
          aria-label="Pull"
          disabled={disabled}
          onClick={onPull}
          title="Pull current branch"
          type="button"
        >
          <Download aria-hidden="true" size={14} />
        </button>
        <button
          disabled={disabled}
          onClick={onRefresh}
          title="Refresh Git changes"
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
        </button>
        <button
          disabled={disabled || !hasSelection}
          onClick={() => onStageChanges(selectedChanges)}
          title="Stage selected files"
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
        </button>
        <button
          disabled={disabled || !hasSelection}
          onClick={() => onUnstageChanges(selectedChanges)}
          title="Unstage selected files"
          type="button"
        >
          <Undo2 aria-hidden="true" size={14} />
        </button>
        <button
          disabled={disabled || !hasSelection}
          onClick={() => onRevertChanges(selectedChanges)}
          title="Revert selected files"
          type="button"
        >
          <RotateCcw aria-hidden="true" size={14} />
        </button>
      </div>
    </header>
  );
}

interface GitChangeGroupViewProps {
  activeChange: GitChangedFile | null;
  collapseKey: string;
  disabled: boolean;
  group: GitChangeGroup;
  includedChangePaths: Set<string>;
  isCollapsed: boolean;
  /**
   * Owning repository's workspace-root-relative directory ("" for primary),
   * used only to compute inclusion keys. The toggle callback is already bound to
   * this repository (see {@link bindRepositoryToggle}).
   */
  repositoryRootRelative: string;
  onOpenChange(change: GitChangedFile): void;
  onPreviewChange(change: GitChangedFile): void;
  onToggleChangeIncluded(change: GitChangedFile): void;
  onToggleCollapsed(collapseKey: string): void;
}

function GitChangeGroupViewComponent({
  activeChange,
  collapseKey,
  disabled,
  group,
  includedChangePaths,
  isCollapsed,
  onOpenChange,
  onPreviewChange,
  onToggleChangeIncluded,
  onToggleCollapsed,
  repositoryRootRelative,
}: GitChangeGroupViewProps) {
  const selectedChanges = useMemo(
    () =>
      group.changes.filter((change) =>
        includedChangePaths.has(
          gitChangeKeyForRepository(repositoryRootRelative, change),
        ),
      ),
    [group.changes, includedChangePaths, repositoryRootRelative],
  );
  const allIncluded = selectedChanges.length === group.changes.length;

  const onToggleGroup = () => {
    if (allIncluded) {
      selectedChanges.forEach(onToggleChangeIncluded);
      return;
    }

    group.changes
      .filter(
        (change) =>
          !includedChangePaths.has(
            gitChangeKeyForRepository(repositoryRootRelative, change),
          ),
      )
      .forEach(onToggleChangeIncluded);
  };

  return (
    <section className="git-change-group">
      <div className="git-change-group-header">
        <button
          aria-expanded={!isCollapsed}
          className="git-change-group-toggle"
          disabled={disabled}
          onClick={() => {
            if (!disabled) {
              onToggleCollapsed(collapseKey);
            }
          }}
          type="button"
        >
          {isCollapsed ? (
            <ChevronRight aria-hidden="true" size={14} />
          ) : (
            <ChevronDown aria-hidden="true" size={14} />
          )}
        </button>
        <ThemedCheckbox
          checked={allIncluded}
          disabled={disabled}
          label={`${allIncluded ? "Unstage" : "Stage"} ${group.title}`}
          onChange={onToggleGroup}
        />
        <span className="git-change-group-title">
          {group.title} {group.changes.length}
        </span>
      </div>
      {isCollapsed
        ? null
        : group.changes.map((change) => (
            <GitChangeRow
              change={change}
              disabled={disabled}
              isActive={isSameActiveChange(activeChange, change)}
              isIncluded={includedChangePaths.has(
                gitChangeKeyForRepository(repositoryRootRelative, change),
              )}
              key={`${change.status}:${change.path}:${change.oldPath || ""}:${change.isStaged}`}
              onOpenChange={onOpenChange}
              onPreviewChange={onPreviewChange}
              onToggleChangeIncluded={onToggleChangeIncluded}
            />
          ))}
    </section>
  );
}

const GitChangeGroupView = memo(GitChangeGroupViewComponent);

// Active-row match by absolute path (unique across repositories), so a nested
// repo's active diff highlights the right row and never a same-named sibling in
// another repository.
function isSameActiveChange(
  activeChange: GitChangedFile | null,
  change: GitChangedFile,
): boolean {
  return (
    activeChange !== null &&
    activeChange.path === change.path &&
    activeChange.oldPath === change.oldPath &&
    activeChange.isStaged === change.isStaged
  );
}

interface GitChangeRowProps {
  change: GitChangedFile;
  disabled: boolean;
  isActive: boolean;
  isIncluded: boolean;
  onOpenChange(change: GitChangedFile): void;
  onPreviewChange(change: GitChangedFile): void;
  onToggleChangeIncluded(change: GitChangedFile): void;
}

function GitChangeRowComponent({
  change,
  disabled,
  isActive,
  isIncluded,
  onOpenChange,
  onPreviewChange,
  onToggleChangeIncluded,
}: GitChangeRowProps) {
  const statusTitle = gitStatusTitle(change.status);

  return (
    <div
      className={
        isActive ? "git-change-row-wrapper active" : "git-change-row-wrapper"
      }
    >
      <ThemedCheckbox
        checked={isIncluded}
        className="git-change-checkbox"
        disabled={disabled}
        label={`${isIncluded ? "Unstage" : "Stage"} ${change.relativePath}`}
        onChange={() => onToggleChangeIncluded(change)}
      />
      <button
        className="tree-row git-change-row"
        disabled={disabled}
        onClick={(event) => {
          if (disabled) {
            return;
          }

          if (event.detail > 1) {
            return;
          }

          onPreviewChange(change);
        }}
        onDoubleClick={() => {
          if (!disabled) {
            onOpenChange(change);
          }
        }}
        title={statusTitle}
        type="button"
      >
        <GitChangeStatusIcon status={change.status} />
        <span className="git-change-name">{fileName(change.relativePath)}</span>
        <small className="git-change-directory">
          {directoryName(change.relativePath)}
        </small>
        <span
          aria-label={statusTitle}
          className={getTreeGitStatusClassName(change.status)}
        >
          {gitStatusLabel(change.status)}
        </span>
      </button>
    </div>
  );
}

const GitChangeRow = memo(GitChangeRowComponent);

interface ThemedCheckboxProps {
  checked: boolean;
  disabled?: boolean;
  className?: string;
  label: string;
  onChange(): void;
}

function ThemedCheckbox({
  checked,
  className = "",
  disabled = false,
  label,
  onChange,
}: ThemedCheckboxProps) {
  return (
    <label
      className={
        checked
          ? `git-themed-checkbox checked ${className}`.trim()
          : `git-themed-checkbox ${className}`.trim()
      }
      onClick={(event) => event.stopPropagation()}
    >
      <input
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        type="checkbox"
      />
      <span aria-hidden="true" className="git-themed-checkbox-box">
        {checked ? <Check size={10} strokeWidth={3} /> : null}
      </span>
    </label>
  );
}

interface GitChangeStatusIconProps {
  status: GitChangeStatus;
}

// JetBrains "Local Changes" renders a status-tinted file glyph per row so the
// kind of change reads at a glance without parsing the trailing letter. Each
// status maps to a distinct lucide icon and a status class the themes tint. The
// glyph is decorative (aria-hidden): the row button's title and the trailing
// status span (aria-label) already carry the status for assistive tech.
function GitChangeStatusIcon({ status }: GitChangeStatusIconProps) {
  const Icon = gitChangeStatusIcon(status);

  return (
    <span
      aria-hidden="true"
      className={`tree-entry-icon git-change-status-icon git-change-status-icon-${status}`}
    >
      <Icon size={16} />
    </span>
  );
}

function gitChangeStatusIcon(status: GitChangeStatus): LucideIcon {
  if (status === "added") {
    return FilePlus;
  }

  if (status === "deleted") {
    return FileMinus;
  }

  if (status === "renamed") {
    return FileSymlink;
  }

  if (status === "untracked") {
    return FileQuestion;
  }

  if (status === "conflicted") {
    return FileWarning;
  }

  return FileEdit;
}

function changeCountLabel(count: number): string {
  return `${count} changed file${count === 1 ? "" : "s"}`;
}

function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function directoryName(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}
