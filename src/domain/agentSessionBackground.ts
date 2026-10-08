import type { AgentBackgroundTask } from "./agentBackgroundActivity";
import type { AgentThread } from "./agentThread";
import type {
  AgentSessionBackgroundTasksEvent,
  AgentSessionEndedEvent,
  AgentThreadSessionRequest,
} from "./agentThreadSession";

export const MAX_AGENT_SESSION_BACKGROUNDS = 64;
export const AGENT_SESSION_REPLY_EXPECTED_CAP_MS = 30_000;

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

export type AgentSessionBackgroundActivity = "idle" | "monitoring" | "working";

export const NO_AGENT_SESSION_BACKGROUNDS: AgentSessionBackgrounds = new Map();

export function applyAgentSessionBackgroundLevel(
  current: AgentSessionBackgrounds,
  event: AgentSessionBackgroundTasksEvent,
  nowEpochMs: number,
): AgentSessionBackgrounds {
  const key = sessionKey(event.workspaceId, event.threadId);
  const previous = current.get(key);
  const reply = nextReply(previous, event, nowEpochMs);
  const live = event.total > 0 || reply.kind !== "none";
  if (!live) return without(current, key);
  const next = new Map(current);
  next.delete(key);
  next.set(key, {
    ownerId: event.workspaceId,
    total: event.total,
    agents: event.agents,
    tasks: event.tasks,
    sinceEpochMs: previous?.sinceEpochMs ?? nowEpochMs,
    taskSinceEpochMs: taskSince(previous, event.tasks, nowEpochMs),
    reply,
  });
  for (const oldest of next.keys()) {
    if (next.size <= MAX_AGENT_SESSION_BACKGROUNDS) break;
    next.delete(oldest);
  }
  return next;
}

export function recoverAgentSessionBackgrounds(
  current: AgentSessionBackgrounds,
  levels: ReadonlyArray<AgentSessionBackgroundTasksEvent>,
  superseded: ReadonlySet<string>,
  nowEpochMs: number,
): AgentSessionBackgrounds {
  const listed = levels
    .slice(0, MAX_AGENT_SESSION_BACKGROUNDS)
    .filter((level) => !superseded.has(agentSessionBackgroundKey(level)));
  const known = new Set([...superseded, ...listed.map(agentSessionBackgroundKey)]);
  const retained = [...current].filter(([key]) => known.has(key));
  let next: AgentSessionBackgrounds =
    retained.length === current.size ? current : new Map(retained);
  for (const level of listed) {
    next = applyAgentSessionBackgroundLevel(next, level, nowEpochMs);
  }
  return next;
}

export function agentSessionBackgroundKey(session: AgentThreadSessionRequest): string {
  return sessionKey(session.workspaceId, session.threadId);
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
  for (const [key, background] of expired) {
    if (background.total > 0) {
      next.set(key, { ...background, reply: NO_AGENT_SESSION_REPLY });
      continue;
    }
    next.delete(key);
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
  session: AgentSessionEndedEvent | AgentThreadSessionRequest,
): AgentSessionBackgrounds {
  return without(current, sessionKey(session.workspaceId, session.threadId));
}

export function forgetAgentSessionBackground(
  current: AgentSessionBackgrounds,
  session: AgentThreadSessionRequest,
  observed: AgentSessionBackground | undefined,
): AgentSessionBackgrounds {
  if (observed === undefined) return current;
  const retained = agentSessionBackgroundOf(current, session.workspaceId, session.threadId);
  if (retained !== observed) return current;
  return endAgentSessionBackground(current, session);
}

export function agentSessionBackgroundFor(
  backgrounds: AgentSessionBackgrounds,
  thread: AgentThread,
): AgentSessionBackground | undefined {
  if (thread.provider.kind !== "claudeCode") return undefined;
  return agentSessionBackgroundOf(backgrounds, thread.owner.ownerId, thread.threadId);
}

export function agentSessionBackgroundOf(
  backgrounds: AgentSessionBackgrounds,
  ownerId: string,
  threadId: string,
): AgentSessionBackground | undefined {
  if (backgrounds.size === 0) return undefined;
  return backgrounds.get(sessionKey(ownerId, threadId));
}

export function agentSessionBackgroundActivity(
  background: AgentSessionBackground | undefined,
): AgentSessionBackgroundActivity {
  if (background === undefined) return "idle";
  if (background.agents > 0 || background.reply.kind !== "none") return "working";
  if (background.total <= 0) return "idle";
  if (listsOnlyMonitors(background)) return "monitoring";
  return "working";
}

export function agentSessionBackgroundIsLive(
  background: AgentSessionBackground | undefined,
): boolean {
  return agentSessionBackgroundActivity(background) !== "idle";
}

export function agentOwnerHasLiveSessionBackground(
  backgrounds: AgentSessionBackgrounds,
  threads: Iterable<AgentThread>,
  ownerId: string,
): boolean {
  if (backgrounds.size === 0) return false;
  for (const thread of threads) {
    if (thread.owner.ownerId !== ownerId) continue;
    if (agentSessionBackgroundIsLive(agentSessionBackgroundFor(backgrounds, thread))) return true;
  }
  return false;
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
      return NO_AGENT_SESSION_REPLY;
    case "expected":
      return expectedReply(previous?.reply, nowEpochMs);
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

function expectedReply(
  previous: AgentSessionReply | undefined,
  nowEpochMs: number,
): AgentSessionReply {
  if (previous?.kind === "expected") return previous;
  return {
    kind: "expected",
    sinceEpochMs: nowEpochMs,
    untilEpochMs: nowEpochMs + AGENT_SESSION_REPLY_EXPECTED_CAP_MS,
  };
}

function listsOnlyMonitors(background: AgentSessionBackground): boolean {
  if (background.tasks.length !== background.total) return false;
  return background.tasks.every((task) => task.taskType === "monitor");
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

function without(current: AgentSessionBackgrounds, key: string): AgentSessionBackgrounds {
  if (!current.has(key)) return current;
  const next = new Map(current);
  next.delete(key);
  return next;
}

function sessionKey(ownerId: string, threadId: string): string {
  return JSON.stringify([ownerId, threadId]);
}

function unsupportedReply(reply: never): never {
  throw new TypeError(`Unsupported agent session reply: ${String(reply)}.`);
}
