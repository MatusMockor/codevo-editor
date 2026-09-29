import type { AgentBackgroundTask } from "./agentBackgroundActivity";
import type { AgentThread } from "./agentThread";
import type {
  AgentSessionBackgroundTasksEvent,
  AgentSessionEndedEvent,
} from "./agentThreadSession";

export const MAX_AGENT_SESSION_BACKGROUNDS = 64;

export interface AgentSessionBackground {
  readonly ownerId: string;
  readonly total: number;
  readonly agents: number;
  readonly tasks: ReadonlyArray<AgentBackgroundTask>;
  readonly sinceEpochMs: number;
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
  if (event.total === 0) return sameOwner ? without(current, event.threadId) : current;
  const next = new Map(current);
  next.delete(event.threadId);
  next.set(event.threadId, {
    ownerId: event.workspaceId,
    total: event.total,
    agents: event.agents,
    tasks: event.tasks,
    sinceEpochMs: sameOwner ? previous.sinceEpochMs : nowEpochMs,
  });
  for (const threadId of next.keys()) {
    if (next.size <= MAX_AGENT_SESSION_BACKGROUNDS) break;
    next.delete(threadId);
  }
  return next;
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

function without(current: AgentSessionBackgrounds, threadId: string): AgentSessionBackgrounds {
  const next = new Map(current);
  next.delete(threadId);
  return next;
}
