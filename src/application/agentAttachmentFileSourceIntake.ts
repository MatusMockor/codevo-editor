import {
  AGENT_ATTACHMENT_PATH_REFUSAL,
  admitAgentAttachmentToTurn,
  sanitizeAgentAttachmentName,
} from "../domain/agentAttachmentIntake";
import { REMOTE_FILE_SOURCE_UNREADABLE_ERROR } from "../domain/remoteRunnerFileAttachment";
import {
  appendDraft,
  blankDraft,
  defaultDraftId,
  discardDraft,
  otherDrafts,
  releaseDraft,
  replaceDraft,
  settleDraft,
  stagedDraft,
  type AttachmentDraft,
  type DraftCoordinator,
} from "./agentAttachmentDraftStore";
import { attempt, errorMessageOf } from "./agentProjectAuthority";
import type { AgentAttachmentOwner, AgentAttachmentSource } from "./useAgentComposerAttachments";

export type AgentAttachmentFileSource = Extract<AgentAttachmentSource, { kind: "fileSource" }>;

type FileSourceStaging =
  | { readonly kind: "staged" }
  | { readonly kind: "stale" }
  | { readonly kind: "failed"; readonly error: Error };

export async function intakeAgentAttachmentFileSource(
  context: DraftCoordinator,
  owner: AgentAttachmentOwner,
  source: AgentAttachmentFileSource,
): Promise<"settled"> {
  const draftId = (context.deps().createDraftId ?? defaultDraftId)();
  const pending = fileSourceDraft(
    blankDraft(draftId, owner, "file", sanitizeAgentAttachmentName(source.path)),
  );
  context.store.queued.delete(source);
  appendDraft(context, pending, source);
  if (context.store.drafts.get(draftId) !== pending) return "settled";
  const outcome = await stageFileSourceDraft(context, pending, source);
  if (outcome.kind !== "failed") return "settled";
  const retained = context.store.drafts.has(draftId);
  discardDraft(context, draftId);
  if (!retained) return "settled";
  throw outcome.error;
}

export async function stageCarriedFileSourceDraft(
  context: DraftCoordinator,
  pending: AttachmentDraft,
  source: AgentAttachmentFileSource,
): Promise<string | null> {
  const placeholder = fileSourceDraft({ ...pending, kind: "file" });
  if (!replaceDraft(context, placeholder)) return null;
  const outcome = await stageFileSourceDraft(context, placeholder, source);
  if (outcome.kind !== "failed") return null;
  return outcome.error.message;
}

function fileSourceDraft(draft: AttachmentDraft): AttachmentDraft {
  return { ...draft, backing: "nativeFile" };
}

async function stageFileSourceDraft(
  context: DraftCoordinator,
  pending: AttachmentDraft,
  source: AgentAttachmentFileSource,
): Promise<FileSourceStaging> {
  const gateway = context.gateway;
  const stage = gateway.stageAgentAttachmentFile;
  if (stage === undefined) return failure(new Error(AGENT_ATTACHMENT_PATH_REFUSAL));
  const staged = await attempt(() =>
    stage.call(gateway, {
      workspaceId: pending.owner.workspaceId,
      path: source.path,
      fileSource: source.fileSource,
    }),
  );
  if (!context.ownerIsCurrent(pending.owner)) {
    if (staged.ok) void releaseDraft(context, stagedDraft(pending, staged.value, "file"));
    discardDraft(context, pending.draftId);
    return { kind: "stale" };
  }
  if (!staged.ok) return failure(staged.error);
  const settled = stagedDraft(pending, staged.value, "file");
  const admission = admitAgentAttachmentToTurn(otherDrafts(context, settled.draftId), settled);
  if (admission.kind === "refused") {
    void releaseDraft(context, settled);
    return failure(new Error(admission.reason));
  }
  settleDraft(context, pending, settled, source);
  return { kind: "staged" };
}

function failure(error: unknown): FileSourceStaging {
  if (error instanceof Error) return { kind: "failed", error };
  const message = errorMessageOf(error).trim();
  return {
    kind: "failed",
    error: new Error(message === "" ? REMOTE_FILE_SOURCE_UNREADABLE_ERROR : message),
  };
}
