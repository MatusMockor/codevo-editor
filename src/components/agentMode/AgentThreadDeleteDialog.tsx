import type { RefObject } from "react";
import { Button } from "../../ui/foundation/Button";
import { Dialog } from "../../ui/foundation/Dialog";

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
      description={`“${title}” and its saved history are removed from Codevo. This cannot be undone.`}
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
    />
  );
}
