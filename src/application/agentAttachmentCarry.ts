import type { AgentAttachmentKind } from "../domain/agentAttachment";
import {
  classifyAgentAttachmentCandidate,
  sanitizeAgentAttachmentName,
} from "../domain/agentAttachmentIntake";
import type { AgentAttachmentIntakeTicket } from "./agentAttachmentIntakeTickets";
import type {
  AgentAttachmentSource,
  AgentComposerAttachmentsSurface,
} from "./useAgentComposerAttachments";

export const AGENT_ATTACHMENT_CARRY_UNAVAILABLE_NOTICE =
  "Attachments could not be moved to this target. They stay with the previous one.";
export const AGENT_ATTACHMENT_CARRY_LOST_REFUSAL =
  "This attachment could not be moved. Attach it again.";
export const MAX_AGENT_ATTACHMENT_CARRY_FAILURE_CHARS = 240;

export type AgentAttachmentCarrySource =
  | AgentAttachmentSource
  | {
      readonly kind: "blob";
      readonly name: string;
      readonly mime: string;
      readonly blob: Blob;
    };

export interface AgentAttachmentCarryItem {
  readonly name: string;
  readonly failure: string | null;
  readonly source: AgentAttachmentCarrySource | null;
}

export interface AgentAttachmentCarry {
  readonly count: number;
}

export interface AgentAttachmentCarryContents {
  readonly items: ReadonlyArray<AgentAttachmentCarryItem>;
  readonly tickets: ReadonlyArray<AgentAttachmentIntakeTicket>;
}

const NOTHING_CARRIED: AgentAttachmentCarryContents = Object.freeze({ items: [], tickets: [] });
const CARRIED = new WeakMap<AgentAttachmentCarry, AgentAttachmentCarryContents>();

export function issueAgentAttachmentCarry(
  items: ReadonlyArray<AgentAttachmentCarryItem>,
  tickets: ReadonlyArray<AgentAttachmentIntakeTicket> = [],
): AgentAttachmentCarry | null {
  if (items.length === 0 && tickets.length === 0) return null;
  const carry: AgentAttachmentCarry = Object.freeze({ count: items.length });
  CARRIED.set(carry, { items, tickets });
  return carry;
}

export function redeemAgentAttachmentCarry(
  carry: AgentAttachmentCarry | null,
): AgentAttachmentCarryContents {
  if (carry === null) return NOTHING_CARRIED;
  const contents = CARRIED.get(carry) ?? NOTHING_CARRIED;
  CARRIED.delete(carry);
  return contents;
}

export function agentAttachmentCarrySourceName(source: AgentAttachmentSource): string {
  return sanitizeAgentAttachmentName(
    source.kind === "path" ? source.path.replace(/\/+$/u, "") : source.name,
  );
}

export function agentAttachmentCarrySourceBytes(source: AgentAttachmentCarrySource): number {
  if (source.kind === "path") return 0;
  if (source.kind === "blob") return source.blob.size;
  return source.bytes.byteLength;
}

export function agentAttachmentCarryKind(source: AgentAttachmentCarrySource): AgentAttachmentKind {
  if (source.kind === "path") return "reference";
  const classified = classifyAgentAttachmentCandidate({
    name: source.name,
    mime: source.mime,
    hasPath: false,
    bytes: agentAttachmentCarrySourceBytes(source),
  });
  return classified.kind === "image" ? "image" : "file";
}

export async function agentAttachmentCarryIntakeSource(
  source: AgentAttachmentCarrySource,
): Promise<AgentAttachmentSource> {
  if (source.kind !== "blob") return source;
  return {
    kind: "bytes",
    name: source.name,
    mime: source.mime,
    bytes: await source.blob.arrayBuffer(),
  };
}

export function boundedAgentAttachmentCarryFailure(reason: string): string {
  if (reason.length <= MAX_AGENT_ATTACHMENT_CARRY_FAILURE_CHARS) return reason;
  const kept = reason.slice(0, MAX_AGENT_ATTACHMENT_CARRY_FAILURE_CHARS - 1);
  const last = kept.charCodeAt(kept.length - 1);
  const splitsSurrogatePair = last >= 0xd800 && last <= 0xdbff;
  return `${splitsSurrogatePair ? kept.slice(0, -1) : kept}…`;
}

export function carryAgentAttachmentDrafts(
  origin: AgentComposerAttachmentsSurface | null,
  destination: AgentComposerAttachmentsSurface | null,
  projectRootKey: string,
): void {
  if (origin === null || origin.releaseForCarry === undefined) return;
  if (origin.drafts.length === 0 && origin.pendingIntake !== true) return;
  const accepted =
    destination?.acceptCarry?.(projectRootKey, () => origin.releaseForCarry?.() ?? null) ?? false;
  if (accepted) return;
  destination?.refuse(AGENT_ATTACHMENT_CARRY_UNAVAILABLE_NOTICE);
}
