import {
  parseAgentRootLeaseReceipt,
  parseAgentRootLeaseReleaseResult,
  validateAgentRootLeaseAcquireRequest,
  validateAgentRootLeaseReleaseRequest,
  type AgentRootLeaseAcquireRequest,
  type AgentRootLeaseReceipt,
  type AgentRootLeaseReleaseResult,
  type AgentRootLeaseReleaseRequest,
} from "../domain/agentProject";

export const ACQUIRE_AGENT_ROOT_LEASE_IPC_COMMAND = "acquire_agent_root_lease" as const;
export const RELEASE_AGENT_ROOT_LEASE_IPC_COMMAND = "release_agent_root_lease" as const;

export type InvokeAgentRootLeaseCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export async function invokeAcquireAgentRootLeaseIpc(
  invokeCommand: InvokeAgentRootLeaseCommand,
  request: AgentRootLeaseAcquireRequest,
): Promise<AgentRootLeaseReceipt> {
  const validated = validateAgentRootLeaseAcquireRequest(request);
  return parseAgentRootLeaseReceipt(
    await invokeCommand(ACQUIRE_AGENT_ROOT_LEASE_IPC_COMMAND, { request: validated }),
  );
}

export async function invokeReleaseAgentRootLeaseIpc(
  invokeCommand: InvokeAgentRootLeaseCommand,
  request: AgentRootLeaseReleaseRequest,
): Promise<AgentRootLeaseReleaseResult> {
  const validated = validateAgentRootLeaseReleaseRequest(request);
  const result = parseAgentRootLeaseReleaseResult(
    await invokeCommand(RELEASE_AGENT_ROOT_LEASE_IPC_COMMAND, { request: validated }),
  );
  if (result.leaseToken !== validated.leaseToken) {
    throw new TypeError(
      "Invalid agent root lease value at result.leaseToken: expected the requested lease token.",
    );
  }
  return result;
}
