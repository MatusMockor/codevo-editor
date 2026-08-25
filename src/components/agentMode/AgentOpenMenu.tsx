import { useId, useLayoutEffect, type KeyboardEvent } from "react";
import { ChevronDown, Copy, FolderOpen, PanelsTopLeft, SquareTerminal } from "lucide-react";
import type { AgentSurfaceKind } from "../../domain/agentWorkbenchLayout";
import { focusMenuItem, useAgentPopover } from "./agentPopover";
import { agentOpenBlockedReason, type AgentOpenTarget } from "./agentThreadHeaderPresentation";

export type { AgentOpenTarget } from "./agentThreadHeaderPresentation";

export interface AgentOpenMenuProps {
  readonly target: AgentOpenTarget | null;
  onOpenSurface(kind: AgentSurfaceKind): void;
  onRevealPath(path: string): Promise<void>;
  onCopyPath(): void;
  onRevealFailed(error: unknown): void;
}

export function AgentOpenMenu({
  onCopyPath,
  onOpenSurface,
  onRevealFailed,
  onRevealPath,
  target,
}: AgentOpenMenuProps) {
  const menuId = useId();
  const blockedReason = agentOpenBlockedReason(target);
  const popover = useAgentPopover("end", blockedReason !== null);

  const reveal = (): void => {
    if (target === null) return;
    void onRevealPath(target.path).catch(onRevealFailed);
  };

  const choose = (action: () => void): void => {
    popover.hide(true);
    action();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key !== "Tab") return;
    popover.hide(false);
  };

  const { open, popoverRef } = popover;
  useLayoutEffect(() => {
    if (!open) return;
    focusMenuItem(popoverRef.current, 0);
  }, [open, popoverRef]);

  return (
    <div
      className={`agent-split${popover.open ? " agent-split--open" : ""}`}
      data-placement={popover.open ? popover.placement : undefined}
      onBlur={popover.onBlur}
      ref={popover.rootRef}
    >
      <button
        aria-label="Open in Editor"
        className="agent-split__main"
        disabled={blockedReason !== null}
        onClick={() => onOpenSurface("files")}
        title={blockedReason ?? "Open the checkout in the editor"}
        type="button"
      >
        <FolderOpen aria-hidden="true" size={13} />
        <span className="agent-split__label">Open</span>
      </button>
      <button
        aria-controls={popover.open ? menuId : undefined}
        aria-expanded={popover.open}
        aria-haspopup="menu"
        aria-label="Open options"
        className="agent-split__chevron"
        disabled={blockedReason !== null}
        onClick={popover.toggle}
        ref={popover.triggerRef}
        title={blockedReason ?? "Open options"}
        type="button"
      >
        <ChevronDown aria-hidden="true" size={12} />
      </button>
      {popover.open && (
        <div
          aria-label="Open options"
          className="agent-menu"
          id={menuId}
          onKeyDown={onMenuKeyDown}
          ref={popover.popoverRef}
          role="menu"
          style={popover.style}
        >
          <MenuItem
            icon={<FolderOpen size={13} />}
            label="Reveal in Finder"
            onSelect={() => choose(reveal)}
          />
          <MenuItem
            icon={<SquareTerminal size={13} />}
            label="Open in Terminal"
            onSelect={() => choose(() => onOpenSurface("terminal"))}
          />
          <MenuItem
            icon={<PanelsTopLeft size={13} />}
            label="Open in Editor"
            onSelect={() => choose(() => onOpenSurface("files"))}
          />
          <div aria-hidden="true" className="agent-menu__separator" />
          <MenuItem
            icon={<Copy size={13} />}
            label="Copy path"
            onSelect={() => choose(onCopyPath)}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onSelect,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  onSelect(): void;
}) {
  return (
    <button
      className="agent-menu__item"
      onClick={onSelect}
      role="menuitem"
      tabIndex={-1}
      type="button"
    >
      <span aria-hidden="true" className="agent-menu__icon">
        {icon}
      </span>
      {label}
    </button>
  );
}
