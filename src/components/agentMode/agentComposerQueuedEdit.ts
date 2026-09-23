import type { AgentQueuedEditAttachment } from "../../application/agentQueuedFollowUpEdit";
import type { AgentTurnAttachmentRequest } from "../../application/agentThreadPorts";
import type { AgentComposerAttachmentDraft } from "../../application/useAgentComposerAttachments";

export interface AgentComposerQueuedEdit {
  readonly threadId: string;
  readonly lease: number;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<AgentComposerAttachmentDraft>;
  onRemoveAttachment(draftId: string): void;
  onCancel(): void;
  commit(prompt: string, request: AgentTurnAttachmentRequest): Promise<boolean>;
}

const QUEUED_EDIT_DRAFT_PREFIX = "queued-edit:";

export function queuedEditAttachmentDraft(
  entry: AgentQueuedEditAttachment,
): AgentComposerAttachmentDraft {
  const { key, attachment } = entry;
  const base = {
    draftId: `${QUEUED_EDIT_DRAFT_PREFIX}${key}`,
    kind: attachment.kind,
    state: "ready" as const,
    name: attachment.name,
    bytes: attachment.bytes,
    previewUrl: null,
    failure: null,
    notice: null,
    missing: false,
    promptLineBytesMax: 0,
  };
  switch (attachment.kind) {
    case "image":
      return {
        ...base,
        mime: attachment.mime,
        width: attachment.width,
        height: attachment.height,
        attachmentId: attachment.attachmentId,
        path: null,
      };
    case "file":
      return {
        ...base,
        mime: null,
        width: null,
        height: null,
        attachmentId: attachment.attachmentId,
        path: null,
      };
    case "reference":
      return {
        ...base,
        mime: null,
        width: null,
        height: null,
        attachmentId: null,
        path: attachment.path,
      };
    default:
      return unsupportedQueuedEditAttachment(attachment);
  }
}

export function queuedEditAttachmentKey(draftId: string): string | null {
  if (!draftId.startsWith(QUEUED_EDIT_DRAFT_PREFIX)) return null;
  return draftId.slice(QUEUED_EDIT_DRAFT_PREFIX.length);
}

function unsupportedQueuedEditAttachment(attachment: never): never {
  throw new TypeError(`Unsupported queued attachment: ${JSON.stringify(attachment)}.`);
}
