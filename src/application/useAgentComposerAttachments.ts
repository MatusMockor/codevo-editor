import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type AgentAttachmentKind, type AgentImageMime } from "../domain/agentAttachment";
import {
  AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL,
  AGENT_ATTACHMENT_IMAGE_DIMENSIONS_REFUSAL,
  AGENT_ATTACHMENT_OVERSIZED_IMAGE_NOTICE,
  AGENT_ATTACHMENT_PATH_REFUSAL,
  AGENT_ATTACHMENT_UNDECODABLE_IMAGE_NOTICE,
  admitAgentAttachmentCount,
  admitAgentAttachmentToTurn,
  agentPasteClaim,
  planAgentAttachmentIntake,
  type AgentAttachmentCandidate,
  type AgentPasteClaim,
} from "../domain/agentAttachmentIntake";
import {
  shrinkAgentImageToFit,
  type AgentImageOutputPolicy,
  type AgentImageShrinkOutcome,
  type AgentImageShrinkRefusal,
  type AgentImageSurfacePort,
} from "../domain/agentImageShrink";
import type { AgentAttachmentGateway, StagedAgentAttachment } from "./agentAttachmentPorts";
import {
  issueAgentAttachmentCarry,
  redeemAgentAttachmentCarry,
  type AgentAttachmentCarry,
  type AgentAttachmentCarrySource,
} from "./agentAttachmentCarry";
import { carryItems, importCarriedDrafts } from "./agentAttachmentCarriedIntake";
import {
  AGENT_ATTACHMENT_UNREADABLE_REFUSAL,
  agentAttachmentDuplicateRefusal,
  appendDraft,
  blankDraft,
  composerDrafts,
  countedDrafts,
  defaultDraftId,
  discardDraft,
  DRAFT_STORAGE_FULL,
  duplicatePathDraft,
  failed,
  failedDraft,
  forgetDraft,
  forgetDrafts,
  MAX_RETAINED_DRAFT_BYTES,
  MAX_RETAINED_DRAFTS,
  otherDrafts,
  referenceDraft,
  releaseDraft,
  replaceDraft,
  sameOwner,
  settleDraft,
  stagedDraft,
  type AttachmentDraft,
  type DraftCoordinator,
  type DraftStore,
} from "./agentAttachmentDraftStore";
import {
  AGENT_ATTACHMENT_INTAKE_BUSY_REFUSAL,
  AGENT_ATTACHMENT_INTAKE_UNAVAILABLE_REFUSAL,
  agentAttachmentIntakeTicketIsOpen,
  MAX_PENDING_AGENT_ATTACHMENT_INTAKES,
  openAgentAttachmentIntakeTicket,
  type AgentAttachmentIntakeTicket,
} from "./agentAttachmentIntakeTickets";
import { describeAgentAttachmentSource } from "./agentAttachmentPathIntake";
import { AGENT_TASKS_SOURCE, attempt, errorMessageOf } from "./agentProjectAuthority";
import type { AgentTurnAttachmentIntent } from "./agentThreadPorts";
import { AGENT_ATTACHMENTS_DISCARDED_NOTICE } from "./agentTurnAttachments";

export {
  AGENT_ATTACHMENT_UNREADABLE_REFUSAL,
  agentAttachmentDuplicateRefusal,
} from "./agentAttachmentDraftStore";
export const AGENT_ATTACHMENT_STAGE_FAILURE_PREFIX = "Unable to save the attachment: ";
export const AGENT_ATTACHMENT_MISSING_SOURCE_NOTICE = "This path is no longer available";

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
  readonly revision?: number;
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
  holdForSend?(draftIds: ReadonlyArray<string>): ReadonlyArray<AgentComposerAttachmentDraft>;
  sendHoldIsCurrent?(drafts: ReadonlyArray<AgentComposerAttachmentDraft>): boolean;
  settleSendHold?(drafts: ReadonlyArray<AgentComposerAttachmentDraft>, delivered: boolean): void;
  returnToComposer?(draftIds: ReadonlyArray<string>): void;
  refuse(reason: string): void;
  dismissRefusal(): void;
  prepareTurn(projectRootKey: string): Promise<AgentComposerTurnAttachments | null>;
  releaseForCarry?(): AgentAttachmentCarry | null;
  acceptCarry?(projectRootKey: string, take: () => AgentAttachmentCarry | null): boolean;
  readonly pendingIntake?: boolean;
  openIntake?(projectRootKey: string): AgentAttachmentIntakeTicket | null;
  holdsIntake?(ticket: AgentAttachmentIntakeTicket): boolean;
  continueIntake?(
    ticket: AgentAttachmentIntakeTicket,
    isCurrent: () => boolean,
  ): ((sources: ReadonlyArray<AgentAttachmentSource>) => Promise<void>) | null;
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
  readonly issue: (blob: Blob) => string;
  readonly revoke: (url: string | null) => void;
  readonly revokeAll: () => void;
}

