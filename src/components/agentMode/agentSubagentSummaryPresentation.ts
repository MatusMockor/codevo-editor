import { isSubagentSpawnTool, presentField } from "./agentTurnProjection";
import type { AgentTurnEvent } from "../../domain/agentThread";

export type AgentSubagentState = "running" | "completed" | "failed";

export interface AgentSubagentEntry {
  readonly toolId: string;
  readonly name: string;
  readonly description: string;
  readonly state: AgentSubagentState;
  readonly subagentType?: string;
  readonly durationMs?: number;
  readonly totalTokens?: number;
  readonly steps?: number;
  readonly lastToolName?: string;
}

export interface AgentSubagentSummary {
  readonly total: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly entries: ReadonlyArray<AgentSubagentEntry>;
}

interface SubagentDraft {
  readonly toolId: string;
  name: string;
  description: string;
  telemetryState: AgentSubagentState | null;
  resultState: AgentSubagentState | null;
  subagentType: string | undefined;
  durationMs: number | undefined;
  totalTokens: number | undefined;
  toolUses: number | undefined;
  lastToolName: string | undefined;
  steps: number;
  spawned: boolean;
}

export function agentTurnSubagentSummary(
  events: ReadonlyArray<AgentTurnEvent>,
): AgentSubagentSummary | null {
  const drafts = new Map<string, SubagentDraft>();
  const toolIdByTaskId = new Map<string, string>();
  for (const event of events) {
    if (event.kind === "toolCall") {
      applyToolCall(drafts, event);
      continue;
    }
    if (event.kind === "toolResult") {
      applyToolResult(drafts, event);
      continue;
    }
    if (event.kind !== "subagent") continue;
    applySubagentEvent(drafts, toolIdByTaskId, event);
  }
  return summarizeSubagentDrafts([...drafts.values()]);
}

function applyToolCall(
  drafts: Map<string, SubagentDraft>,
  event: Extract<AgentTurnEvent, { kind: "toolCall" }>,
): void {
  if (event.parentToolId !== undefined) {
    const parent = drafts.get(event.parentToolId);
    if (parent !== undefined) parent.steps += 1;
    return;
  }
  if (!isSubagentSpawnTool(event.name)) return;
  const draft = subagentDraft(drafts, event.toolId);
  if (draft.spawned) return;
  draft.spawned = true;
  draft.name = draft.subagentType ?? event.name;
  draft.description = event.inputSummary;
}

function applyToolResult(
  drafts: Map<string, SubagentDraft>,
  event: Extract<AgentTurnEvent, { kind: "toolResult" }>,
): void {
  if (event.parentToolId !== undefined) return;
  const draft = drafts.get(event.toolId);
  if (draft === undefined || draft.resultState !== null) return;
  draft.resultState = event.isError ? "failed" : "completed";
}

function applySubagentEvent(
  drafts: Map<string, SubagentDraft>,
  toolIdByTaskId: Map<string, string>,
  event: Extract<AgentTurnEvent, { kind: "subagent" }>,
): void {
  const toolId = subagentEventToolId(toolIdByTaskId, event);
  if (toolId === null) return;
  const draft = subagentDraft(drafts, toolId);
  if (event.subagentType !== undefined) {
    draft.subagentType = event.subagentType;
    draft.name = event.subagentType;
  }
  if (draft.description === "" && event.description !== undefined) {
    draft.description = event.description;
  }
  if (event.durationMs !== undefined) draft.durationMs = event.durationMs;
  if (event.totalTokens !== undefined) draft.totalTokens = event.totalTokens;
  if (event.toolUses !== undefined) draft.toolUses = event.toolUses;
  if (event.lastToolName !== undefined) draft.lastToolName = event.lastToolName;
  if (draft.telemetryState === "failed") return;
  if (event.status === "completed" || event.status === "failed") {
    draft.telemetryState = event.status;
    return;
  }
  if (draft.telemetryState === null) draft.telemetryState = "running";
}

function subagentEventToolId(
  toolIdByTaskId: Map<string, string>,
  event: Extract<AgentTurnEvent, { kind: "subagent" }>,
): string | null {
  if (event.toolId !== undefined) {
    if (event.taskId !== undefined) toolIdByTaskId.set(event.taskId, event.toolId);
    return event.toolId;
  }
  if (event.taskId === undefined) return null;
  return toolIdByTaskId.get(event.taskId) ?? null;
}

function subagentDraft(drafts: Map<string, SubagentDraft>, toolId: string): SubagentDraft {
  const existing = drafts.get(toolId);
  if (existing !== undefined) return existing;
  const draft: SubagentDraft = {
    toolId,
    name: SUBAGENT_FALLBACK_NAME,
    description: "",
    telemetryState: null,
    resultState: null,
    subagentType: undefined,
    durationMs: undefined,
    totalTokens: undefined,
    toolUses: undefined,
    lastToolName: undefined,
    steps: 0,
    spawned: false,
  };
  drafts.set(toolId, draft);
  return draft;
}

function summarizeSubagentDrafts(
  drafts: ReadonlyArray<SubagentDraft>,
): AgentSubagentSummary | null {
  const entries = drafts.map(subagentEntry);
  const total = entries.length;
  if (total === 0) return null;
  return {
    total,
    running: countSubagentState(entries, "running"),
    completed: countSubagentState(entries, "completed"),
    failed: countSubagentState(entries, "failed"),
    entries,
  };
}

function subagentEntry(draft: SubagentDraft): AgentSubagentEntry {
  const steps = draft.steps > 0 ? draft.steps : draft.toolUses;
  return {
    toolId: draft.toolId,
    name: draft.name,
    description: draft.description,
    state: subagentDraftState(draft),
    ...presentField("subagentType", draft.subagentType),
    ...presentField("durationMs", draft.durationMs),
    ...presentField("totalTokens", draft.totalTokens),
    ...presentField("steps", steps),
    ...presentField("lastToolName", draft.lastToolName),
  };
}

function subagentDraftState(draft: SubagentDraft): AgentSubagentState {
  if (draft.resultState === "failed" || draft.telemetryState === "failed") return "failed";
  // A background spawn result acknowledges launch, not completion of the task.
  return draft.telemetryState ?? draft.resultState ?? "running";
}

function countSubagentState(
  entries: ReadonlyArray<AgentSubagentEntry>,
  state: AgentSubagentState,
): number {
  return entries.filter((entry) => entry.state === state).length;
}

const SUBAGENT_FALLBACK_NAME = "subagent";
