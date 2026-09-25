export type AgentAccountUsageRefreshOutcome =
  | { readonly kind: "refreshed" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed" }
  | { readonly kind: "superseded" };
