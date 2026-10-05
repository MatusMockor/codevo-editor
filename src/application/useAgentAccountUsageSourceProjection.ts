import { useLayoutEffect, useRef, useState } from "react";
import type { AgentAccountUsageLoadState } from "../domain/agentAccountUsage";
import type { AgentAccountUsageSourcesPort } from "../domain/agentAccountUsageSources";

export type AgentAccountUsageStates = Readonly<
  Record<"claudeCode" | "codex", AgentAccountUsageLoadState>
>;

export function useAgentAccountUsageSourceProjection(
  accountUsage: AgentAccountUsageStates,
  sources: AgentAccountUsageSourcesPort | undefined,
): AgentAccountUsageStates {
  const [, update] = useState(0);
  const observed = useRef<{
    readonly sources: AgentAccountUsageSourcesPort;
    readonly states: Partial<AgentAccountUsageStates>;
  } | null>(null);
  useLayoutEffect(() => sources?.subscribe(() => update((value) => value + 1)), [sources]);
  useLayoutEffect(() => {
    if (!sources) return;
    const previous = observed.current?.sources === sources ? observed.current.states : {};
    for (const provider of ["claudeCode", "codex"] as const) {
      const state = accountUsage[provider];
      if (previous[provider] === state) continue;
      if (state.kind === "ready") sources.observe("local", state.snapshot);
      else if (state.kind !== "loading") sources.invalidate("local", provider);
    }
    observed.current = { sources, states: accountUsage };
  }, [accountUsage, sources]);
  const project = (provider: "claudeCode" | "codex"): AgentAccountUsageLoadState => {
    const state = accountUsage[provider];
    const snapshot = state.kind === "ready" ? sources?.read("local", provider) : null;
    return snapshot ? { kind: "ready", snapshot } : state;
  };
  return sources ? { claudeCode: project("claudeCode"), codex: project("codex") } : accountUsage;
}
