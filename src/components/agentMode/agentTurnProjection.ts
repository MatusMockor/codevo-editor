import {
  appServerGroupId,
  appServerGroups,
  type AgentAppServerGroup,
} from "./agentAppServerGroups";
import { agentTurnItemKey } from "./agentTurnItemKeys";
import type { AgentAttachment } from "../../domain/agentAttachment";
import type { AgentTaskOutputStream } from "../../domain/agentTask";
import type { AgentTurn, AgentTurnEvent, AgentTurnStatus } from "../../domain/agentThread";
import {
  toolRowKind,
  toolRowLabel,
  type AgentToolRowKind,
  type AgentToolRowStatus,
} from "../../domain/agentToolRowPresentation";

export const MAX_RENDERED_EVENTS_PER_TURN = 200;

export interface AgentToolOutcome {
  readonly outputSummary: string;
  readonly isError: boolean;
}

export type AgentTurnItem =
  | { readonly kind: "subagentGroup"; readonly key: string; readonly group: AgentAppServerGroup }
  | { readonly kind: "queued"; readonly key: string }
  | {
      readonly kind: "assistantText";
      readonly key: string;
      readonly text: string;
      readonly paragraphs: ReadonlyArray<string>;
    }
  | { readonly kind: "reasoning"; readonly key: string; readonly text: string }
  | {
      readonly kind: "userMessage";
      readonly key: string;
      readonly text: string;
      readonly attachments?: ReadonlyArray<AgentAttachment>;
    }
  | {
      readonly kind: "tool";
      readonly key: string;
      readonly toolId: string;
      readonly name: string;
      readonly inputSummary: string;
      readonly outcome: AgentToolOutcome | null;
      readonly parentToolId?: string;
      readonly rowKind: AgentToolRowKind;
      readonly status: AgentToolRowStatus;
      readonly label: string;
      readonly argument: string | null;
      readonly command: string | null;
      readonly output: string | null;
    }
  | {
      readonly kind: "result";
      readonly key: string;
      readonly text: string;
      readonly isError: boolean;
    }
  | {
      readonly kind: "contextCompaction";
      readonly key: string;
      readonly beforeTokens: number | null;
      readonly afterTokens: number | null;
    }
  | { readonly kind: "error"; readonly key: string; readonly message: string };

export interface AgentTurnWorkFold {
  readonly workItems: ReadonlyArray<AgentTurnItem>;
  readonly visibleItems: ReadonlyArray<AgentTurnItem>;
  readonly summary: string;
}

export interface AgentRawLine {
  readonly key: string;
  readonly stream: AgentTaskOutputStream;
  readonly raw: string;
}

export interface AgentTurnProjection {
  readonly items: ReadonlyArray<AgentTurnItem>;
  readonly rawLines: ReadonlyArray<AgentRawLine>;
  readonly hiddenCount: number;
}

export type AgentTurnLiveActivity =
  { readonly kind: "working" } | { readonly kind: "tool"; readonly toolId: string };

export type AgentTurnSettlement = "running" | "stopped" | "settled";

export function agentTurnSettlement(status: AgentTurnStatus): AgentTurnSettlement {
  if (status.kind === "pending" || status.kind === "running") return "running";
  if (status.kind === "stopped" || status.kind === "interrupted") return "stopped";
  return "settled";
}

type AgentToolRowFields = Pick<
  Extract<AgentTurnItem, { kind: "tool" }>,
  "rowKind" | "status" | "label" | "argument" | "command" | "output"
>;

interface AgentToolRowSource {
  readonly name: string;
  readonly inputSummary: string;
  readonly description?: string;
  readonly outcome: AgentToolOutcome | null;
  readonly settlement: AgentTurnSettlement;
  readonly workspaceRoot: string | null;
}

function toolRowStatus(
  outcome: AgentToolOutcome | null,
  settlement: AgentTurnSettlement,
): AgentToolRowStatus {
  if (outcome !== null) return outcome.isError ? "error" : "ok";
  if (settlement === "running") return "running";
  if (settlement === "stopped") return "stopped";
  return "ok";
}

