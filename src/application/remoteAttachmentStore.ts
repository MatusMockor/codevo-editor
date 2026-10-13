import {
  AgentAttachmentRefusalError,
  type AgentAttachmentGateway,
  type StageAgentAttachmentBytesRequest,
  type StageAgentAttachmentFileRequest,
  type StagedAgentAttachment,
  type AgentAttachmentReferenceRequest,
} from "./agentAttachmentPorts";
import type { AgentTurnAttachmentRequest } from "./agentThreadPorts";
import type { AgentAttachmentOwner } from "./useAgentComposerAttachments";
import type { RemoteRunnerGateway, RemoteRunnerPart } from "../domain/remoteRunner";
import { remoteAgentProjectKeyParts } from "./remoteAgentProjection";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import {
  REMOTE_FILE_ATTACHMENTS_UNSUPPORTED_REFUSAL,
  REMOTE_PASTED_FILE_REFUSAL,
} from "../domain/remoteRunnerFileAttachment";
import type { AgentAttachmentEncoderPort } from "./agentAttachmentEncoderPort";
import {
  admitStagedFileSource,
  cancelRemoteAttachmentUpload,
  releaseRemoteAttachmentFileSource,
  REMOTE_FILE_ATTACHMENT_OWNER_CHANGED,
  requireRemoteFileAttachments,
  uploadRemoteAttachmentFile,
  type RemoteAttachmentFileSource,
} from "./remoteAttachmentFileTransfer";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_RETAINED_BYTES = 40 * 1024 * 1024;
const MAX_ENTRIES = 32;
const STAGING_FULL = "Remote attachment staging is full. Remove an attachment first.";
interface Upload {
  readonly id: string;
  promise?: Promise<void>;
  complete: boolean;
  gateway?: RemoteRunnerGateway;
  cancelled?: boolean;
}
type Content =
  | { readonly kind: "bytes"; readonly bytes: Uint8Array }
  | ({ readonly kind: "fileSource" } & RemoteAttachmentFileSource);
interface Entry {
  readonly owner: AgentAttachmentOwner;
  readonly workspaceId: string;
  readonly metadata: StagedAgentAttachment;
  readonly content: Content;
  readonly uploads: Map<string, Upload>;
  readonly encodings: Set<AbortController>;
}
export interface RemoteAttachmentStoreOptions {
  readonly getGateway: () => RemoteRunnerGateway | null;
  readonly resolveOwner: (workspaceId: string) => AgentAttachmentOwner | null;
  readonly ownerIsCurrent: (owner: AgentAttachmentOwner) => boolean;
  readonly ownerIsRetained: (owner: AgentAttachmentOwner) => boolean;
  readonly encoder: AgentAttachmentEncoderPort | null;
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
    if (!owner || owner.workspaceId !== request.workspaceId || !this.options.ownerIsRetained(owner))
      throw new Error("Remote attachment ownership is unavailable.");
    const size = request.bytes.byteLength;
    const isText =
      request.kind === "file" &&
      request.mime === null &&
      request.width === null &&
      request.height === null;
    if (isText && size > MAX_IMAGE_BYTES)
      throw new AgentAttachmentRefusalError(REMOTE_PASTED_FILE_REFUSAL);
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
    if (isText && !isUtf8Text(ownedBytes))
      throw new AgentAttachmentRefusalError(REMOTE_PASTED_FILE_REFUSAL);
    if (isText) {
      if (!this.options.ownerIsCurrent(owner))
        throw new Error("Remote attachment owner changed. Attach the file again.");
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
    if (this.entries.size >= MAX_ENTRIES || this.retainedBytes + size > MAX_RETAINED_BYTES)
      throw new Error(STAGING_FULL);
    const metadata: StagedAgentAttachment = Object.freeze({
      attachmentId: crypto.randomUUID().replace(/-/g, ""),
      name: request.name,
      mime: request.mime,
      bytes: size,
      width: request.width,
      height: request.height,
      promptLineBytesMax: 0,
    });
    if (!this.options.ownerIsRetained(owner))
      throw new Error("Remote attachment owner changed. Attach it again.");
    this.entries.set(metadata.attachmentId, {
      owner,
      workspaceId: request.workspaceId,
      metadata,
      content: { kind: "bytes", bytes: ownedBytes },
      uploads: new Map(),
      encodings: new Set(),
    });
    this.retainedBytes += size;
    return metadata;
  }

