import type {
  AgentThreadStoreOwnerRequest,
  AgentThreadStoreSnapshot,
  DeleteAgentThreadRequest,
} from "../application/agentThreadPorts";
import {
  parseAgentHistoryTurnPage,
  type AgentHistoryTurnPage,
  type FindAgentHistoryImportRequest,
  type ReadAgentHistoryTurnsRequest,
} from "../domain/agentHistory";
import { parseAgentThread, type AgentThread } from "../domain/agentThread";
import { serializeAgentHistoryThread } from "../domain/agentThreadWire";
import {
  AGENT_TASK_ID_PATTERN,
  isAgentSessionId,
  MAX_AGENT_TASK_PATH_BYTES,
} from "../domain/agentTask";
import {
  parseAgentThreadStoreSnapshot,
  validateAgentThreadStoreOwnerRequest,
  validateDeleteAgentThreadRequest,
  type InvokeAgentThreadStoreCommand,
} from "./tauriAgentThreadStoreIpcContract";

export async function loadAgentHistory(
  invoke: InvokeAgentThreadStoreCommand,
  request: AgentThreadStoreOwnerRequest,
): Promise<AgentThreadStoreSnapshot> {
  const owner = validateAgentThreadStoreOwnerRequest(request);
  const raw = await invoke("load_agent_history", { request: owner });
  const result = object(raw, ["threads", "unreadable", "evicted", "revisions"]);
  const revisions = result.revisions;
  if (
    typeof revisions !== "object" ||
    revisions === null ||
    Array.isArray(revisions) ||
    Object.keys(revisions).length > 64
  )
    throw new TypeError("Invalid history revisions.");
  const revisionMap = revisions as Record<string, unknown>;
  for (const [id, revision] of Object.entries(revisionMap)) {
    if (!AGENT_TASK_ID_PATTERN.test(id)) throw new TypeError("Invalid history revision identity.");
    parseRevision(revision);
  }
  const snapshot = parseAgentThreadStoreSnapshot(
    { threads: result.threads, unreadable: result.unreadable, evicted: result.evicted },
    owner,
  );
  return {
    ...snapshot,
    threads: snapshot.threads.map((thread) => ({
      ...thread,
      historyRevision: parseRevision(revisionMap[thread.threadId]),
    })),
  };
}
export interface PreparedAgentHistoryWrite extends AgentThreadStoreOwnerRequest {
  readonly thread: Record<string, unknown>;
  readonly expectedRevision: number;
}
export function prepareAgentHistoryThreadWrite(
  owner: AgentThreadStoreOwnerRequest,
  thread: AgentThread,
  expectedRevision: number,
): PreparedAgentHistoryWrite {
  const request = validateAgentThreadStoreOwnerRequest(owner);
  parseRevision(expectedRevision);
  const document = serializeAgentHistoryThread(thread);
  const parsed = parseAgentThread(document);
  if (parsed.owner.rootKey !== request.rootKey || parsed.owner.ownerId !== request.ownerId)
    throw new TypeError("Foreign agent history owner.");
  return { ...request, thread: document, expectedRevision };
}
export async function savePreparedAgentHistoryThread(
  invoke: InvokeAgentThreadStoreCommand,
  request: PreparedAgentHistoryWrite,
): Promise<number> {
  const result = object(
    await invoke("save_agent_history_thread", {
      request,
    }),
    ["revision"],
  );
  const revision = parseRevision(result.revision);
  if (revision !== request.expectedRevision + 1)
    throw new TypeError("Invalid agent history save revision.");
  return revision;
}
export async function readAgentHistoryTurns(
  invoke: InvokeAgentThreadStoreCommand,
  request: ReadAgentHistoryTurnsRequest,
): Promise<AgentHistoryTurnPage> {
  const owner = validateDeleteAgentThreadRequest(request);
  if (request.beforeTurnId !== null && !AGENT_TASK_ID_PATTERN.test(request.beforeTurnId))
    throw new TypeError("Invalid agent history cursor.");
  return parseAgentHistoryTurnPage(
    await invoke("read_agent_history_turns", {
      request: { ...owner, beforeTurnId: request.beforeTurnId },
    }),
  );
}
export async function deleteAgentHistoryThread(
  invoke: InvokeAgentThreadStoreCommand,
  request: DeleteAgentThreadRequest,
): Promise<void> {
  await unit(invoke, "delete_agent_history_thread", validateDeleteAgentThreadRequest(request));
}
async function unit(
  invoke: InvokeAgentThreadStoreCommand,
  command: string,
  request: object,
): Promise<void> {
  if ((await invoke(command, { request })) !== null)
    throw new TypeError("Invalid agent history response.");
}

export async function findAgentHistoryImport(
  invoke: InvokeAgentThreadStoreCommand,
  request: FindAgentHistoryImportRequest,
): Promise<AgentThread | null> {
  const owner = validateAgentThreadStoreOwnerRequest(request);
  if (
    (request.provider !== "codex" && request.provider !== "claudeCode") ||
    !isAgentSessionId(request.sessionId) ||
    typeof request.repositoryRoot !== "string" ||
    request.repositoryRoot.length === 0 ||
    /\p{Cc}/u.test(request.repositoryRoot) ||
    new TextEncoder().encode(request.repositoryRoot).length > MAX_AGENT_TASK_PATH_BYTES
  )
    throw new TypeError("Invalid imported history lookup.");
  const result = await invoke("find_agent_history_import", {
    request: {
      ...owner,
      provider: request.provider,
      sessionId: request.sessionId,
      repositoryRoot: request.repositoryRoot,
    },
  });
  if (result === null) return null;
  const found = object(result, ["thread", "revision"]);
  const thread = {
    ...parseAgentThread(found.thread),
    historyRevision: parseRevision(found.revision),
  };
  if (
    thread.owner.rootKey !== owner.rootKey ||
    thread.owner.ownerId !== owner.ownerId ||
    thread.owner.repositoryRoot !== request.repositoryRoot ||
    thread.externalOrigin?.provider !== request.provider ||
    thread.externalOrigin.sessionId !== request.sessionId
  )
    throw new TypeError("Foreign imported history.");
  return thread;
}

function parseRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError("Invalid history revision.");
  return value as number;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Invalid history response.");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== keys.length ||
    Object.keys(record).some((key) => !keys.includes(key))
  )
    throw new TypeError("Invalid history response fields.");
  return record;
}
