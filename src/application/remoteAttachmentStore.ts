import type {
  AgentAttachmentGateway,
  StageAgentAttachmentBytesRequest,
  StagedAgentAttachment,
  AgentAttachmentReferenceRequest,
} from "./agentAttachmentPorts";
import type { AgentTurnAttachmentRequest } from "./agentThreadPorts";
import type { AgentAttachmentOwner } from "./useAgentComposerAttachments";
import type { RemoteRunnerGateway, RemoteRunnerPart } from "../domain/remoteRunner";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_RETAINED_BYTES = 40 * 1024 * 1024;
interface Upload {
  readonly id: string;
  promise?: Promise<void>;
  complete: boolean;
}
interface Entry {
  readonly owner: AgentAttachmentOwner;
  readonly workspaceId: string;
  readonly metadata: StagedAgentAttachment;
  readonly bytes: Uint8Array;
  readonly uploads: Map<string, Upload>;
}
export interface RemoteAttachmentStoreOptions {
  readonly getGateway: () => RemoteRunnerGateway | null;
  readonly resolveOwner: (workspaceId: string) => AgentAttachmentOwner | null;
  readonly ownerIsCurrent: (owner: AgentAttachmentOwner) => boolean;
}

/** Private attachment bytes never become local paths or executable session capabilities. */
export class RemoteAttachmentStore implements AgentAttachmentGateway {
  private readonly entries = new Map<string, Entry>();
  private retainedBytes = 0;
  constructor(private readonly options: RemoteAttachmentStoreOptions) {}

  async stageAgentAttachmentBytes(
    request: StageAgentAttachmentBytesRequest,
  ): Promise<StagedAgentAttachment> {
    const resolvedOwner = this.options.resolveOwner(request.workspaceId);
    const owner = resolvedOwner && { ...resolvedOwner };
    if (!owner || owner.workspaceId !== request.workspaceId || !this.options.ownerIsCurrent(owner))
      throw new Error("Remote attachment ownership is unavailable.");
    const size = request.bytes.byteLength;
    const isText =
      request.kind === "file" &&
      request.mime === null &&
      request.width === null &&
      request.height === null;
    if (
      (!isText &&
        (request.kind !== "image" || !["image/png", "image/jpeg"].includes(request.mime ?? ""))) ||
      !request.workspaceId ||
      request.workspaceId.length > 4096 ||
      !request.name.trim() ||
      new TextEncoder().encode(request.name).length > 255 ||
      /[\\/"\x00-\x1f\x7f]/.test(request.name) ||
      (!isText &&
        (!Number.isSafeInteger(request.width) ||
          !Number.isSafeInteger(request.height) ||
          request.width! < 1 ||
          request.width! > 8192 ||
          request.height! < 1 ||
          request.height! > 8192)) ||
      size < 1 ||
      size > MAX_IMAGE_BYTES
    )
      throw new Error(
        "Remote attachments require a UTF-8 text file or PNG/JPEG image up to 5 MiB.",
      );
    const ownedBytes = new Uint8Array(request.bytes.slice(0));
    if (isText) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(ownedBytes);
      if (text.includes("\0")) throw new Error("Text attachments cannot contain NUL bytes.");
    }
    if (isText) {
      const gateway = this.options.getGateway();
      const segments = owner.projectRootKey.split(":");
      if (!gateway || segments.length !== 4 || segments[0] !== "remote")
        throw new Error("Remote text attachment ownership is unavailable.");
      const serverId = decodeURIComponent(segments[1]!);
      const runnerId = decodeURIComponent(segments[2]!);
      const runner = await gateway.getRunner({ serverId });
      if (!this.options.ownerIsCurrent(owner) || this.options.getGateway() !== gateway)
        throw new Error("Remote attachment owner changed. Attach the file again.");
      validateRemoteRunnerValue("getRunner", "response", runner);
      if (runner.runnerId !== runnerId || runner.capabilities.textAttachments !== true)
        throw new Error("Update this server to attach pasted text files.");
    }
    if (this.entries.size >= 32 || this.retainedBytes + size > MAX_RETAINED_BYTES)
      throw new Error("Remote attachment staging is full. Remove an attachment first.");
    const metadata: StagedAgentAttachment = Object.freeze({
      attachmentId: crypto.randomUUID().replace(/-/g, ""),
      name: request.name,
      mime: request.mime,
      bytes: size,
      width: request.width,
      height: request.height,
      promptLineBytesMax: 0,
    });
    if (!this.options.ownerIsCurrent(owner))
      throw new Error("Remote attachment owner changed. Attach the image again.");
    this.entries.set(metadata.attachmentId, {
      owner,
      workspaceId: request.workspaceId,
      metadata,
      bytes: ownedBytes,
      uploads: new Map(),
    });
    this.retainedBytes += size;
    return metadata;
  }

  async releaseAgentAttachment(request: AgentAttachmentReferenceRequest): Promise<void> {
    const entry = this.entries.get(request.attachmentId);
    if (!entry || entry.workspaceId !== request.workspaceId) return;
    this.entries.delete(request.attachmentId);
    this.retainedBytes -= entry.bytes.byteLength;
  }
  clear(): void {
    this.entries.clear();
    this.retainedBytes = 0;
  }

