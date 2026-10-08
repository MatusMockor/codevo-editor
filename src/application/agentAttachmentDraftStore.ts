import type { AgentAttachmentKind } from "../domain/agentAttachment";
import {
  agentReferencePromptLine,
  type AgentReferenceEntry,
  type AgentReferenceIdentity,
} from "../domain/agentReferenceEntry";
import {
  agentAttachmentCarrySourceBytes,
  type AgentAttachmentCarrySource,
} from "./agentAttachmentCarry";
import type { AgentAttachmentIntakeTicket } from "./agentAttachmentIntakeTickets";
import type { AgentAttachmentGateway, StagedAgentAttachment } from "./agentAttachmentPorts";
import { AGENT_TASKS_SOURCE, attempt } from "./agentProjectAuthority";
import type {
  AgentAttachmentOwner,
  AgentAttachmentPreviewUrls,
  AgentAttachmentSource,
  AgentComposerAttachmentDraft,
  AgentComposerAttachmentsDependencies,
} from "./useAgentComposerAttachments";

export const AGENT_ATTACHMENT_UNREADABLE_REFUSAL = "The image could not be read.";

export function agentAttachmentDuplicateRefusal(name: string): string {
  return `${name} is already attached.`;
}

export interface AttachmentDraft extends AgentComposerAttachmentDraft {
  readonly owner: AgentAttachmentOwner;
}

export interface DraftStore {
  projectRootKey: string | null;
  readonly drafts: Map<string, AttachmentDraft>;
  readonly held: Map<string, { readonly anchor: AttachmentDraft; readonly draft: AttachmentDraft }>;
  readonly sources: Map<string, AgentAttachmentCarrySource>;
  readonly carried: Set<string>;
  readonly queued: Set<AgentAttachmentSource>;
  readonly tickets: Map<AgentAttachmentIntakeTicket, AgentAttachmentOwner>;
}

export interface DraftCoordinator {
  readonly deps: () => AgentComposerAttachmentsDependencies;
  readonly gateway: AgentAttachmentGateway;
  readonly store: DraftStore;
  readonly previews: AgentAttachmentPreviewUrls;
  readonly publish: () => void;
  readonly setRefusal: (reason: string | null) => void;
  readonly ownerIsCurrent: (owner: AgentAttachmentOwner) => boolean;
  readonly storeIsCurrent: () => boolean;
  readonly retainedDrafts: () => ReadonlyArray<AgentComposerAttachmentDraft>;
}

const UTF8_ENCODER = new TextEncoder();

export const DRAFT_STORAGE_FULL =
  "Attachment draft storage is full. Remove attachments from another conversation first.";

export const MAX_RETAINED_DRAFT_BYTES = 40 * 1024 * 1024;

export const MAX_RETAINED_DRAFTS = 32;

export function countedDrafts(context: DraftCoordinator): ReadonlyArray<AttachmentDraft> {
  return [...context.store.drafts.values()].filter((draft) => draft.state !== "failed");
}

export function composerDrafts(store: DraftStore): AttachmentDraft[] {
  return [...store.drafts.values()].filter((draft) => !store.held.has(draft.draftId));
}

export function duplicatePathDraft(
  context: DraftCoordinator,
  source: AgentAttachmentSource,
): AttachmentDraft | null {
  if (source.kind !== "path") return null;
  return countedDrafts(context).find((draft) => draft.path === source.path) ?? null;
}

export function otherDrafts(
  context: DraftCoordinator,
  draftId: string,
): ReadonlyArray<AttachmentDraft> {
  return [...context.store.drafts.values()].filter(
    (draft) => draft.draftId !== draftId && draft.state !== "failed",
  );
}

export async function releaseDraft(
  context: DraftCoordinator,
  draft: AttachmentDraft,
): Promise<void> {
  context.previews.revoke(draft.previewUrl);
  const attachmentId = draft.attachmentId;
  if (attachmentId === null) return;
  const released = await attempt(() =>
    context.gateway.releaseAgentAttachment({
      workspaceId: draft.owner.workspaceId,
      attachmentId,
    }),
  );
  if (released.ok) return;
  context.deps().reportError(AGENT_TASKS_SOURCE, released.error);
}

export function settleDraft(
  context: DraftCoordinator,
  pending: AttachmentDraft,
  settled: AttachmentDraft,
  source: AgentAttachmentCarrySource | null = null,
): void {
  if (context.ownerIsCurrent(pending.owner) && replaceDraft(context, settled)) {
    if (source !== null) context.store.sources.set(settled.draftId, source);
    return;
  }
  void releaseDraft(context, settled);
  discardDraft(context, pending.draftId);
}