export function useAgentComposerAttachments(
  dependencies: AgentComposerAttachmentsDependencies,
): AgentComposerAttachmentsSurface {
  const [revision, setRevision] = useState(0);
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
              if (candidate.retained().length === 0 && key !== "") {
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
            () => [...scopes.current.values()].flatMap((candidate) => candidate.retained()),
          );
          scopes.current.set(draftKey, scope);
        }
        return scope.snapshot();
      },
    [previews, publish],
  );
  const clearAll = useMemo(
    () => () => {
      for (const scope of scopes.current.values()) scope.discard();
    },
    [],
  );
  return { ...forDraft(""), forDraft, clearAll, revision };
}

function createDraftScope(
  deps: () => AgentComposerAttachmentsDependencies,
  mounted: () => boolean,
  previews: AgentAttachmentPreviewUrls,
  publish: () => void,
  retainedDrafts: () => ReadonlyArray<AgentComposerAttachmentDraft>,
) {
  const store: DraftStore = {
    projectRootKey: null,
    drafts: new Map(),
    held: new Map(),
    sources: new Map(),
    carried: new Set(),
    queued: new Set(),
    tickets: new Map(),
  };
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
      for (const source of sources) store.queued.add(source);
      try {
        for (const source of sources) {
          if (!context.ownerIsCurrent(owner)) return;
          const admitted = await intakeAgentAttachmentSource(context, owner, source);
          store.queued.delete(source);
          if (admitted === "refused-count") return;
        }
      } finally {
        for (const source of sources) store.queued.delete(source);
      }
    };
  };
  const holdsIntake = (ticket: AgentAttachmentIntakeTicket): boolean => {
    const owner = store.tickets.get(ticket);
    if (disposed || owner === undefined || !agentAttachmentIntakeTicketIsOpen(ticket)) return false;
    const live = deps().resolveOwner(owner.projectRootKey);
    return live !== null && sameOwner(live, owner);
  };
  const pendingTickets = (): ReadonlyArray<AgentAttachmentIntakeTicket> => {
    for (const ticket of [...store.tickets.keys()]) {
      if (!agentAttachmentIntakeTicketIsOpen(ticket)) store.tickets.delete(ticket);
    }
    return [...store.tickets.keys()];
  };
  const openIntake = (target: string): AgentAttachmentIntakeTicket | null => {
    const owner = deps().resolveOwner(target);
    if (coordinator() === null || owner === null) {
      setRefusal(AGENT_ATTACHMENT_INTAKE_UNAVAILABLE_REFUSAL);
      return null;
    }
    if (pendingTickets().length >= MAX_PENDING_AGENT_ATTACHMENT_INTAKES) {
      setRefusal(AGENT_ATTACHMENT_INTAKE_BUSY_REFUSAL);
      return null;
    }
    const ticket = openAgentAttachmentIntakeTicket();
    store.tickets.set(ticket, owner);
    return ticket;
  };
  const continueIntake = (ticket: AgentAttachmentIntakeTicket, isCurrent: () => boolean) => {
    const owner = store.tickets.get(ticket);
    if (owner === undefined || !holdsIntake(ticket)) return null;
    return captureIntake(owner.projectRootKey, () => holdsIntake(ticket) && isCurrent());
  };
  const remove = (draftId: string): void => {
    const context = coordinator();
    if (context === null) return;
    const draft = store.drafts.get(draftId);
    forgetDraft(store, draftId);
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
    forgetDrafts(store);
    store.queued.clear();
    store.tickets.clear();
    store.projectRootKey = null;
    publish();
  };
  const discard = (): void => {
    const previousRefusal = refusal;
    const discarded = store.drafts.size > 0;
    clear();
    setRefusal(discarded ? AGENT_ATTACHMENTS_DISCARDED_NOTICE : previousRefusal);
  };
  const prune = (): void => {
    const currentOwner =
      intakeOwner === null ? null : deps().resolveOwner(intakeOwner.projectRootKey);
    if (
      deps().gateway !== lastGateway ||
      (intakeOwner !== null && (currentOwner === null || !sameOwner(intakeOwner, currentOwner))) ||
      [...store.drafts.values()].some((draft) => {
        const owner = deps().resolveOwner(draft.owner.projectRootKey);
        return owner === null || !sameOwner(owner, draft.owner) || deps().gateway !== lastGateway;
      })
    ) {
      discard();
      lastGateway = deps().gateway;
    }
  };
  const releaseForCarry = (): AgentAttachmentCarry | null => {
    prune();
    if (disposed || store.held.size > 0) return null;
    const carry = issueAgentAttachmentCarry(carryItems(store), pendingTickets());
    if (carry !== null) clear();
    return carry;
  };
  const acceptCarry = (target: string, take: () => AgentAttachmentCarry | null): boolean => {
    prune();
    if (coordinator() === null || deps().resolveOwner(target) === null) return false;
    const { items, tickets } = redeemAgentAttachmentCarry(take());
    const captured = coordinator();
    const owner = deps().resolveOwner(target);
    if (captured === null || owner === null) return false;
    for (const ticket of tickets) store.tickets.set(ticket, owner);
    if (items.length === 0) return true;
    intakeOwner = owner;
    retarget(captured, target);
    void importCarriedDrafts(captured, owner, items, CARRIED_STAGING);
    return true;
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
      forgetDraft(store, draftId);
    }
    if (store.drafts.size === 0) store.projectRootKey = null;
    publish();
  };
  const holdForSend = (draftIds: ReadonlyArray<string>): ReadonlyArray<AttachmentDraft> => {
    const held: AttachmentDraft[] = [];
    for (const draftId of draftIds) {
      const draft = store.drafts.get(draftId);
      if (draft === undefined || draft.state !== "ready") continue;
      const lease = store.held.get(draftId) ?? { anchor: draft, draft };
      store.held.set(draftId, lease);
      held.push(lease.anchor);
    }
    if (held.length > 0) publish();
    return held;
  };
  const returnToComposer = (draftIds: ReadonlyArray<string>): void => {
    let returned = false;
    for (const draftId of draftIds) returned = store.held.delete(draftId) || returned;
    if (returned) publish();
  };
  const prepareTurn = async (target: string): Promise<AgentComposerTurnAttachments | null> => {
    const context = coordinator();
    return context === null ? null : prepareAgentTurnAttachments(context, target);
  };
  const claimPaste = (files: ReadonlyArray<AgentAttachmentCandidate>, plainTextLength: number) =>
    agentPasteClaim(files, plainTextLength);
  const dismissRefusal = () => setRefusal(null);
  const snapshot = (): AgentComposerAttachmentsSurface => {
    const drafts = composerDrafts(store);
    const capturedEpoch = epoch;
    const capturedGateway = deps().gateway;
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
      holdForSend,
      sendHoldIsCurrent: (heldDrafts) =>
        !disposed &&
        mounted() &&
        epoch === capturedEpoch &&
        deps().gateway === capturedGateway &&
        heldDrafts.every((draft) => {
          const lease = store.held.get(draft.draftId);
          if (
            lease?.anchor !== draft ||
            lease.draft !== store.drafts.get(draft.draftId) ||
            lease.draft.state !== "ready"
          )
            return false;
          const owner = deps().resolveOwner(lease.draft.owner.projectRootKey);
          return owner !== null && sameOwner(owner, lease.draft.owner);
        }),
      settleSendHold: (heldDrafts, delivered) => {
        if (disposed || epoch !== capturedEpoch || deps().gateway !== capturedGateway) return;
        const draftIds = heldDrafts
          .filter((draft) => {
            const lease = store.held.get(draft.draftId);
            return lease?.anchor === draft && lease.draft === store.drafts.get(draft.draftId);
          })
          .map((draft) => draft.draftId);
        if (delivered) markSent(draftIds);
        else returnToComposer(draftIds);
      },
      returnToComposer,
      refuse: setRefusal,
      dismissRefusal,
      prepareTurn,
      releaseForCarry,
      acceptCarry,
      pendingIntake: store.queued.size > 0 || pendingTickets().length > 0,
      openIntake,
      holdsIntake,
      continueIntake,
    };
  };
  return {
    snapshot,
    retained: (): ReadonlyArray<AgentComposerAttachmentDraft> => [...store.drafts.values()],
    clear,
    discard,
    prune,
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
  rawSource: AgentAttachmentSource,
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
  const duplicate = duplicatePathDraft(context, rawSource);
  if (duplicate !== null) {
    context.setRefusal(agentAttachmentDuplicateRefusal(duplicate.name));
    return "settled";
  }
  const draftId = (context.deps().createDraftId ?? defaultDraftId)();
  const described = await describeAgentAttachmentSource(
    context.gateway,
    owner.workspaceId,
    rawSource,
    () => context.ownerIsCurrent(owner),
    (error) => context.deps().reportError(AGENT_TASKS_SOURCE, error),
  );
  if (!context.ownerIsCurrent(owner)) return "settled";
  context.store.queued.delete(rawSource);
  if (described === null) {
    appendDraft(context, failedDraft(draftId, owner, AGENT_ATTACHMENT_PATH_REFUSAL));
    return "settled";
  }
  const { source, candidate } = described;
  const resolvedDuplicate = duplicatePathDraft(context, source);
  if (resolvedDuplicate !== null) {
    context.setRefusal(agentAttachmentDuplicateRefusal(resolvedDuplicate.name));
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
        candidate.mime === "inode/directory" ? "Folder path" : plan.notice,
      ),
      source,
    );
    return "settled";
  }
  const pending = {
    ...blankDraft(draftId, owner, plan.kind, candidate.name),
    path: source.kind === "path" ? source.path : null,
  };
  appendDraft(context, pending, source);
  if (plan.kind === "file") {
    await stageFileDraft(context, pending, candidate, source);
    return "settled";
  }
  await stageImageDraft(context, pending, candidate, source);
  return "settled";
}