  async resolve(
    request: AgentTurnAttachmentRequest,
    serverId: string,
  ): Promise<readonly RemoteRunnerPart[]> {
    const intents = request.attachments ?? [];
    if (intents.length === 0) return [];
    const owner = request.attachmentOwner && { ...request.attachmentOwner };
    const gateway = this.options.getGateway();
    if (
      !owner ||
      !gateway ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(serverId) ||
      intents.length > 8
    )
      throw new Error("Remote attachment ownership is unavailable.");
    const seen = new Set<string>();
    const selected = intents.map((intent) => {
      if (intent.kind !== "staged" || seen.has(intent.attachmentId))
        throw new Error("Remote attachments must be unique staged images.");
      seen.add(intent.attachmentId);
      const entry = this.entries.get(intent.attachmentId);
      if (
        !entry ||
        !sameOwner(entry.owner, owner) ||
        entry.metadata.name !== intent.name ||
        entry.metadata.bytes !== intent.bytes ||
        entry.metadata.mime !== intent.mime ||
        entry.metadata.width !== intent.width ||
        entry.metadata.height !== intent.height
      )
        throw new Error("Remote attachment no longer matches its staged image.");
      return entry;
    });
    const assertCurrent = () => {
      if (
        !this.options.ownerIsCurrent(owner) ||
        this.options.getGateway() !== gateway ||
        selected.some((entry) => this.entries.get(entry.metadata.attachmentId) !== entry)
      )
        throw new Error("Remote attachment owner changed. Attach the image again.");
    };
    assertCurrent();
    if (selected.some((entry) => entry.metadata.mime === null)) {
      const runner = await gateway.getRunner({ serverId });
      assertCurrent();
      validateRemoteRunnerValue("getRunner", "response", runner);
      const segments = owner.projectRootKey.split(":");
      if (
        segments.length !== 4 ||
        decodeURIComponent(segments[1]!) !== serverId ||
        decodeURIComponent(segments[2]!) !== runner.runnerId
      )
        throw new Error("Remote text attachment belongs to another server.");
      if (runner.capabilities.textAttachments !== true)
        throw new Error("Update this server to attach pasted text files.");
    }
    const parts: RemoteRunnerPart[] = [];
    for (const entry of selected) {
      assertCurrent();
      let upload = entry.uploads.get(serverId);
      if (!upload) {
        if (entry.uploads.size >= 8) throw new Error("Remote attachment server limit reached.");
        upload = { id: crypto.randomUUID(), complete: false };
        entry.uploads.set(serverId, upload);
      }
      if (!upload.complete) {
        if (!upload.promise)
          upload.promise = this.upload(gateway, serverId, entry, upload, assertCurrent);
        try {
          await upload.promise;
        } finally {
          upload.promise = undefined;
        }
        assertCurrent();
      }
      parts.push({ type: "attachment", attachmentId: upload.id });
    }
    assertCurrent();
    return parts;
  }

  private async upload(
    gateway: RemoteRunnerGateway,
    serverId: string,
    entry: Entry,
    upload: Upload,
    assertCurrent: () => void,
  ): Promise<void> {
    let binary = "";
    for (let offset = 0; offset < entry.bytes.length; offset += 8192)
      binary += String.fromCharCode(...entry.bytes.subarray(offset, offset + 8192));
    const mediaType = entry.metadata.mime;
    if (mediaType !== null && mediaType !== "image/png" && mediaType !== "image/jpeg")
      throw new Error("Unsupported staged attachment media type.");
    const response = await gateway.uploadAttachment({
      serverId,
      attachmentId: upload.id,
      name: entry.metadata.name,
      mediaType: mediaType ?? "text/plain",
      base64: btoa(binary),
    });
    assertCurrent();
    validateRemoteRunnerValue("uploadAttachment", "response", response);
    const remote = response.attachment;
    if (
      remote.id !== upload.id ||
      remote.name !== entry.metadata.name ||
      remote.mediaType !== (entry.metadata.mime ?? "text/plain") ||
      remote.bytes !== entry.metadata.bytes ||
      (remote.width ?? null) !== entry.metadata.width ||
      (remote.height ?? null) !== entry.metadata.height
    )
      throw new Error("Server attachment does not match the staged image.");
    // Cache only while the exact staging lease survives; resolve checks the calling owner too.
    if (this.entries.get(entry.metadata.attachmentId) === entry) upload.complete = true;
  }

  async stageAgentAttachmentFromPath(
    _request: Parameters<AgentAttachmentGateway["stageAgentAttachmentFromPath"]>[0],
  ): Promise<never> {
    return unsupported();
  }
  async inspectAgentAttachmentCandidate(
    _request: Parameters<AgentAttachmentGateway["inspectAgentAttachmentCandidate"]>[0],
  ): Promise<never> {
    return unsupported();
  }
  async readAgentAttachmentCandidate(
    _request: Parameters<AgentAttachmentGateway["readAgentAttachmentCandidate"]>[0],
  ): Promise<never> {
    return unsupported();
  }
  async claimAgentAttachments(
    _request: Parameters<AgentAttachmentGateway["claimAgentAttachments"]>[0],
  ): Promise<never> {
    return unsupported();
  }
  async readAgentAttachment(
    _request: Parameters<AgentAttachmentGateway["readAgentAttachment"]>[0],
  ): Promise<never> {
    return unsupported();
  }
  async revealAgentAttachment(
    _request: Parameters<AgentAttachmentGateway["revealAgentAttachment"]>[0],
  ): Promise<never> {
    return unsupported();
  }
}
function unsupported(): never {
  throw new Error(
    "Remote conversations accept uploaded PNG/JPEG images; local file paths are unavailable.",
  );
}

function sameOwner(left: AgentAttachmentOwner, right: AgentAttachmentOwner): boolean {
  return (
    left.projectRootKey === right.projectRootKey &&
    left.workspaceId === right.workspaceId &&
    left.ownerId === right.ownerId &&
    left.generation === right.generation
  );
}
