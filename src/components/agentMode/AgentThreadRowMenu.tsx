import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useWorkbenchFramePortalTarget } from "../workbenchFramePortal";
import {
  agentThreadMenuEntries,
  type AgentThreadMenuCommand,
  type AgentThreadMenuEntry,
} from "./agentSidebarPresentation";

export interface AgentThreadRowMenuProps {
  readonly threadId: string;
  readonly branch: string | null;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly running: boolean;
  readonly position: { readonly x: number; readonly y: number };
  onCommand(command: AgentThreadMenuCommand): void;
  onRename(): void;
  onClose(): void;
}

const VIEWPORT_MARGIN = 8;

export function AgentThreadRowMenu(props: AgentThreadRowMenuProps) {
  const { onClose, onCommand, onRename, position, threadId } = props;
  const menuRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [placed, setPlaced] = useState(position);
  const portalTarget = useWorkbenchFramePortalTarget();
  const entries = agentThreadMenuEntries(props);

  useLayoutEffect(() => {
    const opener = document.activeElement;
    restoreFocusRef.current = opener instanceof HTMLElement ? opener : null;
    return () => {
      restoreOpenerFocus(restoreFocusRef.current, menuRef.current);
      restoreFocusRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;
    setPlaced({
      x: clamp(position.x, window.innerWidth - menu.offsetWidth - VIEWPORT_MARGIN),
      y: clamp(position.y, window.innerHeight - menu.offsetHeight - VIEWPORT_MARGIN),
    });
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [position]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("mousedown", onClose);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onClose);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    ];
    const current = items.findIndex((element) => element === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(current + step + items.length) % items.length]?.focus();
  };

  const run = (entry: Extract<AgentThreadMenuEntry, { kind: "item" }>): void => {
    onClose();
    if (entry.command === "rename") {
      onRename();
      return;
    }
    onCommand(entry.command);
  };

  return createPortal(
    <div
      aria-label={`Thread ${threadId} actions`}
      className="context-menu agent-row-menu"
      onKeyDown={onMenuKeyDown}
      onMouseDown={(event) => event.stopPropagation()}
      ref={menuRef}
      role="menu"
      style={{ left: placed.x, top: placed.y }}
    >
      {entries.map((entry) =>
        entry.kind === "separator" ? (
          <div aria-hidden="true" className="agent-row-menu__separator" key={entry.id} />
        ) : (
          <button
            className={itemClassName(entry.destructive)}
            disabled={entry.disabled}
            key={entry.id}
            onClick={() => run(entry)}
            role="menuitem"
            type="button"
          >
            {entry.label}
          </button>
        ),
      )}
    </div>,
    portalTarget,
  );
}

function restoreOpenerFocus(opener: HTMLElement | null, menu: HTMLDivElement | null): void {
  if (opener === null || !opener.isConnected) return;
  const active = document.activeElement;
  const focusLost = active === null || active === document.body || menu?.contains(active) === true;
  if (!focusLost) return;
  opener.focus();
}

function itemClassName(destructive: boolean): string {
  if (destructive) return "context-menu-item agent-row-menu__item agent-row-menu__item--danger";
  return "context-menu-item agent-row-menu__item";
}

function clamp(value: number, maximum: number): number {
  return Math.max(VIEWPORT_MARGIN, Math.min(value, Math.max(VIEWPORT_MARGIN, maximum)));
}