const CARRIED_STAGING = { file: stageFileDraft, image: stageImageDraft };

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
  settleStaged(context, pending, staged, "file", null);
}

async function stageImageDraft(
  context: DraftCoordinator,
  pending: AttachmentDraft,
  candidate: AgentAttachmentCandidate,
  source: AgentAttachmentSource,
): Promise<void> {
  const owner = pending.owner;
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
  const declared = declaredImageDimensions(shrunk, context.deps().imageOutputPolicy);
  const staged = await attempt(() =>
    context.gateway.stageAgentAttachmentBytes({
      workspaceId: owner.workspaceId,
      kind: "image",
      name: shrunk.name,
      mime: shrunk.mime,
      ...declared,
      bytes: shrunk.bytes,
    }),
  );
  if (!staged.ok) {
    settleStaged(context, { ...pending, name: shrunk.name }, staged, "image", null);
    return;
  }
  const blob = new Blob([shrunk.bytes], { type: shrunk.mime });
  const previewUrl = context.previews.issue(blob);
  settleStaged(context, { ...pending, name: shrunk.name, previewUrl }, staged, "image", {
    kind: "blob",
    name: shrunk.name,
    mime: shrunk.mime,
    blob,
  });
}

async function prepareAgentTurnAttachments(
  context: DraftCoordinator,
  projectRootKey: string,
): Promise<AgentComposerTurnAttachments | null> {
  if (context.store.projectRootKey !== projectRootKey) return null;
  const owner = context.deps().resolveOwner(projectRootKey);
  if (owner === null) return discardStaleDrafts(context);
  const drafts = composerDrafts(context.store).filter((draft) => draft.state === "ready");
  if (drafts.length === 0) return { owner, draftIds: [], intents: [] };
  if (drafts.some((draft) => !sameOwner(draft.owner, owner))) return discardStaleDrafts(context);
  const draftsAreRetained = () =>
    context.storeIsCurrent() &&
    drafts.every((draft) => context.store.drafts.get(draft.draftId) === draft);
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]!;
    if (draft.kind !== "reference" || draft.path === null) continue;
    const inspected = await attempt(() =>
      context.gateway.inspectAgentAttachmentCandidate({
        workspaceId: owner.workspaceId,
        path: draft.path as string,
      }),
    );
    if (!context.ownerIsCurrent(owner)) return discardStaleDrafts(context);
    if (!draftsAreRetained()) return null;
    markReferenceMissing(
      context,
      draft.draftId,
      !inspected.ok ||
        inspected.value === null ||
        (!inspected.value.isRegularFile && !inspected.value.isDirectory),
    );
    drafts[index] = context.store.drafts.get(draft.draftId)!;
  }
  // Let the caller retain its send hold before validating the final captured draft set.
  await Promise.resolve();
  if (!context.ownerIsCurrent(owner)) return discardStaleDrafts(context);
  if (!draftsAreRetained()) return null;
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

