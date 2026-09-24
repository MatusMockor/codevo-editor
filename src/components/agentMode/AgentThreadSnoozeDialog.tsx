import { useState, type RefObject } from "react";
import { Button } from "../../ui/foundation/Button";
import { Dialog } from "../../ui/foundation/Dialog";

export interface AgentThreadSnoozeDialogProps {
  readonly open: boolean;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  onCancel(): void;
  onSnooze(until: number): void;
}

export function AgentThreadSnoozeDialog({
  onCancel,
  onSnooze,
  open,
  returnFocusRef,
}: AgentThreadSnoozeDialogProps) {
  const [value, setValue] = useState("");
  const until = value === "" ? Number.NaN : new Date(value).getTime();
  const valid = Number.isFinite(until) && until > Date.now();
  return (
    <Dialog
      footer={
        <>
          <Button onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              if (valid) onSnooze(until);
            }}
            type="button"
            variant="primary"
          >
            Snooze
          </Button>
        </>
      }
      onClose={onCancel}
      open={open}
      returnFocusRef={returnFocusRef}
      title="Snooze until"
      width="sm"
    >
      <input
        aria-label="Snooze until"
        className="cv-snooze__input"
        onChange={(event) => setValue(event.target.value)}
        type="datetime-local"
        value={value}
      />
    </Dialog>
  );
}
