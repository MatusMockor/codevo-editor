import { MAX_AGENT_TURN_ATTACHMENTS } from "../domain/agentAttachment";
import {
  AGENT_ATTACHMENT_PATH_REFUSAL,
  admitAgentAttachmentCount,
  planAgentAttachmentIntake,
  type AgentAttachmentCandidate,
} from "../domain/agentAttachmentIntake";
import type { AgentReferenceEntry } from "../domain/agentReferenceEntry";
import {
  AGENT_ATTACHMENT_CARRY_LOST_REFUSAL,
  agentAttachmentCarryIntakeSource,
  agentAttachmentCarryKind,
  agentAttachmentCarrySourceName,
  boundedAgentAttachmentCarryFailure,
  type AgentAttachmentCarryItem,
  type AgentAttachmentCarrySource,
} from "./agentAttachmentCarry";
import {
  AGENT_ATTACHMENT_UNREADABLE_REFUSAL,
  agentAttachmentDuplicateRefusal,
  blankDraft,
  boundFailedSources,
  countedDrafts,
  defaultDraftId,
  DRAFT_STORAGE_FULL,
  duplicatePathDraft,
  failed,
  MAX_RETAINED_DRAFTS,
  referenceDraft,
  replaceDraft,
  settleDraft,
  type AttachmentDraft,
  type DraftCoordinator,
  type DraftStore,
} from "./agentAttachmentDraftStore";
import {
  describeAgentAttachmentSource,
  type DescribedAgentAttachmentSource,
} from "./agentAttachmentPathIntake";
import { AGENT_TASKS_SOURCE, attempt } from "./agentProjectAuthority";
import type { AgentAttachmentOwner, AgentAttachmentSource } from "./useAgentComposerAttachments";

export function carryItems(store: DraftStore): ReadonlyArray<AgentAttachmentCarryItem> {
  const queued = [...store.queued].slice(0, MAX_AGENT_TURN_ATTACHMENTS + 1);
  return [
    ...[...store.drafts.values()].map((draft) => carryItem(store, draft)),
    ...queued.map((source) => ({
      name: agentAttachmentCarrySourceName(source),
      failure: null,
      source,
    })),
  ];
}

function carryItem(store: DraftStore, draft: AttachmentDraft): AgentAttachmentCarryItem {
  const source = store.sources.get(draft.draftId) ?? null;
  if (source !== null) return { name: draft.name, failure: null, source };
  return {
    name: draft.name,
    failure: draft.failure ?? AGENT_ATTACHMENT_CARRY_LOST_REFUSAL,
    source: null,
  };
}

type StageCarriedDraft = (
  context: DraftCoordinator,
  pending: AttachmentDraft,
  candidate: AgentAttachmentCandidate,
  source: AgentAttachmentSource,
) => Promise<void>;

export interface CarriedDraftStaging {
  readonly file: StageCarriedDraft;
  readonly image: StageCarriedDraft;
}

interface CarriedDraft {
  readonly pending: AttachmentDraft;
  readonly source: AgentAttachmentCarrySource;
}

export async function importCarriedDrafts(
  context: DraftCoordinator,
  owner: AgentAttachmentOwner,
  items: ReadonlyArray<AgentAttachmentCarryItem>,
  staging: CarriedDraftStaging,
): Promise<void> {
  const carried = items.flatMap((item) => appendCarriedDraft(context, owner, item));
  context.publish();
  for (const entry of carried) {
    if (!context.ownerIsCurrent(owner)) return;
    await stageCarriedDraft(context, entry, staging);
  }
}

function appendCarriedDraft(
  context: DraftCoordinator,
  owner: AgentAttachmentOwner,
  item: AgentAttachmentCarryItem,
): ReadonlyArray<CarriedDraft> {
  const draftId = (context.deps().createDraftId ?? defaultDraftId)();
  const source = item.source;
  const pending = blankDraft(
    draftId,
    owner,
    source === null ? "reference" : agentAttachmentCarryKind(source),
    item.name,
  );
  const refusal = carriedDraftRefusal(context, item);
  context.store.carried.add(draftId);
  if (source !== null) context.store.sources.set(draftId, source);
  context.store.drafts.set(draftId, refusal === null ? pending : failed(pending, refusal));
  boundFailedSources(context.store);
  return refusal === null && source !== null ? [{ pending, source }] : [];
}

