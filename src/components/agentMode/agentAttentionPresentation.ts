import type { AgentThreadView } from "../../application/agentThreadPorts";

export function agentAttentionExplanation(threads: readonly AgentThreadView[]): string {
  let failed = 0;
  let stopped = 0;
  let interrupted = 0;
  for (const view of threads) {
    if (view.attention !== "attention") continue;
    const status = view.thread.turns[view.thread.turns.length - 1]?.status;
    if (status?.kind === "failed" || (status?.kind === "exited" && status.exitCode !== 0)) {
      failed += 1;
    }
    if (status?.kind === "stopped") stopped += 1;
    if (status?.kind === "interrupted") interrupted += 1;
  }
  const summary = [
    failed > 0 ? `${failed} failed` : null,
    stopped > 0 ? `${stopped} stopped` : null,
    interrupted > 0 ? `${interrupted} interrupted` : null,
  ]
    .filter((label) => label !== null)
    .join(" · ");
  return `${summary === "" ? "Thread status" : summary}. Previous runs ended with an error, were stopped, or were interrupted. Open the threads to see what happened. Reading a thread does not clear its run status. Right-click the status bar to hide this indicator.`;
}
