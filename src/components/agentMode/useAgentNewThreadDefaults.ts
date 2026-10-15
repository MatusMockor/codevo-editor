import { createContext, useContext } from "react";
import type { AgentExecutionTarget } from "../../domain/agentLaunch";
import {
  defaultAgentNewThreadDefaults,
  type AgentNewThreadDefaults,
} from "../../domain/agentNewThreadDefaults";

import type { ClaudeNewThreadModelFallback } from "./agentComposerLaunch";

export type AgentNewThreadDefaultsByTarget = Readonly<
  Record<AgentExecutionTarget, AgentNewThreadDefaults>
>;

const UNCONFIGURED_DEFAULTS = defaultAgentNewThreadDefaults();

export const AgentNewThreadDefaultsContext = createContext<AgentNewThreadDefaultsByTarget>({
  local: UNCONFIGURED_DEFAULTS,
  server: UNCONFIGURED_DEFAULTS,
});

export function useAgentNewThreadDefaults(target: AgentExecutionTarget): AgentNewThreadDefaults {
  return useContext(AgentNewThreadDefaultsContext)[target];
}

export const AgentNewThreadModelFallbackContext = createContext<
  Readonly<Record<AgentExecutionTarget, ClaudeNewThreadModelFallback | null>>
>({ local: null, server: null });

export function useAgentNewThreadModelFallback(
  target: AgentExecutionTarget,
): ClaudeNewThreadModelFallback | null {
  return useContext(AgentNewThreadModelFallbackContext)[target];
}
