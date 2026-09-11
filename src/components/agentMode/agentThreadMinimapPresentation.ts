import type { AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import { agentThreadColumnKey, type AgentThreadColumnAnchor } from "./agentThreadColumn";
import type { AgentImportedTurn } from "./agentImportedPresentation";

export const MAX_AGENT_MINIMAP_ENTRIES = 55;
export const AGENT_MINIMAP_DENSE_TURNS = 44;
export const AGENT_MINIMAP_NAME_CHARS = 60;
export const AGENT_MINIMAP_PREVIEW_CHARS = 180;
export const AGENT_MINIMAP_SOURCE_CHARS = 8 * AGENT_MINIMAP_PREVIEW_CHARS;
export const AGENT_MINIMAP_MAX_DISTANCE = 4;

const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;

export type AgentMinimapDensity = "comfortable" | "dense";

export interface AgentMinimapEntry {
  readonly key: string;
  readonly anchor: AgentThreadColumnAnchor;
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

interface AgentMinimapSource {
  readonly anchor: AgentThreadColumnAnchor;
  readonly text: string;
  readonly streaming: boolean;
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

export function agentThreadMinimapModel(
  imported: ReadonlyArray<AgentImportedTurn>,
  turns: ReadonlyArray<AgentTurn>,
): AgentThreadMinimapModel {
  const column = columnSources(imported, turns);
  const turnCount = column.length;
  if (turnCount === 0) return EMPTY_AGENT_MINIMAP;

  const groupSize = Math.max(1, Math.ceil(turnCount / MAX_AGENT_MINIMAP_ENTRIES));
  const entries: AgentMinimapEntry[] = [];
  const ordinals = new Map<string, number>();

  column.forEach((source, index) => ordinals.set(agentThreadColumnKey(source.anchor), index + 1));

  for (let start = 0; start < turnCount; start += groupSize) {
    const group = column.slice(start, Math.min(start + groupSize, turnCount));
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
  columnKey: string | null,
): number {
  if (columnKey === null) return -1;
  const ordinal = model.ordinals.get(columnKey);
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

function columnSources(
  imported: ReadonlyArray<AgentImportedTurn>,
  turns: ReadonlyArray<AgentTurn>,
): ReadonlyArray<AgentMinimapSource> {
  const sources: AgentMinimapSource[] = [];

  for (const entry of imported) {
    sources.push({
      anchor: { scope: "imported", exchangeIndex: entry.headExchangeIndex },
      text: importedHeadText(entry),
      streaming: false,
    });
  }

  for (const turn of turns) {
    sources.push({
      anchor: { scope: "turn", turnId: turn.turnId },
      text: turn.prompt,
      streaming: isStreaming(turn.status),
    });
  }

  return sources;
}

function importedHeadText(entry: AgentImportedTurn): string {
  if (entry.prompt !== null) return entry.prompt.text;

  return entry.responses[0]?.text ?? "";
}

function minimapEntry(
  group: ReadonlyArray<AgentMinimapSource>,
  head: AgentMinimapSource,
  ordinal: number,
  turnCount: number,
): AgentMinimapEntry {
  const count = group.length;
  const streaming = group.some((source) => source.streaming);
  const text = collapse(head.text);
  const suffix = streaming ? ", answer in progress" : "";
  const preview = clip(text, AGENT_MINIMAP_PREVIEW_CHARS);
  const key = agentThreadColumnKey(head.anchor);
  const last = ordinal + count - 1;

  if (count === 1) {
    const summary = clip(text, AGENT_MINIMAP_NAME_CHARS);
    return {
      key,
      anchor: head.anchor,
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
    key,
    anchor: head.anchor,
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

function collapse(text: string): string {
  return text.slice(0, alignedSourceEnd(text)).replace(/\s+/g, " ").trim();
}

function alignedSourceEnd(text: string): number {
  if (text.length <= AGENT_MINIMAP_SOURCE_CHARS) return text.length;
  const code = text.charCodeAt(AGENT_MINIMAP_SOURCE_CHARS - 1);
  if (code < HIGH_SURROGATE_START || code > HIGH_SURROGATE_END) return AGENT_MINIMAP_SOURCE_CHARS;

  return AGENT_MINIMAP_SOURCE_CHARS - 1;
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;

  return `${text.slice(0, limit).trimEnd()}…`;
}
