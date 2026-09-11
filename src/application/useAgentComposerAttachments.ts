import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  MAX_AGENT_IMAGE_BYTES,
  isAgentImageMime,
  type AgentAttachmentKind,
  type AgentImageMime,
} from "../domain/agentAttachment";
import {
  AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL,
  AGENT_ATTACHMENT_OVERSIZED_IMAGE_NOTICE,
  AGENT_ATTACHMENT_PATH_REFUSAL,
  admitAgentAttachmentCount,
  admitAgentAttachmentToTurn,
  agentAttachmentPromptLine,
  agentPasteClaim,
  isAttachableAgentReferencePath,
  planAgentAttachmentIntake,
  sanitizeAgentAttachmentName,
  type AgentAttachmentCandidate,
  type AgentPasteClaim,
} from "../domain/agentAttachmentIntake";
import { shrinkAgentImageToFit, type AgentImageSurfacePort } from "../domain/agentImageShrink";
import type { AgentAttachmentGateway, StagedAgentAttachment } from "./agentAttachmentPorts";
import { AGENT_TASKS_SOURCE, attempt, errorMessageOf } from "./agentProjectAuthority";
import type { AgentTurnAttachmentIntent } from "./agentThreadPorts";

export const AGENT_ATTACHMENT_UNREADABLE_REFUSAL = "The image could not be read.";
export const AGENT_ATTACHMENT_STAGE_FAILURE_PREFIX = "Unable to save the attachment: ";
export const AGENT_ATTACHMENT_MISSING_SOURCE_NOTICE = "This file is no longer at that path";

export interface AgentAttachmentOwner {
  readonly projectRootKey: string;
  readonly ownerId: string;
  readonly generation: number;
  readonly workspaceId: string;
}

export type AgentAttachmentSource =
  | {
      readonly kind: "bytes";
      readonly name: string;
      readonly mime: string;
      readonly bytes: ArrayBuffer;
    }
  | { readonly kind: "path"; readonly path: string };

export type AgentAttachmentDraftState = "staging" | "ready" | "failed";

export interface AgentComposerAttachmentDraft {
  readonly draftId: string;
  readonly kind: AgentAttachmentKind;
  readonly state: AgentAttachmentDraftState;
  readonly name: string;
  readonly bytes: number;
  readonly mime: AgentImageMime | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly attachmentId: string | null;
  readonly path: string | null;
  readonly failure: string | null;
  readonly notice: string | null;
  readonly missing: boolean;
  readonly promptLineBytesMax: number;
}

export interface AgentComposerTurnAttachments {
  readonly owner: AgentAttachmentOwner;
  readonly intents: ReadonlyArray<AgentTurnAttachmentIntent>;
}

export interface AgentComposerAttachmentsSurface {
  readonly drafts: ReadonlyArray<AgentComposerAttachmentDraft>;
  readonly projectRootKey: string | null;
  readonly staging: boolean;
  readonly blocked: boolean;
  readonly refusal: string | null;
  readonly promptLineBytes: number;
  add(projectRootKey: string, sources: ReadonlyArray<AgentAttachmentSource>): Promise<void>;
  claimPaste(
    files: ReadonlyArray<AgentAttachmentCandidate>,
    plainTextLength: number,
  ): AgentPasteClaim;
  remove(draftId: string): void;
  clear(): void;
  markSent(): void;
  dismissRefusal(): void;
  prepareTurn(projectRootKey: string): Promise<AgentComposerTurnAttachments | null>;
}

export interface AgentComposerAttachmentsDependencies {
  readonly gateway: AgentAttachmentGateway | null;
  readonly imageSurface: AgentImageSurfacePort | null;
  readonly resolveOwner: (projectRootKey: string) => AgentAttachmentOwner | null;
  readonly reportError: (source: string, error: unknown) => void;
  readonly createDraftId?: () => string;
}

interface AttachmentDraft extends AgentComposerAttachmentDraft {
  readonly owner: AgentAttachmentOwner;
}

interface DraftStore {
  projectRootKey: string | null;
  readonly drafts: Map<string, AttachmentDraft>;
}

interface DraftCoordinator {
  readonly deps: () => AgentComposerAttachmentsDependencies;
  readonly gateway: AgentAttachmentGateway;
  readonly store: DraftStore;
  readonly publish: () => void;
  readonly setRefusal: (reason: string | null) => void;
  readonly ownerIsCurrent: (owner: AgentAttachmentOwner) => boolean;
}

