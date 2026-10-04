import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import type { AgentAttachment, AgentImageMime } from "../domain/agentAttachment";
import type {
  RemoteRunnerAttachment,
  RemoteRunnerAttachmentContent,
  RemoteRunnerGateway,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import { isRemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import type { StoredAgentAttachmentRequest } from "./agentAttachmentPorts";
import { isTransientRunnerBusyError } from "./agentAttachmentReadLimiter";
import { remoteAgentThreadKey } from "./remoteAgentProjection";
import type { AgentAttachmentOwner } from "./useAgentComposerAttachments";

export type RemoteAttachmentLoadFailure = "notStored" | "loadFailed" | "unsupported" | "limit";
export type RemoteAttachmentUnavailableReason =
  "notConnected" | "notLoaded" | "foreign" | "readFailed" | "busy" | RemoteAttachmentLoadFailure;
export type RemoteAttachmentRecovery = "whenReady" | "afterReconnect" | "never";

export function remoteAttachmentUnavailableMessage(
  reason: RemoteAttachmentUnavailableReason,
): string {
  switch (reason) {
    case "notConnected":
      return "The server is not connected right now. This image will load when it reconnects.";
    case "notLoaded":
      return "This image's details are still loading. It will appear in a moment.";
    case "foreign":
      return "This image does not belong to this conversation.";
    case "notStored":
      return "The server no longer stores this image.";
    case "loadFailed":
      return "The server could not provide this image's details. Reconnect the server to try again.";
    case "readFailed":
      return "The server could not send this image. Reopen the conversation to try again.";
    case "busy":
      return "The server is busy. Reopen the conversation to try again.";
    case "unsupported":
      return "This server cannot provide image previews.";
    case "limit":
      return "Too many server images are open. Reconnect the server to view more.";
    default:
      return unreachable(reason);
  }
}

export function remoteAttachmentRecovery(
  reason: RemoteAttachmentUnavailableReason,
): RemoteAttachmentRecovery {
  switch (reason) {
    case "notConnected":
    case "notLoaded":
      return "whenReady";
    case "notStored":
    case "loadFailed":
    case "readFailed":
    case "busy":
    case "limit":
      return "afterReconnect";
    case "foreign":
    case "unsupported":
      return "never";
    default:
      return unreachable(reason);
  }
}

export class RemoteAttachmentUnavailableError extends Error {
  constructor(readonly reason: RemoteAttachmentUnavailableReason) {
    super(remoteAttachmentUnavailableMessage(reason));
    this.name = "RemoteAttachmentUnavailableError";
  }
}

export function remoteAttachmentErrorRecovery(error: unknown): RemoteAttachmentRecovery {
  if (error instanceof RemoteAttachmentUnavailableError)
    return remoteAttachmentRecovery(error.reason);
  return "afterReconnect";
}

export function presentRemoteAttachmentError(error: unknown): unknown {
  if (isTransientRunnerBusyError(error)) return new RemoteAttachmentUnavailableError("busy");
  return error;
}

export function remoteAttachmentLoadRetriesQuietly(error: unknown): boolean {
  if (!(error instanceof RemoteAttachmentUnavailableError)) return false;
  return error.reason === "busy" || remoteAttachmentRecovery(error.reason) === "whenReady";
}

interface StoredEntry {
  readonly kind: "stored";
  readonly threads: Set<string>;
  readonly owner: AgentAttachmentOwner;
  readonly serverId: string;
  readonly runnerId: string;
  readonly attachment: RemoteRunnerAttachment;
}
interface FailedEntry {
  readonly kind: "failed";
  readonly threads: Set<string>;
  readonly reason: RemoteAttachmentLoadFailure;
  readonly outageObserved: boolean;
  readonly owner: AgentAttachmentOwner;
  readonly serverId: string;
  readonly runnerId: string;
}
type Entry = StoredEntry | FailedEntry;
export type RemoteAttachmentRegistry = Map<string, Entry>;

export interface RemoteAttachmentAuthority {
  readonly gateway: RemoteRunnerGateway | null;
  readonly isGatewayCurrent: (gateway: RemoteRunnerGateway) => boolean;
  readonly ownerIsCurrent: (owner: AgentAttachmentOwner) => boolean;
  readonly onEvicted?: () => void;
}
export interface RemoteAttachmentReadAuthority extends RemoteAttachmentAuthority {
  readonly isWorkspaceConnected: (workspaceId: string) => boolean;
  readonly resolveServer: (threadId: string) => string | null;
}
export interface RemoteAttachmentRetention {
  readonly ownerIsRetained: (owner: AgentAttachmentOwner) => boolean;
  readonly ownerIsCurrent: (owner: AgentAttachmentOwner) => boolean;
}
export interface RemoteTaskAttachments {
  readonly attachments: readonly AgentAttachment[];
  readonly discovered: readonly RemoteAttachmentLoadFailure[];
}
interface LoadContext {
  readonly task: RemoteRunnerTask;
  readonly threadId: string;
  readonly serverId: string;
  readonly owner: AgentAttachmentOwner;
  readonly gateway: RemoteRunnerGateway;
  readonly authority: RemoteAttachmentAuthority;
}
interface ResolvedEntry {
  readonly entry: Entry;
  readonly discovered: boolean;
  readonly evicted: boolean;
  readonly authorized: boolean;
}

export const MAX_REMOTE_TASK_ATTACHMENTS = 8;
export const MAX_REMOTE_ATTACHMENT_ENTRIES = 512;
const MAX_REMOTE_ATTACHMENT_FAILURES = 128;
const MAX_BYTES = 5 * 1024 * 1024;
const NOT_FOUND_MESSAGE = "Runner request failed (HTTP 404).";
const NO_ATTACHMENTS: RemoteTaskAttachments = { attachments: [], discovered: [] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const keyOf = (workspaceId: string, id: string): string => `${workspaceId}\0${id}`;

export const remoteAttachmentDisplayId = (attachmentId: string): string =>
  attachmentId.replace(/-/g, "");

export function sameAttachmentOwner(
  left: AgentAttachmentOwner,
  right: AgentAttachmentOwner,
): boolean {
  return (
    left.projectRootKey === right.projectRootKey &&
    left.ownerId === right.ownerId &&
    left.generation === right.generation &&
    left.workspaceId === right.workspaceId
  );
}

export async function loadRemoteTaskAttachments(
  registry: RemoteAttachmentRegistry,
  task: RemoteRunnerTask,
  serverId: string,
  owner: AgentAttachmentOwner,
  authority: RemoteAttachmentAuthority,
): Promise<RemoteTaskAttachments> {
  const parts = task.parts.filter((part) => part.type === "attachment");
  if (parts.length === 0) return NO_ATTACHMENTS;
  if (parts.length > MAX_REMOTE_TASK_ATTACHMENTS) throw new Error("Too many server images.");
  const gateway = authority.gateway;
  if (gateway === null) throw new RemoteAttachmentUnavailableError("notConnected");
  const threadId = remoteAgentThreadKey(serverId, task.runnerId, task.conversationId ?? task.id);
  const context: LoadContext = { task, threadId, serverId, owner, gateway, authority };
  const attachments: AgentAttachment[] = [];
  const discovered = new Set<RemoteAttachmentLoadFailure>();
  let evicted = false;
  try {
    for (const part of parts) {
      assertLoadAuthority(context);
      const resolved = await resolveEntry(registry, context, part.attachmentId);
      evicted ||= resolved.evicted;
      if (resolved.entry.kind === "failed") {
        if (resolved.discovered) discovered.add(resolved.entry.reason);
        continue;
      }
      if (!resolved.authorized) {
        discovered.add("limit");
        continue;
      }
      attachments.push(projectAttachment(resolved.entry, serverId));
    }
  } finally {
    if (evicted) authority.onEvicted?.();
  }
  return { attachments, discovered: [...discovered] };
}

export function remoteAttachmentBlocker(
  registry: RemoteAttachmentRegistry,
  request: StoredAgentAttachmentRequest,
  authority: RemoteAttachmentReadAuthority,
): RemoteAttachmentUnavailableReason | null {
  const gateway = authority.gateway;
  if (gateway === null || !authority.isGatewayCurrent(gateway)) return "notConnected";
  const entry = registry.get(keyOf(request.workspaceId, request.attachmentId));
  if (entry === undefined)
    return authority.isWorkspaceConnected(request.workspaceId) ? "notLoaded" : "notConnected";
  if (entry.kind === "failed") return entry.reason;
  if (!entry.threads.has(request.threadId)) return "foreign";
  if (!authority.ownerIsCurrent(entry.owner)) return "notConnected";
  if (authority.resolveServer(request.threadId) !== entry.serverId) return "foreign";
  return null;
}

export function remoteAttachmentImageMime(
  registry: RemoteAttachmentRegistry,
  request: StoredAgentAttachmentRequest,
): AgentImageMime | null {
  const entry = registry.get(keyOf(request.workspaceId, request.attachmentId));
  if (entry?.kind !== "stored" || entry.attachment.mediaType === "text/plain") return null;
  return entry.attachment.mediaType;
}

export async function readRemoteAttachment(
  registry: RemoteAttachmentRegistry,
  request: StoredAgentAttachmentRequest,
  authority: RemoteAttachmentReadAuthority,
): Promise<ArrayBuffer> {
  const entry = readableEntry(registry, request, authority);
  const gateway = authority.gateway;
  if (gateway?.readAttachment === undefined)
    throw new RemoteAttachmentUnavailableError("unsupported");
  const content = await requestContent(gateway, entry);
  if (readableEntry(registry, request, authority) !== entry)
    throw new RemoteAttachmentUnavailableError("notLoaded");
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

export interface RemoteAttachmentEpoch {
  readonly read: () => number;
  readonly advance: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createRemoteAttachmentEpoch(): RemoteAttachmentEpoch {
  let epoch = 0;
  const listeners = new Set<() => void>();
  return {
    read: () => epoch,
    advance: () => {
      epoch += 1;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function reviseRemoteAttachments(
  registry: RemoteAttachmentRegistry,
  retention: RemoteAttachmentRetention,
): ReadonlySet<string> {
  const invalidated = new Set<string>();
  for (const [key, entry] of registry) {
    if (!retention.ownerIsRetained(entry.owner)) {
      invalidated.add(entry.owner.workspaceId);
      registry.delete(key);
      continue;
    }
    if (entry.kind === "failed") reviseFailure(registry, key, entry, retention);
  }
  return invalidated;
}

function reviseFailure(
  registry: RemoteAttachmentRegistry,
  key: string,
  entry: FailedEntry,
  retention: RemoteAttachmentRetention,
): void {
  if (!retention.ownerIsCurrent(entry.owner)) {
    if (!entry.outageObserved) registry.set(key, { ...entry, outageObserved: true });
    return;
  }
  if (entry.outageObserved) registry.delete(key);
}

function assertLoadAuthority(context: LoadContext): void {
  if (!context.authority.isGatewayCurrent(context.gateway))
    throw new Error("The image owner changed.");
  if (!context.authority.ownerIsCurrent(context.owner))
    throw new RemoteAttachmentUnavailableError("notConnected");
}

async function resolveEntry(
  registry: RemoteAttachmentRegistry,
  context: LoadContext,
  attachmentId: string,
): Promise<ResolvedEntry> {
  const key = keyOf(context.owner.workspaceId, remoteAttachmentDisplayId(attachmentId));
  const cached = registry.get(key);
  if (cached !== undefined && entryMatches(cached, context) && !isStaleLimit(registry, cached))
    return resolution(cached, false, false, context);
  const fetched = await fetchEntry(registry, key, context, attachmentId);
  const settled = registry.get(key);
  const kept =
    settled !== undefined && entryMatches(settled, context) ? reconcile(settled, fetched) : null;
  if (kept !== null) return resolution(kept, false, false, context);
  const before = registry.size;
  const entry = makeRoom(registry, key, fetched.kind, context)
    ? fetched
    : failure(context, "limit");
  const registered = makeRoom(registry, key, entry.kind, context);
  const evicted = registry.size < before;
  if (!registered) return resolution(entry, true, evicted, context);
  registry.set(key, entry);
  return resolution(entry, entry.kind === "failed", evicted, context);
}

function resolution(
  entry: Entry,
  discovered: boolean,
  evicted: boolean,
  context: LoadContext,
): ResolvedEntry {
  return { entry, discovered, evicted, authorized: authorizeThread(entry, context.threadId) };
}

function canStore(registry: RemoteAttachmentRegistry, key: string, context: LoadContext): boolean {
  if (registry.has(key) || registry.size < MAX_REMOTE_ATTACHMENT_ENTRIES) return true;
  for (const entry of registry.values()) {
    if (!entry.threads.has(context.threadId)) return true;
  }
  return false;
}

function isStaleLimit(registry: RemoteAttachmentRegistry, entry: Entry): boolean {
  return (
    entry.kind === "failed" &&
    entry.reason === "limit" &&
    registry.size < MAX_REMOTE_ATTACHMENT_ENTRIES
  );
}

function makeRoom(
  registry: RemoteAttachmentRegistry,
  key: string,
  kind: Entry["kind"],
  context: LoadContext,
): boolean {
  if (registry.has(key)) return true;
  const capacity =
    kind === "stored"
      ? MAX_REMOTE_ATTACHMENT_ENTRIES
      : MAX_REMOTE_ATTACHMENT_ENTRIES + MAX_REMOTE_ATTACHMENT_FAILURES;
  for (const [candidate, entry] of registry) {
    if (registry.size < capacity) break;
    if (!entry.threads.has(context.threadId)) registry.delete(candidate);
  }
  return registry.size < capacity;
}

function entryMatches(entry: Entry, context: LoadContext): boolean {
  return (
    entry.serverId === context.serverId &&
    entry.runnerId === context.task.runnerId &&
    sameAttachmentOwner(entry.owner, context.owner)
  );
}

function reconcile(settled: Entry, fetched: Entry): Entry | null {
  if (settled.kind === "failed") return keepsSettledFailure(settled, fetched) ? settled : null;
  if (fetched.kind === "failed") return settled;
  if (!sameMetadata(settled.attachment, fetched.attachment))
    throw new Error("Server image metadata changed.");
  return settled;
}

function keepsSettledFailure(settled: FailedEntry, fetched: Entry): boolean {
  if (fetched.kind !== "failed") return false;
  return settled.reason !== "limit" || fetched.reason === "limit";
}

function failure(context: LoadContext, reason: RemoteAttachmentLoadFailure): FailedEntry {
  return {
    kind: "failed",
    threads: new Set([context.threadId]),
    reason,
    outageObserved: false,
    owner: context.owner,
    serverId: context.serverId,
    runnerId: context.task.runnerId,
  };
}

async function fetchEntry(
  registry: RemoteAttachmentRegistry,
  key: string,
  context: LoadContext,
  attachmentId: string,
): Promise<Entry> {
  if (!uuid.test(attachmentId)) return failure(context, "loadFailed");
  if (context.gateway.getAttachment === undefined) return failure(context, "unsupported");
  if (!canStore(registry, key, context)) return failure(context, "limit");
  const outcome = await requestMetadata(context, attachmentId);
  assertLoadAuthority(context);
  if (typeof outcome === "string") return failure(context, outcome);
  if (!isOwnMetadata(context, attachmentId, outcome)) return failure(context, "loadFailed");
  return {
    kind: "stored",
    owner: context.owner,
    serverId: context.serverId,
    runnerId: outcome.runnerId,
    attachment: outcome,
    threads: new Set([context.threadId]),
  };
}

function isOwnMetadata(
  context: LoadContext,
  attachmentId: string,
  attachment: RemoteRunnerAttachment,
): boolean {
  try {
    validateRemoteRunnerValue("getAttachment", "response", attachment);
  } catch {
    return false;
  }
  return (
    attachment.runnerId === context.task.runnerId &&
    attachment.id === attachmentId &&
    attachment.bytes <= MAX_BYTES &&
    attachment.bytes >= 1
  );
}

async function requestMetadata(
  context: LoadContext,
  attachmentId: string,
): Promise<RemoteRunnerAttachment | RemoteAttachmentLoadFailure> {
  const getAttachment = context.gateway.getAttachment;
  if (getAttachment === undefined) return "unsupported";
  try {
    return await getAttachment.call(context.gateway, {
      serverId: context.serverId,
      attachmentId,
    });
  } catch (error) {
    if (isTransientRunnerBusyError(error)) throw new RemoteAttachmentUnavailableError("busy");
    if (isNotFound(error)) return "notStored";
    return "loadFailed";
  }
}

async function requestContent(
  gateway: RemoteRunnerGateway,
  entry: StoredEntry,
): Promise<RemoteRunnerAttachmentContent> {
  const readAttachment = gateway.readAttachment;
  if (readAttachment === undefined) throw new RemoteAttachmentUnavailableError("unsupported");
  try {
    return await readAttachment.call(gateway, {
      serverId: entry.serverId,
      attachmentId: entry.attachment.id,
    });
  } catch (error) {
    if (isTransientRunnerBusyError(error)) throw error;
    if (isNotFound(error)) throw new RemoteAttachmentUnavailableError("notStored");
    throw new RemoteAttachmentUnavailableError("readFailed");
  }
}

function isNotFound(error: unknown): boolean {
  return isRemoteRunnerRequestRejectedError(error) && error.message === NOT_FOUND_MESSAGE;
}

function readableEntry(
  registry: RemoteAttachmentRegistry,
  request: StoredAgentAttachmentRequest,
  authority: RemoteAttachmentReadAuthority,
): StoredEntry {
  const blocker = remoteAttachmentBlocker(registry, request, authority);
  if (blocker !== null) throw new RemoteAttachmentUnavailableError(blocker);
  const entry = registry.get(keyOf(request.workspaceId, request.attachmentId));
  if (entry?.kind !== "stored") throw new RemoteAttachmentUnavailableError("notLoaded");
  return entry;
}

function authorizeThread(entry: Entry, threadId: string): boolean {
  if (entry.threads.has(threadId)) return true;
  if (entry.threads.size >= MAX_REMOTE_ATTACHMENT_ENTRIES) return false;
  entry.threads.add(threadId);
  return true;
}

function projectAttachment(entry: StoredEntry, serverId: string): AgentAttachment {
  const image = entry.attachment;
  const attachmentId = remoteAttachmentDisplayId(image.id);
  const remote = { serverId, attachmentId: image.id };
  if (image.mediaType === "text/plain")
    return { kind: "file", attachmentId, name: image.name, bytes: image.bytes, remote };
  return {
    kind: "image",
    attachmentId,
    name: image.name,
    mime: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    remote,
  };
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

function unreachable(value: never): never {
  throw new Error(`Unhandled server image state: ${String(value)}`);
}
