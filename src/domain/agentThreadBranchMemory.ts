import type { AgentTaskIsolation } from "./agentTask";

export interface AgentThreadBranchIdentity {
  readonly threadId: string;
  readonly rootKey: string;
  readonly ownerId: string;
}

export type AgentThreadBranchMemory = ReadonlyMap<string, string>;

export interface AgentLocalCheckoutBranchMismatch {
  readonly threadBranch: string;
  readonly currentBranch: string;
}

export interface AgentLocalCheckoutBranchMismatchInput {
  readonly isolation: AgentTaskIsolation;
  readonly worktreePath: string | null;
  readonly remote: boolean;
  readonly threadBranch: string | null;
  readonly currentBranch: string | null;
}

export const MAX_AGENT_THREAD_BRANCH_MEMORY_ENTRIES = 256;
export const MAX_AGENT_THREAD_BRANCH_MEMORY_PERSISTED_CHARS = 256 * 1_024;
export const EMPTY_AGENT_THREAD_BRANCH_MEMORY: AgentThreadBranchMemory = new Map();

const PERSISTED_VERSION = 1;
const MAX_BRANCH_CHARS = 255;
const MAX_KEY_PART_CHARS = 4_096;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export function agentThreadBranchKey(identity: AgentThreadBranchIdentity): string {
  return JSON.stringify([identity.threadId, identity.rootKey, identity.ownerId]);
}

export function agentThreadBranchOf(
  memory: AgentThreadBranchMemory,
  identity: AgentThreadBranchIdentity,
): string | null {
  return memory.get(agentThreadBranchKey(identity)) ?? null;
}

export function rememberAgentThreadBranch(
  memory: AgentThreadBranchMemory,
  identity: AgentThreadBranchIdentity,
  branch: string,
): AgentThreadBranchMemory {
  if (!validBranch(branch)) return memory;
  const key = agentThreadBranchKey(identity);
  if (!validKey(key)) return memory;
  const entries = [...memory.entries()];
  const last = entries[entries.length - 1];
  if (last !== undefined && last[0] === key && last[1] === branch) return memory;
  const next = new Map(entries.filter(([existing]) => existing !== key));
  next.set(key, branch);
  while (next.size > MAX_AGENT_THREAD_BRANCH_MEMORY_ENTRIES) {
    const oldest = next.keys().next();
    if (oldest.done === true) break;
    next.delete(oldest.value);
  }
  return next;
}

export function serializeAgentThreadBranchMemory(memory: AgentThreadBranchMemory): string {
  const entries = [...memory.entries()];
  let serialized = serializedEntries(entries);
  while (serialized.length > MAX_AGENT_THREAD_BRANCH_MEMORY_PERSISTED_CHARS && entries.length > 0) {
    entries.shift();
    serialized = serializedEntries(entries);
  }
  return serialized;
}

function serializedEntries(entries: ReadonlyArray<readonly [string, string]>): string {
  return JSON.stringify({ version: PERSISTED_VERSION, entries });
}

export function parseAgentThreadBranchMemory(raw: string | null): AgentThreadBranchMemory {
  if (raw === null || raw === "" || raw.length > MAX_AGENT_THREAD_BRANCH_MEMORY_PERSISTED_CHARS) {
    return EMPTY_AGENT_THREAD_BRANCH_MEMORY;
  }
  const value = parseJson(raw);
  if (!isRecord(value)) return EMPTY_AGENT_THREAD_BRANCH_MEMORY;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("version") || !keys.includes("entries")) {
    return EMPTY_AGENT_THREAD_BRANCH_MEMORY;
  }
  if (value.version !== PERSISTED_VERSION || !Array.isArray(value.entries)) {
    return EMPTY_AGENT_THREAD_BRANCH_MEMORY;
  }
  if (value.entries.length > MAX_AGENT_THREAD_BRANCH_MEMORY_ENTRIES) {
    return EMPTY_AGENT_THREAD_BRANCH_MEMORY;
  }
  const memory = new Map<string, string>();
  for (const entry of value.entries as ReadonlyArray<unknown>) {
    if (!Array.isArray(entry) || entry.length !== 2) return EMPTY_AGENT_THREAD_BRANCH_MEMORY;
    const [key, branch] = entry as ReadonlyArray<unknown>;
    if (typeof key !== "string" || typeof branch !== "string") {
      return EMPTY_AGENT_THREAD_BRANCH_MEMORY;
    }
    if (!validKey(key) || !validBranch(branch)) return EMPTY_AGENT_THREAD_BRANCH_MEMORY;
    memory.set(key, branch);
  }
  return memory;
}

export function agentLocalCheckoutBranchMismatch(
  input: AgentLocalCheckoutBranchMismatchInput,
): AgentLocalCheckoutBranchMismatch | null {
  if (input.isolation !== "in-place" || input.worktreePath !== null || input.remote) return null;
  if (input.threadBranch === null || input.currentBranch === null) return null;
  if (input.threadBranch === input.currentBranch) return null;
  return { threadBranch: input.threadBranch, currentBranch: input.currentBranch };
}

function validBranch(branch: string): boolean {
  if (branch.trim() === "" || branch !== branch.trim()) return false;
  if (branch.length > MAX_BRANCH_CHARS) return false;
  return !CONTROL_CHARACTER.test(branch);
}

function validKey(key: string): boolean {
  const parts = parseJson(key);
  if (!Array.isArray(parts) || parts.length !== 3) return false;
  return parts.every(
    (part) => typeof part === "string" && part !== "" && part.length <= MAX_KEY_PART_CHARS,
  );
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
