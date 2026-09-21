import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import type { AgentAttachment } from "../domain/agentAttachment";
import type {
  RemoteRunnerAttachment,
  RemoteRunnerGateway,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import type { StoredAgentAttachmentRequest } from "./agentAttachmentPorts";
import { remoteAgentThreadKey } from "./remoteAgentProjection";
import type { AgentAttachmentOwner } from "./useAgentComposerAttachments";

interface Entry {
  readonly threads: Set<string>;
  readonly owner: AgentAttachmentOwner;
  readonly serverId: string;
  readonly attachment: RemoteRunnerAttachment;
}
export type RemoteAttachmentRegistry = Map<string, Entry>;
const MAX_ENTRIES = 512;
const MAX_BYTES = 5 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const keyOf = (workspaceId: string, id: string): string => `${workspaceId}\0${id}`;

export async function loadRemoteTaskAttachments(
  registry: RemoteAttachmentRegistry,
  task: RemoteRunnerTask,
  serverId: string,
  owner: AgentAttachmentOwner,
  gateway: RemoteRunnerGateway | null,
  ownerIsCurrent: (owner: AgentAttachmentOwner) => boolean,
  isGatewayCurrent: (gateway: RemoteRunnerGateway) => boolean,
): Promise<readonly AgentAttachment[]> {
  const parts = task.parts.filter((part) => part.type === "attachment");
  if (parts.length === 0) return [];
  if (parts.length > 8) throw new Error("Too many server images.");
  if (gateway?.getAttachment === undefined)
    throw new Error("This server cannot provide image previews.");
  const result: AgentAttachment[] = [];
  for (const part of parts) {
    if (!uuid.test(part.attachmentId) || !ownerIsCurrent(owner) || !isGatewayCurrent(gateway))
      throw new Error("The image owner changed.");
    const displayId = part.attachmentId.replace(/-/g, "");
    const key = keyOf(owner.workspaceId, displayId);
    let entry = registry.get(key);
    if (
      entry === undefined ||
      entry.serverId !== serverId ||
      entry.attachment.runnerId !== task.runnerId ||
      entry.owner.generation !== owner.generation ||
      entry.owner.ownerId !== owner.ownerId ||
      entry.owner.projectRootKey !== owner.projectRootKey ||
      entry.owner.workspaceId !== owner.workspaceId
    ) {
      if (registry.size >= MAX_ENTRIES && !registry.has(key)) {
        for (const [oldKey, oldEntry] of registry) {
          if (!ownerIsCurrent(oldEntry.owner)) registry.delete(oldKey);
        }
        if (registry.size >= MAX_ENTRIES) throw new Error("Server image metadata limit reached.");
      }
      const attachment = await gateway.getAttachment({ serverId, attachmentId: part.attachmentId });
      if (!ownerIsCurrent(owner) || !isGatewayCurrent(gateway))
        throw new Error("The image owner changed.");
      validateRemoteRunnerValue("getAttachment", "response", attachment);
      if (
        attachment.runnerId !== task.runnerId ||
        attachment.id !== part.attachmentId ||
        attachment.bytes > MAX_BYTES ||
        attachment.bytes < 1
      )
        throw new Error("Invalid server image metadata.");
      const settled = registry.get(key);
      if (
        settled !== undefined &&
        settled.serverId === serverId &&
        settled.owner.ownerId === owner.ownerId &&
        settled.owner.generation === owner.generation &&
        settled.owner.workspaceId === owner.workspaceId &&
        settled.owner.projectRootKey === owner.projectRootKey
      ) {
        if (!sameMetadata(settled.attachment, attachment))
          throw new Error("Server image metadata changed.");
        entry = settled;
      } else {
        entry = { owner, serverId, attachment, threads: new Set() };
      }
      if (registry.size >= MAX_ENTRIES && !registry.has(key))
        throw new Error("Server image metadata limit reached.");
      registry.set(key, entry);
    }
    const threadId = remoteAgentThreadKey(serverId, task.runnerId, task.conversationId ?? task.id);
    if (entry.threads.size >= MAX_ENTRIES && !entry.threads.has(threadId))
      throw new Error("Server image thread limit reached.");
    entry.threads.add(threadId);
    const image = entry.attachment;
    if (image.mediaType === "text/plain") {
      result.push({
        kind: "file",
        attachmentId: displayId,
        name: image.name,
        bytes: image.bytes,
        remote: { serverId, attachmentId: image.id },
      });
      continue;
    }
    result.push({
      kind: "image",
      attachmentId: displayId,
      name: image.name,
      mime: image.mediaType,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
      remote: { serverId, attachmentId: image.id },
    });
  }
  return result;
}

export async function readRemoteAttachment(
  registry: RemoteAttachmentRegistry,
  request: StoredAgentAttachmentRequest,
  dependencies: {
    readonly gateway: RemoteRunnerGateway | null;
    readonly ownerIsCurrent: (owner: AgentAttachmentOwner) => boolean;
    readonly isGatewayCurrent: (gateway: RemoteRunnerGateway) => boolean;
    readonly resolveServer: (threadId: string) => string | null;
  },
): Promise<ArrayBuffer> {
  const entry = registry.get(keyOf(request.workspaceId, request.attachmentId));
  const valid = (): boolean =>
    dependencies.gateway !== null &&
    dependencies.isGatewayCurrent(dependencies.gateway) &&
    entry !== undefined &&
    registry.get(keyOf(request.workspaceId, request.attachmentId)) === entry &&
    dependencies.ownerIsCurrent(entry.owner) &&
    entry.threads.has(request.threadId) &&
    dependencies.resolveServer(request.threadId) === entry.serverId;
  if (entry === undefined || !valid())
    throw new Error("The server image is unavailable for this thread.");
  if (dependencies.gateway?.readAttachment === undefined)
    throw new Error("This server cannot provide image previews.");
  const content = await dependencies.gateway.readAttachment({
    serverId: entry.serverId,
    attachmentId: entry.attachment.id,
  });
  if (!valid()) throw new Error("The image owner changed.");
  if (
    content.mediaType !== entry.attachment.mediaType ||
    content.base64.length > Math.ceil(MAX_BYTES / 3) * 4
  )
    throw new Error("Invalid server image content.");
  const decoded = atob(content.base64);
  if (decoded.length !== entry.attachment.bytes)
    throw new Error("Server image length does not match its metadata.");
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes.buffer;
}

function sameMetadata(left: RemoteRunnerAttachment, right: RemoteRunnerAttachment): boolean {
  return (
    left.id === right.id &&
    left.runnerId === right.runnerId &&
    left.name === right.name &&
    left.mediaType === right.mediaType &&
    left.bytes === right.bytes &&
    left.sha256 === right.sha256 &&
    left.width === right.width &&
    left.height === right.height &&
    left.createdAt === right.createdAt
  );
}
