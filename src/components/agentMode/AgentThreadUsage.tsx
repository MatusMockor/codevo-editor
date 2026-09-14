import type { AgentTurnUsage } from "../../domain/agentThread";

export function AgentThreadUsage({ usage }: { readonly usage: AgentTurnUsage | null }) {
  if (usage === null) return null;
  const totals = usage.appServerUsage?.total ?? usage;
  return (
    <p className="agent-note agent-num">
      Thread usage: {totals.inputTokens} input · {totals.outputTokens} output
      {totals.cachedInputTokens != null && ` · ${totals.cachedInputTokens} cached input`}
      {totals.reasoningOutputTokens != null &&
        ` · ${totals.reasoningOutputTokens} reasoning output`}
    </p>
  );
}
