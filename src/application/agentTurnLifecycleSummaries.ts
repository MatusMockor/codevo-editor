import type { AgentTurnLogSummary, SummarizeAgentTurnLogsRequest } from "../domain/agentTurnLog";
import { AGENT_TURN_LOG_LIMITS } from "../domain/agentTurnLog";
import type { AgentTurnLogGateway } from "./agentTurnLogPorts";
import { attempt } from "./agentProjectAuthority";

export async function completeAgentLifecycleSummaries(
  gateway: Pick<AgentTurnLogGateway, "summarizeTurnLogs">,
  request: SummarizeAgentTurnLogsRequest,
  summaries: ReadonlyArray<AgentTurnLogSummary>,
  owned: () => boolean,
): Promise<ReadonlyArray<AgentTurnLogSummary>> {
  const completed: AgentTurnLogSummary[] = [];
  for (const summary of summaries.slice(0, AGENT_TURN_LOG_LIMITS.summaries)) {
    if (!owned()) return completed;
    if (!summary.lifecycleOmitted) {
      completed.push(summary);
      continue;
    }
    const result = await attempt(() =>
      gateway.summarizeTurnLogs({
        ...request,
        turnId: summary.turnId,
        includePrompts: false,
        includeLifecycles: true,
      }),
    );
    if (!owned()) return completed;
    const detail = result.ok
      ? result.value.find((entry) => entry.turnId === summary.turnId)
      : undefined;
    completed.push(
      detail === undefined
        ? summary
        : { ...detail, prompt: summary.prompt, promptOmitted: summary.promptOmitted },
    );
  }
  return completed;
}
