import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
  shrinkAgentImageToFit,
  type AgentImageOutputPolicy,
  type AgentImageSurfacePort,
} from "../domain/agentImageShrink";
import type { AgentAttachmentGateway, StagedAgentAttachment } from "./agentAttachmentPorts";
import { AGENT_TASKS_SOURCE, attempt, errorMessageOf } from "./agentProjectAuthority";
import type { AgentTurnAttachmentIntent } from "./agentThreadPorts";
import { AGENT_ATTACHMENTS_DISCARDED_NOTICE } from "./agentTurnAttachments";

export const AGENT_ATTACHMENT_UNREADABLE_REFUSAL = "The image could not be read.";
export const AGENT_ATTACHMENT_STAGE_FAILURE_PREFIX = "Unable to save the attachment: ";
export const AGENT_ATTACHMENT_MISSING_SOURCE_NOTICE = "This file is no longer at that path";

export function agentAttachmentDuplicateRefusal(name: string): string {
  return `${name} is already attached.`;
}

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
  readonly previewUrl: string | null;
  readonly failure: string | null;
  readonly notice: string | null;
  readonly missing: boolean;
  readonly promptLineBytesMax: number;
}

export interface AgentComposerTurnAttachments {
  readonly owner: AgentAttachmentOwner;
  readonly draftIds: ReadonlyArray<string>;
  readonly intents: ReadonlyArray<AgentTurnAttachmentIntent>;
}

export interface AgentComposerAttachmentsSurface {
  forDraft?(draftKey: string): AgentComposerAttachmentsSurface;
  clearAll?(): void;
  readonly drafts: ReadonlyArray<AgentComposerAttachmentDraft>;
  readonly projectRootKey: string | null;
  readonly staging: boolean;
  readonly blocked: boolean;
  readonly refusal: string | null;
  readonly promptLineBytes: number;
  add(projectRootKey: string, sources: ReadonlyArray<AgentAttachmentSource>): Promise<void>;
  captureIntake?(
    projectRootKey: string,
    isCurrent?: () => boolean,
  ): ((sources: ReadonlyArray<AgentAttachmentSource>) => Promise<void>) | null;
  claimPaste(
    files: ReadonlyArray<AgentAttachmentCandidate>,
    plainTextLength: number,
  ): AgentPasteClaim;
  remove(draftId: string): void;
  clear(): void;
  markSent(draftIds: ReadonlyArray<string>): void;
  refuse(reason: string): void;
  dismissRefusal(): void;
  prepareTurn(projectRootKey: string): Promise<AgentComposerTurnAttachments | null>;
}

export interface AgentComposerAttachmentsDependencies {
  readonly gateway: AgentAttachmentGateway | null;
  readonly imageSurface: AgentImageSurfacePort | null;
  readonly imageOutputPolicy?: AgentImageOutputPolicy;
  readonly sentAttachmentDisposition?: "retain" | "release";
  readonly resolveOwner: (projectRootKey: string) => AgentAttachmentOwner | null;
  readonly reportError: (source: string, error: unknown) => void;
  readonly createDraftId?: () => string;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
}

export interface AgentAttachmentPreviewUrls {
  readonly issue: (bytes: ArrayBuffer, mime: AgentImageMime) => string;
  readonly revoke: (url: string | null) => void;
  readonly revokeAll: () => void;
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
  readonly previews: AgentAttachmentPreviewUrls;
  readonly publish: () => void;
  readonly setRefusal: (reason: string | null) => void;
  readonly ownerIsCurrent: (owner: AgentAttachmentOwner) => boolean;
  readonly storeIsCurrent: () => boolean;
  readonly retainedDrafts: () => ReadonlyArray<AgentComposerAttachmentDraft>;
}

const UTF8_ENCODER = new TextEncoder();
const DRAFT_STORAGE_FULL =
  "Attachment draft storage is full. Remove attachments from another conversation first.";
const MAX_RETAINED_DRAFT_BYTES = 40 * 1024 * 1024;
const MAX_RETAINED_DRAFTS = 32;