const UTF8_ENCODER = new TextEncoder();

export function useAgentComposerAttachments(
  dependencies: AgentComposerAttachmentsDependencies,
): AgentComposerAttachmentsSurface {
  const [drafts, setDrafts] = useState<ReadonlyArray<AgentComposerAttachmentDraft>>([]);
  const [projectRootKey, setProjectRootKey] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const storeRef = useRef<DraftStore>({ projectRootKey: null, drafts: new Map() });
  const dependenciesRef = useRef(dependencies);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const publish = useCallback((): void => {
    if (!mountedRef.current) return;
    const store = storeRef.current;
    setProjectRootKey(store.projectRootKey);
    setDrafts([...store.drafts.values()]);
  }, []);

  const coordinator = useCallback((): DraftCoordinator | null => {
    const deps = dependenciesRef.current;
    if (deps.gateway === null) return null;
    return {
      deps: () => dependenciesRef.current,
      gateway: deps.gateway,
      store: storeRef.current,
      publish,
      setRefusal,
      ownerIsCurrent: (owner) => {
        if (!mountedRef.current) return false;
        const current = dependenciesRef.current.resolveOwner(owner.projectRootKey);
        return current !== null && sameOwner(current, owner);
      },
    };
  }, [publish]);

  const add = useCallback(
    async (target: string, sources: ReadonlyArray<AgentAttachmentSource>): Promise<void> => {
      const context = coordinator();
      if (context === null) return;
      const owner = context.deps().resolveOwner(target);
      if (owner === null) return;
      retarget(context, target);
      for (const source of sources) {
        if (!context.ownerIsCurrent(owner)) return;
        await intakeAgentAttachmentSource(context, owner, source);
      }
    },
    [coordinator],
  );

  const remove = useCallback(
    (draftId: string): void => {
      const context = coordinator();
      if (context === null) return;
      const draft = context.store.drafts.get(draftId);
      context.store.drafts.delete(draftId);
      context.publish();
      if (draft !== undefined) void releaseDraft(context, draft);
    },
    [coordinator],
  );

  const clear = useCallback((): void => {
    const context = coordinator();
    setRefusal(null);
    if (context === null) return;
    releaseAll(context);
    context.store.projectRootKey = null;
    context.publish();
  }, [coordinator]);

  const markSent = useCallback((): void => {
    const context = coordinator();
    setRefusal(null);
    if (context === null) return;
    context.store.drafts.clear();
    context.store.projectRootKey = null;
    context.publish();
  }, [coordinator]);

  const prepareTurn = useCallback(
    async (target: string): Promise<AgentComposerTurnAttachments | null> => {
      const context = coordinator();
      if (context === null) return null;
      return prepareAgentTurnAttachments(context, target);
    },
    [coordinator],
  );

  const claimPaste = useCallback(
    (files: ReadonlyArray<AgentAttachmentCandidate>, plainTextLength: number): AgentPasteClaim =>
      agentPasteClaim(files, plainTextLength),
    [],
  );

  const dismissRefusal = useCallback((): void => setRefusal(null), []);

  return {
    drafts,
    projectRootKey,
    staging: drafts.some((draft) => draft.state === "staging"),
    blocked: drafts.some((draft) => draft.state !== "ready"),
    refusal,
    promptLineBytes: promptLineBytesOf(drafts),
    add,
    claimPaste,
    remove,
    clear,
    markSent,
    dismissRefusal,
    prepareTurn,
  };
}