  async stageAgentAttachmentFile(
    request: StageAgentAttachmentFileRequest,
  ): Promise<StagedAgentAttachment> {
    const resolvedOwner = this.options.resolveOwner(request.workspaceId);
    const owner = resolvedOwner && { ...resolvedOwner };
    if (!owner || owner.workspaceId !== request.workspaceId || !this.options.ownerIsRetained(owner))
      throw new Error("Remote attachment ownership is unavailable.");
    const gateway = await requireRemoteFileAttachments({
      owner,
      getGateway: this.options.getGateway,
      ownerIsCurrent: this.options.ownerIsCurrent,
    });
    if (this.entries.size >= MAX_ENTRIES) throw new Error(STAGING_FULL);
    const port = request.fileSource;
    const native = await port.stage(request.path);
    const source: RemoteAttachmentFileSource = { port, sourceId: native.sourceId };
    try {
      if (!this.options.ownerIsRetained(owner) || this.options.getGateway() !== gateway)
        throw new Error(REMOTE_FILE_ATTACHMENT_OWNER_CHANGED);
      if (this.entries.size >= MAX_ENTRIES) throw new Error(STAGING_FULL);
      const staged = admitStagedFileSource(native);
      const metadata: StagedAgentAttachment = Object.freeze({
        attachmentId: crypto.randomUUID().replace(/-/g, ""),
        name: staged.name,
        mime: null,
        bytes: staged.bytes,
        width: null,
        height: null,
        promptLineBytesMax: 0,
      });
      this.entries.set(metadata.attachmentId, {
        owner,
        workspaceId: request.workspaceId,
        metadata,
        content: { kind: "fileSource", ...source },
        uploads: new Map(),
        encodings: new Set(),
      });
      return metadata;
    } catch (error) {
      releaseRemoteAttachmentFileSource(source);
      throw error;
    }
  }