export function useAgentComposerAttachments(
  dependencies: AgentComposerAttachmentsDependencies,
): AgentComposerAttachmentsSurface {
  const [, setRevision] = useState(0);
  const dependenciesRef = useRef(dependencies);
  const mountedRef = useRef(true);
  const scopes = useRef(new Map<string, ReturnType<typeof createDraftScope>>());
  const previews = useMemo(
    () => createAgentAttachmentPreviewUrls(() => dependenciesRef.current),
    [],
  );
  const publish = useMemo(
    () => () => {
      if (mountedRef.current) setRevision((revision) => revision + 1);
    },
    [],
  );
  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
    for (const scope of scopes.current.values()) scope.prune();
  });
  useEffect(() => {
    mountedRef.current = true;
    const ownedScopes = scopes.current;
    return () => {
      mountedRef.current = false;
      for (const scope of ownedScopes.values()) scope.clear();
      previews.revokeAll();
    };
  }, [previews]);
  const forDraft = useMemo(
    () =>
      (draftKey: string): AgentComposerAttachmentsSurface => {
        let scope = scopes.current.get(draftKey);
        if (scope === undefined) {
          // Empty scopes are disposable; attachment-bearing drafts are never silently evicted.
          if (scopes.current.size >= 128) {
            for (const [key, candidate] of scopes.current) {
              if (candidate.snapshot().drafts.length === 0 && key !== "") {
                candidate.dispose();
                scopes.current.delete(key);
              }
            }
          }
          if (scopes.current.size >= 128) return unavailableDraftScope();
          scope = createDraftScope(
            () => dependenciesRef.current,
            () => mountedRef.current,
            previews,
            publish,
            () => [...scopes.current.values()].flatMap((candidate) => candidate.snapshot().drafts),
          );
          scopes.current.set(draftKey, scope);
        }
        return scope.snapshot();
      },
    [previews, publish],
  );
  const clearAll = useMemo(
    () => () => {
      for (const scope of scopes.current.values()) scope.clear();
    },
    [],
  );
  return { ...forDraft(""), forDraft, clearAll };
}

