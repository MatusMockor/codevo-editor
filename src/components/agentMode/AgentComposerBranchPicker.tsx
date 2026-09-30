import { Check, ChevronDown, GitBranch, Plus, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  useComposerBranchPicker,
  type ComposerBranchItem,
  type ComposerBranchPicker,
} from "../../application/useComposerBranchPicker";
import { agentBranchRefLabel, type AgentWorktreeBase } from "../../domain/agentWorktreeBase";
import { Popover } from "../../ui/foundation/Popover";
import type { AgentWorkbenchChrome } from "./agentWorkbenchChrome";
import type { AgentComposerDrawerContext } from "./composer/AgentComposerFrame";
import { composerBranchItems } from "./composerBranchItems";
import "./pickers/agentPickers.css";

export interface AgentComposerBranchPickerProps {
  readonly branchCheckout: AgentWorkbenchChrome["branchCheckout"];
  readonly context: AgentComposerDrawerContext;
}

const MAX_QUERY_LENGTH = 256;
const unavailable = (): string => "Branch switching is unavailable in this view.";

export function AgentComposerBranchPicker({
  branchCheckout,
  context,
}: AgentComposerBranchPickerProps) {
  const repositoryRoot = context.repositoryRoot;
  const gateway = branchCheckout?.gateway ?? null;
  const hidden = context.locked || context.remote || repositoryRoot === null || gateway === null;
  const picker = useComposerBranchPicker({
    gateway,
    guard: branchCheckout?.guard ?? unavailable,
    target: repositoryRoot === null ? null : { ownerKey: repositoryRoot, repositoryRoot },
  });
  const load = picker.load;
  useEffect(() => {
    if (hidden) return;
    load();
  }, [gateway, hidden, load, repositoryRoot]);
  if (hidden) return null;
  return <AgentComposerBranchPickerControl context={context} picker={picker} />;
}

export function AgentComposerBranchLabel({
  branch,
  detail = null,
}: {
  readonly branch: string;
  readonly detail?: string | null;
}) {
  return (
    <span className="agent-composer__branch-label">
      <span aria-hidden="true" className="agent-composer__lock-glyph">
        <GitBranch size={12} />
      </span>
      <span className="agent-visually-hidden">Branch:</span>
      <span className="agent-composer__branch-name">{branch}</span>
      {detail === null ? null : <span className="agent-composer__branch-detail">· {detail}</span>}
    </span>
  );
}

export function AgentComposerBranchPickerControl({
  context,
  picker,
}: {
  readonly context: AgentComposerDrawerContext;
  readonly picker: ComposerBranchPicker;
}) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const worktreeMode = context.isolation === "worktree";
  const branches = picker.list.kind === "ready" ? picker.list.branches : null;
  const items = branches === null ? [] : composerBranchItems(branches, query);
  const trimmed = query.trim();
  const offerCreate =
    !worktreeMode &&
    branches !== null &&
    trimmed !== "" &&
    !items.some((item) => item.name === trimmed);
  const baseRef = context.worktreeBase.kind === "ref" ? context.worktreeBase.ref : null;
  const label = triggerLabel(
    worktreeMode,
    baseRef === null ? null : agentBranchRefLabel(baseRef),
    picker,
  );
  const rowCount = items.length + (offerCreate ? 1 : 0);
  const selected = (item: ComposerBranchItem): boolean => {
    if (!worktreeMode || baseRef === null) return item.current;
    return item.ref === baseRef;
  };
  const close = (): void => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  const choose = async (item: ComposerBranchItem): Promise<void> => {
    if (worktreeMode) {
      context.onWorktreeBaseChange(worktreeBaseFor(item));
      close();
      return;
    }
    if (await picker.switchTo(item)) close();
  };
  const createBranch = async (): Promise<void> => {
    if (await picker.create(trimmed)) close();
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rowCount === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + rowCount) % rowCount);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const item = items[active];
    if (item !== undefined) {
      void choose(item);
      return;
    }
    if (offerCreate) void createBranch();
  };

  return (
    <div className="agent-picker agent-branch-picker__anchor">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Branch: ${label}`}
        className="agent-picker__trigger agent-picker__trigger--ghost"
        disabled={context.disabled || picker.pending}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          picker.load();
          setOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        <GitBranch aria-hidden="true" className="agent-picker__icon" size={14} />
        <span className="agent-picker__value agent-branch-picker__value">{label}</span>
        <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={14} />
      </button>
      <Popover
        anchorRef={triggerRef}
        className="agent-branch-picker"
        label="Branch"
        onClose={close}
        open={open}
        placement="top-end"
      >
        <label className="agent-branch-picker__search">
          <Search aria-hidden="true" size={14} />
          <input
            aria-activedescendant={rowCount === 0 ? undefined : `${listId}-${active}`}
            aria-controls={listId}
            aria-label="Search refs"
            autoFocus
            onChange={(event) => {
              setQuery(event.currentTarget.value.slice(0, MAX_QUERY_LENGTH));
              setActive(0);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder={worktreeMode ? "Start the worktree from…" : "Search refs…"}
            spellCheck={false}
            type="search"
            value={query}
          />
        </label>
        <div aria-label="Branches" className="agent-branch-picker__list" id={listId} role="listbox">
          {picker.list.kind === "loading" && branches === null ? (
            <p className="agent-branch-picker__note">Loading branches…</p>
          ) : null}
          {picker.list.kind === "error" ? (
            <p className="agent-branch-picker__note" role="alert">
              {picker.list.message}
            </p>
          ) : null}
          {items.map((item, index) => (
            <div
              aria-selected={selected(item)}
              className="agent-picker__option"
              data-active={index === active ? "true" : undefined}
              id={`${listId}-${index}`}
              key={item.ref}
              onClick={() => void choose(item)}
              onMouseEnter={() => setActive(index)}
              role="option"
              tabIndex={-1}
            >
              <GitBranch aria-hidden="true" className="agent-picker__mark" size={14} />
              <span className="agent-branch-picker__name">{item.name}</span>
              {item.kind === "remote" ? <span className="agent-picker__detail">remote</span> : null}
              {selected(item) ? (
                <Check aria-hidden="true" className="agent-branch-picker__check" size={14} />
              ) : null}
            </div>
          ))}
          {offerCreate ? (
            <div
              aria-selected={false}
              className="agent-picker__option"
              data-active={active === items.length ? "true" : undefined}
              id={`${listId}-${items.length}`}
              onClick={() => void createBranch()}
              onMouseEnter={() => setActive(items.length)}
              role="option"
              tabIndex={-1}
            >
              <Plus aria-hidden="true" className="agent-picker__mark" size={14} />
              <span>
                Create branch <code className="agent-branch-picker__name">{trimmed}</code>
              </span>
            </div>
          ) : null}
        </div>
        {picker.error === null ? null : (
          <p className="agent-branch-picker__note" role="alert">
            {picker.error}
          </p>
        )}
      </Popover>
    </div>
  );
}

function worktreeBaseFor(item: ComposerBranchItem): AgentWorktreeBase {
  if (item.current) return { kind: "head" };
  return { kind: "ref", ref: item.ref };
}

function triggerLabel(
  worktreeMode: boolean,
  baseLabel: string | null,
  picker: ComposerBranchPicker,
): string {
  const current = picker.list.kind === "ready" ? picker.list.branches.current : null;
  if (worktreeMode) return `From ${baseLabel ?? current ?? "HEAD"}`;
  if (picker.list.kind !== "ready") return "Branch";
  return current ?? "Detached HEAD";
}