function toolRowFields(source: AgentToolRowSource): AgentToolRowFields {
  const rowKind = toolRowKind(source.name);
  const status = toolRowStatus(source.outcome, source.settlement);
  const label = toolRowLabel({
    name: source.name,
    inputSummary: source.inputSummary,
    status,
    workspaceRoot: source.workspaceRoot,
    ...presentField("description", source.description),
  });
  const output = source.outcome?.outputSummary ?? "";
  return {
    rowKind,
    status,
    label: `${label.verb} ${label.subject}`.trim(),
    argument: label.argument,
    command: rowKind === "command" && source.inputSummary !== "" ? source.inputSummary : null,
    output: output === "" ? null : output,
  };
}

export function agentTurnLiveActivity(turn: AgentTurn): AgentTurnLiveActivity | null {
  if (turn.status.kind !== "running" && turn.status.kind !== "pending") return null;
  const unresolved = unresolvedAgentToolCallIds(turn.events);
  const latest = unresolved[unresolved.length - 1];
  if (latest === undefined) return { kind: "working" };
  return { kind: "tool", toolId: latest };
}

function unresolvedAgentToolCallIds(events: ReadonlyArray<AgentTurnEvent>): ReadonlyArray<string> {
  const order: string[] = [];
  const open = new Set<string>();
  for (const event of agentToolLifecycleEvents(events)) {
    if (event.kind === "toolCall") {
      if (open.has(event.toolId)) continue;
      open.add(event.toolId);
      order.push(event.toolId);
      continue;
    }
    open.delete(event.toolId);
  }
  return order.filter((toolId) => open.has(toolId));
}

type AgentToolLifecycleEvent = Extract<AgentTurnEvent, { kind: "toolCall" | "toolResult" }>;

function agentToolLifecycleEvents(
  events: ReadonlyArray<AgentTurnEvent>,
): ReadonlyArray<AgentToolLifecycleEvent> {
  const lifecycle: AgentToolLifecycleEvent[] = [];
  for (const event of events) {
    if (event.kind !== "toolCall" && event.kind !== "toolResult") continue;
    if (event.parentToolId !== undefined) continue;
    lifecycle.push(event);
  }
  return lifecycle;
}

const PARAGRAPH_SEPARATOR = /\n{2,}/;

export function agentTurnProjection(
  events: ReadonlyArray<AgentTurnEvent>,
  revealEventIndex: number | null = null,
  workspaceRoot: string | null = null,
  settlement: AgentTurnSettlement = "running",
  firstEventOffset = 0,
): AgentTurnProjection {
  const groups = appServerGroups(events, revealEventIndex);
  const seenGroups = new Set<string>();
  const renderableGroups = new Set<string>();
  const renderable = events
    .map((event, offset) => ({ event, offset }))
    .filter(({ event }) => {
      if (event.kind === "subagent") return false;
      const id = appServerGroupId(event);
      if (id === null) return true;
      if (renderableGroups.has(id)) return false;
      renderableGroups.add(id);
      return true;
    });
  const hiddenCount = Math.max(0, renderable.length - MAX_RENDERED_EVENTS_PER_TURN);
  const revealEvent = revealEventIndex === null ? undefined : events[revealEventIndex];
  const revealGroup = revealEvent === undefined ? null : appServerGroupId(revealEvent);
  const revealPosition =
    revealEventIndex === null
      ? -1
      : renderable.findIndex(
          ({ event, offset }) =>
            offset === revealEventIndex ||
            (revealGroup !== null && appServerGroupId(event) === revealGroup),
        );
  const firstVisible =
    revealPosition >= 0 && revealPosition < hiddenCount
      ? Math.max(0, revealPosition - Math.floor(MAX_RENDERED_EVENTS_PER_TURN / 2))
      : hiddenCount;
  const visible = renderable.slice(firstVisible, firstVisible + MAX_RENDERED_EVENTS_PER_TURN);
  const calls = toolCallIndex(events);
  const visibleAssistantText = new Set(
    visible
      .filter(
        (
          entry,
        ): entry is { event: Extract<AgentTurnEvent, { kind: "assistantText" }>; offset: number } =>
          entry.event.kind === "assistantText",
      )
      .map((entry) => normalizedAgentResponse(entry.event.text)),
  );
  const items: AgentTurnItem[] = [];
  const rawLines: AgentRawLine[] = [];
  const toolItemByToolId = new Map<string, number>();

  for (const { event, offset } of visible) {
    if (
      event.kind === "result" &&
      !event.isError &&
      visibleAssistantText.has(normalizedAgentResponse(event.text))
    ) {
      continue;
    }
    const key = agentTurnItemKey(offset, firstEventOffset);
    const groupId = appServerGroupId(event);
    if (groupId !== null) {
      const group = groups.get(groupId);
      if (group !== undefined && !seenGroups.has(groupId)) {
        items.push({ kind: "subagentGroup", key, group });
        seenGroups.add(groupId);
      }
      continue;
    }
    appendTurnItem({
      calls,
      event,
      items,
      key,
      rawLines,
      settlement,
      toolItemByToolId,
      workspaceRoot,
    });
  }

  return { items, rawLines, hiddenCount };
}

