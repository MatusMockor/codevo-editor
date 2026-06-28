import { memo, useCallback, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Plus,
  RefreshCw,
  RotateCcw,
  Undo2,
} from "lucide-react";
import {
  gitChangeKey,
  groupGitChanges,
  gitStatusLabel,
  gitStatusTitle,
  type GitChangedFile,
  type GitChangeGroup,
  type GitStatus,
} from "../domain/git";
import { getTreeGitStatusClassName } from "./gitStatusClassName";
import { TreeEntryIcon } from "./TreeEntryIcon";

interface GitChangesPanelProps {
  activeChange: GitChangedFile | null;
  commitMessage: string;
  gitOperationLoading: boolean;
  includedChangePaths: Set<string>;
  isLoading: boolean;
  rootPath: string | null;
  status: GitStatus;
  onCommit(): void;
  onCommitAndPush(): void;
  onCommitMessageChange(message: string): void;
  onOpenChange(change: GitChangedFile): void;
  onPreviewChange(change: GitChangedFile): void;
  onRefresh(): void;
  onRevertChanges(changes: GitChangedFile[]): void;
  onStageChanges(changes: GitChangedFile[]): void;
  onToggleChangeIncluded(change: GitChangedFile): void;
  onUnstageChanges(changes: GitChangedFile[]): void;
}

function GitChangesPanelComponent({
  activeChange,
  commitMessage,
  gitOperationLoading,
  includedChangePaths,
  isLoading,
  onCommit,
  onCommitAndPush,
  onCommitMessageChange,
  onOpenChange,
  onPreviewChange,
  onRefresh,
  onRevertChanges,
  onStageChanges,
  onToggleChangeIncluded,
  onUnstageChanges,
  rootPath,
  status,
}: GitChangesPanelProps) {
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<
    Set<GitChangeGroup["id"]>
  >(new Set());

  const changes = status.changes;
  const groups = useMemo(() => groupGitChanges(changes), [changes]);
  const selectedChanges = useMemo(
    () =>
      changes.filter((change) =>
        includedChangePaths.has(gitChangeKey(change)),
      ),
    [changes, includedChangePaths],
  );

  const onToggleGroupCollapsed = useCallback(
    (groupId: GitChangeGroup["id"]) => {
      setCollapsedGroupIds((current) => {
        const next = new Set(current);

        if (next.has(groupId)) {
          next.delete(groupId);
          return next;
        }

        next.add(groupId);
        return next;
      });
    },
    [],
  );

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

  if (!status.isRepository) {
    return (
      <div className="empty-tree">
        <p>No Git repository</p>
      </div>
    );
  }

  if (status.changes.length === 0) {
    return (
      <section aria-label="Commit" className="git-commit-panel">
        <GitCommitHeader
          branch={status.branch}
          disabled={gitOperationLoading}
          onRefresh={onRefresh}
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
    selectedChanges.length > 0 &&
    commitMessage.trim().length > 0 &&
    !gitOperationLoading;

  return (
    <section aria-label="Commit" className="git-commit-panel">
      <GitCommitHeader
        branch={status.branch}
        disabled={gitOperationLoading}
        onRefresh={onRefresh}
        onRevertChanges={onRevertChanges}
        onStageChanges={onStageChanges}
        onUnstageChanges={onUnstageChanges}
        selectedChanges={selectedChanges}
      />
      <nav aria-label="Git changes" className="git-changes">
        {groups.map((group) => (
          <GitChangeGroupView
            activeChange={activeChange}
            disabled={gitOperationLoading}
            group={group}
            key={group.id}
            onOpenChange={onOpenChange}
            onPreviewChange={onPreviewChange}
            onToggleChangeIncluded={onToggleChangeIncluded}
            includedChangePaths={includedChangePaths}
            isCollapsed={collapsedGroupIds.has(group.id)}
            onToggleCollapsed={onToggleGroupCollapsed}
          />
        ))}
      </nav>
      <footer className="git-commit-footer">
        <textarea
          aria-label="Commit message"
          className="git-commit-message"
          disabled={gitOperationLoading}
          onInput={(event) =>
            onCommitMessageChange(event.currentTarget.value)
          }
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
    </section>
  );
}

export const GitChangesPanel = memo(GitChangesPanelComponent);

interface GitCommitHeaderProps {
  branch: string | null;
  disabled: boolean;
  selectedChanges: GitChangedFile[];
  onRefresh(): void;
  onRevertChanges(changes: GitChangedFile[]): void;
  onStageChanges(changes: GitChangedFile[]): void;
  onUnstageChanges(changes: GitChangedFile[]): void;
}

function GitCommitHeader({
  branch,
  disabled,
  onRefresh,
  onRevertChanges,
  onStageChanges,
  onUnstageChanges,
  selectedChanges,
}: GitCommitHeaderProps) {
  const hasSelection = selectedChanges.length > 0;

  return (
    <header className="git-commit-header">
      <div className="git-commit-title">
        <span>Commit</span>
        <small>
          <GitBranch aria-hidden="true" size={13} />
          {branch || "detached"}
        </small>
      </div>
      <div className="git-commit-toolbar" aria-label="Git actions">
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
  disabled: boolean;
  group: GitChangeGroup;
  includedChangePaths: Set<string>;
  isCollapsed: boolean;
  onOpenChange(change: GitChangedFile): void;
  onPreviewChange(change: GitChangedFile): void;
  onToggleChangeIncluded(change: GitChangedFile): void;
  onToggleCollapsed(groupId: GitChangeGroup["id"]): void;
}

function GitChangeGroupViewComponent({
  activeChange,
  disabled,
  group,
  includedChangePaths,
  isCollapsed,
  onOpenChange,
  onPreviewChange,
  onToggleChangeIncluded,
  onToggleCollapsed,
}: GitChangeGroupViewProps) {
  const activeChangeKey = activeChange ? gitChangeKey(activeChange) : null;

  const selectedChanges = useMemo(
    () =>
      group.changes.filter((change) =>
        includedChangePaths.has(gitChangeKey(change)),
      ),
    [group.changes, includedChangePaths],
  );
  const allIncluded = selectedChanges.length === group.changes.length;

  const onToggleGroup = () => {
    if (allIncluded) {
      selectedChanges.forEach(onToggleChangeIncluded);
      return;
    }

    group.changes
      .filter((change) => !includedChangePaths.has(gitChangeKey(change)))
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
              onToggleCollapsed(group.id);
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
        : group.changes.map((change) => {
            const changeKey = gitChangeKey(change);

            return (
              <GitChangeRow
                change={change}
                disabled={disabled}
                isActive={activeChangeKey === changeKey}
                isIncluded={includedChangePaths.has(changeKey)}
                key={`${change.status}:${change.path}:${change.oldPath || ""}:${change.isStaged}`}
                onOpenChange={onOpenChange}
                onPreviewChange={onPreviewChange}
                onToggleChangeIncluded={onToggleChangeIncluded}
              />
            );
          })}
    </section>
  );
}

const GitChangeGroupView = memo(GitChangeGroupViewComponent);

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
        <TreeEntryIcon kind="file" />
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

function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function directoryName(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}
