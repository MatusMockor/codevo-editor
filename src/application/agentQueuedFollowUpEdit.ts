import {
  MAX_AGENT_TURN_ATTACHMENTS,
  MAX_AGENT_TURN_IMAGE_BYTES,
  agentTurnImageBytes,
  type AgentAttachment,
} from "../domain/agentAttachment";
import {
  AGENT_ATTACHMENT_COUNT_REFUSAL,
  AGENT_ATTACHMENT_TURN_IMAGE_BYTES_REFUSAL,
  agentEffectivePrompt,
} from "../domain/agentAttachmentIntake";
import { MAX_AGENT_TASK_PROMPT_BYTES, type StartAgentTaskAttachment } from "../domain/agentTask";
import type {
  AgentFollowUpRequest,
  AgentTurnAttachmentIntent,
  AgentTurnAttachmentRequest,
} from "./agentThreadPorts";
import { agentPromptByteLength } from "./agentTurnAdmission";
import type { ClaimedTurnAttachments } from "./agentTurnAttachments";

export const AGENT_QUEUED_EDIT_EMPTY_NOTICE = "A queued message needs text or an attachment.";
export const AGENT_QUEUED_EDIT_TOO_LONG_NOTICE =
  "The prompt is too long. Shorten it and try again.";
export const AGENT_QUEUED_EDIT_UNAVAILABLE_NOTICE =
  "This queued message is no longer waiting, so the edit was not applied.";

export interface AgentQueuedEditAttachment {
  readonly key: string;
  readonly attachment: AgentAttachment;
}

export interface AgentQueuedEditSession {
  readonly threadId: string;
  readonly entryId: string;
  readonly lease: number;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<AgentQueuedEditAttachment>;
}

export interface AgentQueuedEditCommit extends AgentTurnAttachmentRequest {
  readonly prompt: string;
  readonly keptAttachmentKeys: ReadonlyArray<string>;
}

export type AgentQueuedEditAdmission =
  | { readonly kind: "accepted"; readonly prompt: string }
  | { readonly kind: "refused"; readonly reason: string };

export function queuedEditAttachments(
  prepared: ClaimedTurnAttachments | undefined,
): ReadonlyArray<AgentQueuedEditAttachment> {
  if (prepared === undefined) return [];
  return prepared.attachments
    .slice(0, MAX_AGENT_TURN_ATTACHMENTS)
    .map((attachment, index) => ({ key: `attachment-${index}`, attachment }));
}

export function keptQueuedEditAttachments(
  session: AgentQueuedEditSession,
  keys: ReadonlyArray<string>,
): ReadonlyArray<AgentAttachment> {
  const wanted = new Set(keys);
  return session.attachments
    .filter((entry) => wanted.has(entry.key))
    .map((entry) => entry.attachment);
}

export function admitQueuedEdit(
  rawPrompt: string,
  kept: ReadonlyArray<AgentAttachment>,
  added: ReadonlyArray<AgentTurnAttachmentIntent>,
): AgentQueuedEditAdmission {
  const prompt = rawPrompt.trim();
  if (prompt === "" && kept.length + added.length === 0) {
    return { kind: "refused", reason: AGENT_QUEUED_EDIT_EMPTY_NOTICE };
  }
  if (agentPromptByteLength(prompt) > MAX_AGENT_TASK_PROMPT_BYTES) {
    return { kind: "refused", reason: AGENT_QUEUED_EDIT_TOO_LONG_NOTICE };
  }
  if (kept.length + added.length > MAX_AGENT_TURN_ATTACHMENTS) {
    return { kind: "refused", reason: AGENT_ATTACHMENT_COUNT_REFUSAL };
  }
  if (agentTurnImageBytes(kept) + addedImageBytes(added) > MAX_AGENT_TURN_IMAGE_BYTES) {
    return { kind: "refused", reason: AGENT_ATTACHMENT_TURN_IMAGE_BYTES_REFUSAL };
  }
  return { kind: "accepted", prompt };
}

export function mergeQueuedEditClaim(
  prompt: string,
  kept: ReadonlyArray<AgentAttachment>,
  added: ClaimedTurnAttachments,
): ClaimedTurnAttachments {
  const attachments = [...kept, ...added.attachments];
  return {
    prompt: agentEffectivePrompt(prompt, attachments),
    attachments,
    references: [...kept.map(queuedEditReference), ...added.references],
    notice: null,
  };
}

export function editedFollowUpRequest(
  original: AgentFollowUpRequest,
  prompt: string,
  kept: ReadonlyArray<AgentAttachment>,
  commit: AgentQueuedEditCommit,
): AgentFollowUpRequest {
  const { attachments: _previous, attachmentOwner, ...base } = original;
  const intents = [...kept.map(queuedEditIntent), ...(commit.attachments ?? [])];
  if (intents.length === 0) return { ...base, prompt };
  const owner = attachmentOwner ?? commit.attachmentOwner;
  if (owner === undefined) return { ...base, prompt, attachments: intents };
  return { ...base, prompt, attachments: intents, attachmentOwner: owner };
}

function queuedEditIntent(attachment: AgentAttachment): AgentTurnAttachmentIntent {
  switch (attachment.kind) {
    case "reference":
      return {
        kind: "reference",
        name: attachment.name,
        path: attachment.path,
        bytes: attachment.bytes,
      };
    case "image":
      return {
        kind: "staged",
        attachmentId: attachment.attachmentId,
        name: attachment.name,
        bytes: attachment.bytes,
        mime: attachment.mime,
        width: attachment.width,
        height: attachment.height,
      };
    case "file":
      return {
        kind: "staged",
        attachmentId: attachment.attachmentId,
        name: attachment.name,
        bytes: attachment.bytes,
        mime: null,
        width: null,
        height: null,
      };
    default:
      return unsupportedQueuedEditAttachment(attachment);
  }
}

function queuedEditReference(attachment: AgentAttachment): StartAgentTaskAttachment {
  if (attachment.kind === "reference") {
    return { kind: "reference", name: attachment.name, path: attachment.path };
  }
  return { kind: "staged", attachmentId: attachment.attachmentId };
}

function addedImageBytes(added: ReadonlyArray<AgentTurnAttachmentIntent>): number {
  return added.reduce(
    (total, intent) =>
      intent.kind === "staged" && intent.mime !== null ? total + intent.bytes : total,
    0,
  );
}

function unsupportedQueuedEditAttachment(attachment: never): never {
  throw new TypeError(`Unsupported queued attachment: ${JSON.stringify(attachment)}.`);
}
