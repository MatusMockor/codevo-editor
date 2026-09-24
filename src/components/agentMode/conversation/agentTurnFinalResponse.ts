import type { AgentTurnItem } from "../agentTurnProjection";

function finalResponseIndex(items: ReadonlyArray<AgentTurnItem>): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item === undefined) continue;
    if (item.kind === "assistantText") return index;
    if (item.kind === "result" && !item.isError && item.text.trim() !== "") return index;
  }
  return -1;
}

export function agentFinalResponseItems(
  items: ReadonlyArray<AgentTurnItem>,
): ReadonlyArray<AgentTurnItem> {
  const index = finalResponseIndex(items);
  if (index < 0) return [];
  return items.slice(index);
}

export function agentItemsBeforeFinalResponse(
  items: ReadonlyArray<AgentTurnItem>,
): ReadonlyArray<AgentTurnItem> {
  const index = finalResponseIndex(items);
  if (index < 0) return items;
  return items.slice(0, index);
}
