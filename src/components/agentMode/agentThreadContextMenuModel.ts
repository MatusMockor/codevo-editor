import type { AgentThreadDropSection } from "../../domain/agentThreadOrganization";
import {
  ARCHIVE_RUNNING_REASON,
  DELETE_RUNNING_REASON,
  MARK_UNREAD_UNAVAILABLE_REASON,
  ORGANIZE_RUNNING_REASON,
  type AgentThreadMenuCommand,
} from "./agentSidebarPresentation";

export const SNOOZE_HOUR_MS = 3_600_000;
export const SNOOZE_DAY_MS = 86_400_000;

export type AgentThreadMenuAction =
  | { readonly kind: "command"; readonly command: AgentThreadMenuCommand }
  | { readonly kind: "rename" }
  | { readonly kind: "delete" }
  | { readonly kind: "snoozeCustom" };

export type AgentThreadMenuIconName =
  | "newThread"
  | "pin"
  | "unpin"
  | "settle"
  | "restore"
  | "snooze"
  | "wake"
  | "stop"
  | "rename"
  | "markUnread"
  | "move"
  | "moveUp"
  | "moveDown"
  | "copy"
  | "archive"
  | "unarchive"
  | "delete";

export type AgentThreadMenuTone = "default" | "danger";

export type AgentThreadMenuNode =
  | {
      readonly kind: "item";
      readonly id: string;
      readonly label: string;
      readonly icon: AgentThreadMenuIconName | null;
      readonly action: AgentThreadMenuAction;
      readonly disabledReason: string | null;
      readonly tone: AgentThreadMenuTone;
    }
  | {
      readonly kind: "choice";
      readonly id: string;
      readonly label: string;
      readonly checked: boolean;
      readonly action: AgentThreadMenuAction | null;
      readonly disabledReason: string | null;
    }
  | {
      readonly kind: "submenu";
      readonly id: string;
      readonly label: string;
      readonly icon: AgentThreadMenuIconName;
      readonly children: ReadonlyArray<AgentThreadMenuNode>;
    }
  | { readonly kind: "separator"; readonly id: string };

export interface AgentThreadContextMenuContext {
  readonly branch: string | null;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly running: boolean;
  readonly snoozed: boolean;
  readonly settled: boolean;
  readonly canMarkUnread: boolean;
  readonly moveUpId?: string;
  readonly moveDownId?: string;
  readonly now: number;
}

export function agentThreadContextMenu(
  context: AgentThreadContextMenuContext,
): ReadonlyArray<AgentThreadMenuNode> {
  const organizeReason = context.running ? ORGANIZE_RUNNING_REASON : null;
  const nodes: AgentThreadMenuNode[] = [
    item(
      "new",
      context.branch === null ? "New thread" : `New thread on ${context.branch}`,
      "newThread",
      command({ kind: "newThread" }),
    ),
    item(
      "pin",
      context.pinned ? "Unpin thread" : "Pin thread",
      context.pinned ? "unpin" : "pin",
      command({ kind: "togglePin" }),
    ),
  ];
  if (!context.archived) {
    nodes.push(
      item(
        "settle",
        context.settled ? "Restore to active" : "Settle thread",
        context.settled ? "restore" : "settle",
        command({ kind: context.settled ? "restore" : "settle" }),
        organizeReason,
      ),
      snoozeNode(context, organizeReason),
    );
  }
  if (context.running) nodes.push(item("stop", "Stop agent", "stop", command({ kind: "stop" })));
  nodes.push(
    separator("s1"),
    item("rename", "Rename thread", "rename", { kind: "rename" }),
    item(
      "unread",
      "Mark unread",
      "markUnread",
      command({ kind: "markUnread" }),
      context.canMarkUnread ? null : MARK_UNREAD_UNAVAILABLE_REASON,
    ),
  );
  if (!context.archived) nodes.push(moveNode(context));
  nodes.push(separator("s2"), copyNode(), separator("s3"));
  nodes.push(
    context.archived
      ? item("unarchive", "Unarchive thread", "unarchive", command({ kind: "unarchive" }))
      : item(
          "archive",
          "Archive thread",
          "archive",
          command({ kind: "archive" }),
          context.running ? ARCHIVE_RUNNING_REASON : null,
        ),
    item(
      "delete",
      "Delete",
      "delete",
      { kind: "delete" },
      context.running ? DELETE_RUNNING_REASON : null,
      "danger",
    ),
  );
  return nodes;
}

