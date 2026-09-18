export function AgentUnconfirmedMessageNotice({ onDismiss }: { readonly onDismiss: () => void }) {
  return (
    <div className="agent-thread-notice" role="status">
      <p className="agent-note agent-note--warning">
        Delivery could not be confirmed. The agent may already have received your message.
        Dismissing this warning does not resend or undo it.
      </p>
      <button className="agent-composer__alternate" onClick={onDismiss} type="button">
        Dismiss unconfirmed message
      </button>
    </div>
  );
}