async function intakeAgentAttachmentSource(
  context: DraftCoordinator,
  owner: AgentAttachmentOwner,
  source: AgentAttachmentSource,
): Promise<void> {
  const draftId = (context.deps().createDraftId ?? defaultDraftId)();
  const candidate = await describeCandidate(context, owner, source);
  if (!context.ownerIsCurrent(owner)) return;
  if (candidate === null) {
    appendDraft(context, failedDraft(draftId, owner, AGENT_ATTACHMENT_PATH_REFUSAL));
    return;
  }
  const plan = planAgentAttachmentIntake(candidate);
  if (plan.kind === "refused") {
    context.setRefusal(plan.reason);
    return;
  }
  const admission = admitAgentAttachmentCount(
    [...context.store.drafts.values()].filter((draft) => draft.state !== "failed"),
  );
  if (admission.kind === "refused") {
    context.setRefusal(admission.reason);
    return;
  }
  if (plan.kind === "reference") {
    if (source.kind !== "path") {
      appendDraft(context, failedDraft(draftId, owner, AGENT_ATTACHMENT_PATH_REFUSAL));
      return;
    }
    appendDraft(
      context,
      referenceDraft(
        blankDraft(draftId, owner, "reference", candidate.name),
        candidate.bytes,
        source.path,
        plan.notice,
      ),
    );
    return;
  }
  const pending = blankDraft(draftId, owner, plan.kind, candidate.name);
  appendDraft(context, pending);
  if (plan.kind === "file") {
    await stageFileDraft(context, pending, candidate, source);
    return;
  }
  await stageImageDraft(context, pending, candidate, source);
}

async function stageFileDraft(
  context: DraftCoordinator,
  pending: AttachmentDraft,
  candidate: AgentAttachmentCandidate,
  source: AgentAttachmentSource,
): Promise<void> {
  if (source.kind !== "bytes") {
    settleDraft(context, pending, failed(pending, AGENT_ATTACHMENT_PATH_REFUSAL));
    return;
  }
  const staged = await attempt(() =>
    context.gateway.stageAgentAttachmentBytes({
      workspaceId: pending.owner.workspaceId,
      kind: "file",
      name: candidate.name,
      mime: null,
      width: null,
      height: null,
      bytes: source.bytes,
    }),
  );
  settleStaged(context, pending, staged, "file");
}

async function stageImageDraft(
  context: DraftCoordinator,
  pending: AttachmentDraft,
  candidate: AgentAttachmentCandidate,
  source: AgentAttachmentSource,
): Promise<void> {
  const owner = pending.owner;
  if (
    source.kind === "path" &&
    candidate.bytes <= MAX_AGENT_IMAGE_BYTES &&
    isAgentImageMime(candidate.mime)
  ) {
    const staged = await attempt(() =>
      context.gateway.stageAgentAttachmentFromPath({
        workspaceId: owner.workspaceId,
        kind: "image",
        name: candidate.name,
        mime: candidate.mime as AgentImageMime,
        path: source.path,
      }),
    );
    settleStaged(context, pending, staged, "image");
    return;
  }
  const bytes = await readImageBytes(context, owner, source);
  if (!context.ownerIsCurrent(owner)) {
    discardDraft(context, pending.draftId);
    return;
  }
  const surface = context.deps().imageSurface;
  if (bytes === null || surface === null) {
    settleDraft(context, pending, failed(pending, AGENT_ATTACHMENT_UNREADABLE_REFUSAL));
    return;
  }
  const shrunk = await shrinkAgentImageToFit(
    { name: candidate.name, mime: candidate.mime, bytes },
    surface,
  );
  if (!context.ownerIsCurrent(owner)) {
    discardDraft(context, pending.draftId);
    return;
  }
  if (shrunk.kind === "refused") {
    settleDraft(context, pending, refusedImageDraft(pending, candidate, source, shrunk.reason));
    return;
  }
  const staged = await attempt(() =>
    context.gateway.stageAgentAttachmentBytes({
      workspaceId: owner.workspaceId,
      kind: "image",
      name: shrunk.name,
      mime: shrunk.mime,
      width: shrunk.width,
      height: shrunk.height,
      bytes: shrunk.bytes,
    }),
  );
  settleStaged(context, { ...pending, name: shrunk.name }, staged, "image");
}

async function prepareAgentTurnAttachments(
  context: DraftCoordinator,
  projectRootKey: string,
): Promise<AgentComposerTurnAttachments | null> {
  if (context.store.projectRootKey !== projectRootKey) return null;
  const owner = context.deps().resolveOwner(projectRootKey);
  if (owner === null) return null;
  const drafts = [...context.store.drafts.values()].filter((draft) => draft.state === "ready");
  if (drafts.length === 0) return { owner, intents: [] };
  if (drafts.some((draft) => !sameOwner(draft.owner, owner))) return null;
  for (const draft of drafts) {
    if (draft.kind !== "reference" || draft.path === null) continue;
    const inspected = await attempt(() =>
      context.gateway.inspectAgentAttachmentCandidate({
        workspaceId: owner.workspaceId,
        path: draft.path as string,
      }),
    );
    if (!context.ownerIsCurrent(owner)) return null;
    markReferenceMissing(context, draft.draftId, !inspected.ok || !inspected.value.isRegularFile);
  }
  if (!context.ownerIsCurrent(owner)) return null;
  return { owner, intents: drafts.map(turnAttachmentIntent) };
}

