import { Pencil } from "lucide-react";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";
import { AgentComposerAttachments } from "./AgentComposerAttachments";
import type { AgentComposerQueuedEdit } from "./agentComposerQueuedEdit";

export const AGENT_COMPOSER_QUEUED_EDIT_LABEL = "Editing queued message";
export const AGENT_COMPOSER_QUEUED_EDIT_CANCEL_LABEL = "Cancel editing queued message";
export const AGENT_COMPOSER_SAVE_QUEUED_LABEL = "Save queued message";
export const AGENT_COMPOSER_QUEUED_EDIT_HINT = "sends after this turn";

const NO_REFUSAL = null;

export function AgentComposerQueuedEditBar({ edit }: { readonly edit: AgentComposerQueuedEdit }) {
  return (
    <div
      aria-label={AGENT_COMPOSER_QUEUED_EDIT_LABEL}
      className="agent-composer__queued-edit"
      role="group"
    >
      <ComposerBanner
        actions={
          <button
            aria-label={AGENT_COMPOSER_QUEUED_EDIT_CANCEL_LABEL}
            className="agent-composer__queued-edit-cancel cv-banner-action"
            onClick={edit.onCancel}
            title="Cancel (Esc)"
            type="button"
          >
            Cancel
          </button>
        }
        icon={<Pencil size={12} strokeWidth={1.5} />}
      >
        <span className="cv-banner-line">
          <span className="agent-composer__queued-edit-title cv-banner-strong">
            {AGENT_COMPOSER_QUEUED_EDIT_LABEL}
          </span>
          <span className="cv-banner-detail">{AGENT_COMPOSER_QUEUED_EDIT_HINT}</span>
        </span>
      </ComposerBanner>
    </div>
  );
}

export function AgentComposerQueuedEditAttachments({
  edit,
}: {
  readonly edit: AgentComposerQueuedEdit;
}) {
  return (
    <AgentComposerAttachments
      drafts={edit.attachments}
      onDismissRefusal={dismissNothing}
      onRemove={edit.onRemoveAttachment}
      refusal={NO_REFUSAL}
    />
  );
}

function dismissNothing(): void {}
