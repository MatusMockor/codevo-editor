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
  AGENT_TOOL_PATH_LIST_SEPARATOR,
  toolRowKind,
  toolRowLabel,
  type AgentToolRowKind,
  type AgentToolRowStatus,
} from "../../domain/agentToolRowPresentation";

export const MAX_RENDERED_EVENTS_PER_TURN = 200;
export const MAX_REVEALED_EVENTS_PER_TURN = MAX_RENDERED_EVENTS_PER_TURN * 5;

const MULTI_PATH_EDIT_TOOLS: ReadonlySet<string> = new Set(["apply_patch", "applypatch"]);
const MAX_COUNTED_CHANGED_PATHS = 4_096;
const INTERRUPTED_TOOL_VERB = "Interrupted";

export type AgentToolItemStatus = AgentToolRowStatus | "interrupted";

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
  | {
      readonly kind: "reasoning";
      readonly key: string;
      readonly text: string;
      readonly parentToolId?: string;
    }
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
      readonly status: AgentToolItemStatus;
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

export type AgentToolSettlement = AgentTurnSettlement | "interrupted";

export function agentToolSettlement(status: AgentTurnStatus): AgentToolSettlement {
  switch (status.kind) {
    case "pending":
    case "running":
      return "running";
    case "stopped":
      return "stopped";
    case "interrupted":
    case "failed":
      return "interrupted";
    case "exited":
      return status.exitCode === 0 ? "settled" : "interrupted";
    default:
      return unsupportedTurnStatus(status);
  }
}

export function agentSubagentGroupSettlement(
  groupState: string,
  parent: AgentToolSettlement,
): AgentToolSettlement {
  if (groupState === "completed") return "settled";
  if (groupState === "failed" || groupState === "interrupted") return "interrupted";
  if (parent === "settled") return "interrupted";
  return parent;
}

function unsupportedTurnStatus(status: never): never {
  throw new TypeError(`Unsupported agent turn status: ${JSON.stringify(status)}.`);
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
  readonly settlement: AgentToolSettlement;
  readonly workspaceRoot: string | null;
}

function toolRowStatus(
  outcome: AgentToolOutcome | null,
  settlement: AgentToolSettlement,
): AgentToolItemStatus {
  if (outcome !== null) return outcome.isError ? "error" : "ok";
  if (settlement === "running") return "running";
  if (settlement === "stopped") return "stopped";
  if (settlement === "interrupted") return "interrupted";
  return "ok";
}

function toolRowFields(source: AgentToolRowSource): AgentToolRowFields {
  const rowKind = toolRowKind(source.name);
  const status = toolRowStatus(source.outcome, source.settlement);
  const interrupted = status === "interrupted";
  const label = toolRowLabel({
    name: source.name,
    inputSummary: source.inputSummary,
    status: interrupted ? "stopped" : status,
    workspaceRoot: source.workspaceRoot,
    ...presentField("description", source.description),
  });
  const verb = interrupted ? INTERRUPTED_TOOL_VERB : label.verb;
  const output = source.outcome?.outputSummary ?? "";
  return {
    rowKind,
    status,
    label: `${verb} ${label.subject}`.trim(),
    argument: label.argument,
    command: rowKind === "command" && source.inputSummary !== "" ? source.inputSummary : null,
    output: output === "" ? null : output,
  };
}

export function agentTurnLiveActivity(turn: AgentTurn): AgentTurnLiveActivity | null {
  if (turn.status.kind !== "running" && turn.status.kind !== "pending") return null;
  const latest = latestLiveToolCallId(turn.events);
  if (latest === null) return { kind: "working" };
  return { kind: "tool", toolId: latest };
}

function latestLiveToolCallId(events: ReadonlyArray<AgentTurnEvent>): string | null {
  const open = new Map<string, number>();
  let activityBoundary = -1;
  events.forEach((event, position) => {
    if (event.kind === "toolCall" && event.parentToolId === undefined) {
      if (!open.has(event.toolId)) open.set(event.toolId, position);
      return;
    }
    if (event.kind === "toolResult" && event.parentToolId === undefined) {
      open.delete(event.toolId);
      return;
    }
    if (supersedesToolActivity(event)) activityBoundary = position;
  });
  let latest: string | null = null;
  let latestPosition = activityBoundary;
  for (const [toolId, position] of open) {
    if (position <= latestPosition) continue;
    latest = toolId;
    latestPosition = position;
  }
  return latest;
}

function supersedesToolActivity(event: AgentTurnEvent): boolean {
  if (event.kind === "assistantText" || event.kind === "reasoning") {
    return event.parentToolId === undefined && event.text.trim() !== "";
  }
  return event.kind === "userMessage";
}

function isSubagentNarration(event: AgentTurnEvent): boolean {
  return event.kind === "assistantText" && event.parentToolId !== undefined;
}

const PARAGRAPH_SEPARATOR = /\n{2,}/;