function createDraftScope(
  deps: () => AgentComposerAttachmentsDependencies,
  mounted: () => boolean,
  previews: AgentAttachmentPreviewUrls,
  publish: () => void,
  retainedDrafts: () => ReadonlyArray<AgentComposerAttachmentDraft>,
) {
  const store: DraftStore = { projectRootKey: null, drafts: new Map() };
  let disposed = false;
  let epoch = 0;
  let lastGateway = deps().gateway;
  let intakeOwner: AgentAttachmentOwner | null = null;
  let refusal: string | null = null;
  const setRefusal = (reason: string | null) => {
    refusal = reason;
    publish();
  };
  const coordinator = (): DraftCoordinator | null => {
    const gateway = deps().gateway;
    if (gateway === null || disposed) return null;
    lastGateway = gateway;
    const capturedEpoch = epoch;
    return {
      deps,
      gateway,
      store,
      previews,
      publish,
      setRefusal,
      retainedDrafts,
      storeIsCurrent: () => !disposed && epoch === capturedEpoch,
      ownerIsCurrent: (owner) => {
        const current = deps().resolveOwner(owner.projectRootKey);
        return (
          !disposed &&
          epoch === capturedEpoch &&
          deps().gateway === gateway &&
          mounted() &&
          current !== null &&
          sameOwner(current, owner)
        );
      },
    };
  };
  const add = async (
    target: string,
    sources: ReadonlyArray<AgentAttachmentSource>,
  ): Promise<void> => {
    const intake = captureIntake(target);
    if (intake !== null) await intake(sources);
  };
  const captureIntake = (target: string, isCurrent: () => boolean = () => true) => {
    const captured = coordinator();
    const owner = captured?.deps().resolveOwner(target);
    if (captured === null || owner === null || owner === undefined) return null;
    intakeOwner = owner;
    const context: DraftCoordinator = {
      ...captured,
      ownerIsCurrent: (candidate) => isCurrent() && captured.ownerIsCurrent(candidate),
    };
    return async (sources: ReadonlyArray<AgentAttachmentSource>): Promise<void> => {
      if (!context.ownerIsCurrent(owner)) return;
      retarget(context, target);
      for (const source of sources) {
        if (!context.ownerIsCurrent(owner)) return;
        const admitted = await intakeAgentAttachmentSource(context, owner, source);
        if (admitted === "refused-count") return;
      }
    };
  };
  const remove = (draftId: string): void => {
    const context = coordinator();
    if (context === null) return;
    const draft = store.drafts.get(draftId);
    store.drafts.delete(draftId);
    publish();
    if (draft !== undefined) void releaseDraft(context, draft);
  };
  const clear = (): void => {
    epoch += 1;
    intakeOwner = null;
    setRefusal(null);
    for (const draft of store.drafts.values()) {
      previews.revoke(draft.previewUrl);
      if (draft.attachmentId !== null && lastGateway !== null) {
        void lastGateway
          .releaseAgentAttachment({
            workspaceId: draft.owner.workspaceId,
            attachmentId: draft.attachmentId,
          })
          .catch((error: unknown) => deps().reportError(AGENT_TASKS_SOURCE, error));
      }
    }
    store.drafts.clear();
    store.projectRootKey = null;
    publish();
  };
  const markSent = (draftIds: ReadonlyArray<string>): void => {
    const context = coordinator();
    setRefusal(null);
    if (context === null) return;
    for (const draftId of draftIds) {
      const draft = store.drafts.get(draftId);
      if (draft === undefined) continue;
      if (deps().sentAttachmentDisposition === "release") void releaseDraft(context, draft);
      else previews.revoke(draft.previewUrl);
      store.drafts.delete(draftId);
    }
    if (store.drafts.size === 0) store.projectRootKey = null;
    publish();
  };
  const prepareTurn = async (target: string): Promise<AgentComposerTurnAttachments | null> => {
    const context = coordinator();
    return context === null ? null : prepareAgentTurnAttachments(context, target);
  };
  const claimPaste = (files: ReadonlyArray<AgentAttachmentCandidate>, plainTextLength: number) =>
    agentPasteClaim(files, plainTextLength);
  const dismissRefusal = () => setRefusal(null);
  const snapshot = (): AgentComposerAttachmentsSurface => {
    const drafts = [...store.drafts.values()];
    return {
      drafts,
      projectRootKey: store.projectRootKey,
      staging: drafts.some((draft) => draft.state === "staging"),
      blocked: drafts.some((draft) => draft.state !== "ready"),
      refusal,
      promptLineBytes: promptLineBytesOf(drafts),
      add,
      captureIntake,
      claimPaste,
      remove,
      clear,
      markSent,
      refuse: setRefusal,
      dismissRefusal,
      prepareTurn,
    };
  };
  return {
    snapshot,
    clear,
    prune: () => {
      const currentOwner =
        intakeOwner === null ? null : deps().resolveOwner(intakeOwner.projectRootKey);
      if (
        deps().gateway !== lastGateway ||
        (intakeOwner !== null &&
          (currentOwner === null || !sameOwner(intakeOwner, currentOwner))) ||
        [...store.drafts.values()].some((draft) => {
          const owner = deps().resolveOwner(draft.owner.projectRootKey);
          return owner === null || !sameOwner(owner, draft.owner) || deps().gateway !== lastGateway;
        })
      ) {
        const previousRefusal = refusal;
        clear();
        setRefusal(previousRefusal ?? AGENT_ATTACHMENTS_DISCARDED_NOTICE);
        lastGateway = deps().gateway;
      }
    },
    dispose: () => {
      disposed = true;
    },
  };
}