  async releaseAgentAttachment(request: AgentAttachmentReferenceRequest): Promise<void> {
    const entry = this.entries.get(request.attachmentId);
    if (!entry || entry.workspaceId !== request.workspaceId) return;
    this.entries.delete(request.attachmentId);
    this.abandon(entry);
    if (entry.content.kind === "bytes") this.retainedBytes -= entry.content.bytes.byteLength;
  }
  clear(): void {
    const abandoned = [...this.entries.values()];
    this.entries.clear();
    this.retainedBytes = 0;
    for (const entry of abandoned) this.abandon(entry);
  }
  cancelStaleUploads(): void {
    for (const entry of this.entries.values()) {
      if (entry.content.kind !== "fileSource") continue;
      for (const [serverId, upload] of entry.uploads) {
        if (upload.promise === undefined || upload.gateway === undefined) continue;
        if (
          this.options.ownerIsCurrent(entry.owner) &&
          this.options.getGateway() === upload.gateway
        )
          continue;
        this.cancelUpload(serverId, upload);
      }
    }
  }
  private abandon(entry: Entry): void {
    for (const encoding of entry.encodings) encoding.abort();
    if (entry.content.kind !== "fileSource") return;
    for (const [serverId, upload] of entry.uploads) {
      if (upload.promise !== undefined) this.cancelUpload(serverId, upload);
    }
    releaseRemoteAttachmentFileSource(entry.content);
  }
  private cancelUpload(serverId: string, upload: Upload): void {
    if (upload.gateway === undefined || upload.cancelled === true) return;
    upload.cancelled = true;
    cancelRemoteAttachmentUpload(upload.gateway, serverId, upload.id);
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
    const target = remoteAgentProjectKeyParts(owner.projectRootKey);
    if (target === null || target.serverId !== serverId)
      throw new Error("Remote attachment belongs to another server.");
    const seen = new Set<string>();
    const selected = intents.map((intent) => {
      if (intent.kind !== "staged" || seen.has(intent.attachmentId))
        throw new Error("Remote attachments must be unique and staged.");
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
        throw new Error("Remote attachment no longer matches what was staged.");
      return entry;
    });
    const assertCurrent = () => {
      if (
        !this.options.ownerIsCurrent(owner) ||
        this.options.getGateway() !== gateway ||
        selected.some((entry) => this.entries.get(entry.metadata.attachmentId) !== entry)
      )
        throw new Error("Remote attachment owner changed. Attach it again.");
    };
    assertCurrent();
    const sendsFiles = selected.some((entry) => entry.content.kind === "fileSource");
    const sendsText = selected.some(
      (entry) => entry.content.kind === "bytes" && entry.metadata.mime === null,
    );
    if (sendsText || sendsFiles) {
      const runner = await gateway.getRunner({ serverId });
      assertCurrent();
      validateRemoteRunnerValue("getRunner", "response", runner);
      const segments = owner.projectRootKey.split(":");
      if (
        sendsText &&
        (segments.length !== 4 ||
          decodeURIComponent(segments[1]!) !== serverId ||
          decodeURIComponent(segments[2]!) !== runner.runnerId)
      )
        throw new Error("Remote text attachment belongs to another server.");
      if (sendsText && runner.capabilities.textAttachments !== true)
        throw new Error("Update this server to attach pasted text files.");
      if (
        sendsFiles &&
        (runner.runnerId !== target.runnerId || runner.capabilities.fileAttachments !== true)
      )
        throw new Error(REMOTE_FILE_ATTACHMENTS_UNSUPPORTED_REFUSAL);
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
          upload.promise = this.start(gateway, serverId, entry, upload, assertCurrent);
        const uploading = upload.promise;
        try {
          await uploading;
        } finally {
          if (upload.promise === uploading) upload.promise = undefined;
        }
        assertCurrent();
      }
      parts.push({ type: "attachment", attachmentId: upload.id });
    }
    assertCurrent();
    return parts;
  }

  private start(
    gateway: RemoteRunnerGateway,
    serverId: string,
    entry: Entry,
    upload: Upload,
    assertCurrent: () => void,
  ): Promise<void> {
    if (entry.content.kind === "bytes")
      return this.upload(gateway, serverId, entry, entry.content.bytes, upload, assertCurrent);
    return this.uploadFile(gateway, serverId, entry, entry.content, upload);
  }

  private async uploadFile(
    gateway: RemoteRunnerGateway,
    serverId: string,
    entry: Entry,
    source: RemoteAttachmentFileSource,
    upload: Upload,
  ): Promise<void> {
    upload.gateway = gateway;
    upload.cancelled = false;
    await uploadRemoteAttachmentFile({
      gateway,
      serverId,
      runnerId: remoteAgentProjectKeyParts(entry.owner.projectRootKey)?.runnerId ?? "",
      attachmentId: upload.id,
      sourceId: source.sourceId,
      name: entry.metadata.name,
      bytes: entry.metadata.bytes,
      isCurrent: () =>
        this.options.ownerIsCurrent(entry.owner) &&
        this.options.getGateway() === gateway &&
        this.entries.get(entry.metadata.attachmentId) === entry,
      cancel: () => this.cancelUpload(serverId, upload),
    });
    if (this.entries.get(entry.metadata.attachmentId) === entry) upload.complete = true;
  }

  private async upload(
    gateway: RemoteRunnerGateway,
    serverId: string,
    entry: Entry,
    bytes: Uint8Array,
    upload: Upload,
    assertCurrent: () => void,
  ): Promise<void> {
    const encoder = this.options.encoder;
    if (encoder === null) throw new Error("Attachment encoding is unavailable.");
    const encoding = new AbortController();
    entry.encodings.add(encoding);
    let base64: string;
    try {
      base64 = await encoder.encode(bytes, encoding.signal);
    } catch (error) {
      assertCurrent();
      throw error;
    } finally {
      entry.encodings.delete(encoding);
    }
    assertCurrent();
    const mediaType = entry.metadata.mime;
    if (mediaType !== null && mediaType !== "image/png" && mediaType !== "image/jpeg")
      throw new Error("Unsupported staged attachment media type.");
    const response = await gateway.uploadAttachment({
      serverId,
      attachmentId: upload.id,
      name: entry.metadata.name,
      mediaType: mediaType ?? "text/plain",
      base64,
    });
    assertCurrent();
    validateRemoteRunnerValue("uploadAttachment", "response", response);
    const remote = response.attachment;
    if (
      remote.runnerId !== remoteAgentProjectKeyParts(entry.owner.projectRootKey)?.runnerId ||
      remote.id !== upload.id ||
      remote.name !== entry.metadata.name ||
      remote.mediaType !== (entry.metadata.mime ?? "text/plain") ||
      remote.bytes !== entry.metadata.bytes ||
      (remote.width ?? null) !== entry.metadata.width ||
      (remote.height ?? null) !== entry.metadata.height
    )
      throw new Error("Server attachment does not match what was staged.");
    // Cache only while the exact staging lease survives; resolve checks the calling owner too.
    if (this.entries.get(entry.metadata.attachmentId) === entry) upload.complete = true;
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

function isUtf8Text(bytes: Uint8Array): boolean {
  try {
    return !new TextDecoder("utf-8", { fatal: true }).decode(bytes).includes("\0");
  } catch {
    return false;
  }
}

function sameOwner(left: AgentAttachmentOwner, right: AgentAttachmentOwner): boolean {
  return (
    left.projectRootKey === right.projectRootKey &&
    left.workspaceId === right.workspaceId &&
    left.ownerId === right.ownerId &&
    left.generation === right.generation
  );
}
