import { agentProjectOwnsOwner, type AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentThread, AgentThreadOwner } from "../../domain/agentThread";
import {
  projectAuthority,
  projectByRootKey,
  sameProjectAuthority,
  type AgentProjectAuthority,
} from "../agentProjectAuthority";
import type { AgentTasksNotice, AgentThreadStoreGateway } from "../agentThreadPorts";
import { isRemoteAgentIdentity } from "../remoteAgentSurface";
import type { AgentTurnLogIntegration } from "../useAgentTurnLogging";
import type { AgentThreadStateStore } from "./agentThreadStateStore";

export const LEGACY_AGENT_THREAD_PIN_STORAGE_KEY_PREFIX = "mockor.agents.threadPins.";
export const MIN_AGENT_THREAD_PERSIST_INTERVAL_MS = 10_000;
export const MAX_INTERRUPTED_AGENT_THREADS_PER_LOAD = 8;
export const MAX_SEALED_INTERRUPTED_TURN_LOGS_PER_THREAD = 16;

export const SAVED_DELETE_PROJECT_UNAVAILABLE =
  "This conversation's project is no longer open, so it was not deleted.";
export const SAVED_DELETE_THREAD_OPEN =
  "This conversation is open in the thread list; delete it from there.";
export const SAVED_DELETE_IN_PROGRESS = "This conversation is already being deleted.";
export const SAVED_DELETE_OPENING = "This conversation is opening; try again in a moment.";
export const SAVED_DELETE_PROJECT_LOADING =
  "Saved threads are still loading for this project; try again in a moment.";

export interface AgentThreadLegacyPinStorage {
  removeItem(key: string): void;
}

export interface AgentThreadStoreDependencies {
  readonly agentThreadStoreGateway: AgentThreadStoreGateway;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly now?: () => number;
  readonly legacyPinStorage?: AgentThreadLegacyPinStorage;
  readonly minimumPersistIntervalMs?: number;
  readonly turnLog?: AgentTurnLogIntegration;
}

export interface AgentThreadStoreContext {
  readonly threads: AgentThreadStateStore;
  dependencies(): AgentThreadStoreDependencies;
  mounted(): boolean;
}

export function isLoggedAgentThread(thread: AgentThread): boolean {
  if (isRemoteAgentIdentity(thread.threadId)) return false;
  return !isRemoteAgentIdentity(thread.owner.ownerId);
}

export function durableAgentHistory(context: AgentThreadStoreContext): boolean {
  return context.dependencies().agentThreadStoreGateway.readAgentHistoryTurns !== undefined;
}

export function threadAuthority(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  thread: AgentThread,
): AgentProjectAuthority | null {
  return threadOwnerAuthority(projects, thread.owner);
}

export function threadOwnerAuthority(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  owner: AgentThreadOwner,
): AgentProjectAuthority | null {
  const project = projectByRootKey(projects, owner.rootKey);
  if (project === undefined) return null;
  if (!agentProjectOwnsOwner(project, owner)) return null;
  return projectAuthority(project, owner.ownerId);
}

export function ownsProjectRoot(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  authority: AgentProjectAuthority,
): boolean {
  const project = projectByRootKey(projects, authority.rootKey);
  if (project === undefined) return false;
  if (!agentProjectOwnsOwner(project, authority)) return false;
  return sameProjectAuthority(projectAuthority(project, authority.ownerId), authority);
}

export function authorityKey(authority: AgentProjectAuthority): string {
  return [authority.rootKey, authority.ownerId, authority.generation].join("#");
}
