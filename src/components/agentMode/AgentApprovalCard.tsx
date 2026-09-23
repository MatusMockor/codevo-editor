import { useId, useRef, useState } from "react";
import type { AgentApprovalDecision } from "../../domain/agentApproval";
import type { AgentApprovalView } from "./agentApprovalPresenter";
import "./agentApprovalCard.css";

export interface AgentApprovalCardProps {
  readonly view: AgentApprovalView;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onDecide: (decision: AgentApprovalDecision) => Promise<void>;
}

export function AgentApprovalCard({ view, pending, error, onDecide }: AgentApprovalCardProps) {
  const headingId = useId();
  const detailId = useId();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const busy = pending || sending;

  if (!view.pending) {
    return (
      <section
        className="agent-approval-card agent-approval-card--settled"
        aria-labelledby={headingId}
      >
        <p className="agent-approval-card__settled" role="status" id={headingId}>
          <span>{view.title}</span> <span>{view.statusText}</span>
        </p>
      </section>
    );
  }

  const decide = (decision: AgentApprovalDecision) => {
    if (busy || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    void onDecide(decision)
      .catch(() => {
        setSendError("Could not send your decision. Please try again.");
      })
      .finally(() => {
        sendingRef.current = false;
        setSending(false);
      });
  };

  return (
    <section
      className="agent-approval-card"
      aria-labelledby={headingId}
      aria-describedby={view.detail ? detailId : undefined}
      aria-busy={busy}
    >
      <div className="agent-approval-card__status">
        <span role="status">{busy ? "Sending decision…" : view.statusText}</span>
        <span>{view.providerLabel}</span>
      </div>
      <h3 className="agent-approval-card__title" id={headingId}>
        {view.title}
      </h3>
      {view.detail && (
        <div className="agent-approval-card__detail">
          <span className="agent-approval-card__label">{view.detailLabel}</span>
          <pre id={detailId} tabIndex={0}>
            {view.detail}
          </pre>
          {view.truncatedNote && (
            <span className="agent-approval-card__note">{view.truncatedNote}</span>
          )}
        </div>
      )}
      {view.facts.length > 0 && (
        <dl className="agent-approval-card__facts">
          {view.facts.map((fact, index) => (
            <div key={`${fact.label}-${index}`}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {(error || sendError) && (
        <p className="agent-approval-card__error" role="alert">
          {sendError || error}
        </p>
      )}
      <div className="agent-approval-card__actions">
        {view.actions.map((action) => (
          <button
            key={action.decision}
            type="button"
            className={`agent-approval-card__action agent-approval-card__action--${action.tone}`}
            disabled={busy}
            onClick={() => decide(action.decision)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
