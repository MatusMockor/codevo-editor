import { Download, X } from "lucide-react";
import "./agentCloneDraftPanel.css";

export interface AgentCloneDraftPanelProps {
  readonly clone: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly error: string | null;
  };
  readonly preparing?: boolean;
  readonly onCancel: () => void;
  readonly onRetry?: () => void;
  readonly onRemove?: () => void;
  readonly onClose: () => void;
}

/** Clone status sits directly above the regular composer; it never owns message input. */
export function AgentCloneDraftPanel({
  clone,
  preparing = false,
  onCancel,
  onRetry,
  onRemove,
  onClose,
}: AgentCloneDraftPanelProps) {
  const complete = clone.status === "completed" || clone.status === "succeeded";
  const retryable = ["failed", "canceled", "cancelled", "interrupted"].includes(clone.status);
  const running = ["pending", "queued", "running", "cloning"].includes(clone.status);
  const cancelled = ["canceled", "cancelled"].includes(clone.status);
  const title = complete
    ? preparing
      ? `Preparing ${clone.name}`
      : `${clone.name} is ready`
    : retryable
      ? `${cancelled ? "Cancelled cloning" : "Could not clone"} ${clone.name}`
      : `Cloning ${clone.name}`;
  return (
    <section
      className="agent-clone-draft"
      aria-label={`Clone ${clone.name}`}
      data-failed={retryable}
    >
      <Download aria-hidden="true" size={16} />
      <div className="agent-clone-draft__copy" role="status">
        <strong>{title}</strong>
        <span>
          {complete
            ? preparing
              ? "Preparing the project. Your message stays here."
              : "Review your message and send when you are ready."
            : retryable
              ? "Your message and attachments are kept. Retry to finish cloning."
              : "Write your message below. Sending becomes available when cloning finishes."}
        </span>
        {clone.error !== null && <span role="alert">{clone.error}</span>}
      </div>
      <div className="agent-clone-draft__actions">
        {running && (
          <button type="button" onClick={() => onCancel()}>
            Cancel clone
          </button>
        )}
        {(retryable || clone.error !== null) && onRetry !== undefined && (
          <button type="button" onClick={() => onRetry()}>
            {running ? "Retry status" : "Retry clone"}
          </button>
        )}
        {(retryable || complete) && onRemove !== undefined && (
          <button type="button" onClick={() => onRemove()}>
            {complete ? "Dismiss clone" : "Remove project"}
          </button>
        )}
        <button
          type="button"
          onClick={() => onClose()}
          aria-label="Close clone draft"
          title="Close clone draft"
        >
          <X aria-hidden="true" size={14} />
        </button>
      </div>
    </section>
  );
}