async function describeCandidate(
  context: DraftCoordinator,
  owner: AgentAttachmentOwner,
  source: AgentAttachmentSource,
): Promise<AgentAttachmentCandidate | null> {
  if (source.kind === "bytes") {
    return {
      name: sanitizeAgentAttachmentName(source.name),
      mime: source.mime,
      hasPath: false,
      bytes: source.bytes.byteLength,
    };
  }
  if (!isAttachableAgentReferencePath(source.path)) return null;
  const inspected = await attempt(() =>
    context.gateway.inspectAgentAttachmentCandidate({
      workspaceId: owner.workspaceId,
      path: source.path,
    }),
  );
  if (!inspected.ok) {
    context.deps().reportError(AGENT_TASKS_SOURCE, inspected.error);
    return null;
  }
  if (!inspected.value.isRegularFile) return null;
  return {
    name: sanitizeAgentAttachmentName(source.path),
    mime: inspected.value.extensionMime ?? "",
    hasPath: true,
    bytes: inspected.value.bytes,
  };
}

async function readImageBytes(
  context: DraftCoordinator,
  owner: AgentAttachmentOwner,
  source: AgentAttachmentSource,
): Promise<ArrayBuffer | null> {
  if (source.kind === "bytes") return source.bytes;
  const read = await attempt(() =>
    context.gateway.readAgentAttachmentCandidate({
      workspaceId: owner.workspaceId,
      path: source.path,
    }),
  );
  if (read.ok) return read.value;
  context.deps().reportError(AGENT_TASKS_SOURCE, read.error);
  return null;
}

