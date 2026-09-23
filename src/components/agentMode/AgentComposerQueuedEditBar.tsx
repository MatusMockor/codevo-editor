import { Pencil } from "lucide-react";
import { AgentComposerAttachments } from "./AgentComposerAttachments";
import type { AgentComposerQueuedEdit } from "./agentComposerQueuedEdit";

export const AGENT_COMPOSER_QUEUED_EDIT_LABEL = "Editing queued message";
export const AGENT_COMPOSER_QUEUED_EDIT_CANCEL_LABEL = "Cancel editing queued message";
export const AGENT_COMPOSER_SAVE_QUEUED_LABEL = "Save queued message";

const NO_REFUSAL = null;

export function AgentComposerQueuedEditBar({ edit }: { readonly edit: AgentComposerQueuedEdit }) {
  return (
    <div
      aria-label={AGENT_COMPOSER_QUEUED_EDIT_LABEL}
      className="agent-composer__queued-edit"
      role="group"
    >
      <div className="agent-composer__queued-edit-head">
        <Pencil aria-hidden="true" size={13} />
        <span className="agent-composer__queued-edit-title">
          {AGENT_COMPOSER_QUEUED_EDIT_LABEL}
        </span>
        <button
          aria-label={AGENT_COMPOSER_QUEUED_EDIT_CANCEL_LABEL}
          className="agent-composer__queued-edit-cancel"
          onClick={edit.onCancel}
          title="Cancel (Esc)"
          type="button"
        >
          Cancel
        </button>
      </div>
      <AgentComposerAttachments
        drafts={edit.attachments}
        onDismissRefusal={dismissNothing}
        onRemove={edit.onRemoveAttachment}
        refusal={NO_REFUSAL}
      />
    </div>
  );
}

function dismissNothing(): void {}