export function agentTurnProjection(
  events: ReadonlyArray<AgentTurnEvent>,
  revealEventIndex: number | null = null,
  workspaceRoot: string | null = null,
  settlement: AgentToolSettlement = "running",
  firstEventOffset = 0,
  renderedLimit: number = MAX_RENDERED_EVENTS_PER_TURN,
): AgentTurnProjection {
  const limit = agentRenderedEventLimit(renderedLimit);
  const groups = appServerGroups(events, revealEventIndex);
  const seenGroups = new Set<string>();
  const renderableGroups = new Set<string>();
  const renderable = events
    .map((event, offset) => ({ event, offset }))
    .filter(({ event }) => {
      if (event.kind === "subagent") return false;
      if (isSubagentNarration(event)) return false;
      const id = appServerGroupId(event);
      if (id === null) return true;
      if (renderableGroups.has(id)) return false;
      renderableGroups.add(id);
      return true;
    });
  const hiddenCount = Math.max(0, renderable.length - limit);
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
      ? Math.max(0, revealPosition - Math.floor(limit / 2))
      : hiddenCount;
  const visible = renderable.slice(firstVisible, firstVisible + limit);
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

export function agentRenderedEventLimit(requested: number): number {
  if (!Number.isSafeInteger(requested)) return MAX_RENDERED_EVENTS_PER_TURN;
  return Math.min(MAX_REVEALED_EVENTS_PER_TURN, Math.max(MAX_RENDERED_EVENTS_PER_TURN, requested));
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

interface AgentWorkTally {
  commands: number;
  reads: number;
  searches: number;
  fetches: number;
  tools: number;
  updates: number;
  subagents: number;
  unnamedChanges: number;
  readonly changedPaths: Set<string>;
}

const EMPTY_WORK_SUMMARY = "Activity";

export function agentPartialWorkSummary(summary: string, hiddenCount: number): string {
  if (hiddenCount <= 0) return summary;
  if (summary === EMPTY_WORK_SUMMARY) return `${EMPTY_WORK_SUMMARY} · earlier events hidden`;
  return `At least ${summary}`;
}

function agentWorkSummary(items: ReadonlyArray<AgentTurnItem>): string {
  const tally: AgentWorkTally = {
    commands: 0,
    reads: 0,
    searches: 0,
    fetches: 0,
    tools: 0,
    updates: 0,
    subagents: 0,
    unnamedChanges: 0,
    changedPaths: new Set(),
  };
  for (const item of items) {
    if (item.kind === "assistantText") tally.updates += 1;
    if (item.kind !== "tool") continue;
    if (item.parentToolId !== undefined) continue;
    tallyTool(tally, item);
  }
  const changes = tally.changedPaths.size + tally.unnamedChanges;
  const parts = [
    countLabel(tally.commands, "command"),
    countLabel(tally.updates, "update"),
    countLabel(tally.reads, "file read", "files read"),
    countLabel(tally.searches, "search", "searches"),
    countLabel(changes, "file changed", "files changed"),
    countLabel(tally.fetches, "page fetched", "pages fetched"),
    countLabel(tally.tools, "other tool"),
    countLabel(tally.subagents, "subagent"),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? EMPTY_WORK_SUMMARY : parts.join(" · ");
}

function tallyTool(tally: AgentWorkTally, item: Extract<AgentTurnItem, { kind: "tool" }>): void {
  if (isAgentSubagentToolItem(item)) {
    tally.subagents += 1;
    return;
  }
  switch (item.rowKind) {
    case "command":
      tally.commands += 1;
      return;
    case "read":
      tally.reads += 1;
      return;
    case "search":
      tally.searches += 1;
      return;
    case "web":
      tallyWebTool(tally, item.name);
      return;
    case "edit":
      tallyChangedPaths(tally, item);
      return;
    case "agent":
    case "other":
      tally.tools += 1;
      return;
    default:
      unsupportedRowKind(item.rowKind);
  }
}

function tallyWebTool(tally: AgentWorkTally, name: string): void {
  const normalized = name.toLowerCase();
  if (normalized === "websearch" || normalized === "web_search") {
    tally.searches += 1;
    return;
  }
  tally.fetches += 1;
}

function tallyChangedPaths(
  tally: AgentWorkTally,
  item: Extract<AgentTurnItem, { kind: "tool" }>,
): void {
  if (item.status !== "ok") return;
  const paths = editedPaths(item);
  if (paths.length === 0) {
    tally.unnamedChanges += 1;
    return;
  }
  for (const path of paths) {
    if (tally.changedPaths.size >= MAX_COUNTED_CHANGED_PATHS) return;
    tally.changedPaths.add(path);
  }
}

function editedPaths(item: Extract<AgentTurnItem, { kind: "tool" }>): ReadonlyArray<string> {
  const summary = item.inputSummary.trim();
  if (summary === "") return [];
  if (!MULTI_PATH_EDIT_TOOLS.has(item.name.toLowerCase())) return [summary];
  return summary
    .split(AGENT_TOOL_PATH_LIST_SEPARATOR)
    .map((path) => path.trim())
    .filter((path) => path !== "");
}

function unsupportedRowKind(kind: never): never {
  throw new TypeError(`Unsupported agent tool row kind: ${String(kind)}.`);
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
  readonly settlement: AgentToolSettlement;
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
    if (event.text.trim() === "") return;
    items.push({
      kind: "reasoning",
      key,
      text: event.text,
      ...presentField("parentToolId", event.parentToolId),
    });
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
  readonly settlement: AgentToolSettlement;
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
