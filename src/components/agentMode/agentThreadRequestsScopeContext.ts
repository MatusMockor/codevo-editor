import { createContext } from "react";
import type { AgentThreadRequestDeliveryLedger } from "../../application/agentThreadRequestDeliveryLedger";
import type { AgentThreadRequestScope } from "../../application/agentThreadRequestPorts";
import type { AgentThreadRuntimeRequests } from "../../application/useAgentThreadRuntimeRequests";

export interface AgentThreadRequestsScopeValue {
  readonly threadId: string;
  readonly scope: AgentThreadRequestScope;
  readonly scopeKey: string;
  readonly remote: boolean;
  readonly reachable: boolean;
  readonly requests: AgentThreadRuntimeRequests;
}

export type AgentThreadRequestTurnsReport = (
  threadId: string,
  turnIds: readonly string[] | null,
) => void;

export const AgentThreadRequestsScopeContext = createContext<AgentThreadRequestsScopeValue | null>(
  null,
);

export const AgentThreadRequestDeliveriesContext =
  createContext<AgentThreadRequestDeliveryLedger | null>(null);

export const AgentThreadRequestTurnsReportContext =
  createContext<AgentThreadRequestTurnsReport | null>(null);
