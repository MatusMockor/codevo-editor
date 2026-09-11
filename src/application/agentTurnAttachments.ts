import type { AgentAttachment } from "../domain/agentAttachment";
import {
  agentEffectivePrompt,
  agentEffectivePromptWithinCap,
} from "../domain/agentAttachmentIntake";
import type { StartAgentTaskAttachment } from "../domain/agentTask";
import type { AgentAttachmentGateway, ClaimedAgentAttachment } from "./agentAttachmentPorts";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  failure,
  warning,
  type AgentTaskLaunchAuthority,
} from "./agentProjectAuthority";
import type {
  AgentAttachmentIntentOwner,
  AgentTasksNotice,
  AgentTurnAttachmentIntent,
  AgentTurnAttachmentRequest,
} from "./agentThreadPorts";

export const AGENT_ATTACHMENTS_DISCARDED_NOTICE =
  "Attachments from a previous workspace session were discarded.";
export const AGENT_ATTACHMENT_UNAVAILABLE_NOTICE =
  "Attachment is no longer available. Remove it and try again.";
export const AGENT_ATTACHMENT_PROMPT_TOO_LONG_NOTICE =
  "The prompt is too long. Shorten it and try again.";

export interface AgentTurnAttachmentAuthority {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly generation: number;
  readonly workspaceId: string;
}

export type AdmittedTurnAttachments =
  | { readonly kind: "admitted"; readonly intents: ReadonlyArray<AgentTurnAttachmentIntent> }
  | { readonly kind: "discarded"; readonly intents: ReadonlyArray<AgentTurnAttachmentIntent> };

export interface ClaimedTurnAttachments {
  readonly prompt: string;
  readonly attachments: ReadonlyArray<AgentAttachment>;
  readonly references: ReadonlyArray<StartAgentTaskAttachment>;
  readonly notice: AgentTasksNotice | null;
}

export function admitTurnAttachments(
  request: AgentTurnAttachmentRequest,
  authority: AgentTurnAttachmentAuthority,
): AdmittedTurnAttachments {
  const intents = request.attachments ?? [];
  if (intents.length === 0) return { kind: "admitted", intents: [] };
  const owner = request.attachmentOwner;
  if (owner === undefined || !ownerMatchesAuthority(owner, authority)) {
    return { kind: "discarded", intents };
  }
  return { kind: "admitted", intents };
}

export function stagedAttachmentIds(
  intents: ReadonlyArray<AgentTurnAttachmentIntent>,
): ReadonlyArray<string> {
  return intents
    .filter((intent) => intent.kind === "staged")
    .map((intent) => (intent.kind === "staged" ? intent.attachmentId : ""));
}

export async function releaseTurnAttachments(
  gateway: AgentAttachmentGateway,
  workspaceId: string,
  intents: ReadonlyArray<AgentTurnAttachmentIntent>,
  reportError: (error: unknown) => void,
): Promise<void> {
  for (const attachmentId of stagedAttachmentIds(intents)) {
    try {
      await gateway.releaseAgentAttachment({ workspaceId, attachmentId });
    } catch (error) {
      reportError(error);
    }
  }
}

export async function claimTurnAttachments(
  gateway: AgentAttachmentGateway,
  workspaceId: string,
  threadId: string,
  intents: ReadonlyArray<AgentTurnAttachmentIntent>,
  text: string,
): Promise<ClaimedTurnAttachments> {
  const attachmentIds = stagedAttachmentIds(intents);
  const claimed =
    attachmentIds.length === 0
      ? []
      : await gateway.claimAgentAttachments({ workspaceId, threadId, attachmentIds });
  const byId = new Map(claimed.map((entry) => [entry.attachmentId, entry]));
  const attachments = intents.map((intent) => turnAttachment(intent, byId));
  return {
    prompt: agentEffectivePrompt(text, attachments),
    attachments,
    references: intents.map(startAgentTaskAttachment),
    notice: null,
  };
}

export function turnAttachmentsWithinPromptCap(
  text: string,
  attachments: ReadonlyArray<AgentAttachment>,
): boolean {
  return agentEffectivePromptWithinCap(text, attachments);
}

export interface TurnAttachmentDependencies {
  readonly agentAttachmentGateway?: AgentAttachmentGateway;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly reportError: (source: string, error: unknown) => void;
}

