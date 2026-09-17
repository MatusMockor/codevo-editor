import { isAgentSubagentToolItem, type AgentTurnItem } from "./agentModePresentation";

export type AgentActivityTool = Extract<AgentTurnItem, { kind: "tool" }>;
export type AgentActivityEntry =
  | { readonly kind: "item"; readonly key: string; readonly item: AgentTurnItem }
  | {
      readonly kind: "group";
      readonly key: string;
      readonly category: string;
      readonly label: string;
      readonly items: ReadonlyArray<AgentActivityTool>;
    };

export const AGENT_ACTIVITY_PAGE_SIZE = 50;

function integration(name: string): string | null {
  const claude = /^mcp__([^\s]+?)__\S+$/.exec(name);
  if (claude?.[1]) return claude[1];
  const codex = /^([^/\s]+)\/[^/\s]+$/.exec(name);
  return codex?.[1] ?? null;
}

function category(item: AgentTurnItem): string | null {
  if (item.kind !== "tool" || isAgentSubagentToolItem(item)) return null;
  if (item.status === "error" || item.status === "stopped") return null;
  const server = integration(item.name);
  if (server !== null) return `mcp:${server}`;
  switch (item.rowKind) {
    case "command":
    case "edit":
    case "read":
    case "search":
    case "web":
      return item.rowKind;
    case "agent":
    case "other":
      return null;
  }
}

function groupLabel(kind: string, items: ReadonlyArray<AgentActivityTool>): string {
  const count = items.length;
  const running = items.some((item) => item.status === "running");
  switch (kind) {
    case "command":
      return `${running ? "Running" : "Ran"} ${count} commands`;
    case "edit":
      return `${count} file edits`;
    case "read":
      return `${count} file reads`;
    case "search":
      return `${count} searches`;
    case "web":
      return `${count} web requests`;
    default:
      return `Used ${kind.slice(4)} · ${count} calls`;
  }
}

/** Group only adjacent compatible activities, never across conversational boundaries. */
export function agentActivityEntries(
  items: ReadonlyArray<AgentTurnItem>,
): ReadonlyArray<AgentActivityEntry> {
  const result: AgentActivityEntry[] = [];
  let pending: AgentActivityTool[] = [];
  let pendingCategory: string | null = null;
  let pendingParent: string | undefined;
  function flush() {
    const first = pending[0];
    if (first === undefined) return;
    if (pending.length === 1) result.push({ kind: "item", key: first.key, item: first });
    else
      result.push({
        kind: "group",
        key: first.key,
        category: pendingCategory ?? "",
        label: groupLabel(pendingCategory ?? "", pending),
        items: pending,
      });
    pending = [];
  }
  for (const item of items) {
    const next = category(item);
    const parent = item.kind === "tool" ? item.parentToolId : undefined;
    if (next === null || next !== pendingCategory || parent !== pendingParent) flush();
    pendingParent = parent;
    pendingCategory = next;
    if (next !== null && item.kind === "tool") pending.push(item);
    else result.push({ kind: "item", key: item.key, item });
  }
  flush();
  return result;
}

export function agentActivityAttentionCount(items: ReadonlyArray<AgentTurnItem>): number {
  return items.filter(
    (item) =>
      item.kind === "error" ||
      (item.kind === "result" && item.isError) ||
      (item.kind === "tool" && (item.status === "error" || item.status === "stopped")),
  ).length;
}
