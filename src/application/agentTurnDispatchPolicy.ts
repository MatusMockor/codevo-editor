import type { AgentFreshSessionReason } from "../domain/agentSessionIdentity";
import type { AttachmentThreadReservation } from "./agentTurnAttachments";
import { MAX_CONCURRENT_AGENT_DISPATCHES } from "./agentDispatchKeys";

export const AGENT_RESUME_REJECTED_NOTICE =
  "The agent CLI could not resume this thread's session. Try sending the message again; if it keeps failing, check the agent CLI version in Settings.";
export const AGENT_SESSION_LOST_NOTICE =
  "The agent could not find this thread's saved session. Your next message starts a new session in this thread; earlier turns will not be in the agent's context.";
export const AGENT_FRESH_SESSION_NOTICE =
  "This thread had no resumable agent session, so this message started a new one. Earlier turns are not in the agent's context.";
export const AGENT_REPLACED_SESSION_NOTICE =
  "This thread's saved agent session was lost, so this message started a new one. Earlier turns are not in the agent's context.";

export function agentFreshSessionNotice(reason: AgentFreshSessionReason): string {
  switch (reason) {
    case "noSession":
      return AGENT_FRESH_SESSION_NOTICE;
    case "sessionLost":
      return AGENT_REPLACED_SESSION_NOTICE;
    default:
      return unsupportedFreshSessionReason(reason);
  }
}

export function rememberAttachmentReservation(
  reservations: Map<string, AttachmentThreadReservation>,
  dispatchKey: string,
  reservation: AttachmentThreadReservation,
): void {
  reservations.delete(dispatchKey);
  reservations.set(dispatchKey, reservation);
  for (const key of reservations.keys()) {
    if (reservations.size <= MAX_CONCURRENT_AGENT_DISPATCHES) return;
    reservations.delete(key);
  }
}

function unsupportedFreshSessionReason(reason: never): never {
  throw new TypeError(`Unsupported fresh session reason: ${String(reason)}.`);
}