export function agentTurnWorkFold(
  items: ReadonlyArray<AgentTurnItem>,
  running: boolean,
): AgentTurnWorkFold | null {
  const hasWork = items.some((item) => item.kind === "tool" || item.kind === "reasoning");
  if (!hasWork) return null;
  if (items.some((item) => item.kind === "userMessage" || item.kind === "subagentGroup"))
    return null;
  if (running) {
    return { workItems: items, visibleItems: [], summary: agentWorkSummary(items) };
  }
  let finalResponseIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      item?.kind === "assistantText" ||
      (item?.kind === "result" && !item.isError && item.text.trim() !== "")
    ) {
      finalResponseIndex = index;
      break;
    }
  }
  // A compaction boundary remains in the conversation, including when work is
  // collapsed. End the fold at the first boundary so later output keeps its order.
  const boundaryIndex = items.findIndex((item) => item.kind === "contextCompaction");
  if (boundaryIndex >= 0 && boundaryIndex < finalResponseIndex) finalResponseIndex = boundaryIndex;
  if (finalResponseIndex <= 0) return null;
  const workItems = items.slice(0, finalResponseIndex);
  if (!workItems.some((item) => item.kind === "tool" || item.kind === "reasoning")) return null;
  return {
    workItems,
    visibleItems: items.slice(finalResponseIndex),
    summary: agentWorkSummary(workItems),
  };
}

