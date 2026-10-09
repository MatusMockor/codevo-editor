import type { AgentThreadView } from "../../application/agentThreadPorts";
import { remoteAgentProjectServerId } from "../../application/remoteAgentProjection";
import { isRemoteAgentIdentity } from "../../application/remoteAgentSurface";
import { agentRailOwnerIndex } from "./agentRailProjectLayout";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";
import type { AgentStartingThread } from "./agentStartingThreads";
import { agentRowRuntime, type AgentThreadRowRuntime } from "./agentThreadRowLocation";

export const AGENT_RAIL_STARTING_STATUS_LABEL = "Starting";

export type AgentRailStartingRows = ReadonlyMap<string, ReadonlyArray<AgentStartingThread>>;

export interface AgentRailStartingRowsInput {
  readonly threads: ReadonlyArray<AgentStartingThread>;
  readonly visibleEntries: ReadonlyArray<AgentRailScopeEntry>;
  readonly entries: ReadonlyArray<AgentRailScopeEntry>;
  readonly views: ReadonlyArray<AgentThreadView>;
}

export const NO_AGENT_RAIL_STARTING_ROWS: AgentRailStartingRows = new Map();
const NO_THREAD_IDS: ReadonlySet<string> = new Set();

export function agentRailStartingRows(
  input: AgentRailStartingRowsInput,
  previous: AgentRailStartingRows = NO_AGENT_RAIL_STARTING_ROWS,
): AgentRailStartingRows {
  if (input.threads.length === 0) return NO_AGENT_RAIL_STARTING_ROWS;
  const present = agentRailPresentThreadIds(input.threads, input.views, input.entries);
  const owners = agentRailOwnerIndex(input.visibleEntries);
  const byProject = new Map<string, AgentStartingThread[]>();
  for (const thread of [...input.threads].reverse()) {
    if (thread.threadId !== null && present.has(thread.threadId)) continue;
    const owner = owners.get(thread.projectRootKey);
    if (owner === undefined) continue;
    const rows = byProject.get(owner.projectRootKey) ?? [];
    rows.push(thread);
    byProject.set(owner.projectRootKey, rows);
  }
  if (byProject.size === 0) return NO_AGENT_RAIL_STARTING_ROWS;
  return reusedStartingRows(previous, byProject);
}

export function agentRailPresentThreadIds(
  threads: ReadonlyArray<AgentStartingThread>,
  views: ReadonlyArray<AgentThreadView>,
  entries: ReadonlyArray<AgentRailScopeEntry>,
): ReadonlySet<string> {
  const identified = new Set(
    threads.flatMap((thread) => (thread.threadId === null ? [] : [thread.threadId])),
  );
  if (identified.size === 0) return NO_THREAD_IDS;
  const owners = agentRailOwnerIndex(entries);
  const present = new Set<string>();
  for (const view of views) {
    if (!identified.has(view.thread.threadId)) continue;
    if (!owners.has(view.thread.owner.rootKey)) continue;
    present.add(view.thread.threadId);
  }
  return present;
}

export function agentRailStartingRowLabel(thread: AgentStartingThread): string {
  return `Starting thread: ${thread.title}`;
}

export function agentRailStartingRowRuntime(
  thread: AgentStartingThread,
  serverNames: ReadonlyMap<string, string>,
): AgentThreadRowRuntime {
  if (!isRemoteAgentIdentity(thread.projectRootKey)) {
    return agentRowRuntime(thread.provider, "local", null);
  }
  const serverId = remoteAgentProjectServerId(thread.projectRootKey);
  const serverName = serverId === null ? null : (serverNames.get(serverId) ?? null);
  return agentRowRuntime(thread.provider, "server", serverName);
}

function reusedStartingRows(
  previous: AgentRailStartingRows,
  next: ReadonlyMap<string, ReadonlyArray<AgentStartingThread>>,
): AgentRailStartingRows {
  const reused = new Map<string, ReadonlyArray<AgentStartingThread>>();
  let changed = previous.size !== next.size;
  for (const [projectRootKey, rows] of next) {
    const before = previous.get(projectRootKey);
    if (before !== undefined && sameRows(before, rows)) {
      reused.set(projectRootKey, before);
      continue;
    }
    changed = true;
    reused.set(projectRootKey, rows);
  }
  if (!changed) return previous;
  return reused;
}

function sameRows(
  left: ReadonlyArray<AgentStartingThread>,
  right: ReadonlyArray<AgentStartingThread>,
): boolean {
  return left.length === right.length && right.every((thread, index) => thread === left[index]);
}
