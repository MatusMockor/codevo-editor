import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Clock,
  Copy,
  Mail,
  MoveRight,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Square,
  SquareCheck,
  SquarePen,
  Sun,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem, MenuSeparator } from "../../ui/foundation/MenuItem";
import { Submenu } from "../../ui/foundation/Submenu";
import type {
  AgentThreadMenuAction,
  AgentThreadMenuIconName,
  AgentThreadMenuNode,
} from "./agentThreadContextMenuModel";

const ICONS: Readonly<Record<AgentThreadMenuIconName, LucideIcon>> = {
  newThread: SquarePen,
  pin: Pin,
  unpin: PinOff,
  settle: SquareCheck,
  restore: RotateCcw,
  snooze: Clock,
  wake: Sun,
  stop: Square,
  rename: Pencil,
  markUnread: Mail,
  move: MoveRight,
  moveUp: ArrowUp,
  moveDown: ArrowDown,
  copy: Copy,
  archive: Archive,
  unarchive: ArchiveRestore,
  delete: Trash2,
};

const ICON_SIZE = 14;

export interface AgentThreadMenuAnchor {
  readonly x: number;
  readonly y: number;
}

export interface AgentThreadContextMenuProps {
  readonly anchor: AgentThreadMenuAnchor;
  readonly nodes: ReadonlyArray<AgentThreadMenuNode>;
  onAction(action: AgentThreadMenuAction): void;
  onClose(): void;
}

export function AgentThreadContextMenu({
  anchor,
  nodes,
  onAction,
  onClose,
}: AgentThreadContextMenuProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  return (
    <>
      {createPortal(
        <span
          aria-hidden="true"
          ref={anchorRef}
          style={{ position: "fixed", left: anchor.x, top: anchor.y, width: 0, height: 0 }}
        />,
        document.body,
      )}
      <Menu
        anchorRef={anchorRef}
        label="Thread actions"
        onClose={onClose}
        open
        placement="bottom-start"
      >
        {renderNodes(nodes, onAction)}
      </Menu>
    </>
  );
}

function renderNodes(
  nodes: ReadonlyArray<AgentThreadMenuNode>,
  onAction: (action: AgentThreadMenuAction) => void,
): ReactNode {
  return nodes.map((node) => {
    switch (node.kind) {
      case "separator":
        return <MenuSeparator key={node.id} />;
      case "submenu":
        return (
          <Submenu icon={menuIcon(node.icon)} key={node.id} label={node.label}>
            {renderNodes(node.children, onAction)}
          </Submenu>
        );
      case "choice":
        return (
          <MenuItem
            checked={node.checked}
            description={node.disabledReason ?? undefined}
            disabled={node.disabledReason !== null || node.action === null}
            key={node.id}
            onSelect={() => {
              if (node.action !== null) onAction(node.action);
            }}
          >
            {node.label}
          </MenuItem>
        );
      case "item":
        return (
          <MenuItem
            description={node.disabledReason ?? undefined}
            disabled={node.disabledReason !== null}
            icon={node.icon === null ? undefined : menuIcon(node.icon)}
            key={node.id}
            onSelect={() => onAction(node.action)}
            tone={node.tone}
          >
            {node.label}
          </MenuItem>
        );
      default:
        return unsupportedNode(node);
    }
  });
}

function menuIcon(name: AgentThreadMenuIconName): ReactNode {
  const Icon = ICONS[name];
  return <Icon size={ICON_SIZE} />;
}

function unsupportedNode(node: never): never {
  throw new TypeError(`Unsupported thread menu node: ${JSON.stringify(node)}.`);
}