function agentWorkSummary(items: ReadonlyArray<AgentTurnItem>): string {
  let commands = 0;
  let reads = 0;
  let changes = 0;
  let tools = 0;
  let updates = 0;
  let subagents = 0;
  for (const item of items) {
    if (item.kind === "assistantText") updates += 1;
    if (item.kind !== "tool") continue;
    if (item.parentToolId !== undefined) continue;
    if (isAgentSubagentToolItem(item)) {
      subagents += 1;
      continue;
    }
    const name = item.name.toLowerCase();
    if (name === "bash" || name === "shell" || name === "command_execution") commands += 1;
    else if (name === "read") reads += 1;
    else if (name === "edit" || name === "write" || name === "apply_patch") changes += 1;
    else tools += 1;
  }
  const parts = [
    countLabel(commands, "command"),
    countLabel(updates, "update"),
    countLabel(reads, "file read", "files read"),
    countLabel(changes, "file changed", "files changed"),
    countLabel(tools, "other tool"),
    countLabel(subagents, "subagent"),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "Activity" : parts.join(" · ");
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string | null {
  return count === 0 ? null : `${count} ${count === 1 ? singular : plural}`;
}

function normalizedAgentResponse(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function isAgentSubagentToolItem(item: AgentTurnItem): boolean {
  return item.kind === "tool" && isSubagentSpawnTool(item.name);
}

export function isSubagentSpawnTool(name: string): boolean {
  return name === "Task" || name === "Agent" || name === "SpawnAgent" || name === "spawn_agent";
}

interface TurnItemAppend {
  readonly calls: ReadonlyMap<string, AgentToolCallSummary>;
  readonly event: AgentTurnEvent;
  readonly items: AgentTurnItem[];
  readonly key: string;
  readonly rawLines: AgentRawLine[];
  readonly settlement: AgentTurnSettlement;
  readonly toolItemByToolId: Map<string, number>;
  readonly workspaceRoot: string | null;
}

function appendTurnItem({
  calls,
  event,
  items,
  key,
  rawLines,
  settlement,
  toolItemByToolId,
  workspaceRoot,
}: TurnItemAppend): void {
  if (event.kind === "assistantText") {
    items.push({
      kind: "assistantText",
      key,
      text: event.text,
      paragraphs: agentTextParagraphs(event.text),
    });
    return;
  }
  if (event.kind === "reasoning") {
    items.push({ kind: "reasoning", key, text: event.text });
    return;
  }
  if (event.kind === "toolCall") {
    toolItemByToolId.set(event.toolId, items.length);
    items.push({
      kind: "tool",
      key,
      toolId: event.toolId,
      name: event.name,
      inputSummary: event.inputSummary,
      outcome: null,
      ...toolRowFields({
        name: event.name,
        inputSummary: event.inputSummary,
        outcome: null,
        settlement,
        workspaceRoot,
        ...presentField("description", event.description),
      }),
      ...presentField("parentToolId", event.parentToolId),
    });
    return;
  }
  if (event.kind === "queued") {
    items.push({ kind: "queued", key });
    return;
  }
  if (event.kind === "subagent" || appServerGroupId(event) !== null) return;
  if (event.kind === "toolResult") {
    attachToolResult({ calls, event, items, key, settlement, toolItemByToolId, workspaceRoot });
    return;
  }
  if (event.kind === "result") {
    items.push({ kind: "result", key, text: event.text, isError: event.isError });
    return;
  }
  if (event.kind === "contextCompaction") {
    items.push({
      kind: "contextCompaction",
      key,
      beforeTokens: event.beforeTokens,
      afterTokens: event.afterTokens,
    });
    return;
  }
  if (event.kind === "error") {
    items.push({ kind: "error", key, message: event.message });
    return;
  }
  if (event.kind === "userMessage") {
    items.push({
      kind: "userMessage",
      key,
      text: event.text,
      ...presentField("attachments", event.attachments),
    });
    return;
  }
  if (event.kind === "unknownLine") rawLines.push({ key, stream: event.stream, raw: event.raw });
}

interface ToolResultAttach {
  readonly calls: ReadonlyMap<string, AgentToolCallSummary>;
  readonly event: Extract<AgentTurnEvent, { kind: "toolResult" }>;
  readonly items: AgentTurnItem[];
  readonly key: string;
  readonly settlement: AgentTurnSettlement;
  readonly toolItemByToolId: Map<string, number>;
  readonly workspaceRoot: string | null;
}

function attachToolResult({
  calls,
  event,
  items,
  key,
  settlement,
  toolItemByToolId,
  workspaceRoot,
}: ToolResultAttach): void {
  const outcome: AgentToolOutcome = {
    outputSummary: event.outputSummary,
    isError: event.isError,
  };
  const call = calls.get(event.toolId);
  const index = toolItemByToolId.get(event.toolId);
  const pending = index === undefined ? undefined : items[index];
  if (index !== undefined && pending !== undefined && pending.kind === "tool") {
    items[index] = {
      ...pending,
      outcome,
      ...toolRowFields({
        name: pending.name,
        inputSummary: pending.inputSummary,
        outcome,
        settlement,
        workspaceRoot,
        ...presentField("description", call?.description),
      }),
    };
    toolItemByToolId.delete(event.toolId);
    return;
  }
  const name = call?.name ?? "tool";
  const inputSummary = call?.inputSummary ?? "";
  items.push({
    kind: "tool",
    key,
    toolId: event.toolId,
    name,
    inputSummary,
    outcome,
    ...toolRowFields({
      name,
      inputSummary,
      outcome,
      settlement,
      workspaceRoot,
      ...presentField("description", call?.description),
    }),
    ...presentField("parentToolId", call?.parentToolId ?? event.parentToolId),
  });
}

interface AgentToolCallSummary {
  readonly name: string;
  readonly inputSummary: string;
  readonly description?: string;
  readonly parentToolId?: string;
}

export function presentField<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

function toolCallIndex(
  events: ReadonlyArray<AgentTurnEvent>,
): ReadonlyMap<string, AgentToolCallSummary> {
  const calls = new Map<string, AgentToolCallSummary>();
  for (const event of events) {
    if (event.kind !== "toolCall") continue;
    if (calls.has(event.toolId)) continue;
    calls.set(event.toolId, {
      name: event.name,
      inputSummary: event.inputSummary,
      ...presentField("description", event.description),
      ...presentField("parentToolId", event.parentToolId),
    });
  }
  return calls;
}

export function agentTextParagraphs(text: string): ReadonlyArray<string> {
  const paragraphs = text
    .split(PARAGRAPH_SEPARATOR)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  if (paragraphs.length === 0) return [];
  return paragraphs;
}