async function releaseDraft(context: DraftCoordinator, draft: AttachmentDraft): Promise<void> {
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

function settleStaged(
  context: DraftCoordinator,
  pending: AttachmentDraft,
  staged:
    | { readonly ok: true; readonly value: StagedAgentAttachment }
    | { readonly ok: false; readonly error: unknown },
  kind: "image" | "file",
): void {
  if (staged.ok) {
    const settled = stagedDraft(pending, staged.value, kind);
    const admission = admitAgentAttachmentToTurn(otherDrafts(context, settled.draftId), settled);
    if (admission.kind === "refused") {
      context.setRefusal(admission.reason);
      void releaseDraft(context, settled);
      discardDraft(context, settled.draftId);
      return;
    }
    settleDraft(context, pending, settled);
    return;
  }
  context.deps().reportError(AGENT_TASKS_SOURCE, staged.error);
  settleDraft(
    context,
    pending,
    failed(pending, `${AGENT_ATTACHMENT_STAGE_FAILURE_PREFIX}${errorMessageOf(staged.error)}`),
  );
}

function otherDrafts(context: DraftCoordinator, draftId: string): ReadonlyArray<AttachmentDraft> {
  return [...context.store.drafts.values()].filter(
    (draft) => draft.draftId !== draftId && draft.state !== "failed",
  );
}

function settleDraft(
  context: DraftCoordinator,
  pending: AttachmentDraft,
  settled: AttachmentDraft,
): void {
  if (context.ownerIsCurrent(pending.owner) && replaceDraft(context, settled)) return;
  void releaseDraft(context, settled);
  discardDraft(context, pending.draftId);
}

function retarget(context: DraftCoordinator, projectRootKey: string): void {
  if (context.store.projectRootKey === projectRootKey) return;
  releaseAll(context);
  context.store.projectRootKey = projectRootKey;
  context.publish();
}

function releaseAll(context: DraftCoordinator): void {
  for (const draft of [...context.store.drafts.values()]) void releaseDraft(context, draft);
  context.store.drafts.clear();
}

function appendDraft(context: DraftCoordinator, draft: AttachmentDraft): void {
  if (context.store.projectRootKey !== draft.owner.projectRootKey) return;
  context.store.drafts.set(draft.draftId, draft);
  context.publish();
}

function replaceDraft(context: DraftCoordinator, draft: AttachmentDraft): boolean {
  if (context.store.projectRootKey !== draft.owner.projectRootKey) return false;
  if (!context.store.drafts.has(draft.draftId)) return false;
  context.store.drafts.set(draft.draftId, draft);
  context.publish();
  return true;
}

function discardDraft(context: DraftCoordinator, draftId: string): void {
  if (!context.store.drafts.delete(draftId)) return;
  context.publish();
}

function markReferenceMissing(context: DraftCoordinator, draftId: string, missing: boolean): void {
  const draft = context.store.drafts.get(draftId);
  if (draft === undefined) return;
  context.store.drafts.set(draftId, {
    ...draft,
    missing,
    notice: missing ? AGENT_ATTACHMENT_MISSING_SOURCE_NOTICE : draft.notice,
  });
  context.publish();
}

function refusedImageDraft(
  pending: AttachmentDraft,
  candidate: AgentAttachmentCandidate,
  source: AgentAttachmentSource,
  reason: "unreadable" | "too-large",
): AttachmentDraft {
  if (reason === "unreadable" && source.kind === "path") {
    return referenceDraft(
      pending,
      candidate.bytes,
      source.path,
      AGENT_ATTACHMENT_OVERSIZED_IMAGE_NOTICE,
    );
  }
  if (reason === "too-large") return failed(pending, AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL);
  return failed(pending, AGENT_ATTACHMENT_UNREADABLE_REFUSAL);
}

function referenceDraft(
  pending: AttachmentDraft,
  bytes: number,
  path: string,
  notice: string | null,
): AttachmentDraft {
  return {
    ...pending,
    kind: "reference",
    state: "ready",
    bytes,
    path,
    attachmentId: null,
    mime: null,
    width: null,
    height: null,
    failure: null,
    notice,
    promptLineBytesMax: promptLineBytes({
      kind: "reference",
      name: pending.name,
      path,
      bytes,
    }),
  };
}

function stagedDraft(
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

function failed(pending: AttachmentDraft, failure: string): AttachmentDraft {
  return { ...pending, state: "failed", failure };
}

function failedDraft(
  draftId: string,
  owner: AgentAttachmentOwner,
  failure: string,
): AttachmentDraft {
  return failed(blankDraft(draftId, owner, "reference", "attachment"), failure);
}

function blankDraft(
  draftId: string,
  owner: AgentAttachmentOwner,
  kind: AgentAttachmentKind,
  name: string,
): AttachmentDraft {
  return {
    draftId,
    owner,
    kind,
    state: "staging",
    name,
    bytes: 0,
    mime: null,
    width: null,
    height: null,
    attachmentId: null,
    path: null,
    failure: null,
    notice: null,
    missing: false,
    promptLineBytesMax: 0,
  };
}

function turnAttachmentIntent(draft: AttachmentDraft): AgentTurnAttachmentIntent {
  if (draft.kind === "reference") {
    return { kind: "reference", name: draft.name, path: draft.path ?? "", bytes: draft.bytes };
  }
  return {
    kind: "staged",
    attachmentId: draft.attachmentId ?? "",
    name: draft.name,
    bytes: draft.bytes,
    mime: draft.mime,
    width: draft.width,
    height: draft.height,
  };
}

function promptLineBytesOf(drafts: ReadonlyArray<AgentComposerAttachmentDraft>): number {
  const lines = drafts.filter((draft) => draft.state === "ready");
  if (lines.length === 0) return 0;
  const separators = lines.length - 1;
  return lines.reduce((total, draft) => total + draft.promptLineBytesMax, separators);
}

function promptLineBytes(attachment: {
  readonly kind: "reference";
  readonly name: string;
  readonly path: string;
  readonly bytes: number;
}): number {
  return UTF8_ENCODER.encode(agentAttachmentPromptLine(attachment)).byteLength;
}

function sameOwner(left: AgentAttachmentOwner, right: AgentAttachmentOwner): boolean {
  return (
    left.projectRootKey === right.projectRootKey &&
    left.ownerId === right.ownerId &&
    left.generation === right.generation &&
    left.workspaceId === right.workspaceId
  );
}

function defaultDraftId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
