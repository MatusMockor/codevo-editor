import {
  parseAgentRootLeaseReceipt,
  validateAgentRootLeaseAcquireRequest,
  validateAgentRootLeaseReleaseRequest,
  type AgentRootLeaseAcquireRequest,
  type AgentRootLeaseReceipt,
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
): Promise<void> {
  return invokeUnit(
    invokeCommand,
    RELEASE_AGENT_ROOT_LEASE_IPC_COMMAND,
    validateAgentRootLeaseReleaseRequest(request),
  );
}

async function invokeUnit(
  invokeCommand: InvokeAgentRootLeaseCommand,
  command: string,
  request: AgentRootLeaseReleaseRequest,
): Promise<void> {
  const value = await invokeCommand(command, { request });
  if (value !== null) {
    throw new TypeError("Invalid agent root lease value at result: expected null.");
  }
}
