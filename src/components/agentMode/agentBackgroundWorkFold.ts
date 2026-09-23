import {
  agentTurnWorkFold,
  type AgentTurnItem,
  type AgentTurnWorkFold,
} from "./agentTurnProjection";

export function agentBackgroundSettledWorkFold(
  items: ReadonlyArray<AgentTurnItem>,
): AgentTurnWorkFold | null {
  const fold = agentTurnWorkFold(items, false);
  if (fold === null) return null;
  const [answer, ...trailing] = fold.visibleItems;
  if (answer === undefined) return fold;
  if (answer.kind !== "assistantText" && answer.kind !== "result") return fold;
  const lateWork = trailing.filter(isWorkItem);
  if (lateWork.length === 0) return fold;
  const workItems = [...fold.workItems, ...lateWork];
  return {
    workItems,
    visibleItems: [answer, ...trailing.filter((item) => !isWorkItem(item))],
    summary: agentTurnWorkFold(workItems, true)?.summary ?? fold.summary,
  };
}

function isWorkItem(item: AgentTurnItem): boolean {
  return item.kind === "tool" || item.kind === "reasoning";
}
