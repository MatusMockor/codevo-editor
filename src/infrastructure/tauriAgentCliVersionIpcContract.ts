import {
  parseAgentCliVersionProbeResult,
  validateAgentCliVersionProbeRequest,
  type AgentCliVersionProbeRequest,
  type AgentCliVersionProbeResult,
} from "../domain/agentCliVersion";

export const PROBE_AGENT_CLI_VERSION_IPC_COMMAND = "probe_agent_cli_version" as const;

export type InvokeAgentCliVersionCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export async function invokeProbeAgentCliVersionIpc(
  invokeCommand: InvokeAgentCliVersionCommand,
  request: AgentCliVersionProbeRequest,
): Promise<AgentCliVersionProbeResult> {
  const validated = validateAgentCliVersionProbeRequest(request);
  return parseAgentCliVersionProbeResult(
    await invokeCommand(PROBE_AGENT_CLI_VERSION_IPC_COMMAND, { request: validated }),
  );
}
