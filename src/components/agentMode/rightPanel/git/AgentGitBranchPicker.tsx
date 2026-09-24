import { ChevronDown, GitBranch, GitBranchPlus, Search } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
  gitBranchPickerItems,
  validateNewBranchName,
  type GitBranchPickerItem,
} from "../../../../domain/gitBranchPicker";
import { Button } from "../../../../ui/foundation/Button";
import { Popover } from "../../../../ui/foundation/Popover";
import { Switch } from "../../../../ui/foundation/Switch";
import "./agentGitBranchPicker.css";

export interface AgentGitBranchPickerProps {
  readonly currentBranch: string | null;
  readonly defaultBranch: string | null;
  readonly localBranches: ReadonlyArray<string>;
  readonly remoteBranches: ReadonlyArray<string>;
  readonly worktreeBranches: ReadonlyArray<string>;
  readonly busy: boolean;
  readonly switchDisabledReason: string | null;
  onSwitch(item: GitBranchPickerItem): void;
  onCreate(name: string, options: { readonly worktree: boolean }): void;
}

export function AgentGitBranchPicker(props: AgentGitBranchPickerProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Branch: ${props.currentBranch ?? "Detached HEAD"}`}
        className="cv-rp-ctl"
        onClick={() => setOpen((current) => !current)}
        ref={anchorRef}
        title={props.currentBranch ?? "Detached HEAD"}
        type="button"
      >
        <GitBranch aria-hidden="true" size={14} />
        <span className="cv-bpick__current">{props.currentBranch ?? "Detached HEAD"}</span>
        <ChevronDown aria-hidden="true" size={12} />
      </button>
      <Popover
        anchorRef={anchorRef}
        className="cv-bpick"
        label="Switch branch"
        onClose={() => setOpen(false)}
        open={open}
      >
        <BranchPickerBody {...props} onDone={() => setOpen(false)} />
      </Popover>
    </>
  );
}

function BranchPickerBody(props: AgentGitBranchPickerProps & { onDone(): void }) {
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [worktreeChoice, setWorktreeChoice] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const items = gitBranchPickerItems(
    props.localBranches,
    props.remoteBranches,
    props.worktreeBranches,
    props.currentBranch,
    props.defaultBranch,
    query,
  );
  const worktreeOnly = props.switchDisabledReason !== null;
  const worktree = worktreeOnly || worktreeChoice;
  const switchBlocked = worktreeOnly || props.busy;
  const activeIndex = Math.min(active, Math.max(0, items.length - 1));
  const activeItem = items[activeIndex];
  const validation = name.trim().length === 0 ? null : validateNewBranchName(name);
  const canCreate = validation?.kind === "ok" && !props.busy;
  const switchTo = (item: GitBranchPickerItem): void => {
    if (switchBlocked) return;
    props.onSwitch(item);
    props.onDone();
  };
  const create = (): void => {
    if (!canCreate || validation?.kind !== "ok") return;
    props.onCreate(validation.name, { worktree });
    props.onDone();
  };
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    const next = nextActiveIndex(event.key, activeIndex, items.length);
    if (next !== null) {
      event.preventDefault();
      setActive(next);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (activeItem !== undefined) switchTo(activeItem);
  };
  const onNameKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    create();
  };
  const optionId = (index: number): string => `${listId}-option-${index}`;
  return (
    <>
      <label className="cv-bpick__q">
        <Search aria-hidden="true" size={14} />
        <input
          aria-activedescendant={activeItem === undefined ? undefined : optionId(activeIndex)}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded="true"
          aria-label="Search refs"
          autoFocus
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={onSearchKey}
          placeholder="Search refs…"
          role="combobox"
          type="text"
          value={query}
        />
      </label>
      {props.switchDisabledReason !== null && (
        <p className="cv-bpick__reason">{props.switchDisabledReason}</p>
      )}
      <div aria-label="Branches" className="cv-bpick__list" id={listId} role="listbox">
        {items.length === 0 && <p className="cv-bpick__empty">No matching branches.</p>}
        {items.map((item, index) => (
          <div
            aria-current={item.badge === "current" ? "true" : undefined}
            aria-disabled={switchBlocked}
            aria-selected={index === activeIndex}
            className={
              index === activeIndex ? "cv-bpick__item cv-bpick__item--active" : "cv-bpick__item"
            }
            id={optionId(index)}
            key={`${item.kind}:${item.name}`}
            onClick={() => switchTo(item)}
            onMouseMove={() => setActive(index)}
            role="option"
            title={props.switchDisabledReason ?? item.name}
          >
            <span
              className={
                item.badge === "current"
                  ? "cv-bpick__name cv-bpick__name--current"
                  : "cv-bpick__name"
              }
            >
              {item.name}
            </span>
            {item.badge !== null && <span className="cv-bpick__badge">{item.badge}</span>}
          </div>
        ))}
      </div>
      <div className="cv-bpick__new">
        <div className="cv-bpick__row">
          <label className="cv-bpick__field">
            <GitBranchPlus aria-hidden="true" size={14} />
            <input
              aria-label="New branch name"
              onChange={(event) => setName(event.currentTarget.value)}
              onKeyDown={onNameKey}
              placeholder="new-branch-name"
              type="text"
              value={name}
            />
          </label>
          <Button disabled={!canCreate} onClick={create} size="sm" variant="primary">
            Create
          </Button>
        </div>
        {validation?.kind === "invalid" && (
          <p className="cv-bpick__reason" role="alert">
            {validation.reason}
          </p>
        )}
        <div className="cv-bpick__from">
          from <b>{props.currentBranch ?? "HEAD"}</b>
        </div>
        <div className="cv-bpick__switch">
          <span>Check out in a new worktree</span>
          <Switch
            checked={worktree}
            disabled={worktreeOnly}
            label="Check out in a new worktree"
            onChange={setWorktreeChoice}
          />
        </div>
        {worktreeOnly && <p className="cv-bpick__reason">{WORKTREE_ONLY_NOTE}</p>}
      </div>
    </>
  );
}

const WORKTREE_ONLY_NOTE = "New branches from this thread open in a new worktree.";

function nextActiveIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return Math.min(count - 1, current + 1);
  if (key === "ArrowUp") return Math.max(0, current - 1);
  return null;
}
