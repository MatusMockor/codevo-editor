import type { RefObject } from "react";
import {
  boundedSavedConversationTitle,
  savedConversationTitle,
} from "../../domain/agentSavedConversationTitle";
import { Button } from "../../ui/foundation/Button";
import { Dialog } from "../../ui/foundation/Dialog";
import "./agentThreadDeleteDialog.css";

const MAX_DIALOG_TITLE_CHARS = 60;

export interface AgentThreadDeleteDialogProps {
  readonly open: boolean;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly title: string;
  onCancel(): void;
  onConfirm(): void;
}

export function AgentThreadDeleteDialog({
  onCancel,
  onConfirm,
  open,
  returnFocusRef,
  title,
}: AgentThreadDeleteDialogProps) {
  return (
    <Dialog
      footer={
        <>
          <Button onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button onClick={onConfirm} type="button" variant="danger">
            Delete thread
          </Button>
        </>
      }
      onClose={onCancel}
      open={open}
      returnFocusRef={returnFocusRef}
      title="Delete thread?"
      width="sm"
    >
      <p className="agent-delete-dialog__name" title={savedConversationTitle(title)}>
        {boundedSavedConversationTitle(title, MAX_DIALOG_TITLE_CHARS)}
      </p>
      <p className="agent-delete-dialog__copy">
        Its saved history will be removed from Codevo. This can&apos;t be undone.
      </p>
    </Dialog>
  );
}
