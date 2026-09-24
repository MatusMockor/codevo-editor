import { MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import type { AgentApprovalDecision } from "../../../domain/agentApproval";
import { Button } from "../../../ui/foundation/Button";
import { Menu } from "../../../ui/foundation/Menu";
import { MenuItem } from "../../../ui/foundation/MenuItem";
import type { AgentComposerInteraction } from "./agentComposerInteraction";
import { useAgentComposerPanelFocus } from "./useAgentComposerInteractionFocus";

export const AGENT_APPROVAL_SEND_FAILURE = "Could not send your decision. Please try again.";

export function AgentComposerApprovalPanel({
  interaction,
}: {
  readonly interaction: Extract<AgentComposerInteraction, { kind: "approval" }>;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const { view } = interaction;
  const busy = interaction.sending || sending;
  const primary = view.actions.find((action) => action.tone === "primary") ?? null;
  const danger = view.actions.find((action) => action.tone === "danger") ?? null;
  const secondary = view.actions.filter((action) => action.tone === "secondary");
  const error = sendError ?? interaction.error;

  useAgentComposerPanelFocus(rootRef);

  const decide = (decision: AgentApprovalDecision): void => {
    if (busy || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    void interaction
      .decide(decision)
      .catch(() => setSendError(AGENT_APPROVAL_SEND_FAILURE))
      .finally(() => {
        sendingRef.current = false;
        setSending(false);
      });
  };

  return (
    <div
      aria-busy={busy}
      aria-label="Approval request"
      className="cv-composer-interaction"
      ref={rootRef}
      role="group"
      tabIndex={-1}
    >
      <div className="cv-composer-interaction__body">
        <p className="cv-composer-interaction__kicker">
          <b>{view.detailLabel}</b>
          <span className="cv-composer-interaction__title">{view.title}</span>
          {interaction.pendingCount > 1 && (
            <span className="cv-composer-interaction__count">1/{interaction.pendingCount}</span>
          )}
        </p>
        {view.detail !== "" && (
          <pre className="cv-composer-interaction__detail" tabIndex={0}>
            {view.detail}
          </pre>
        )}
        {view.truncatedNote !== null && (
          <p className="cv-composer-interaction__note">{view.truncatedNote}</p>
        )}
        {view.facts.map((fact, index) => (
          <p className="cv-composer-interaction__note" key={`${fact.label}-${index}`}>
            {fact.label}: {fact.value}
          </p>
        ))}
        {error !== null && (
          <p className="cv-composer-interaction__error" role="alert">
            {error}
          </p>
        )}
        <span className="agent-visually-hidden" role="status">
          {busy ? "Sending decision…" : view.statusText}
        </span>
      </div>
      <div className="cv-composer__foot">
        <span className="cv-composer__controls" />
        <div className="cv-composer__actions">
          {secondary.length > 0 && (
            <>
              <button
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                aria-label="More approval options"
                className="cv-icon-button cv-icon-button--sm"
                disabled={busy}
                onClick={() => setMoreOpen((open) => !open)}
                ref={moreRef}
                title="More options"
                type="button"
              >
                <span aria-hidden="true" className="cv-icon-button__glyph">
                  <MoreHorizontal size={16} strokeWidth={1.5} />
                </span>
              </button>
              <Menu
                anchorRef={moreRef}
                label="More approval options"
                onClose={() => setMoreOpen(false)}
                open={moreOpen}
                placement="top-end"
              >
                {secondary.map((action) => (
                  <MenuItem key={action.decision} onSelect={() => decide(action.decision)}>
                    {action.label}
                  </MenuItem>
                ))}
              </Menu>
            </>
          )}
          {danger !== null && (
            <Button disabled={busy} onClick={() => decide(danger.decision)}>
              {danger.label}
            </Button>
          )}
          {primary !== null && (
            <Button disabled={busy} onClick={() => decide(primary.decision)} variant="primary">
              {primary.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
