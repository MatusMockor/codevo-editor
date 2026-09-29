import { AlertTriangle } from "lucide-react";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";
import type {
  AgentEndSessionBackground,
  AgentEndSessionConfirmationView,
} from "./useAgentEndSessionCommand";

export const AGENT_END_SESSION_STOP_TEXT =
  "Ending the session may stop background tasks Claude started.";

export function AgentEndSessionConfirmationBanner({
  confirmation,
}: {
  readonly confirmation: AgentEndSessionConfirmationView | null;
}) {
  if (confirmation === null) return null;
  return (
    <ComposerBanner
      actions={
        <>
          <button
            className="cv-banner-action"
            onClick={() => confirmation.onConfirm()}
            type="button"
          >
            End session
          </button>
          <button
            className="cv-banner-action"
            onClick={() => confirmation.onCancel()}
            type="button"
          >
            Keep running
          </button>
        </>
      }
      icon={<AlertTriangle size={12} strokeWidth={1.5} />}
      tone="warn"
    >
      {agentEndSessionText(confirmation.title, confirmation.background)}
    </ComposerBanner>
  );
}

function agentEndSessionText(title: string, background: AgentEndSessionBackground): string {
  return `End Claude's session for "${title}"? ${backgroundText(background)} ${AGENT_END_SESSION_STOP_TEXT}`;
}

function backgroundText(background: AgentEndSessionBackground): string {
  switch (background) {
    case "live":
      return "Background tasks are still running in this session.";
    case "unknown":
      return "Codevo could not check whether background tasks are running in this session.";
    default:
      return unsupportedBackground(background);
  }
}

function unsupportedBackground(background: never): never {
  throw new TypeError(`Unsupported end session background: ${String(background)}.`);
}
