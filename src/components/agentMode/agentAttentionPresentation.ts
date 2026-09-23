import type { AgentThreadView } from "../../application/agentThreadPorts";

export function agentAttentionExplanation(threads: readonly AgentThreadView[]): string {
  let failed = 0;
  let interrupted = 0;
  for (const view of threads) {
    if (view.attention !== "attention") continue;
    const status = view.thread.turns[view.thread.turns.length - 1]?.status;
    if (status?.kind === "failed" || (status?.kind === "exited" && status.exitCode !== 0)) {
      failed += 1;
    }
    if (status?.kind === "interrupted") interrupted += 1;
  }
  const summary = [
    failed > 0 ? `${failed} failed` : null,
    interrupted > 0 ? `${interrupted} interrupted` : null,
  ]
    .filter((label) => label !== null)
    .join(" · ");
  return `${summary === "" ? "Thread status" : summary}. Runs that ended with an error or were interrupted and have not been opened since. Opening a thread clears it from this count; runs you stopped are not counted. Right-click the status bar to hide this indicator.`;
}
