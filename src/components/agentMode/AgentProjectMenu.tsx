import { useId, useLayoutEffect, type KeyboardEvent, type ReactNode } from "react";
import { Copy, Filter, FolderOpen, Settings, ShieldCheck, Unplug } from "lucide-react";
import { focusMenuItem, useAgentPopover } from "./agentPopover";
import {
  agentProjectMenuEntries,
  agentProjectMenuTarget,
  type AgentProjectMenuCommand,
  type AgentProjectMenuTarget,
  type AgentRailProjectScopeEntry,
} from "./agentSidebarPresentation";

export interface AgentProjectMenuProps {
  readonly entry: AgentRailProjectScopeEntry;
  readonly scoped: boolean;
  onCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
}

export function AgentProjectMenu({ entry, onCommand, scoped }: AgentProjectMenuProps) {
  const menuId = useId();
  const popover = useAgentPopover("end");
  const entries = agentProjectMenuEntries(entry, scoped);
  const label = `Project actions for ${entry.label}`;

  const choose = (command: AgentProjectMenuCommand): void => {
    popover.hide(true);
    onCommand(agentProjectMenuTarget(entry), command);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      focusMenuItem(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
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
    focusMenuItem(popoverRef.current, 0);
  }, [open, popoverRef]);

  return (
    <div
      className="agent-scope-menu__actions"
      onBlur={popover.onBlur}
      ref={popover.rootRef}
      role="none"
    >
      <button
        aria-controls={popover.open ? menuId : undefined}
        aria-expanded={popover.open}
        aria-haspopup="menu"
        aria-label={label}
        className="agent-scope-menu__gear"
        data-open={popover.open ? "true" : undefined}
        data-scope-item="gear"
        onClick={popover.toggle}
        ref={popover.triggerRef}
        role="menuitem"
        tabIndex={-1}
        title={label}
        type="button"
      >
        <Settings aria-hidden="true" size={13} />
      </button>
      {popover.open && (
        <div
          aria-label={label}
          className="agent-menu"
          id={menuId}
          onKeyDown={onMenuKeyDown}
          ref={popover.popoverRef}
          role="menu"
          style={popover.style}
        >
          {entries.map((item) => (
            <button
              className="agent-menu__item"
              disabled={item.disabled}
              key={item.id}
              onClick={() => choose(item.command)}
              role="menuitem"
              tabIndex={-1}
              type="button"
            >
              <span aria-hidden="true" className="agent-menu__icon">
                {commandIcon(item.command)}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function commandIcon(command: AgentProjectMenuCommand): ReactNode {
  switch (command) {
    case "trust":
      return <ShieldCheck size={13} />;
    case "release":
      return <Unplug size={13} />;
    case "reveal":
      return <FolderOpen size={13} />;
    case "copyPath":
      return <Copy size={13} />;
    case "filterToProject":
      return <Filter size={13} />;
    default:
      return unsupportedProjectMenuCommand(command);
  }
}

function unsupportedProjectMenuCommand(command: never): never {
  throw new TypeError(`Unsupported agent project menu command: ${String(command)}.`);
}
