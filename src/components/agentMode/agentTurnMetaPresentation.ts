import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentTurnUsage } from "../../domain/agentThread";
import {
  agentLaunchEffortLabel,
  agentLaunchEffortValue,
  agentLaunchModelLabel,
} from "./agentLaunchPresentation";
import { agentTokenCountLabel } from "./agentRuntimeSubagentPresentation";

export function agentTurnLaunchLabel(launch: AgentLaunchOptions | null): string | null {
  if (launch === null) return null;
  const parts: string[] = [];
  if (launch.model !== "default") parts.push(agentLaunchModelLabel(launch));
  if (agentLaunchEffortValue(launch) !== "default") {
    parts.push(`${agentLaunchEffortLabel(launch)} effort`);
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

export function agentSubagentTokensLabel(usage: AgentTurnUsage | null): string | null {
  if (usage === null) return null;
  const total = usage.appServerUsage?.total.totalTokens ?? usage.inputTokens + usage.outputTokens;
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  return `${agentTokenCountLabel(total)} tok`;
}
