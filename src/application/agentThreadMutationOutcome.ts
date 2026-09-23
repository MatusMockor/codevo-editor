import type { AgentThreadMutationResult } from "./agentThreadPorts";

export async function settleAgentThreadMutation(
  result: AgentThreadMutationResult | void,
): Promise<boolean> {
  try {
    return (await result) === true;
  } catch {
    return false;
  }
}
