import { isTransientRunnerBusyError } from "../domain/remoteRunnerErrors";
import {
  REMOTE_FILE_DOWNLOAD_MISMATCH_ERROR,
  REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR,
  REMOTE_FILE_DOWNLOAD_WRITE_ERROR,
} from "../domain/remoteRunnerFileAttachment";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import type { StoredAgentAttachmentRequest } from "./agentAttachmentPorts";
import {
  readableRemoteAttachment,
  RemoteAttachmentUnavailableError,
  type RemoteAttachmentReadAuthority,
  type RemoteAttachmentRegistry,
  type RemoteAttachmentStoredEntry,
  type RemoteAttachmentUnavailableReason,
} from "./remoteAttachmentHistory";

export type AgentAttachmentDownloadOutcome = "saved" | "cancelled";

export const REMOTE_ATTACHMENT_DOWNLOAD_UNAVAILABLE = "Attachment downloads are unavailable here.";
export const REMOTE_ATTACHMENT_DOWNLOAD_SUPERSEDED =
  "The server connection changed while the attachment was downloading.";
export const REMOTE_ATTACHMENT_DOWNLOAD_BUSY =
  "The server is busy. Try the download again shortly.";
export const REMOTE_ATTACHMENT_DOWNLOAD_FAILED = "The attachment could not be downloaded.";
export const REMOTE_ATTACHMENT_DOWNLOAD_UNKNOWN_THREAD =
  "This conversation is no longer available. Reopen it to download the attachment.";
export const LOCAL_ATTACHMENT_DOWNLOAD_REFUSAL =
  "This attachment is already stored on this computer. Reveal it instead of downloading it.";

const NOT_FOUND_MESSAGE = "Runner request failed (HTTP 404).";
const MAX_PRESENTED_ERROR_BYTES = 512;
const UTF8_ENCODER = new TextEncoder();
const PRESENTED_NATIVE_ERRORS: ReadonlySet<string> = new Set([
  REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR,
  REMOTE_FILE_DOWNLOAD_MISMATCH_ERROR,
  REMOTE_FILE_DOWNLOAD_WRITE_ERROR,
]);

export class AgentAttachmentDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentAttachmentDownloadError";
  }
}

export function refuseLocalAttachmentDownload(): Promise<AgentAttachmentDownloadOutcome> {
  return Promise.reject(new AgentAttachmentDownloadError(LOCAL_ATTACHMENT_DOWNLOAD_REFUSAL));
}

export function refuseUnknownAttachmentDownload(): Promise<AgentAttachmentDownloadOutcome> {
  return Promise.reject(
    new AgentAttachmentDownloadError(REMOTE_ATTACHMENT_DOWNLOAD_UNKNOWN_THREAD),
  );
}

export async function downloadRemoteAttachment(
  registry: RemoteAttachmentRegistry,
  request: StoredAgentAttachmentRequest,
  authority: RemoteAttachmentReadAuthority,
): Promise<AgentAttachmentDownloadOutcome> {
  const entry = authorizedEntry(registry, request, authority);
  const gateway = authority.gateway;
  const download = gateway?.downloadAttachment;
  if (gateway === null || download === undefined)
    throw new AgentAttachmentDownloadError(REMOTE_ATTACHMENT_DOWNLOAD_UNAVAILABLE);
  const { id, name, bytes, sha256 } = entry.attachment;
  const isCurrent = (): boolean => currentEntry(registry, request, authority) === entry;
  let result: Awaited<ReturnType<typeof download>>;
  try {
    result = await download.call(gateway, {
      serverId: entry.serverId,
      attachmentId: id,
      name,
      bytes,
      sha256,
    });
  } catch (error) {
    if (!isCurrent()) throw new AgentAttachmentDownloadError(REMOTE_ATTACHMENT_DOWNLOAD_SUPERSEDED);
    throw new AgentAttachmentDownloadError(downloadFailureMessage(error));
  }
  if (!isCurrent()) throw new AgentAttachmentDownloadError(REMOTE_ATTACHMENT_DOWNLOAD_SUPERSEDED);
  try {
    validateRemoteRunnerValue("downloadAttachment", "response", result);
  } catch {
    throw new AgentAttachmentDownloadError(REMOTE_ATTACHMENT_DOWNLOAD_FAILED);
  }
  return result.status;
}

function authorizedEntry(
  registry: RemoteAttachmentRegistry,
  request: StoredAgentAttachmentRequest,
  authority: RemoteAttachmentReadAuthority,
): RemoteAttachmentStoredEntry {
  try {
    return readableRemoteAttachment(registry, request, authority);
  } catch (error) {
    if (error instanceof RemoteAttachmentUnavailableError)
      throw new AgentAttachmentDownloadError(downloadBlockedMessage(error.reason));
    throw new AgentAttachmentDownloadError(REMOTE_ATTACHMENT_DOWNLOAD_FAILED);
  }
}

function currentEntry(
  registry: RemoteAttachmentRegistry,
  request: StoredAgentAttachmentRequest,
  authority: RemoteAttachmentReadAuthority,
): RemoteAttachmentStoredEntry | null {
  try {
    return readableRemoteAttachment(registry, request, authority);
  } catch {
    return null;
  }
}

function downloadBlockedMessage(reason: RemoteAttachmentUnavailableReason): string {
  switch (reason) {
    case "notConnected":
      return "The server is not connected right now. Reconnect it to download this attachment.";
    case "notLoaded":
      return "This attachment's details are still loading. Try again in a moment.";
    case "foreign":
      return "This attachment does not belong to this conversation.";
    case "notStored":
      return REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR;
    case "loadFailed":
      return "The server could not provide this attachment's details. Reconnect the server to try again.";
    case "unsupported":
      return "This server cannot provide this attachment.";
    case "limit":
      return "Too many server attachments are open. Reconnect the server to download more.";
    case "busy":
      return REMOTE_ATTACHMENT_DOWNLOAD_BUSY;
    case "readFailed":
    case "notImage":
      return REMOTE_ATTACHMENT_DOWNLOAD_FAILED;
    default:
      return unreachable(reason);
  }
}

function downloadFailureMessage(error: unknown): string {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const message = raw.trim();
  if (PRESENTED_NATIVE_ERRORS.has(message)) return message;
  if (message === NOT_FOUND_MESSAGE) return REMOTE_FILE_DOWNLOAD_NOT_STORED_ERROR;
  if (isTransientRunnerBusyError(error)) return REMOTE_ATTACHMENT_DOWNLOAD_BUSY;
  const presentable =
    message.length > 0 &&
    UTF8_ENCODER.encode(message).byteLength <= MAX_PRESENTED_ERROR_BYTES &&
    !/\p{Cc}/u.test(message);
  return presentable ? message : REMOTE_ATTACHMENT_DOWNLOAD_FAILED;
}

function unreachable(value: never): never {
  throw new Error(`Unhandled attachment download state: ${String(value)}`);
}
