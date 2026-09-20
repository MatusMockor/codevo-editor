import {
  agentActivityCategoryKey,
  foldAgentActivity,
  type AgentActivityCandidate,
  type AgentActivityCategory,
  type AgentActivityCategoryCount,
} from "../../domain/agentActivityFold";
import { isAgentSubagentToolItem, type AgentTurnItem } from "./agentModePresentation";

export type AgentActivityTool = Extract<AgentTurnItem, { kind: "tool" }>;
export type AgentActivityEntry =
  | { readonly kind: "item"; readonly key: string; readonly item: AgentTurnItem }
  | {
      readonly kind: "group";
      readonly key: string;
      readonly category: string;
      readonly label: string;
      readonly running: number;
      readonly completed: number;
      readonly items: ReadonlyArray<AgentActivityTool>;
    };

export const AGENT_ACTIVITY_PAGE_SIZE = 50;

function integration(name: string): string | null {
  const claude = /^mcp__([^\s]+?)__\S+$/.exec(name);
  if (claude?.[1]) return claude[1];
  const codex = /^([^/\s]+)\/[^/\s]+$/.exec(name);
  return codex?.[1] ?? null;
}

function toolCategory(item: AgentActivityTool): AgentActivityCategory | null {
  if (isAgentSubagentToolItem(item)) return null;
  if (item.status === "error" || item.status === "stopped") return null;
  const server = integration(item.name);
  if (server !== null) return { kind: "integration", server };
  switch (item.rowKind) {
    case "command":
      return { kind: "command" };
    case "edit":
      return { kind: "edit" };
    case "read":
      return { kind: "read" };
    case "search":
      return { kind: "search" };
    case "web":
      return { kind: "web" };
    case "agent":
    case "other":
      return null;
  }
}

function activityCandidate(item: AgentTurnItem): AgentActivityCandidate {
  if (item.kind !== "tool")
    return { stableId: null, category: null, running: false, settledOk: false };
  return {
    stableId: item.toolId === "" ? null : item.toolId,
    category: toolCategory(item),
    running: item.status === "running",
    settledOk: item.outcome !== null && !item.outcome.isError,
  };
}

function plural(count: number, singular: string, many = `${singular}s`): string {
  return count === 1 ? singular : many;
}

function categoryPhrase({ category, count }: AgentActivityCategoryCount): string {
  switch (category.kind) {
    case "command":
      return `${count} ${plural(count, "command")}`;
    case "edit":
      return `${count} file ${plural(count, "edit")}`;
    case "read":
      return `${count} file ${plural(count, "read")}`;
    case "search":
      return `${count} ${plural(count, "search", "searches")}`;
    case "web":
      return `${count} web ${plural(count, "request")}`;
    case "integration":
      return `${count} ${category.server} ${plural(count, "call")}`;
  }
}

const MAX_SUMMARIZED_CATEGORIES = 4;

function mixedLabel(categories: ReadonlyArray<AgentActivityCategoryCount>): string {
  const shown = categories.slice(0, MAX_SUMMARIZED_CATEGORIES).map(categoryPhrase);
  const hidden = categories.length - shown.length;
  if (hidden > 0) shown.push(`+${hidden} more`);
  return shown.join(" · ");
}

function dominantCategory(
  categories: ReadonlyArray<AgentActivityCategoryCount>,
): AgentActivityCategory {
  let dominant = categories[0];
  for (const candidate of categories) {
    if (candidate.count <= dominant.count) continue;
    dominant = candidate;
  }
  return dominant.category;
}

function groupLabel(
  categories: ReadonlyArray<AgentActivityCategoryCount>,
  running: number,
): string {
  const only = categories.length === 1 ? categories[0] : null;
  if (only === null) return mixedLabel(categories);
  if (only.category.kind === "command")
    return `${running > 0 ? "Running" : "Ran"} ${categoryPhrase(only)}`;
  if (only.category.kind === "integration")
    return `Used ${only.category.server} · ${only.count} ${plural(only.count, "call")}`;
  return categoryPhrase(only);
}

export function agentActivityEntries(
  items: ReadonlyArray<AgentTurnItem>,
): ReadonlyArray<AgentActivityEntry> {
  const entries: AgentActivityEntry[] = [];
  const groupKeys = new Set<string>();
  for (const entry of foldAgentActivity(items.map(activityCandidate))) {
    if (entry.kind === "item") {
      const item = items[entry.index];
      entries.push({ kind: "item", key: item.key, item });
      continue;
    }
    const members: AgentActivityTool[] = [];
    for (let index = entry.start; index < entry.end; index += 1) {
      const member = items[index];
      if (member.kind !== "tool") continue;
      members.push(member);
    }
    const stableKey = entry.stableId === null ? null : `group:${entry.stableId}`;
    const key = stableKey === null || groupKeys.has(stableKey) ? items[entry.start].key : stableKey;
    groupKeys.add(key);
    entries.push({
      kind: "group",
      key,
      category: agentActivityCategoryKey(dominantCategory(entry.categories)),
      label: groupLabel(entry.categories, entry.running),
      running: entry.running,
      completed: entry.completed,
      items: members,
    });
  }
  return entries;
}

export function agentActivityAttentionCount(items: ReadonlyArray<AgentTurnItem>): number {
  return items.filter(
    (item) =>
      item.kind === "error" ||
      (item.kind === "result" && item.isError) ||
      (item.kind === "tool" && (item.status === "error" || item.status === "stopped")),
  ).length;
}
