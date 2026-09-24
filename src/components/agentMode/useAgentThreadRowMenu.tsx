import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { AgentThreadContextMenu, type AgentThreadMenuAnchor } from "./AgentThreadContextMenu";
import {
  agentThreadContextMenu,
  type AgentThreadContextMenuContext,
  type AgentThreadMenuAction,
} from "./agentThreadContextMenuModel";
import { AgentThreadDeleteDialog } from "./AgentThreadDeleteDialog";
import type { AgentThreadMenuCommand } from "./agentSidebarPresentation";
import { AgentThreadSnoozeDialog } from "./AgentThreadSnoozeDialog";

const KEYBOARD_ANCHOR_INSET_PX = 12;
const KEYBOARD_ANCHOR_LIFT_PX = 8;

type AgentThreadRowDialog = "delete" | "snooze" | null;

export interface AgentThreadRowMenuOptions {
  readonly title: string;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  context(): Omit<AgentThreadContextMenuContext, "now">;
  onCommand(command: AgentThreadMenuCommand): void;
  onRename(): void;
}

export interface AgentThreadRowMenu {
  readonly open: boolean;
  readonly overlays: ReactNode;
  openAtPointer(event: MouseEvent<HTMLElement>): void;
  openFromKeyboard(event: KeyboardEvent<HTMLElement>): boolean;
  openAt(anchor: AgentThreadMenuAnchor): void;
  reset(): void;
}

export function useAgentThreadRowMenu({
  context,
  onCommand,
  onRename,
  returnFocusRef,
  title,
}: AgentThreadRowMenuOptions): AgentThreadRowMenu {
  const [anchor, setAnchor] = useState<AgentThreadMenuAnchor | null>(null);
  const [dialog, setDialog] = useState<AgentThreadRowDialog>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    const open = anchor !== null;
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    returnFocusRef.current?.focus();
  }, [anchor, returnFocusRef]);

  const openAt = useCallback((next: AgentThreadMenuAnchor) => setAnchor(next), []);

  const openAtPointer = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setAnchor({ x: event.clientX, y: event.clientY });
  }, []);

  const openFromKeyboard = useCallback((event: KeyboardEvent<HTMLElement>): boolean => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return false;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setAnchor({
      x: rect.left + KEYBOARD_ANCHOR_INSET_PX,
      y: rect.top + rect.height - KEYBOARD_ANCHOR_LIFT_PX,
    });
    return true;
  }, []);

  const close = useCallback(() => setAnchor(null), []);
  const reset = useCallback(() => {
    setAnchor(null);
    setDialog(null);
  }, []);

  const act = (action: AgentThreadMenuAction): void => {
    switch (action.kind) {
      case "command":
        onCommand(action.command);
        return;
      case "rename":
        onRename();
        return;
      case "delete":
        setDialog("delete");
        return;
      case "snoozeCustom":
        setDialog("snooze");
        return;
      default:
        unsupportedAction(action);
    }
  };

  const overlays = (
    <>
      {anchor !== null && (
        <AgentThreadContextMenu
          anchor={anchor}
          nodes={agentThreadContextMenu({ ...context(), now: Date.now() })}
          onAction={act}
          onClose={close}
        />
      )}
      {dialog === "delete" && (
        <AgentThreadDeleteDialog
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            onCommand({ kind: "delete" });
          }}
          open
          returnFocusRef={returnFocusRef}
          title={title}
        />
      )}
      {dialog === "snooze" && (
        <AgentThreadSnoozeDialog
          onCancel={() => setDialog(null)}
          onSnooze={(until) => {
            setDialog(null);
            onCommand({ kind: "snooze", until });
          }}
          open
          returnFocusRef={returnFocusRef}
        />
      )}
    </>
  );

  return { open: anchor !== null, overlays, openAtPointer, openFromKeyboard, openAt, reset };
}

function unsupportedAction(action: never): never {
  throw new TypeError(`Unsupported thread menu action: ${JSON.stringify(action)}.`);
}
