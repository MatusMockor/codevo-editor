export function AgentThreadSessionEmpty({
  repositoryLabel,
}: {
  readonly repositoryLabel: string | null;
}) {
  return (
    <section aria-label="New agent thread" className="agent-session">
      <div className="agent-session__scroll">
        <div className="agent-session__body agent-session__body--empty">
          <AgentEmptyTitle repositoryLabel={repositoryLabel} />
        </div>
      </div>
    </section>
  );
}

function AgentEmptyTitle({ repositoryLabel }: { readonly repositoryLabel: string | null }) {
  if (repositoryLabel === null) {
    return (
      <>
        <h2 className="agent-empty__title">No Git repository detected</h2>
        <p className="agent-empty__text">
          The agent will work in this folder as it is. Open a Git repository to get branches,
          worktrees and change review.
        </p>
      </>
    );
  }

  return (
    <h2 className="agent-empty__title">
      What should we build in <span className="agent-empty__project">{repositoryLabel}</span>?
    </h2>
  );
}