function settleStaged(
  context: DraftCoordinator,
  pending: AttachmentDraft,
  staged:
    | { readonly ok: true; readonly value: StagedAgentAttachment }
    | { readonly ok: false; readonly error: unknown },
  kind: "image" | "file",
  source: AgentAttachmentCarrySource | null,
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
      refuseStaged(context, settled, DRAFT_STORAGE_FULL);
      return;
    }
    const admission = admitAgentAttachmentToTurn(otherDrafts(context, settled.draftId), settled);
    if (admission.kind === "refused") {
      refuseStaged(context, settled, admission.reason);
      return;
    }
    settleDraft(context, pending, settled, source);
    return;
  }
  context.deps().reportError(AGENT_TASKS_SOURCE, staged.error);
  settleDraft(
    context,
    pending,
    failed(pending, `${AGENT_ATTACHMENT_STAGE_FAILURE_PREFIX}${errorMessageOf(staged.error)}`),
  );
}

function refuseStaged(context: DraftCoordinator, settled: AttachmentDraft, reason: string): void {
  void releaseDraft(context, settled);
  if (context.store.carried.has(settled.draftId)) {
    replaceDraft(context, failed({ ...settled, attachmentId: null, previewUrl: null }, reason));
    return;
  }
  context.setRefusal(reason);
  discardDraft(context, settled.draftId);
}

