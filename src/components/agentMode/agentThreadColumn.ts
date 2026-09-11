export type AgentThreadColumnAnchor =
  | { readonly scope: "imported"; readonly exchangeIndex: number }
  | { readonly scope: "turn"; readonly turnId: string };

export function agentThreadColumnKey(anchor: AgentThreadColumnAnchor): string {
  if (anchor.scope === "imported") return `imported:${anchor.exchangeIndex}`;

  return `turn:${anchor.turnId}`;
}
