import type { AgentTurn, AgentTurnStatus } from "../../domain/agentThread";

export const MAX_AGENT_MINIMAP_ENTRIES = 55;
export const AGENT_MINIMAP_DENSE_TURNS = 44;
export const AGENT_MINIMAP_NAME_CHARS = 60;
export const AGENT_MINIMAP_PREVIEW_CHARS = 180;
export const AGENT_MINIMAP_MAX_DISTANCE = 4;

export type AgentMinimapDensity = "comfortable" | "dense";

export interface AgentMinimapEntry {
  readonly key: string;
  readonly turnId: string;
  readonly ordinal: number;
  readonly count: number;
  readonly name: string;
  readonly label: string;
  readonly caption: string;
  readonly preview: string;
  readonly streaming: boolean;
}

export interface AgentThreadMinimapModel {
  readonly entries: ReadonlyArray<AgentMinimapEntry>;
  readonly ordinals: ReadonlyMap<string, number>;
  readonly density: AgentMinimapDensity;
  readonly turnCount: number;
  readonly folded: boolean;
}

const NO_ENTRIES: ReadonlyArray<AgentMinimapEntry> = [];
const NO_ORDINALS: ReadonlyMap<string, number> = new Map();

export const EMPTY_AGENT_MINIMAP: AgentThreadMinimapModel = {
  entries: NO_ENTRIES,
  ordinals: NO_ORDINALS,
  density: "comfortable",
  turnCount: 0,
  folded: false,
};

export function agentThreadMinimapModel(turns: ReadonlyArray<AgentTurn>): AgentThreadMinimapModel {
  const turnCount = turns.length;
  if (turnCount === 0) return EMPTY_AGENT_MINIMAP;

  const groupSize = Math.max(1, Math.ceil(turnCount / MAX_AGENT_MINIMAP_ENTRIES));
  const entries: AgentMinimapEntry[] = [];
  const ordinals = new Map<string, number>();

  turns.forEach((turn, index) => ordinals.set(turn.turnId, index + 1));

  for (let start = 0; start < turnCount; start += groupSize) {
    const group = turns.slice(start, Math.min(start + groupSize, turnCount));
    const head = group[0];
    if (head === undefined) continue;
    entries.push(minimapEntry(group, head, start + 1, turnCount));
  }

  return {
    entries,
    ordinals,
    density: turnCount >= AGENT_MINIMAP_DENSE_TURNS ? "dense" : "comfortable",
    turnCount,
    folded: groupSize > 1,
  };
}

export function agentMinimapEntryIndex(
  model: AgentThreadMinimapModel,
  turnId: string | null,
): number {
  if (turnId === null) return -1;
  const ordinal = model.ordinals.get(turnId);
  if (ordinal === undefined) return -1;

  for (let index = model.entries.length - 1; index >= 0; index -= 1) {
    const entry = model.entries[index];
    if (entry === undefined) continue;
    if (entry.ordinal <= ordinal) return index;
  }

  return -1;
}

export function agentMinimapDistance(index: number, currentIndex: number): number {
  if (currentIndex < 0) return AGENT_MINIMAP_MAX_DISTANCE;

  return Math.min(Math.abs(index - currentIndex), AGENT_MINIMAP_MAX_DISTANCE);
}

function minimapEntry(
  group: ReadonlyArray<AgentTurn>,
  head: AgentTurn,
  ordinal: number,
  turnCount: number,
): AgentMinimapEntry {
  const count = group.length;
  const streaming = group.some((turn) => isStreaming(turn.status));
  const prompt = collapse(head.prompt);
  const suffix = streaming ? ", answer in progress" : "";
  const preview = clip(prompt, AGENT_MINIMAP_PREVIEW_CHARS);
  const last = ordinal + count - 1;

  if (count === 1) {
    const summary = clip(prompt, AGENT_MINIMAP_NAME_CHARS);
    return {
      key: head.turnId,
      turnId: head.turnId,
      ordinal,
      count,
      name: `Turn ${ordinal} of ${turnCount}: ${summary}${suffix}`,
      label: summary,
      caption: `turn ${ordinal}`,
      preview,
      streaming,
    };
  }

  return {
    key: head.turnId,
    turnId: head.turnId,
    ordinal,
    count,
    name: `Turns ${ordinal} to ${last} of ${turnCount}, ${count} prompts${suffix}`,
    label: `Turns ${ordinal} to ${last}`,
    caption: `${count} prompts`,
    preview,
    streaming,
  };
}

function isStreaming(status: AgentTurnStatus): boolean {
  return status.kind === "pending" || status.kind === "running";
}

function collapse(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;

  return `${text.slice(0, limit).trimEnd()}…`;
}