function carriedDraftRefusal(
  context: DraftCoordinator,
  item: AgentAttachmentCarryItem,
): string | null {
  if (item.source === null) {
    return boundedAgentAttachmentCarryFailure(item.failure ?? AGENT_ATTACHMENT_CARRY_LOST_REFUSAL);
  }
  if (context.retainedDrafts().length >= MAX_RETAINED_DRAFTS) return DRAFT_STORAGE_FULL;
  const admission = admitAgentAttachmentCount(countedDrafts(context));
  return admission.kind === "refused" ? admission.reason : null;
}

async function stageCarriedDraft(
  context: DraftCoordinator,
  carried: CarriedDraft,
  staging: CarriedDraftStaging,
): Promise<void> {
  const { pending } = carried;
  const owner = pending.owner;
  const resolved = await attempt(() => agentAttachmentCarryIntakeSource(carried.source));
  if (!context.ownerIsCurrent(owner)) return;
  if (!resolved.ok) {
    failCarriedDraft(context, pending, AGENT_ATTACHMENT_UNREADABLE_REFUSAL);
    return;
  }
  const described = await describeAgentAttachmentSource(
    context.gateway,
    owner.workspaceId,
    resolved.value,
    () => context.ownerIsCurrent(owner),
    (error) => context.deps().reportError(AGENT_TASKS_SOURCE, error),
  );
  if (!context.ownerIsCurrent(owner)) return;
  if (described === null) {
    failCarriedDraft(context, pending, AGENT_ATTACHMENT_PATH_REFUSAL);
    return;
  }
  const plan = planCarriedStaging(context, described);
  if (plan.kind === "refused") {
    failCarriedDraft(context, pending, plan.reason);
    return;
  }
  const { source, candidate } = described;
  if (plan.kind === "reference") {
    settleDraft(
      context,
      pending,
      referenceDraft(pending, candidate.bytes, plan.path, plan.notice, plan.entry),
    );
    return;
  }
  const placeholder = {
    ...pending,
    kind: plan.kind,
    path: source.kind === "path" ? source.path : null,
  };
  if (!replaceDraft(context, placeholder)) return;
  if (plan.kind === "file") {
    await staging.file(context, placeholder, candidate, source);
    return;
  }
  await staging.image(context, placeholder, candidate, source);
}

type CarriedStagingPlan =
  | { readonly kind: "refused"; readonly reason: string }
  | {
      readonly kind: "reference";
      readonly path: string;
      readonly notice: string | null;
      readonly entry: AgentReferenceEntry;
    }
  | { readonly kind: "file" | "image" };

function planCarriedStaging(
  context: DraftCoordinator,
  described: DescribedAgentAttachmentSource,
): CarriedStagingPlan {
  const { source, candidate } = described;
  const duplicate = duplicatePathDraft(context, source);
  if (duplicate !== null) {
    return { kind: "refused", reason: agentAttachmentDuplicateRefusal(duplicate.name) };
  }
  const plan = planAgentAttachmentIntake(candidate);
  if (plan.kind === "refused") return plan;
  if (plan.kind !== "reference") return { kind: plan.kind };
  if (source.kind !== "path") return { kind: "refused", reason: AGENT_ATTACHMENT_PATH_REFUSAL };
  return { kind: "reference", path: source.path, notice: plan.notice, entry: described.entry };
}

function failCarriedDraft(
  context: DraftCoordinator,
  pending: AttachmentDraft,
  reason: string,
): void {
  settleDraft(context, pending, failed(pending, boundedAgentAttachmentCarryFailure(reason)));
}
