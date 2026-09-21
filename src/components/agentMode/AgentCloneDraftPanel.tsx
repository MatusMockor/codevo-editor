import { MAX_PENDING_CLONE_DRAFT_CHARS } from "./agentProjectCreationSession";
import { useId } from "react";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "../../domain/agentTask";
import "./agentCloneDraftPanel.css";

export interface AgentCloneDraftPanelProps {
  readonly clone: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly error: string | null;
  };
  readonly draft: string;
  readonly onChangeDraft: (draft: string) => void;
  readonly onCancel: () => void;
  readonly onRetry?: () => void;
  readonly onContinue?: () => void;
  readonly onClose: () => void;
}

export function AgentCloneDraftPanel({
  clone,
  draft,
  onChangeDraft,
  onCancel,
  onRetry,
  onContinue,
  onClose,
}: AgentCloneDraftPanelProps) {
  const id = useId();
  const oversized = new TextEncoder().encode(draft).byteLength > MAX_AGENT_TASK_PROMPT_BYTES;
  const complete = clone.status === "completed" || clone.status === "succeeded";
  const retryable = ["failed", "canceled", "cancelled", "interrupted"].includes(clone.status);
  const running = ["pending", "queued", "running", "cloning"].includes(clone.status);
  const ready = complete && onContinue !== undefined;
  const status = complete
    ? "Clone complete. Continue to review your draft before sending."
    : retryable
      ? "Clone did not complete. Your draft is still available."
      : running
        ? "You can write your message while the repository is cloning. Sending waits until it is ready."
        : "Waiting for the clone to become available. Your draft is still available.";

  return (
    <section className="agent-clone-draft" aria-label={`Clone ${clone.name}`}>
      <header className="agent-clone-draft__header">
        <h2>{clone.name}</h2>
        <button type="button" onClick={onClose} aria-label="Close clone draft">
          Close
        </button>
      </header>
      <p id={`${id}-status`} role="status">
        {status}
      </p>
      {clone.error !== null && <p role="alert">{clone.error}</p>}
      <label htmlFor={id}>Message for cloned project</label>
      <textarea
        id={id}
        value={draft}
        maxLength={MAX_PENDING_CLONE_DRAFT_CHARS}
        placeholder="What would you like to work on?"
        aria-describedby={`${id}-status${oversized ? ` ${id}-limit` : ""}`}
        aria-invalid={oversized}
        onChange={(event) => onChangeDraft(event.target.value)}
      />
      {oversized && (
        <p id={`${id}-limit`} role="alert">
          This message exceeds the {MAX_AGENT_TASK_PROMPT_BYTES.toLocaleString("en-US")}-byte limit.
          Shorten it before continuing. Your text has not been truncated.
        </p>
      )}
      <div className="agent-clone-draft__actions">
        {running && (
          <button type="button" onClick={onCancel}>
            Cancel clone
          </button>
        )}
        {(retryable || (running && clone.error !== null)) && onRetry !== undefined && (
          <button type="button" onClick={onRetry}>
            {running ? "Retry status" : "Retry clone"}
          </button>
        )}
        <button
          type="button"
          disabled={!ready || oversized}
          onClick={() => {
            if (ready && !oversized) onContinue();
          }}
        >
          {ready ? "Continue with draft" : "Send"}
        </button>
      </div>
    </section>
  );
}
