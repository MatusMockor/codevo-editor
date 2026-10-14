import {
  AGENT_ATTACHMENT_FILE_BYTES_REFUSAL,
  sanitizeAgentAttachmentName,
} from "../domain/agentAttachmentIntake";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import {
  isRemoteRunnerFileAttachmentName,
  MAX_REMOTE_FILE_ATTACHMENT_BYTES,
  REMOTE_FILE_ATTACHMENTS_UNSUPPORTED_REFUSAL,
  REMOTE_FILE_SOURCE_EMPTY_ERROR,
  REMOTE_FILE_SOURCE_UNREADABLE_ERROR,
  REMOTE_FILE_UPLOAD_MISMATCH_ERROR,
} from "../domain/remoteRunnerFileAttachment";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import type {
  AgentAttachmentFileSourcePort,
  StagedAgentAttachmentFileSource,
} from "./agentAttachmentFileSourcePort";
import { remoteAgentProjectKeyParts } from "./remoteAgentProjection";
import type { AgentAttachmentOwner } from "./useAgentComposerAttachments";

export const REMOTE_FILE_ATTACHMENT_OWNER_CHANGED =
  "Remote attachment owner changed. Attach the file again.";
export const REMOTE_FILE_ATTACHMENTS_DISCONNECTED = "Connect to the server to attach files.";
export const REMOTE_FILE_ATTACHMENTS_UNAVAILABLE = "File attachments are unavailable here.";
export const REMOTE_FILE_UPLOAD_FAILED = "The file could not be uploaded to the server.";

const MAX_PRESENTED_ERROR_BYTES = 512;
const UTF8_ENCODER = new TextEncoder();

export interface RemoteAttachmentFileSource {
  readonly port: AgentAttachmentFileSourcePort;
  readonly sourceId: string;
}

export interface RemoteFileAttachmentAuthority {
  readonly owner: AgentAttachmentOwner;
  readonly getGateway: () => RemoteRunnerGateway | null;
  readonly ownerIsCurrent: (owner: AgentAttachmentOwner) => boolean;
}

export interface RemoteAttachmentFileUpload {
  readonly gateway: RemoteRunnerGateway;
  readonly serverId: string;
  readonly runnerId: string;
  readonly attachmentId: string;
  readonly sourceId: string;
  readonly name: string;
  readonly bytes: number;
  readonly isCurrent: () => boolean;
  readonly cancel: () => void;
}

export async function requireRemoteFileAttachments(
  authority: RemoteFileAttachmentAuthority,
): Promise<RemoteRunnerGateway> {
  const { owner } = authority;
  if (!authority.ownerIsCurrent(owner)) throw new Error(REMOTE_FILE_ATTACHMENTS_DISCONNECTED);
  const gateway = authority.getGateway();
  const target = remoteAgentProjectKeyParts(owner.projectRootKey);
  if (gateway === null || target === null)
    throw new Error("Remote attachment ownership is unavailable.");
  if (gateway.uploadAttachmentFile === undefined)
    throw new Error(REMOTE_FILE_ATTACHMENTS_UNAVAILABLE);
  const runner = await gateway.getRunner({ serverId: target.serverId });
  if (!authority.ownerIsCurrent(owner) || authority.getGateway() !== gateway)
    throw new Error(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
  validateRemoteRunnerValue("getRunner", "response", runner);
  if (runner.runnerId !== target.runnerId || runner.capabilities.fileAttachments !== true)
    throw new Error(REMOTE_FILE_ATTACHMENTS_UNSUPPORTED_REFUSAL);
  return gateway;
}

export function admitStagedFileSource(
  staged: StagedAgentAttachmentFileSource,
): StagedAgentAttachmentFileSource {
  if (!Number.isSafeInteger(staged.bytes) || staged.bytes < 1)
    throw new Error(REMOTE_FILE_SOURCE_EMPTY_ERROR);
  if (staged.bytes > MAX_REMOTE_FILE_ATTACHMENT_BYTES)
    throw new Error(AGENT_ATTACHMENT_FILE_BYTES_REFUSAL);
  const name = sanitizeAgentAttachmentName(staged.name);
  if (!isRemoteRunnerFileAttachmentName(name)) throw new Error(REMOTE_FILE_SOURCE_UNREADABLE_ERROR);
  return { sourceId: staged.sourceId, name, bytes: staged.bytes };
}

export function releaseRemoteAttachmentFileSource(source: RemoteAttachmentFileSource): void {
  void source.port.release(source.sourceId).catch(() => undefined);
}

export function cancelRemoteAttachmentUpload(
  gateway: RemoteRunnerGateway,
  serverId: string,
  attachmentId: string,
): void {
  const cancel = gateway.cancelAttachmentUpload;
  if (cancel === undefined) return;
  void cancel.call(gateway, { serverId, attachmentId }).catch(() => undefined);
}

export async function uploadRemoteAttachmentFile(
  upload: RemoteAttachmentFileUpload,
): Promise<void> {
  const { gateway, serverId, attachmentId, sourceId, name } = upload;
  const send = gateway.uploadAttachmentFile;
  if (send === undefined) throw new Error(REMOTE_FILE_ATTACHMENTS_UNAVAILABLE);
  let response: Awaited<ReturnType<typeof send>>;
  try {
    response = await send.call(gateway, { serverId, attachmentId, sourceId, name });
  } catch (error) {
    if (upload.isCurrent()) throw presentedUploadError(error);
    upload.cancel();
    throw new Error(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
  }
  if (!upload.isCurrent()) {
    upload.cancel();
    throw new Error(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
  }
  validateRemoteRunnerValue("uploadAttachmentFile", "response", response);
  const stored = response.attachment;
  if (
    stored.kind !== "file" ||
    stored.id !== attachmentId ||
    stored.name !== name ||
    stored.bytes !== upload.bytes ||
    stored.runnerId !== upload.runnerId
  )
    throw new Error(REMOTE_FILE_UPLOAD_MISMATCH_ERROR);
}

function presentedUploadError(error: unknown): Error {
  if (error instanceof Error) return error;
  const message = typeof error === "string" ? error.trim() : "";
  const presentable =
    message.length > 0 &&
    UTF8_ENCODER.encode(message).byteLength <= MAX_PRESENTED_ERROR_BYTES &&
    !/\p{Cc}/u.test(message);
  return new Error(presentable ? message : REMOTE_FILE_UPLOAD_FAILED);
}
