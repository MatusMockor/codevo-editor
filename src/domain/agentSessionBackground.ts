import type { AgentBackgroundTask } from "./agentBackgroundActivity";
import type { AgentThread } from "./agentThread";
import type {
  AgentSessionBackgroundTasksEvent,
  AgentSessionEndedEvent,
} from "./agentThreadSession";

export const MAX_AGENT_SESSION_BACKGROUNDS = 64;
export const AGENT_SESSION_FOLLOW_UP_GRACE_MS = 5_000;

export type AgentSessionReply =
  | { readonly kind: "none" }
  | { readonly kind: "expected"; readonly sinceEpochMs: number; readonly untilEpochMs: number }
  | { readonly kind: "inProgress"; readonly sinceEpochMs: number };

export const NO_AGENT_SESSION_REPLY: AgentSessionReply = Object.freeze({ kind: "none" });

export interface AgentSessionBackground {
  readonly ownerId: string;
  readonly total: number;
  readonly agents: number;
  readonly tasks: ReadonlyArray<AgentBackgroundTask>;
  readonly sinceEpochMs: number;
  readonly taskSinceEpochMs: ReadonlyMap<string, number>;
  readonly reply: AgentSessionReply;
}

export type AgentSessionBackgrounds = ReadonlyMap<string, AgentSessionBackground>;

export const NO_AGENT_SESSION_BACKGROUNDS: AgentSessionBackgrounds = new Map();

export function applyAgentSessionBackgroundLevel(
  current: AgentSessionBackgrounds,
  event: AgentSessionBackgroundTasksEvent,
  nowEpochMs: number,
): AgentSessionBackgrounds {
  const previous = current.get(event.threadId);
  const sameOwner = previous?.ownerId === event.workspaceId;
  const reply = nextReply(sameOwner ? previous : undefined, event, nowEpochMs);
  const live = event.total > 0 || reply.kind !== "none";
  if (!live) return sameOwner ? without(current, event.threadId) : current;
  const next = new Map(current);
  next.delete(event.threadId);
  next.set(event.threadId, {
    ownerId: event.workspaceId,
    total: event.total,
    agents: event.agents,
    tasks: event.tasks,
    sinceEpochMs: sameOwner ? previous.sinceEpochMs : nowEpochMs,
    taskSinceEpochMs: taskSince(sameOwner ? previous : undefined, event.tasks, nowEpochMs),
    reply,
  });
  for (const threadId of next.keys()) {
    if (next.size <= MAX_AGENT_SESSION_BACKGROUNDS) break;
    next.delete(threadId);
  }
  return next;
}

export function expireAgentSessionBackgroundReplies(
  current: AgentSessionBackgrounds,
  nowEpochMs: number,
): AgentSessionBackgrounds {
  const expired = [...current].filter(([, background]) => {
    const expiry = replyExpiry(background.reply);
    return expiry !== null && expiry <= nowEpochMs;
  });
  if (expired.length === 0) return current;
  const next = new Map(current);
  for (const [threadId, background] of expired) {
    if (background.total > 0) {
      next.set(threadId, { ...background, reply: NO_AGENT_SESSION_REPLY });
      continue;
    }
    next.delete(threadId);
  }
  return next;
}

export function nextAgentSessionReplyExpiry(current: AgentSessionBackgrounds): number | null {
  let nearest: number | null = null;
  for (const background of current.values()) {
    const expiry = replyExpiry(background.reply);
    if (expiry === null) continue;
    if (nearest === null || expiry < nearest) nearest = expiry;
  }
  return nearest;
}

export function endAgentSessionBackground(
  current: AgentSessionBackgrounds,
  event: AgentSessionEndedEvent,
): AgentSessionBackgrounds {
  const previous = current.get(event.threadId);
  if (previous?.ownerId !== event.workspaceId) return current;
  return without(current, event.threadId);
}

export function agentSessionBackgroundFor(
  backgrounds: AgentSessionBackgrounds,
  thread: AgentThread,
): AgentSessionBackground | undefined {
  if (thread.provider.kind !== "claudeCode") return undefined;
  const background = backgrounds.get(thread.threadId);
  if (background?.ownerId !== thread.owner.ownerId) return undefined;
  return background;
}

export function agentSessionAwaitsFollowUp(
  background: AgentSessionBackground | undefined,
): boolean {
  return background !== undefined && (background.agents > 0 || background.reply.kind !== "none");
}

export function agentSessionReplySince(reply: AgentSessionReply): number | null {
  switch (reply.kind) {
    case "none":
      return null;
    case "expected":
    case "inProgress":
      return reply.sinceEpochMs;
    default:
      return unsupportedReply(reply);
  }
}

function nextReply(
  previous: AgentSessionBackground | undefined,
  event: AgentSessionBackgroundTasksEvent,
  nowEpochMs: number,
): AgentSessionReply {
  switch (event.reply) {
    case "none":
      return awaitedReply(previous, event.agents, nowEpochMs);
    case "inProgress":
      return {
        kind: "inProgress",
        sinceEpochMs:
          agentSessionReplySince(previous?.reply ?? NO_AGENT_SESSION_REPLY) ?? nowEpochMs,
      };
    default:
      return unsupportedReply(event.reply);
  }
}

function awaitedReply(
  previous: AgentSessionBackground | undefined,
  agents: number,
  nowEpochMs: number,
): AgentSessionReply {
  if (previous === undefined || agents > 0) return NO_AGENT_SESSION_REPLY;
  if (previous.agents > 0)
    return {
      kind: "expected",
      sinceEpochMs: nowEpochMs,
      untilEpochMs: nowEpochMs + AGENT_SESSION_FOLLOW_UP_GRACE_MS,
    };
  const expiry = replyExpiry(previous.reply);
  if (expiry === null || expiry <= nowEpochMs) return NO_AGENT_SESSION_REPLY;
  return previous.reply;
}

function replyExpiry(reply: AgentSessionReply): number | null {
  switch (reply.kind) {
    case "none":
    case "inProgress":
      return null;
    case "expected":
      return reply.untilEpochMs;
    default:
      return unsupportedReply(reply);
  }
}

function taskSince(
  previous: AgentSessionBackground | undefined,
  tasks: ReadonlyArray<AgentBackgroundTask>,
  nowEpochMs: number,
): ReadonlyMap<string, number> {
  return new Map(
    tasks.map((task) => [task.taskId, previous?.taskSinceEpochMs.get(task.taskId) ?? nowEpochMs]),
  );
}

function without(current: AgentSessionBackgrounds, threadId: string): AgentSessionBackgrounds {
  const next = new Map(current);
  next.delete(threadId);
  return next;
}

function unsupportedReply(reply: never): never {
  throw new TypeError(`Unsupported agent session reply: ${String(reply)}.`);
}
