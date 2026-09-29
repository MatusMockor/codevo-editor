import { AlertTriangle } from "lucide-react";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";
import { agentStopConfirmationText } from "./agentStopConfirmationPresentation";

export const AGENT_STOP_INTERRUPTING_TEXT =
  "Stopping the current step. Press Stop or Esc again to end Claude's session.";

export type AgentStopConfirmationView =
  | { readonly kind: "confirmBackground"; readonly liveTaskCount: number; onCancel(): void }
  | { readonly kind: "interrupting"; onCancel(): void };

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
            {confirmation.kind === "interrupting" ? "Dismiss" : "Keep running"}
          </button>
        </>
      }
      announce={false}
      icon={<AlertTriangle size={12} strokeWidth={1.5} />}
      tone="warn"
    >
      {agentStopConfirmationViewText(confirmation)}
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
      {confirmation === null ? "" : agentStopConfirmationViewText(confirmation)}
    </span>
  );
}

function agentStopConfirmationViewText(confirmation: AgentStopConfirmationView): string {
  switch (confirmation.kind) {
    case "interrupting":
      return AGENT_STOP_INTERRUPTING_TEXT;
    case "confirmBackground":
      return agentStopConfirmationText(confirmation.liveTaskCount);
    default:
      return unsupportedConfirmation(confirmation);
  }
}

function unsupportedConfirmation(confirmation: never): never {
  throw new Error(`Unsupported stop confirmation: ${JSON.stringify(confirmation)}`);
}
