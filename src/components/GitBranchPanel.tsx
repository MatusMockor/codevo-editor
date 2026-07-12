import {
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { GitBranch as GitBranchEntry } from "../domain/git";

interface GitBranchDeleteError {
  id: string;
  message: string;
}

interface GitBranchPanelProps {
  branches: GitBranchEntry[];
  deleteError: GitBranchDeleteError | null;
  isLoading: boolean;
  isOpen: boolean;
  onClose(): void;
  onCreate(): void;
  onDelete(name: string, options: { force: boolean }): Promise<void>;
  onRename(oldName: string, newName: string): Promise<void>;
  onCheckoutRemote(name: string): void;
  onSwitch(name: string): void;
  remoteBranches: GitBranchEntry[];
}

export function GitBranchPanel({
  branches,
  deleteError,
  isLoading,
  isOpen,
  onClose,
  onCreate,
  onDelete,
  onRename,
  onCheckoutRemote,
  onSwitch,
  remoteBranches,
}: GitBranchPanelProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const deleteErrorIdRef = useRef<string | null>(null);
  const [forceDeleteBranch, setForceDeleteBranch] = useState<string | null>(
    null,
  );
  const [pendingDeleteBranch, setPendingDeleteBranch] = useState<string | null>(
    null,
  );
  const [renamingBranch, setRenamingBranch] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [remoteBranchesExpanded, setRemoteBranchesExpanded] = useState(false);
  const [filterValue, setFilterValue] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    containerRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setRemoteBranchesExpanded(false);
    setFilterValue("");
  }, [isOpen]);

  useEffect(() => {
    setForceDeleteBranch(null);
    setPendingDeleteBranch(null);
    setRenamingBranch(null);
  }, [branches]);

  useEffect(() => {
    if (!pendingDeleteBranch || !deleteError) {
      return;
    }

    if (deleteError.id === deleteErrorIdRef.current) {
      return;
    }

    deleteErrorIdRef.current = deleteError.id;
    setPendingDeleteBranch(null);

    if (!/not fully merged/i.test(deleteError.message)) {
      return;
    }

    setForceDeleteBranch(pendingDeleteBranch);
  }, [deleteError, pendingDeleteBranch]);

  if (!isOpen) {
    return null;
  }

  const normalizedFilter = filterValue.toLocaleLowerCase();
  const filterActive = filterValue.length > 0;
  const filteredBranches = branches.filter((branch) =>
    branch.name.toLocaleLowerCase().includes(normalizedFilter),
  );
  const filteredRemoteBranches = remoteBranches.filter((branch) =>
    branch.name.toLocaleLowerCase().includes(normalizedFilter),
  );
  const remoteSectionExpanded = filterActive
    ? filteredRemoteBranches.length > 0
    : remoteBranchesExpanded;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    if (filterActive) {
      setFilterValue("");
      return;
    }

    onClose();
  };

  const handleDelete = async (name: string) => {
    deleteErrorIdRef.current = deleteError?.id ?? null;
    setForceDeleteBranch(null);
    setPendingDeleteBranch(name);
    await onDelete(name, { force: false });
  };

  const handleForceDelete = async (name: string) => {
    setForceDeleteBranch(null);
    setPendingDeleteBranch(null);
    await onDelete(name, { force: true });
  };

  const startRename = (name: string) => {
    setRenamingBranch(name);
    setRenameValue(name);
  };

  const cancelRename = () => {
    setRenamingBranch(null);
    setRenameValue("");
  };

  const confirmRename = async (name: string) => {
    const nextName = renameValue.trim();

    if (!nextName || nextName === name) {
      cancelRename();
      return;
    }

    cancelRename();
    await onRename(name, nextName);
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Git Branches"
        aria-modal="true"
        className="file-history-panel git-branch-panel"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="file-history-header">
          <span>
            <strong>Git Branches</strong>
            <small>Switch between local branches or create a new one</small>
          </span>
          <button onClick={onClose} title="Close branches" type="button">
            <X aria-hidden="true" size={14} />
          </button>
        </header>

        <label className="git-branch-filter">
          <Search aria-hidden="true" size={14} />
          <input
            aria-label="Filter branches"
            onChange={(event) => setFilterValue(event.target.value)}
            placeholder="Filter branches"
            type="text"
            value={filterValue}
          />
        </label>

        <div className="git-branch-actions-bar">
          <button
            aria-label="Create new branch"
            className="git-branch-new-button"
            disabled={isLoading}
            onClick={onCreate}
            type="button"
          >
            <Plus aria-hidden="true" size={14} />
            New Branch
          </button>
        </div>

        <div className="file-history-body">
          <div className="file-history-commits" role="list">
            {isLoading ? (
              <div className="file-history-empty">Loading branches</div>
            ) : null}
            {!isLoading && !filterActive && branches.length === 0 ? (
              <div className="file-history-empty">No branches</div>
            ) : null}
            {!isLoading &&
            filterActive &&
            filteredBranches.length === 0 &&
            filteredRemoteBranches.length === 0 ? (
              <div className="file-history-empty">No branches match</div>
            ) : null}
            {filteredBranches.map((branch) => (
              <GitBranchRow
                branch={branch}
                forceDelete={forceDeleteBranch === branch.name}
                isLoading={isLoading}
                isRenaming={renamingBranch === branch.name}
                key={branch.name}
                onCancelRename={cancelRename}
                onConfirmRename={() => void confirmRename(branch.name)}
                onDelete={() => void handleDelete(branch.name)}
                onForceDelete={() => void handleForceDelete(branch.name)}
                onRenameValueChange={setRenameValue}
                onStartRename={() => startRename(branch.name)}
                onSwitch={() => onSwitch(branch.name)}
                renameValue={renameValue}
              />
            ))}
            <div className="git-remote-branches-section">
              <button
                aria-controls="git-remote-branch-list"
                aria-expanded={remoteSectionExpanded}
                className="git-remote-branches-toggle"
                onClick={() =>
                  setRemoteBranchesExpanded((expanded) => !expanded)
                }
                type="button"
              >
                {remoteSectionExpanded ? (
                  <ChevronDown aria-hidden="true" size={14} />
                ) : (
                  <ChevronRight aria-hidden="true" size={14} />
                )}
                <span>Remote branches</span>
                <span className="git-remote-branches-count">
                  {filteredRemoteBranches.length}
                </span>
              </button>
              {remoteSectionExpanded ? (
                <div id="git-remote-branch-list" role="list">
                  {filteredRemoteBranches.map((branch) => (
                    <button
                      aria-label={`Check out remote branch ${branch.name}`}
                      className="git-remote-branch-row"
                      disabled={isLoading}
                      key={branch.name}
                      onClick={() => onCheckoutRemote(branch.name)}
                      role="listitem"
                      type="button"
                    >
                      <GitBranch
                        aria-hidden="true"
                        className="git-branch-icon"
                        size={14}
                      />
                      <span className="git-branch-name">{branch.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

interface GitBranchRowProps {
  branch: GitBranchEntry;
  forceDelete: boolean;
  isLoading: boolean;
  isRenaming: boolean;
  onCancelRename(): void;
  onConfirmRename(): void;
  onDelete(): void;
  onForceDelete(): void;
  onRenameValueChange(value: string): void;
  onStartRename(): void;
  onSwitch(): void;
  renameValue: string;
}

function GitBranchRow({
  branch,
  forceDelete,
  isLoading,
  isRenaming,
  onCancelRename,
  onConfirmRename,
  onDelete,
  onForceDelete,
  onRenameValueChange,
  onStartRename,
  onSwitch,
  renameValue,
}: GitBranchRowProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const renameButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasRenamingRef = useRef(false);

  useEffect(() => {
    if (isRenaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (wasRenamingRef.current) {
      renameButtonRef.current?.focus();
    }

    wasRenamingRef.current = isRenaming;
  }, [isRenaming]);

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onConfirmRename();
      return;
    }

    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onCancelRename();
  };

  return (
    <div
      aria-current={branch.isCurrent ? "true" : undefined}
      className={branch.isCurrent ? "git-branch-row active" : "git-branch-row"}
      role="listitem"
    >
      {isRenaming ? (
        <div className="git-branch-rename-form">
          <GitBranch aria-hidden="true" className="git-branch-icon" size={14} />
          <input
            aria-label={`New name for branch ${branch.name}`}
            disabled={isLoading}
            onChange={(event) => onRenameValueChange(event.target.value)}
            onKeyDown={handleRenameKeyDown}
            ref={inputRef}
            type="text"
            value={renameValue}
          />
        </div>
      ) : (
        <>
          <button
            className="git-branch-switch"
            disabled={branch.isCurrent || isLoading}
            onClick={onSwitch}
            title={
              branch.isCurrent
                ? `${branch.name} (current)`
                : `Switch to ${branch.name}`
            }
            type="button"
          >
            <GitBranch aria-hidden="true" className="git-branch-icon" size={14} />
            <span className="git-branch-name">{branch.name}</span>
            {branch.isCurrent ? (
              <Check aria-hidden="true" className="git-branch-current" size={14} />
            ) : null}
          </button>
          <div className="git-branch-row-actions">
            <button
              aria-label={`Rename branch ${branch.name}`}
              className="git-branch-row-action"
              disabled={isLoading}
              onClick={onStartRename}
              ref={renameButtonRef}
              type="button"
            >
              <Pencil aria-hidden="true" size={13} />
            </button>
            {!branch.isCurrent ? (
              <button
                aria-label={`Delete branch ${branch.name}`}
                className="git-branch-row-action git-branch-delete"
                disabled={isLoading}
                onClick={onDelete}
                type="button"
              >
                <Trash2 aria-hidden="true" size={13} />
              </button>
            ) : null}
          </div>
        </>
      )}
      {forceDelete ? (
        <div className="git-branch-force-confirm">
          <span>Branch not merged — force delete?</span>
          <button
            className="git-branch-force-delete"
            disabled={isLoading}
            onClick={onForceDelete}
            type="button"
          >
            Force delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