function retarget(context: DraftCoordinator, projectRootKey: string): void {
  if (context.store.projectRootKey === projectRootKey) return;
  releaseAll(context);
  context.store.projectRootKey = projectRootKey;
  context.publish();
}

function releaseAll(context: DraftCoordinator): void {
  for (const draft of [...context.store.drafts.values()]) void releaseDraft(context, draft);
  forgetDrafts(context.store);
}

function markReferenceMissing(context: DraftCoordinator, draftId: string, missing: boolean): void {
  const draft = context.store.drafts.get(draftId);
  if (draft === undefined) return;
  const updated = {
    ...draft,
    missing,
    notice: missing ? AGENT_ATTACHMENT_MISSING_SOURCE_NOTICE : draft.notice,
  };
  context.store.drafts.set(draftId, updated);
  const lease = context.store.held.get(draftId);
  if (lease?.draft === draft) context.store.held.set(draftId, { ...lease, draft: updated });
  context.publish();
}

function declaredImageDimensions(
  shrunk: Extract<AgentImageShrinkOutcome, { kind: "ready" }>,
  policy: AgentImageOutputPolicy | undefined,
): { readonly width: number | null; readonly height: number | null } {
  if (shrunk.reencoded || policy !== undefined) {
    return { width: shrunk.width, height: shrunk.height };
  }
  return { width: null, height: null };
}

function refusedImageDraft(
  pending: AttachmentDraft,
  candidate: AgentAttachmentCandidate,
  source: AgentAttachmentSource,
  reason: AgentImageShrinkRefusal,
): AttachmentDraft {
  switch (reason) {
    case "unreadable":
      return source.kind === "path"
        ? referenceDraft(
            pending,
            candidate.bytes,
            source.path,
            AGENT_ATTACHMENT_UNDECODABLE_IMAGE_NOTICE,
          )
        : failed(pending, AGENT_ATTACHMENT_UNREADABLE_REFUSAL);
    case "oversized":
      return source.kind === "path"
        ? referenceDraft(
            pending,
            candidate.bytes,
            source.path,
            AGENT_ATTACHMENT_OVERSIZED_IMAGE_NOTICE,
          )
        : failed(pending, AGENT_ATTACHMENT_IMAGE_DIMENSIONS_REFUSAL);
    case "too-large":
      return failed(pending, AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL);
    default:
      return unsupportedImageRefusal(reason);
  }
}

function unsupportedImageRefusal(reason: never): never {
  throw new TypeError(`Unsupported image refusal: ${String(reason)}.`);
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
    issue: (blob) => {
      const createObjectUrl = deps().createObjectUrl ?? defaultCreateObjectUrl;
      const url = createObjectUrl(blob);
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
