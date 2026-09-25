import { AlertTriangle } from "lucide-react";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";
import { agentStopConfirmationText } from "./agentStopConfirmationPresentation";

export interface AgentStopConfirmationView {
  readonly liveTaskCount: number;
  onCancel(): void;
}

export function AgentStopConfirmationBanner({
  confirmation,
  onConfirm,
  onFocusReturn,
}: {
  readonly confirmation: AgentStopConfirmationView | null;
  readonly onConfirm: (() => void) | undefined;
  readonly onFocusReturn?: () => void;
}) {
  if (confirmation === null) return null;
  const choose = (action: () => void) => (): void => {
    action();
    onFocusReturn?.();
  };
  return (
    <ComposerBanner
      actions={
        <>
          {onConfirm === undefined ? null : (
            <button className="cv-banner-action" onClick={choose(onConfirm)} type="button">
              Stop everything
            </button>
          )}
          <button
            className="cv-banner-action"
            onClick={choose(() => confirmation.onCancel())}
            type="button"
          >
            Keep running
          </button>
        </>
      }
      announce={false}
      icon={<AlertTriangle size={12} strokeWidth={1.5} />}
      tone="warn"
    >
      {agentStopConfirmationText(confirmation.liveTaskCount)}
    </ComposerBanner>
  );
}

export function AgentStopConfirmationAnnouncer({
  confirmation,
}: {
  readonly confirmation: AgentStopConfirmationView | null;
}) {
  return (
    <span
      aria-live="polite"
      className="agent-stop-confirmation-announcer agent-visually-hidden"
      role="status"
    >
      {confirmation === null ? "" : agentStopConfirmationText(confirmation.liveTaskCount)}
    </span>
  );
}