export async function prepareTurnAttachments(
  deps: TurnAttachmentDependencies,
  request: AgentTurnAttachmentRequest,
  authority: AgentTurnAttachmentAuthority,
  threadId: string,
  text: string,
): Promise<ClaimedTurnAttachments | null> {
  const admitted = admitTurnAttachments(request, authority);
  const gateway = deps.agentAttachmentGateway;
  if (admitted.kind === "discarded") {
    if (gateway !== undefined) {
      await releaseTurnAttachments(gateway, authority.workspaceId, admitted.intents, (error) =>
        deps.reportError(AGENT_TASKS_SOURCE, error),
      );
    }
    const notice = warning(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    deps.setNotice(notice);
    if (text === "") return null;
    return { prompt: text, attachments: [], references: [], notice };
  }
  if (admitted.intents.length === 0) {
    return { prompt: text, attachments: [], references: [], notice: null };
  }
  if (gateway === undefined) {
    deps.setNotice(failure(AGENT_ATTACHMENT_UNAVAILABLE_NOTICE));
    return null;
  }
  const claimed = await attempt(() =>
    claimTurnAttachments(gateway, authority.workspaceId, threadId, admitted.intents, text),
  );
  if (!claimed.ok) {
    deps.reportError(AGENT_TASKS_SOURCE, claimed.error);
    deps.setNotice(failure(AGENT_ATTACHMENT_UNAVAILABLE_NOTICE));
    return null;
  }
  if (!turnAttachmentsWithinPromptCap(text, claimed.value.attachments)) {
    deps.setNotice(warning(AGENT_ATTACHMENT_PROMPT_TOO_LONG_NOTICE));
    return null;
  }
  return claimed.value;
}

function turnAttachment(
  intent: AgentTurnAttachmentIntent,
  claimed: ReadonlyMap<string, ClaimedAgentAttachment>,
): AgentAttachment {
  if (intent.kind === "reference") {
    return { kind: "reference", name: intent.name, path: intent.path, bytes: intent.bytes };
  }
  const entry = claimed.get(intent.attachmentId);
  if (entry === undefined) throw new Error(AGENT_ATTACHMENT_UNAVAILABLE_NOTICE);
  if (intent.mime === null || intent.width === null || intent.height === null) {
    return {
      kind: "file",
      attachmentId: intent.attachmentId,
      name: intent.name,
      bytes: intent.bytes,
      storedPath: entry.storedPath,
    };
  }
  return {
    kind: "image",
    attachmentId: intent.attachmentId,
    name: intent.name,
    mime: intent.mime,
    bytes: intent.bytes,
    width: intent.width,
    height: intent.height,
    storedPath: entry.storedPath,
  };
}

function startAgentTaskAttachment(intent: AgentTurnAttachmentIntent): StartAgentTaskAttachment {
  if (intent.kind === "reference") {
    return { kind: "reference", name: intent.name, path: intent.path };
  }
  return { kind: "staged", attachmentId: intent.attachmentId };
}

function ownerMatchesAuthority(
  owner: AgentAttachmentIntentOwner,
  authority: AgentTurnAttachmentAuthority,
): boolean {
  return (
    owner.projectRootKey === authority.rootKey &&
    owner.ownerId === authority.ownerId &&
    owner.generation === authority.generation &&
    owner.workspaceId === authority.workspaceId
  );
}

/** A failed new-thread send keeps the exact unpublished attachment owner for retry. */
export interface AttachmentThreadReservation {
  readonly authority: AgentTaskLaunchAuthority;
  readonly threadId: string;
}

export function retryAttachmentThreadId(
  reservation: AttachmentThreadReservation | null,
  authority: AgentTaskLaunchAuthority,
  usedIds: ReadonlySet<string>,
): string | null {
  if (reservation === null || usedIds.has(reservation.threadId)) return null;
  const previous = reservation.authority;
  return previous.rootKey === authority.rootKey &&
    previous.ownerId === authority.ownerId &&
    previous.generation === authority.generation &&
    previous.workspaceId === authority.workspaceId &&
    previous.workspaceGeneration === authority.workspaceGeneration
    ? reservation.threadId
    : null;
}
