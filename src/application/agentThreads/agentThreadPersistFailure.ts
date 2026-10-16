import { AGENT_THREAD_STORE_FULL_ERROR } from "../../domain/agentThread";
import { errorMessageOf } from "../agentProjectAuthority";

export const PERSIST_FAILURE_NOTICE = "Some agent conversations could not be saved.";
export const MAX_PERSIST_FAILURE_REASON_CHARS = 180;
export const TURN_LOG_DELETE_FAILURE_NOTICE =
  "The saved transcript of a removed thread could not be deleted from this computer.";
export const STORE_FULL_NOTICE =
  "The saved-thread store is full. Unpin or remove older threads so new conversations can be saved.";

const HISTORY_DELETED_CLEANUP_FAILED_PREFIX = "The saved thread was deleted but";

const BACKEND_REASON_PREFIXES = [
  "Agent context ",
  "Agent project ",
  "Agent session ",
  "Agent task ",
  "Agent thread ",
  "Agent tool ",
  "Agent turn ",
  "The agent thread ",
  "The saved thread ",
  "Unable to ",
] as const;

export function historyDeletedCleanupFailure(error: unknown): string | null {
  const message = errorMessageOf(error);
  return message.startsWith(HISTORY_DELETED_CLEANUP_FAILED_PREFIX) ? message : null;
}

export function persistFailureMessage(error: unknown): string {
  const raw = errorMessageOf(error);
  if (raw === AGENT_THREAD_STORE_FULL_ERROR) return STORE_FULL_NOTICE;
  const reason = boundedPersistFailureReason(raw);
  if (reason === null) return PERSIST_FAILURE_NOTICE;
  return `${PERSIST_FAILURE_NOTICE} ${reason}`;
}

function boundedPersistFailureReason(raw: string): string | null {
  const collapsed = raw
    .replace(/\p{Cc}|\p{Cf}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!BACKEND_REASON_PREFIXES.some((prefix) => collapsed.startsWith(prefix))) return null;
  const points = [...collapsed];
  if (points.length <= MAX_PERSIST_FAILURE_REASON_CHARS) return collapsed;
  return `${points.slice(0, MAX_PERSIST_FAILURE_REASON_CHARS).join("")}…`;
}
