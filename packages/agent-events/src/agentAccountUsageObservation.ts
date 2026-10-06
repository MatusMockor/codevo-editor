import type { AgentCliKind } from "./agentProvider.js";

export interface AgentAccountUsageWindow {
  readonly id: string;
  readonly label: string;
  readonly usedPercent: number;
  readonly windowDurationMinutes: number | null;
  readonly resetsAtEpochMs: number | null;
  readonly resetsLabel: string | null;
}

export interface AgentAccountUsageObservation {
  readonly provider: AgentCliKind;
  readonly windows: ReadonlyArray<AgentAccountUsageWindow>;
}
