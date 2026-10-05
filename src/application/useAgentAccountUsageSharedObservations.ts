import { useCallback } from "react";
import type {
  AgentAccountUsageLoadState,
  AgentAccountUsageObservation,
} from "../domain/agentAccountUsage";
import type { AgentAccountUsageSourcesPort } from "../domain/agentAccountUsageSources";

/** Partial local turn updates retain windows most recently verified by a peer account. */
export function useAgentAccountUsageSharedObservations(
  record: (observation: AgentAccountUsageObservation) => void,
  capture: (provider: "claudeCode" | "codex") => AgentAccountUsageLoadState,
  sources: AgentAccountUsageSourcesPort | undefined,
) {
  return useCallback(
    (observation: AgentAccountUsageObservation) => {
      const own = capture(observation.provider);
      const shared = sources?.read("local", observation.provider);
      const identity = own.kind === "ready" ? own.snapshot.accountIdentity : null;
      record(
        identity && shared?.accountIdentity === identity
          ? {
              provider: observation.provider,
              windows: [...shared.windows, ...observation.windows],
            }
          : observation,
      );
    },
    [capture, record, sources],
  );
}
