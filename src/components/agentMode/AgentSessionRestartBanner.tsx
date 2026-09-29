import { AlertTriangle } from "lucide-react";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";

export const AGENT_SESSION_RESTART_TEXT =
  "Sending this restarts Claude for this thread. Restarting ends this Claude session. Background tasks it started may stop.";

export interface AgentSessionRestartConfirmationView {
  onCancel(): void;
}

export function AgentSessionRestartBanner({
  confirmation,
  onConfirm,
}: {
  readonly confirmation: AgentSessionRestartConfirmationView | null;
  readonly onConfirm: () => void;
}) {
  if (confirmation === null) return null;
  return (
    <ComposerBanner
      actions={
        <>
          <button className="cv-banner-action" onClick={onConfirm} type="button">
            Restart and send
          </button>
          <button
            className="cv-banner-action"
            onClick={() => confirmation.onCancel()}
            type="button"
          >
            Cancel
          </button>
        </>
      }
      icon={<AlertTriangle size={12} strokeWidth={1.5} />}
      tone="warn"
    >
      {AGENT_SESSION_RESTART_TEXT}
    </ComposerBanner>
  );
}
