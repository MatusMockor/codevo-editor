import { Check, GitBranch, Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import type { GitBranch as GitBranchEntry } from "../domain/git";

interface GitBranchPanelProps {
  branches: GitBranchEntry[];
  isLoading: boolean;
  isOpen: boolean;
  onClose(): void;
  onCreate(): void;
  onSwitch(name: string): void;
}

export function GitBranchPanel({
  branches,
  isLoading,
  isOpen,
  onClose,
  onCreate,
  onSwitch,
}: GitBranchPanelProps) {
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    containerRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    onClose();
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
          <div className="file-history-commits" role="listbox">
            {isLoading ? (
              <div className="file-history-empty">Loading branches</div>
            ) : null}
            {!isLoading && branches.length === 0 ? (
              <div className="file-history-empty">No branches</div>
            ) : null}
            {branches.map((branch) => (
              <GitBranchRow
                branch={branch}
                key={branch.name}
                onSwitch={() => onSwitch(branch.name)}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

interface GitBranchRowProps {
  branch: GitBranchEntry;
  onSwitch(): void;
}

function GitBranchRow({ branch, onSwitch }: GitBranchRowProps) {
  // The current branch is not actionable: clicking it would be a no-op switch,
  // so it is rendered selected and disabled, mirroring PhpStorm's branch popup.
  return (
    <button
      aria-selected={branch.isCurrent}
      className={
        branch.isCurrent ? "git-branch-row active" : "git-branch-row"
      }
      disabled={branch.isCurrent}
      onClick={onSwitch}
      role="option"
      title={branch.isCurrent ? `${branch.name} (current)` : `Switch to ${branch.name}`}
      type="button"
    >
      <GitBranch aria-hidden="true" className="git-branch-icon" size={14} />
      <span className="git-branch-name">{branch.name}</span>
      {branch.isCurrent ? (
        <Check aria-hidden="true" className="git-branch-current" size={14} />
      ) : null}
    </button>
  );
}
