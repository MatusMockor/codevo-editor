import type { AgentCliKind } from "../../domain/agentTask";
import { agentThreadAutoTitle } from "../../domain/agentThreadAutoTitle";
import {
  MAX_AGENT_PENDING_SENDS,
  type AgentPendingSend,
  type AgentPendingSendOwner,
  type AgentPendingSends,
} from "./agentPendingSend";

export const MAX_AGENT_STARTING_THREADS = MAX_AGENT_PENDING_SENDS;

export interface AgentStartingThread {
  readonly key: string;
  readonly projectRootKey: string;
  readonly owner: AgentPendingSendOwner | null;
  readonly provider: AgentCliKind;
  readonly threadId: string | null;
  readonly title: string;
  readonly sentAtEpochMs: number;
  readonly current: boolean;
}

export const NO_AGENT_STARTING_THREADS: ReadonlyArray<AgentStartingThread> = Object.freeze([]);

export function agentStartingThreadKey(sendId: number): string {
  return `starting:${sendId}`;
}

export function agentStartingThreadTitle(prompt: string): string {
  return agentThreadAutoTitle(prompt.trim());
}

export function agentStartingThreads(
  sends: AgentPendingSends,
  visibleSendId: number | null,
  previous: ReadonlyArray<AgentStartingThread> = NO_AGENT_STARTING_THREADS,
): ReadonlyArray<AgentStartingThread> {
  const reusable = new Map(previous.map((entry) => [entry.key, entry] as const));
  const next = sends
    .flatMap((send) => startingThread(send, visibleSendId))
    .slice(-MAX_AGENT_STARTING_THREADS)
    .map((entry) => reusedStartingThread(reusable.get(entry.key), entry));
  if (next.length === 0) return NO_AGENT_STARTING_THREADS;
  if (sameStartingThreads(previous, next)) return previous;
  return next;
}

function startingThread(
  send: AgentPendingSend,
  visibleSendId: number | null,
): ReadonlyArray<AgentStartingThread> {
  if (send.target.kind !== "new") return [];
  if (send.status !== "sending") return [];
  return [
    {
      key: agentStartingThreadKey(send.id),
      projectRootKey: send.target.projectRootKey,
      owner: send.owner ?? null,
      provider: send.target.provider,
      threadId: send.identifiedThreadId ?? null,
      title: agentStartingThreadTitle(send.prompt),
      sentAtEpochMs: send.sentAtEpochMs,
      current: send.id === visibleSendId,
    },
  ];
}

function reusedStartingThread(
  previous: AgentStartingThread | undefined,
  next: AgentStartingThread,
): AgentStartingThread {
  if (previous === undefined) return next;
  if (!sameStartingThread(previous, next)) return next;
  return previous;
}

function sameStartingThreads(
  previous: ReadonlyArray<AgentStartingThread>,
  next: ReadonlyArray<AgentStartingThread>,
): boolean {
  return previous.length === next.length && next.every((entry, index) => entry === previous[index]);
}

function sameStartingThread(left: AgentStartingThread, right: AgentStartingThread): boolean {
  return (
    left.key === right.key &&
    left.projectRootKey === right.projectRootKey &&
    sameOwner(left.owner, right.owner) &&
    left.provider === right.provider &&
    left.threadId === right.threadId &&
    left.title === right.title &&
    left.sentAtEpochMs === right.sentAtEpochMs &&
    left.current === right.current
  );
}

function sameOwner(
  left: AgentPendingSendOwner | null,
  right: AgentPendingSendOwner | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.ownerId === right.ownerId && left.generation === right.generation;
}
