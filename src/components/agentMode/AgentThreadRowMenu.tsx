import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  FolderClosed,
  GitBranch,
  Hash,
  MailOpen,
  MessageSquarePlus,
  Pencil,
  Pin,
  PinOff,
  Square,
  Trash2,
} from "lucide-react";
import { useWorkbenchFramePortalTarget } from "../workbenchFramePortal";
import {
  agentThreadMenuEntries,
  type AgentThreadMenuCommand,
  type AgentThreadMenuEntry,
  type AgentThreadMenuIcon,
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
  const [armed, setArmed] = useState<string | null>(null);
  const portalTarget = useWorkbenchFramePortalTarget();
  const entries = agentThreadMenuEntries(props);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const opener = document.activeElement;
    restoreFocusRef.current = opener instanceof HTMLElement ? opener : null;
    return () => {
      restoreOpenerFocus(restoreFocusRef.current, menu);
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

  useLayoutEffect(() => {
    if (armed === null) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[data-armed="true"]')?.focus();
  }, [armed]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (armed !== null) {
        setArmed(null);
        return;
      }
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
  }, [armed, onClose]);

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
    if (entry.destructive && armed !== entry.id) {
      setArmed(entry.id);
      return;
    }
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
      className="agent-menu agent-row-menu"
      onKeyDown={onMenuKeyDown}
      onMouseDown={(event) => event.stopPropagation()}
      ref={menuRef}
      role="menu"
      style={{ left: placed.x, top: placed.y }}
    >
      {entries.map((entry) =>
        entry.kind === "separator" ? (
          <div aria-hidden="true" className="agent-menu__separator" key={entry.id} />
        ) : (
          <button
            className={itemClassName(entry.destructive, armed === entry.id)}
            data-armed={armed === entry.id ? "true" : undefined}
            disabled={entry.disabled}
            key={entry.id}
            onClick={() => run(entry)}
            role="menuitem"
            type="button"
          >
            <span aria-hidden="true" className="agent-menu__icon">
              <MenuIcon icon={entry.icon} />
            </span>
            {armed === entry.id ? `Confirm ${entry.label.toLowerCase()}` : entry.label}
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

function MenuIcon({ icon }: { readonly icon: AgentThreadMenuIcon }) {
  const size = 14;
  if (icon === "newThread") return <MessageSquarePlus size={size} />;
  if (icon === "pin") return <Pin size={size} />;
  if (icon === "unpin") return <PinOff size={size} />;
  if (icon === "rename") return <Pencil size={size} />;
  if (icon === "markUnread") return <MailOpen size={size} />;
  if (icon === "copyPath") return <FolderClosed size={size} />;
  if (icon === "copyBranch") return <GitBranch size={size} />;
  if (icon === "copyThreadId") return <Hash size={size} />;
  if (icon === "stop") return <Square size={size} />;
  if (icon === "archive") return <Archive size={size} />;
  if (icon === "delete") return <Trash2 size={size} />;
  return unsupportedMenuIcon(icon);
}

function unsupportedMenuIcon(icon: never): never {
  throw new Error(`Unsupported agent thread menu icon: ${String(icon)}`);
}

function itemClassName(destructive: boolean, armed: boolean): string {
  if (armed) {
    return "agent-menu__item agent-row-menu__item agent-menu__item--danger agent-menu__item--armed";
  }
  if (destructive) return "agent-menu__item agent-row-menu__item agent-menu__item--danger";
  return "agent-menu__item agent-row-menu__item";
}

function clamp(value: number, maximum: number): number {
  return Math.max(VIEWPORT_MARGIN, Math.min(value, Math.max(VIEWPORT_MARGIN, maximum)));
}
