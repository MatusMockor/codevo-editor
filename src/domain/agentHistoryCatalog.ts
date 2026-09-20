import { parseAgentThread, type AgentThread } from "./agentThread";
import { AGENT_TASK_ID_PATTERN } from "./agentTask";

export const MAX_AGENT_HISTORY_CATALOG_THREADS = 32;
export const MAX_AGENT_HISTORY_CATALOG_BYTES = 4 * 1024 * 1024;
export interface ReadAgentHistoryThreadsRequest {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly beforeThreadId: string | null;
}
export interface AgentHistoryThreadPage {
  readonly threads: ReadonlyArray<AgentThread>;
  readonly hasEarlier: boolean;
  readonly beforeThreadId: string | null;
}

export function parseAgentHistoryThreadPage(
  value: unknown,
  owner: ReadAgentHistoryThreadsRequest,
): AgentHistoryThreadPage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const page = value as Record<string, unknown>;
  const keys = ["threads", "hasEarlier", "beforeThreadId", "revisions"];
  if (
    Object.keys(page).length !== keys.length ||
    Object.keys(page).some((key) => !keys.includes(key))
  )
    invalid();
  if (!Array.isArray(page.threads) || page.threads.length > MAX_AGENT_HISTORY_CATALOG_THREADS)
    invalid();
  if (typeof page.hasEarlier !== "boolean") invalid();
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_AGENT_HISTORY_CATALOG_BYTES)
    invalid();
  if (
    typeof page.revisions !== "object" ||
    page.revisions === null ||
    Array.isArray(page.revisions)
  )
    invalid();
  const revisions = page.revisions as Record<string, unknown>;
  if (Object.keys(revisions).length !== page.threads.length) invalid();
  const threads = page.threads.map((value) => {
    const thread = parseAgentThread(value);
    const revision = revisions[thread.threadId];
    if (
      !Object.prototype.hasOwnProperty.call(revisions, thread.threadId) ||
      typeof revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    )
      invalid();
    return { ...thread, historyRevision: revision };
  });
  if (
    threads.some(
      (thread) => thread.owner.rootKey !== owner.rootKey || thread.owner.ownerId !== owner.ownerId,
    )
  )
    invalid();
  if (new Set(threads.map((thread) => thread.threadId)).size !== threads.length) invalid();
  const cursor = page.beforeThreadId;
  if (cursor !== null && (typeof cursor !== "string" || !AGENT_TASK_ID_PATTERN.test(cursor)))
    invalid();
  if (cursor !== (threads[threads.length - 1]?.threadId ?? null)) invalid();
  if (page.hasEarlier && threads.length === 0) invalid();
  if (
    owner.beforeThreadId !== null &&
    threads.some((thread) => thread.threadId === owner.beforeThreadId)
  )
    invalid();
  return { threads, hasEarlier: page.hasEarlier, beforeThreadId: cursor };
}
function invalid(): never {
  throw new TypeError("Invalid saved conversation page.");
}
