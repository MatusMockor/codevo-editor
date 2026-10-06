export function AgentCodexStartingNote() {
  return (
    <p className="agent-note" role="status">
      Starting Codex…
    </p>
  );
}

export function AgentWaitingForOutputNote() {
  return (
    <p className="agent-note">
      Waiting for output…
      <span aria-hidden="true" className="agent-well__caret" />
    </p>
  );
}