export function forgetDrafts(store: DraftStore): void {
  store.drafts.clear();
  store.held.clear();
  store.sources.clear();
  store.carried.clear();
}

export function forgetDraft(store: DraftStore, draftId: string): boolean {
  store.held.delete(draftId);
  store.sources.delete(draftId);
  store.carried.delete(draftId);
  return store.drafts.delete(draftId);
}

export function appendDraft(
  context: DraftCoordinator,
  draft: AttachmentDraft,
  source: AgentAttachmentCarrySource | null = null,
): void {
  if (context.store.projectRootKey !== draft.owner.projectRootKey) return;
  if (context.retainedDrafts().length >= MAX_RETAINED_DRAFTS) {
    context.setRefusal(DRAFT_STORAGE_FULL);
    return;
  }
  context.store.drafts.set(draft.draftId, draft);
  if (source !== null) context.store.sources.set(draft.draftId, source);
  context.publish();
}

export function replaceDraft(context: DraftCoordinator, draft: AttachmentDraft): boolean {
  if (context.store.projectRootKey !== draft.owner.projectRootKey) return false;
  if (!context.store.drafts.has(draft.draftId)) return false;
  context.store.drafts.set(draft.draftId, draft);
  if (draft.state === "failed") boundFailedSources(context.store);
  context.publish();
  return true;
}

export function discardDraft(context: DraftCoordinator, draftId: string): void {
  if (!forgetDraft(context.store, draftId)) return;
  context.publish();
}

export function boundFailedSources(store: DraftStore): void {
  let retained = 0;
  for (const draft of store.drafts.values()) {
    const source = store.sources.get(draft.draftId);
    if (draft.state !== "failed" || source === undefined) continue;
    const bytes = agentAttachmentCarrySourceBytes(source);
    if (!store.carried.has(draft.draftId) || retained + bytes > MAX_RETAINED_DRAFT_BYTES) {
      store.sources.delete(draft.draftId);
      continue;
    }
    retained += bytes;
  }
}

export function referenceDraft(
  pending: AttachmentDraft,
  bytes: number,
  path: string,
  notice: string | null,
  entry: AgentReferenceEntry,
): AttachmentDraft {
  return {
    ...pending,
    kind: "reference",
    entry,
    state: "ready",
    bytes,
    path,
    previewUrl: null,
    attachmentId: null,
    mime: null,
    width: null,
    height: null,
    failure: null,
    notice,
    promptLineBytesMax: referencePromptLineBytes({ name: pending.name, path }, entry),
  };
}

export function stagedDraft(
  pending: AttachmentDraft,
  staged: StagedAgentAttachment,
  kind: "image" | "file",
): AttachmentDraft {
  return {
    ...pending,
    kind,
    state: "ready",
    name: staged.name,
    bytes: staged.bytes,
    mime: staged.mime,
    width: staged.width,
    height: staged.height,
    attachmentId: staged.attachmentId,
    failure: null,
    promptLineBytesMax: staged.promptLineBytesMax,
  };
}

export function failed(pending: AttachmentDraft, failure: string): AttachmentDraft {
  return { ...pending, state: "failed", failure };
}

export function failedDraft(
  draftId: string,
  owner: AgentAttachmentOwner,
  failure: string,
): AttachmentDraft {
  return failed(blankDraft(draftId, owner, "reference", "attachment"), failure);
}

export function blankDraft(
  draftId: string,
  owner: AgentAttachmentOwner,
  kind: AgentAttachmentKind,
  name: string,
): AttachmentDraft {
  return {
    draftId,
    owner,
    kind,
    entry: "file",
    state: "staging",
    name,
    bytes: 0,
    mime: null,
    width: null,
    height: null,
    attachmentId: null,
    path: null,
    previewUrl: null,
    failure: null,
    notice: null,
    missing: false,
    promptLineBytesMax: 0,
  };
}

export function referencePromptLineBytes(
  reference: AgentReferenceIdentity,
  entry: AgentReferenceEntry,
): number {
  return UTF8_ENCODER.encode(agentReferencePromptLine(reference, entry)).byteLength;
}

export function sameOwner(left: AgentAttachmentOwner, right: AgentAttachmentOwner): boolean {
  return (
    left.projectRootKey === right.projectRootKey &&
    left.ownerId === right.ownerId &&
    left.generation === right.generation &&
    left.workspaceId === right.workspaceId
  );
}

export function defaultDraftId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
