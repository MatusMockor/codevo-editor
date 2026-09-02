import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Folder, Search } from "lucide-react";
import { useAgentPopover } from "./agentPopover";
import { AgentProjectMenu } from "./AgentProjectMenu";
import {
  agentProjectRepositoryCountLabel,
  agentRailScopeState,
  type AgentProjectMenuCommand,
  type AgentProjectMenuTarget,
  type AgentRailScopeEntry,
} from "./agentSidebarPresentation";

export interface AgentProjectScopeMenuProps {
  readonly id: string;
  readonly label: string;
  readonly entries: ReadonlyArray<AgentRailScopeEntry>;
  readonly value: string;
  readonly disabled: boolean;
  onChange(value: string): void;
  onProjectCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
}

const UNKNOWN_SCOPE_LABEL = "Select…";
const ITEM_SELECTOR = "[data-scope-item]:not(:disabled)";
const MAX_PROJECT_FILTER_CHARS = 160;

export function AgentProjectScopeMenu({
  disabled,
  entries,
  id,
  label,
  onChange,
  onProjectCommand,
  value,
}: AgentProjectScopeMenuProps) {
  const popover = useAgentPopover("start", disabled);
  const listId = `${id}-list`;
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const selected = entries.find((entry) => entry.value === value) ?? null;
  const filteredEntries = useMemo(() => filterScopeEntries(entries, query), [entries, query]);

  const choose = (entry: AgentRailScopeEntry): void => {
    popover.hide(true);
    if (entry.value === value) return;
    onChange(entry.value);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    popover.show();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveScopeFocus(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      focusScopeEdge(event.currentTarget, event.key === "Home" ? "first" : "last");
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (event.target === searchRef.current && query !== "") {
        setQuery("");
        return;
      }
      popover.hide(true);
      return;
    }
    if (event.key !== "Tab") return;
    event.stopPropagation();
    popover.hide(false);
  };

  const { open } = popover;
  useLayoutEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    searchRef.current?.focus();
  }, [open]);

  return (
    <div
      className={`agent-picker agent-scope-menu${popover.open ? " agent-picker--open" : ""}`}
      data-placement={popover.open ? popover.placement : undefined}
      onBlur={popover.onBlur}
      ref={popover.rootRef}
    >
      <button
        aria-controls={popover.open ? listId : undefined}
        aria-expanded={popover.open}
        aria-haspopup="menu"
        aria-label={label}
        className="agent-picker__trigger"
        data-value={value}
        disabled={disabled}
        id={id}
        onClick={popover.toggle}
        onKeyDown={onTriggerKeyDown}
        ref={popover.triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="agent-picker__icon">
          <Folder size={13} />
        </span>
        <span className="agent-picker__value">{selected?.label ?? UNKNOWN_SCOPE_LABEL}</span>
        <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={12} />
      </button>

      {popover.open && (
        <div
          aria-label={label}
          className="agent-menu agent-scope-menu__menu"
          id={listId}
          onKeyDown={onMenuKeyDown}
          ref={popover.popoverRef}
          role="menu"
          style={popover.style}
        >
          <label className="agent-scope-menu__search">
            <Search aria-hidden="true" size={14} />
            <input
              aria-label="Search projects"
              autoComplete="off"
              maxLength={MAX_PROJECT_FILTER_CHARS}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search projects"
              ref={searchRef}
              type="search"
              value={query}
            />
          </label>
          {filteredEntries.map((entry) => (
            <div className="agent-scope-menu__row" key={entry.value} role="none">
              <button
                aria-checked={entry.value === value}
                className="agent-menu__item agent-scope-menu__item"
                data-scope-item="scope"
                data-value={entry.value}
                onClick={() => choose(entry)}
                role="menuitemradio"
                tabIndex={-1}
                type="button"
              >
                <span aria-hidden="true" className="agent-menu__icon">
                  <Folder size={13} />
                </span>
                <span className="agent-menu__text">
                  <span className="agent-menu__label">{entry.label}</span>
                </span>
                {repositoryCount(entry)}
                {stateLabel(entry)}
              </button>
              {entry.kind === "repository" && (
                <AgentProjectMenu
                  entry={entry}
                  onCommand={onProjectCommand}
                  scoped={entry.value === value}
                />
              )}
            </div>
          ))}
          {filteredEntries.length === 0 && (
            <p className="agent-menu__note agent-scope-menu__empty">No matching projects.</p>
          )}
        </div>
      )}
    </div>
  );
}

function repositoryCount(entry: AgentRailScopeEntry) {
  const count = agentProjectRepositoryCountLabel(entry);
  if (count === null) return null;
  return <span className="agent-scope-menu__count agent-num">{count}</span>;
}

function stateLabel(entry: AgentRailScopeEntry) {
  const state = agentRailScopeState(entry);
  if (state === null) return null;
  return <span className="agent-menu__detail">{state.label}</span>;
}

function moveScopeFocus(menu: HTMLElement, step: 1 | -1): void {
  const items = scopeItems(menu);
  if (items.length === 0) return;
  const current = items.findIndex((item) => item === document.activeElement);
  if (current === -1) {
    items[step === 1 ? 0 : items.length - 1]?.focus();
    return;
  }
  items[(current + step + items.length) % items.length]?.focus();
}

function focusScopeEdge(menu: HTMLElement | null, edge: "first" | "last"): void {
  if (menu === null) return;
  const items = scopeItems(menu);
  if (items.length === 0) return;
  const target = edge === "first" ? items[0] : items[items.length - 1];
  target?.focus();
}

function scopeItems(menu: HTMLElement): ReadonlyArray<HTMLButtonElement> {
  return [...menu.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR)];
}

function filterScopeEntries(
  entries: ReadonlyArray<AgentRailScopeEntry>,
  rawQuery: string,
): ReadonlyArray<AgentRailScopeEntry> {
  const query = rawQuery.slice(0, MAX_PROJECT_FILTER_CHARS).trim().toLocaleLowerCase();
  if (query === "") return entries;
  return entries.filter((entry) => {
    const searchable =
      entry.kind === "all"
        ? entry.label
        : `${entry.label}\n${entry.repositoryRoot}\n${entry.rootPath ?? ""}`;
    return searchable.toLocaleLowerCase().includes(query);
  });
}
