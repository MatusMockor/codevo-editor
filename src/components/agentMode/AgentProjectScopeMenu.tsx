import { useLayoutEffect, type KeyboardEvent } from "react";
import { ChevronDown, Folder } from "lucide-react";
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
  const selected = entries.find((entry) => entry.value === value) ?? null;

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
      popover.hide(true);
      return;
    }
    if (event.key !== "Tab") return;
    event.stopPropagation();
    popover.hide(false);
  };

  const { open, popoverRef } = popover;
  useLayoutEffect(() => {
    if (!open) return;
    const menu = popoverRef.current;
    const current = menu?.querySelector<HTMLButtonElement>(`[data-value="${cssEscape(value)}"]`);
    if (current !== null && current !== undefined) {
      current.focus();
      return;
    }
    focusScopeEdge(menu, "first");
  }, [open, popoverRef, value]);

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
          {entries.map((entry) => (
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

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/gu, "\\$&");
}
