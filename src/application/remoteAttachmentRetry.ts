import type { StoredAgentAttachmentRequest } from "./agentAttachmentPorts";
import {
  remoteAttachmentErrorRecovery,
  remoteAttachmentRecovery,
  type RemoteAttachmentRecovery,
  type RemoteAttachmentUnavailableReason,
} from "./remoteAttachmentHistory";

interface RetryRecord {
  readonly request: StoredAgentAttachmentRequest;
  readonly armed: boolean;
}
export type RemoteAttachmentRetries = Map<string, RetryRecord>;
export const MAX_REMOTE_ATTACHMENT_RETRIES = 64;

const keyOf = (request: StoredAgentAttachmentRequest): string =>
  `${request.workspaceId}\0${request.threadId}\0${request.attachmentId}`;

export function recordRemoteAttachmentFailure(
  retries: RemoteAttachmentRetries,
  request: StoredAgentAttachmentRequest,
  error: unknown,
): void {
  const key = keyOf(request);
  retries.delete(key);
  const recovery = remoteAttachmentErrorRecovery(error);
  if (recovery === "never") return;
  retries.set(key, {
    request: {
      workspaceId: request.workspaceId,
      threadId: request.threadId,
      attachmentId: request.attachmentId,
    },
    armed: recovery === "whenReady",
  });
  for (const oldest of retries.keys()) {
    if (retries.size <= MAX_REMOTE_ATTACHMENT_RETRIES) return;
    retries.delete(oldest);
  }
}

export function settleRemoteAttachmentRetry(
  retries: RemoteAttachmentRetries,
  request: StoredAgentAttachmentRequest,
): void {
  retries.delete(keyOf(request));
}

export function recoverRemoteAttachmentRetries(
  retries: RemoteAttachmentRetries,
  blockerOf: (request: StoredAgentAttachmentRequest) => RemoteAttachmentUnavailableReason | null,
): readonly StoredAgentAttachmentRequest[] {
  const recovered: StoredAgentAttachmentRequest[] = [];
  for (const [key, record] of retries) {
    const blocker = blockerOf(record.request);
    if (blocker !== null) {
      observeBlocker(retries, key, record, remoteAttachmentRecovery(blocker));
      continue;
    }
    if (!record.armed) continue;
    recovered.push(record.request);
    retries.delete(key);
  }
  return recovered;
}

export function forgetRemoteAttachmentRetries(
  retries: RemoteAttachmentRetries,
  workspaceIds: ReadonlySet<string>,
): void {
  if (workspaceIds.size === 0) return;
  for (const [key, record] of retries) {
    if (workspaceIds.has(record.request.workspaceId)) retries.delete(key);
  }
}

function observeBlocker(
  retries: RemoteAttachmentRetries,
  key: string,
  record: RetryRecord,
  recovery: RemoteAttachmentRecovery,
): void {
  switch (recovery) {
    case "never":
      retries.delete(key);
      return;
    case "afterReconnect":
      return;
    case "whenReady":
      if (!record.armed) retries.set(key, { request: record.request, armed: true });
      return;
    default:
      recovery satisfies never;
  }
}