function snoozeNode(
  context: AgentThreadContextMenuContext,
  reason: string | null,
): AgentThreadMenuNode {
  if (context.snoozed) {
    return item("wake", "Wake now", "wake", command({ kind: "unsnooze" }), reason);
  }
  if (reason !== null) return item("snooze", "Snooze", "snooze", { kind: "snoozeCustom" }, reason);
  return {
    kind: "submenu",
    id: "snooze",
    label: "Snooze",
    icon: "snooze",
    children: [
      item(
        "snooze-hour",
        "For 1 hour",
        null,
        command({ kind: "snooze", until: context.now + SNOOZE_HOUR_MS }),
      ),
      item(
        "snooze-day",
        "For 1 day",
        null,
        command({ kind: "snooze", until: context.now + SNOOZE_DAY_MS }),
      ),
      separator("snooze-s"),
      item("snooze-custom", "Choose date and time…", null, { kind: "snoozeCustom" }),
    ],
  };
}

function moveNode(context: AgentThreadContextMenuContext): AgentThreadMenuNode {
  const current = currentSection(context);
  const section = (id: AgentThreadDropSection, label: string): AgentThreadMenuNode => ({
    kind: "choice",
    id: `move-${id}`,
    label,
    checked: current === id,
    action: current === id ? null : command({ kind: "moveToSection", section: id }),
    disabledReason: id === "settled" && context.running ? ORGANIZE_RUNNING_REASON : null,
  });
  const children: AgentThreadMenuNode[] = [
    section("pinned", "Pinned"),
    section("active", "Active"),
    section("settled", "Settled"),
  ];
  if (context.moveUpId !== undefined || context.moveDownId !== undefined) {
    children.push(separator("move-s1"));
  }
  if (context.moveUpId !== undefined) {
    children.push(
      item(
        "move-up",
        "Move up",
        "moveUp",
        command({ kind: "moveBefore", targetThreadId: context.moveUpId }),
      ),
    );
  }
  if (context.moveDownId !== undefined) {
    children.push(
      item(
        "move-down",
        "Move down",
        "moveDown",
        command({ kind: "moveAfter", targetThreadId: context.moveDownId }),
      ),
    );
  }
  return { kind: "submenu", id: "move", label: "Move to", icon: "move", children };
}

function currentSection(context: AgentThreadContextMenuContext): AgentThreadDropSection {
  if (context.settled) return "settled";
  if (context.pinned) return "pinned";
  return "active";
}

function copyNode(): AgentThreadMenuNode {
  return {
    kind: "submenu",
    id: "copy",
    label: "Copy",
    icon: "copy",
    children: [
      item("copy-path", "Copy path", null, command({ kind: "copy", detail: "path" })),
      item("copy-branch", "Copy branch", null, command({ kind: "copy", detail: "branch" })),
      item("copy-id", "Copy thread ID", null, command({ kind: "copy", detail: "threadId" })),
    ],
  };
}

function item(
  id: string,
  label: string,
  icon: AgentThreadMenuIconName | null,
  action: AgentThreadMenuAction,
  disabledReason: string | null = null,
  tone: AgentThreadMenuTone = "default",
): AgentThreadMenuNode {
  return { kind: "item", id, label, icon, action, disabledReason, tone };
}

function command(value: AgentThreadMenuCommand): AgentThreadMenuAction {
  return { kind: "command", command: value };
}

function separator(id: string): AgentThreadMenuNode {
  return { kind: "separator", id };
}
