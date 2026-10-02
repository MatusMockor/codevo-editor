import type { AgentTaskChangeSummary, AgentThreadView } from "./agentThreadPorts";

interface SummarizedView {
  readonly summary: AgentTaskChangeSummary;
  readonly view: AgentThreadView;
}

export class RemoteChangeSummaryViews {
  private readonly cache = new WeakMap<AgentThreadView, SummarizedView>();

  present(view: AgentThreadView, summary: AgentTaskChangeSummary | undefined): AgentThreadView {
    if (summary === undefined) return view;
    const cached = this.cache.get(view);
    if (cached !== undefined && cached.summary === summary) return cached.view;
    const next: AgentThreadView = { ...view, changeSummary: summary };
    this.cache.set(view, { summary, view: next });
    return next;
  }
}
