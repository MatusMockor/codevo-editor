import type { AgentGitDiscardPending } from "../../../../application/rightPanel/useAgentGitDiscard";
import { Button } from "../../../../ui/foundation/Button";
import { Dialog } from "../../../../ui/foundation/Dialog";
import { discardCopy } from "./agentGitPresentation";

export interface AgentGitDiscardDialogProps {
  readonly pending: AgentGitDiscardPending | null;
  onCancel(): void;
  onConfirm(): void;
}

export function AgentGitDiscardDialog({
  onCancel,
  onConfirm,
  pending,
}: AgentGitDiscardDialogProps) {
  if (pending === null) return null;
  const copy = discardCopy(pending);
  return (
    <Dialog
      description={copy.description}
      dismissOnBackdrop={!pending.busy}
      footer={
        <>
          <Button disabled={pending.busy} onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button
            disabled={pending.busy || !pending.ready}
            onClick={onConfirm}
            type="button"
            variant="danger"
          >
            {pending.busy ? "Discarding…" : copy.confirmLabel}
          </Button>
        </>
      }
      onClose={onCancel}
      open
      role="alertdialog"
      title={copy.title}
      width="sm"
    />
  );
}
