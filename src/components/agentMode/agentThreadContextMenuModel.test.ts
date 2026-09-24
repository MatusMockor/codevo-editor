import { describe, expect, it } from "vitest";
import {
  agentThreadContextMenu,
  type AgentThreadContextMenuContext,
  type AgentThreadMenuNode,
} from "./agentThreadContextMenuModel";

const base: AgentThreadContextMenuContext = {
  branch: "fix/payments-timeout",
  pinned: false,
  archived: false,
  running: false,
  snoozed: false,
  settled: false,
  canMarkUnread: true,
  now: 1_000,
};

function labels(nodes: ReadonlyArray<AgentThreadMenuNode>): ReadonlyArray<string> {
  return nodes.map((node) => (node.kind === "separator" ? "—" : node.label));
}

function submenu(
  nodes: ReadonlyArray<AgentThreadMenuNode>,
  label: string,
): ReadonlyArray<AgentThreadMenuNode> {
  const found = nodes.find((node) => node.kind === "submenu" && node.label === label);
  expect(found?.kind).toBe("submenu");
  return found?.kind === "submenu" ? found.children : [];
}

describe("thread context menu", () => {
  it("matches the mockup order", () => {
    expect(labels(agentThreadContextMenu(base))).toEqual([
      "New thread on fix/payments-timeout",
      "Pin thread",
      "Settle thread",
      "Snooze",
      "—",
      "Rename thread",
      "Mark unread",
      "Move to",
      "—",
      "Copy",
      "—",
      "Archive thread",
      "Delete",
    ]);
  });

  it("offers only the Pinned, Active and Settled sections plus reorder under Move to", () => {
    const move = submenu(
      agentThreadContextMenu({ ...base, moveUpId: "up", moveDownId: "down" }),
      "Move to",
    );
    expect(labels(move)).toEqual(["Pinned", "Active", "Settled", "—", "Move up", "Move down"]);
    expect(move.find((node) => node.kind === "choice" && node.label === "Active")).toMatchObject({
      checked: true,
      action: null,
    });
    expect(move.find((node) => node.kind === "choice" && node.label === "Pinned")).toMatchObject({
      checked: false,
      action: { kind: "command", command: { kind: "moveToSection", section: "pinned" } },
    });
    expect(
      move.find((node) => node.kind !== "separator" && node.label === "Move up"),
    ).toMatchObject({
      action: { kind: "command", command: { kind: "moveBefore", targetThreadId: "up" } },
    });
    expect(labels(submenu(agentThreadContextMenu(base), "Move to"))).toEqual([
      "Pinned",
      "Active",
      "Settled",
    ]);
    expect(labels(submenu(agentThreadContextMenu({ ...base, pinned: true }), "Move to"))).toEqual([
      "Pinned",
      "Active",
      "Settled",
    ]);
    const settledMove = submenu(agentThreadContextMenu({ ...base, settled: true }), "Move to");
    expect(
      settledMove.find((node) => node.kind !== "separator" && node.label === "Settled"),
    ).toMatchObject({ checked: true });
  });

  it("disables organise, archive and delete while running and adds Stop agent", () => {
    const nodes = agentThreadContextMenu({ ...base, running: true });
    expect(labels(nodes)).toContain("Stop agent");
    expect(
      nodes.find((node) => node.kind === "item" && node.label === "Settle thread"),
    ).toMatchObject({ disabledReason: "Available after the agent stops." });
    const snooze = nodes.find((node) => node.kind !== "separator" && node.label === "Snooze");
    expect(snooze?.kind).toBe("item");
    expect(nodes.find((node) => node.kind === "item" && node.label === "Delete")).toMatchObject({
      tone: "danger",
      disabledReason: "Stop the agent before deleting this thread.",
    });
    expect(
      nodes.find((node) => node.kind === "item" && node.label === "Archive thread"),
    ).toMatchObject({ disabledReason: "Stop the agent before archiving this thread." });
    const move = submenu(nodes, "Move to");
    expect(
      move.find((node) => node.kind !== "separator" && node.label === "Settled"),
    ).toMatchObject({
      disabledReason: "Available after the agent stops.",
    });
  });

  it("uses Wake now for a snoozed thread and Unarchive for an archived one", () => {
    expect(labels(agentThreadContextMenu({ ...base, snoozed: true }))).toContain("Wake now");
    const archived = labels(agentThreadContextMenu({ ...base, archived: true }));
    expect(archived).toContain("Unarchive thread");
    expect(archived).not.toContain("Move to");
    expect(archived).not.toContain("Snooze");
    expect(labels(agentThreadContextMenu({ ...base, pinned: true }))).toContain("Unpin thread");
    expect(labels(agentThreadContextMenu({ ...base, branch: null }))[0]).toBe("New thread");
  });

  it("explains why Mark unread is unavailable", () => {
    const nodes = agentThreadContextMenu({ ...base, canMarkUnread: false });
    expect(
      nodes.find((node) => node.kind === "item" && node.label === "Mark unread"),
    ).toMatchObject({ disabledReason: "Available after a run finishes." });
  });

  it("puts one-hour, one-day and custom snooze in the Snooze submenu", () => {
    const snooze = submenu(agentThreadContextMenu(base), "Snooze");
    expect(labels(snooze)).toEqual(["For 1 hour", "For 1 day", "—", "Choose date and time…"]);
    expect(snooze[0]).toMatchObject({
      action: { kind: "command", command: { kind: "snooze", until: 3_601_000 } },
    });
    expect(snooze[1]).toMatchObject({
      action: { kind: "command", command: { kind: "snooze", until: 86_401_000 } },
    });
    expect(snooze[3]).toMatchObject({ action: { kind: "snoozeCustom" } });
  });

  it("groups the copy details", () => {
    expect(labels(submenu(agentThreadContextMenu(base), "Copy"))).toEqual([
      "Copy path",
      "Copy branch",
      "Copy thread ID",
    ]);
  });
});
