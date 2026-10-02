import { Check, ChevronDown, GitBranch, RefreshCw, Search, Server } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { RemoteProjectGit } from "../../application/useRemoteProjectGit";
import type { AgentWorktreeBase } from "../../domain/agentWorktreeBase";
import {
  MAX_REMOTE_BRANCH_QUERY_LENGTH,
  remoteBranchMatches,
  remoteOriginBase,
  remoteOriginBranchOf,
} from "../../domain/remoteDraftGitBase";
import { HEAD_WORKTREE_BASE } from "../../domain/agentWorktreeBase";
import type { RemoteGitBranchList } from "../../domain/remoteGitSync";
import { IconButton } from "../../ui/foundation/IconButton";
import { Popover } from "../../ui/foundation/Popover";
import {
  REMOTE_BRANCHES_TRUNCATED_NOTE,
  REMOTE_CHECKOUT_LABEL,
  remoteBaseLabel,
  remoteFetchedLabel,
} from "./remoteGitPresentation";
import "./pickers/agentPickers.css";
import "./remoteComposerGit.css";

export interface RemoteBaseBranchPickerProps {
  readonly git: RemoteProjectGit;
  readonly base: AgentWorktreeBase;
  readonly disabled: boolean;
  readonly nowMs: number;
  onChoose(base: AgentWorktreeBase): void;
}

interface Row {
  readonly key: string;
  readonly base: AgentWorktreeBase;
  readonly label: string;
  readonly detail: string | null;
  readonly checkout: boolean;
}

export function RemoteBaseBranchPicker({
  base,
  disabled,
  git,
  nowMs,
  onChoose,
}: RemoteBaseBranchPickerProps) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = git.branches.kind === "idle" ? null : git.branches.value;
  const selectedBranch = remoteOriginBranchOf(base);
  const rows = pickerRows(list, query);
  const label = remoteBaseLabel(base);
  const fetching = git.network.kind === "running";
  const close = (): void => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  const choose = (row: Row): void => {
    onChoose(row.base);
    close();
  };
  const selected = (row: Row): boolean =>
    row.checkout ? base.kind === "head" : remoteOriginBranchOf(row.base) === selectedBranch;
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + rows.length) % rows.length);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const row = rows[active];
    if (row !== undefined) choose(row);
  };
  const toggle = (): void => {
    if (open) {
      close();
      return;
    }
    setOpen(true);
    if (!fetching) void git.fetch();
  };

  return (
    <div className="agent-picker agent-branch-picker__anchor">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Start from: ${label}`}
        className="agent-picker__trigger agent-picker__trigger--ghost"
        disabled={disabled}
        onClick={toggle}
        ref={triggerRef}
        title="Choose where the new worktree starts"
        type="button"
      >
        <GitBranch aria-hidden="true" className="agent-picker__icon" size={14} />
        <span className="agent-picker__value agent-branch-picker__value">From {label}</span>
        <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={14} />
      </button>
      <Popover
        anchorRef={triggerRef}
        className="agent-branch-picker remote-git-picker"
        label="Start from"
        onClose={close}
        open={open}
        placement="top-end"
      >
        <label className="agent-branch-picker__search">
          <Search aria-hidden="true" size={14} />
          <input
            aria-activedescendant={rows.length === 0 ? undefined : `${listId}-${active}`}
            aria-controls={listId}
            aria-label="Search origin branches"
            autoFocus
            onChange={(event) => {
              setQuery(event.currentTarget.value.slice(0, MAX_REMOTE_BRANCH_QUERY_LENGTH));
              setActive(0);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Search origin branches…"
            spellCheck={false}
            type="search"
            value={query}
          />
        </label>
        <div className="remote-git-picker__status">
          <span aria-live="polite" className="remote-git-picker__fetched">
            {remoteFetchedLabel(list?.fetchedAt ?? null, git.network, nowMs)}
          </span>
          <IconButton
            disabled={fetching}
            icon={<RefreshCw size={12} />}
            label="Fetch from origin"
            onClick={() => void git.fetch()}
            size="xs"
          />
        </div>
        <div
          aria-label="Start from"
          className="agent-branch-picker__list"
          id={listId}
          role="listbox"
        >
          {rows.map((row, index) => (
            <div
              aria-selected={selected(row)}
              className="agent-picker__option"
              data-active={index === active ? "true" : undefined}
              id={`${listId}-${index}`}
              key={row.key}
              onClick={() => choose(row)}
              onMouseEnter={() => setActive(index)}
              role="option"
              tabIndex={-1}
            >
              {row.checkout ? (
                <Server aria-hidden="true" className="agent-picker__mark" size={14} />
              ) : (
                <GitBranch aria-hidden="true" className="agent-picker__mark" size={14} />
              )}
              <span
                className={row.checkout ? "remote-git-picker__label" : "agent-branch-picker__name"}
              >
                {row.label}
              </span>
              {row.detail === null ? null : (
                <span className="agent-picker__detail">{row.detail}</span>
              )}
              {selected(row) ? (
                <Check aria-hidden="true" className="agent-branch-picker__check" size={14} />
              ) : null}
            </div>
          ))}
          {list === null && git.branches.kind === "loading" ? (
            <p className="agent-branch-picker__note">Loading origin branches…</p>
          ) : null}
          {list !== null && rows.length === 1 && query.trim() !== "" ? (
            <p className="agent-branch-picker__note">No origin branch matches.</p>
          ) : null}
        </div>
        {list?.truncated === true ? (
          <p className="agent-branch-picker__note">{REMOTE_BRANCHES_TRUNCATED_NOTE}</p>
        ) : null}
        {git.branches.kind === "failed" ? (
          <p className="agent-branch-picker__note remote-git-picker__error" role="alert">
            {git.branches.message}
          </p>
        ) : null}
        {git.network.kind === "failed" && git.network.action === "fetch" ? (
          <p className="agent-branch-picker__note remote-git-picker__error" role="alert">
            {git.network.message}
          </p>
        ) : null}
      </Popover>
    </div>
  );
}

function pickerRows(list: RemoteGitBranchList | null, query: string): readonly Row[] {
  const checkout: Row = {
    key: "checkout-head",
    base: HEAD_WORKTREE_BASE,
    label: `Current ${REMOTE_CHECKOUT_LABEL.toLowerCase()}`,
    detail: list?.checkoutBranch ?? null,
    checkout: true,
  };
  if (list === null) return [checkout];
  const branches = remoteBranchMatches(list, query).flatMap((branch): Row[] => {
    const base = remoteOriginBase(branch.name);
    if (base === null) return [];
    return [
      {
        key: branch.name,
        base,
        label: branch.name,
        detail: branch.name === list.defaultBranch ? "default" : null,
        checkout: false,
      },
    ];
  });
  return [checkout, ...branches];
}