function unavailableDraftScope(): AgentComposerAttachmentsSurface {
  return {
    drafts: [],
    projectRootKey: null,
    staging: false,
    blocked: true,
    refusal: DRAFT_STORAGE_FULL,
    promptLineBytes: 0,
    add: async () => undefined,
    captureIntake: () => null,
    claimPaste: agentPasteClaim,
    remove: () => undefined,
    clear: () => undefined,
    markSent: () => undefined,
    refuse: () => undefined,
    dismissRefusal: () => undefined,
    prepareTurn: async () => null,
  };
}

type IntakeOutcome = "settled" | "refused-count";

async function intakeAgentAttachmentSource(
  context: DraftCoordinator,
  owner: AgentAttachmentOwner,
  source: AgentAttachmentSource,
): Promise<IntakeOutcome> {
  if (context.retainedDrafts().length >= MAX_RETAINED_DRAFTS) {
    context.setRefusal(DRAFT_STORAGE_FULL);
    return "refused-count";
  }
  const admission = admitAgentAttachmentCount(countedDrafts(context));
  if (admission.kind === "refused") {
    context.setRefusal(admission.reason);
    return "refused-count";
  }
  const duplicate = duplicatePathDraft(context, source);
  if (duplicate !== null) {
    context.setRefusal(agentAttachmentDuplicateRefusal(duplicate.name));
    return "settled";
  }
  const draftId = (context.deps().createDraftId ?? defaultDraftId)();
  const candidate = await describeCandidate(context, owner, source);
  if (!context.ownerIsCurrent(owner)) return "settled";
  if (candidate === null) {
    appendDraft(context, failedDraft(draftId, owner, AGENT_ATTACHMENT_PATH_REFUSAL));
    return "settled";
  }
  const plan = planAgentAttachmentIntake(candidate);
  if (plan.kind === "refused") {
    context.setRefusal(plan.reason);
    return "settled";
  }
  if (plan.kind === "reference") {
    if (source.kind !== "path") {
      appendDraft(context, failedDraft(draftId, owner, AGENT_ATTACHMENT_PATH_REFUSAL));
      return "settled";
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
    return "settled";
  }
  const pending = {
    ...blankDraft(draftId, owner, plan.kind, candidate.name),
    path: source.kind === "path" ? source.path : null,
  };
  appendDraft(context, pending);
  if (plan.kind === "file") {
    await stageFileDraft(context, pending, candidate, source);
    return "settled";
  }
  await stageImageDraft(context, pending, candidate, source);
  return "settled";
}

function countedDrafts(context: DraftCoordinator): ReadonlyArray<AttachmentDraft> {
  return [...context.store.drafts.values()].filter((draft) => draft.state !== "failed");
}

function duplicatePathDraft(
  context: DraftCoordinator,
  source: AgentAttachmentSource,
): AttachmentDraft | null {
  if (source.kind !== "path") return null;
  return countedDrafts(context).find((draft) => draft.path === source.path) ?? null;
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
    context.deps().imageOutputPolicy === undefined &&
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
    if (!staged.ok) return;
    await previewStagedPathImage(context, pending, candidate.mime as AgentImageMime, source);
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
    context.deps().imageOutputPolicy,
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
  if (!staged.ok) {
    settleStaged(context, { ...pending, name: shrunk.name }, staged, "image");
    return;
  }
  const previewUrl = context.previews.issue(shrunk.bytes, shrunk.mime);
  settleStaged(context, { ...pending, name: shrunk.name, previewUrl }, staged, "image");
}

async function previewStagedPathImage(
  context: DraftCoordinator,
  pending: AttachmentDraft,
  mime: AgentImageMime,
  source: AgentAttachmentSource,
): Promise<void> {
  const current = context.store.drafts.get(pending.draftId);
  if (current === undefined || current.state !== "ready") return;
  const bytes = await readImageBytes(context, pending.owner, source);
  if (bytes === null) return;
  const latest = context.store.drafts.get(pending.draftId);
  if (!context.ownerIsCurrent(pending.owner) || latest === undefined || latest.state !== "ready") {
    return;
  }
  const previewUrl = context.previews.issue(bytes, mime);
  if (replaceDraft(context, { ...latest, previewUrl })) return;
  context.previews.revoke(previewUrl);
}

async function prepareAgentTurnAttachments(
  context: DraftCoordinator,
  projectRootKey: string,
): Promise<AgentComposerTurnAttachments | null> {
  if (context.store.projectRootKey !== projectRootKey) return null;
  const owner = context.deps().resolveOwner(projectRootKey);
  if (owner === null) return discardStaleDrafts(context);
  const drafts = [...context.store.drafts.values()].filter((draft) => draft.state === "ready");
  if (drafts.length === 0) return { owner, draftIds: [], intents: [] };
  if (drafts.some((draft) => !sameOwner(draft.owner, owner))) return discardStaleDrafts(context);
  for (const draft of drafts) {
    if (draft.kind !== "reference" || draft.path === null) continue;
    const inspected = await attempt(() =>
      context.gateway.inspectAgentAttachmentCandidate({
        workspaceId: owner.workspaceId,
        path: draft.path as string,
      }),
    );
    if (!context.ownerIsCurrent(owner)) return discardStaleDrafts(context);
    markReferenceMissing(context, draft.draftId, !inspected.ok || !inspected.value.isRegularFile);
  }
  if (!context.ownerIsCurrent(owner)) return discardStaleDrafts(context);
  return {
    owner,
    draftIds: drafts.map((draft) => draft.draftId),
    intents: drafts.map(turnAttachmentIntent),
  };
}

function discardStaleDrafts(context: DraftCoordinator): null {
  if (!context.storeIsCurrent()) return null;
  releaseAll(context);
  context.store.projectRootKey = null;
  context.setRefusal(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
  context.publish();
  return null;
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

function settleStaged(
  context: DraftCoordinator,
  pending: AttachmentDraft,
  staged:
    | { readonly ok: true; readonly value: StagedAgentAttachment }
    | { readonly ok: false; readonly error: unknown },
  kind: "image" | "file",
): void {
  if (!context.ownerIsCurrent(pending.owner)) {
    if (staged.ok) void releaseDraft(context, stagedDraft(pending, staged.value, kind));
    discardDraft(context, pending.draftId);
    return;
  }
  if (staged.ok) {
    const settled = stagedDraft(pending, staged.value, kind);
    const retainedBytes = context
      .retainedDrafts()
      .filter((draft) => draft.draftId !== settled.draftId && draft.kind !== "reference")
      .reduce((sum, draft) => sum + draft.bytes, 0);
    if (retainedBytes + settled.bytes > MAX_RETAINED_DRAFT_BYTES) {
      context.setRefusal(DRAFT_STORAGE_FULL);
      void releaseDraft(context, settled);
      discardDraft(context, settled.draftId);
      return;
    }
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
  if (context.retainedDrafts().length >= MAX_RETAINED_DRAFTS) {
    context.setRefusal(DRAFT_STORAGE_FULL);
    return;
  }
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
    previewUrl: null,
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
    previewUrl: null,
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

function createAgentAttachmentPreviewUrls(
  deps: () => AgentComposerAttachmentsDependencies,
): AgentAttachmentPreviewUrls {
  const issued = new Set<string>();

  function revoke(url: string | null): void {
    if (url === null) return;
    if (!issued.delete(url)) return;
    (deps().revokeObjectUrl ?? defaultRevokeObjectUrl)(url);
  }

  return {
    issue: (bytes, mime) => {
      const createObjectUrl = deps().createObjectUrl ?? defaultCreateObjectUrl;
      const url = createObjectUrl(new Blob([bytes], { type: mime }));
      issued.add(url);
      return url;
    },
    revoke,
    revokeAll: () => {
      for (const url of [...issued]) revoke(url);
    },
  };
}

function defaultCreateObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

function defaultRevokeObjectUrl(url: string): void {
  URL.revokeObjectURL(url);
}

function defaultDraftId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
