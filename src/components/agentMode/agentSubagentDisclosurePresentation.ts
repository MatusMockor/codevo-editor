import type { AgentSubagentLifecycle } from "../../domain/agentSubagentLifecycle";
import type { AgentTurnEvent } from "../../domain/agentThread";
import { appServerGroups } from "./agentAppServerGroups";
import { agentTurnSubagentSummary, type AgentSubagentEntry } from "./agentModePresentation";

export interface AgentSubagentDisclosureEntry extends Omit<AgentSubagentEntry, "state"> {
  readonly state: AgentSubagentEntry["state"] | "interrupted" | "unknown";
  readonly detail?: string;
}

const MAX_DETAIL_CHARACTERS = 2_000;

export function agentSubagentDisclosureEntries(
  events: ReadonlyArray<AgentTurnEvent>,
  lifecycle?: AgentSubagentLifecycle,
  settlement: "running" | "settled" | "stopped" = "running",
): ReadonlyArray<AgentSubagentDisclosureEntry> {
  const groups = appServerGroups(events);
  const legacyEntries = groups.size > 0 ? [] : (agentTurnSubagentSummary(events)?.entries ?? []);
  const toolIds = new Set(
    lifecycle === undefined
      ? legacyEntries.map((entry) => entry.toolId)
      : lifecycle.entries.flatMap((entry) => (entry.toolId === undefined ? [] : [entry.toolId])),
  );
  const details = new Map<string, string>();
  for (const event of events) {
    if (
      event.kind === "toolResult" &&
      event.parentToolId === undefined &&
      toolIds.has(event.toolId)
    ) {
      details.set(event.toolId, boundedDetail(event.outputSummary));
    } else if (
      event.kind === "assistantText" &&
      event.parentToolId !== undefined &&
      toolIds.has(event.parentToolId)
    ) {
      details.set(event.parentToolId, boundedDetail(event.text));
    }
  }
  // App-server child identities are authoritative; spawn-tool IDs cannot safely be correlated.
  const entries: AgentSubagentDisclosureEntry[] = legacyEntries.map((entry) => ({
    ...entry,
    toolId: `tool:${entry.toolId}`,
    detail: details.get(entry.toolId),
  }));
  for (const group of groups.values()) {
    let detail: string | undefined;
    for (const event of group.events) {
      if (event.kind === "assistantText") detail = boundedDetail(event.text);
    }
    entries.push({
      toolId: `thread:${group.agentThreadId}`,
      name: group.path,
      description: "",
      state:
        group.state === "completed" || group.state === "failed" || group.state === "interrupted"
          ? group.state
          : group.state === "started" || group.state === "interacted"
            ? "running"
            : "unknown",
      ...(group.durationMs === null ? {} : { durationMs: group.durationMs }),
      ...(group.usage === null
        ? {}
        : {
            totalTokens:
              group.usage.appServerUsage?.last.totalTokens ??
              group.usage.inputTokens + group.usage.outputTokens,
          }),
      ...(detail === undefined ? {} : { detail }),
    });
  }
  if (lifecycle === undefined) return settleEntries(entries, settlement);
  const previews = new Map(entries.map((entry) => [entry.toolId, entry.detail]));
  return settleEntries(
    lifecycle.entries.map((entry) => {
      const toolId =
        entry.agentThreadId === undefined
          ? `tool:${entry.toolId ?? entry.id}`
          : `thread:${entry.agentThreadId}`;
      return {
        ...entry,
        toolId,
        detail:
          entry.agentThreadId === undefined
            ? details.get(entry.toolId ?? entry.id)
            : previews.get(toolId),
      };
    }),
    settlement,
  );
}

function settleEntries(
  entries: ReadonlyArray<AgentSubagentDisclosureEntry>,
  settlement: "running" | "settled" | "stopped",
): ReadonlyArray<AgentSubagentDisclosureEntry> {
  if (settlement === "running") return entries;
  return entries.map((entry) =>
    entry.state === "running"
      ? { ...entry, state: settlement === "stopped" ? "interrupted" : "unknown" }
      : entry,
  );
}

function boundedDetail(text: string): string {
  return text.length > MAX_DETAIL_CHARACTERS
    ? `${text.slice(0, MAX_DETAIL_CHARACTERS)}… (preview shortened)`
    : text;
}
