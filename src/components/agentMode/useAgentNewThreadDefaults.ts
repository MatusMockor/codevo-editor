import { createContext, useContext } from "react";
import type { AgentExecutionTarget } from "../../domain/agentLaunch";
import {
  defaultAgentNewThreadDefaults,
  type AgentNewThreadDefaults,
} from "../../domain/agentNewThreadDefaults";

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
