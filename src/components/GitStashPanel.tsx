import { Archive, Check, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { gitBlameRelativeDate, type GitStashEntry } from "../domain/git";

interface GitStashPanelProps {
  diff: string | null;
  diffLoading: boolean;
  isLoading: boolean;
  isOpen: boolean;
  message: string;
  selectedIndex: number | null;
  stashes: GitStashEntry[];
  onApply(index: number): void;
  onClose(): void;
  onDrop(index: number): void;
  onMessageChange(message: string): void;
  onPop(index: number): void;
  onSave(message: string): void;
  onSelect(index: number): void;
}

export function GitStashPanel({
  diff,
  diffLoading,
  isLoading,
  isOpen,
  message,
  onApply,
  onClose,
  onDrop,
  onMessageChange,
  onPop,
  onSave,
  onSelect,
  selectedIndex,
  stashes,
}: GitStashPanelProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  // The stash index currently armed for destructive deletion. Drop is a
  // two-step inline confirmation: the first click arms, the second confirms.
  const [pendingDropIndex, setPendingDropIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPendingDropIndex(null);
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

    if (pendingDropIndex !== null) {
      setPendingDropIndex(null);
      return;
    }

    onClose();
  };

  const canSave = message.trim().length > 0;

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Git Stashes"
        aria-modal="true"
        className="file-history-panel git-stash-panel"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        ref={containerRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="file-history-header">
          <span>
            <strong>Git Stashes</strong>
            <small>Stash and restore work-in-progress changes</small>
          </span>
          <button onClick={onClose} title="Close stashes" type="button">
            <X aria-hidden="true" size={14} />
          </button>
        </header>

        <div className="git-stash-save">
          <input
            aria-label="Stash message"
            className="git-stash-message"
            onInput={(event) => onMessageChange(event.currentTarget.value)}
            placeholder="Stash message"
            value={message}
          />
          <button
            aria-label="Stash working tree changes"
            className="git-stash-save-button"
            disabled={!canSave || isLoading}
            onClick={() => onSave(message)}
            type="button"
          >
            <Archive aria-hidden="true" size={14} />
            Stash Changes
          </button>
        </div>

        <div className="file-history-body">
          <div className="file-history-commits" role="listbox">
            {isLoading ? (
              <div className="file-history-empty">Loading stashes</div>
            ) : null}
            {!isLoading && stashes.length === 0 ? (
              <div className="file-history-empty">No stashes</div>
            ) : null}
            {stashes.map((stash) => (
              <GitStashRow
                isActive={stash.index === selectedIndex}
                isPendingDrop={stash.index === pendingDropIndex}
                key={stash.index}
                onApply={() => onApply(stash.index)}
                onArmDrop={() => setPendingDropIndex(stash.index)}
                onCancelDrop={() => setPendingDropIndex(null)}
                onConfirmDrop={() => {
                  setPendingDropIndex(null);
                  onDrop(stash.index);
                }}
                onPop={() => onPop(stash.index)}
                onSelect={() => onSelect(stash.index)}
                stash={stash}
              />
            ))}
          </div>

          <div className="file-history-diff">
            <GitStashDiff
              diff={diff}
              isLoading={diffLoading}
              selectedIndex={selectedIndex}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

interface GitStashRowProps {
  isActive: boolean;
  isPendingDrop: boolean;
  stash: GitStashEntry;
  onApply(): void;
  onArmDrop(): void;
  onCancelDrop(): void;
  onConfirmDrop(): void;
  onPop(): void;
  onSelect(): void;
}

function GitStashRow({
  isActive,
  isPendingDrop,
  onApply,
  onArmDrop,
  onCancelDrop,
  onConfirmDrop,
  onPop,
  onSelect,
  stash,
}: GitStashRowProps) {
  return (
    <div className={isActive ? "git-stash-row-wrapper active" : "git-stash-row-wrapper"}>
      <button
        aria-selected={isActive}
        className={isActive ? "git-stash-row active" : "git-stash-row"}
        onClick={onSelect}
        role="option"
        title={stash.message}
        type="button"
      >
        <span className="git-stash-text">
          <strong>{stash.message || "(no message)"}</strong>
          <small>
            {`stash@{${stash.index}}`}
            {stash.branch ? ` · ${stash.branch}` : ""} ·{" "}
            {gitBlameRelativeDate(stash.timestamp)}
          </small>
        </span>
      </button>
      <div className="git-stash-actions">
        {isPendingDrop ? (
          <>
            <button
              aria-label={`Confirm drop stash ${stash.index}`}
              className="git-stash-action danger"
              onClick={onConfirmDrop}
              title="Confirm permanent drop"
              type="button"
            >
              <Check aria-hidden="true" size={13} />
            </button>
            <button
              aria-label={`Cancel drop stash ${stash.index}`}
              className="git-stash-action"
              onClick={onCancelDrop}
              title="Cancel"
              type="button"
            >
              <X aria-hidden="true" size={13} />
            </button>
          </>
        ) : (
          <>
            <button
              aria-label={`Apply stash ${stash.index}`}
              className="git-stash-action"
              onClick={onApply}
              title="Apply (keep stash)"
              type="button"
            >
              <RotateCcw aria-hidden="true" size={13} />
            </button>
            <button
              aria-label={`Pop stash ${stash.index}`}
              className="git-stash-action"
              onClick={onPop}
              title="Pop (apply and remove)"
              type="button"
            >
              <Undo2 aria-hidden="true" size={13} />
            </button>
            <button
              aria-label={`Drop stash ${stash.index}`}
              className="git-stash-action"
              onClick={onArmDrop}
              title="Drop (permanently discard)"
              type="button"
            >
              <Trash2 aria-hidden="true" size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface GitStashDiffProps {
  diff: string | null;
  isLoading: boolean;
  selectedIndex: number | null;
}

function GitStashDiff({ diff, isLoading, selectedIndex }: GitStashDiffProps) {
  if (isLoading) {
    return (
      <div className="file-history-diff-empty">
        <p>Loading diff</p>
      </div>
    );
  }

  if (selectedIndex === null) {
    return (
      <div className="file-history-diff-empty">
        <p>Select a stash to preview its changes.</p>
      </div>
    );
  }

  if (!diff || diff.trim().length === 0) {
    return (
      <div className="file-history-diff-empty">
        <p>No changes to preview for this stash.</p>
      </div>
    );
  }

  return (
    <pre className="git-stash-diff" aria-label="Stash diff">
      {diff.split("\n").map((line, index) => (
        <span className={diffLineClassName(line)} key={index}>
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function diffLineClassName(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "git-stash-diff-meta";
  }

  if (line.startsWith("@@")) {
    return "git-stash-diff-hunk";
  }

  if (line.startsWith("+")) {
    return "git-stash-diff-added";
  }

  if (line.startsWith("-")) {
    return "git-stash-diff-removed";
  }

  return "git-stash-diff-context";
}
