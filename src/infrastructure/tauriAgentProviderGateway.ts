import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  parseAgentProviderCurrentPolicyResult,
  parseAgentProviderHealthProbeResult,
  parseAgentProviderPolicyRegistrationReceipt,
  parseAgentProviderUpdateResult,
  parseAgentProviderUpdateProgressEvent,
  validateAgentProviderCurrentPolicyRequest,
  validateAgentProviderHealthProbeRequest,
  validateAgentProviderPolicyRegistrationRequest,
  validateAgentProviderUpdateRequest,
  type AgentProviderCurrentPolicyRequest,
  type AgentProviderCurrentPolicyResult,
  type AgentProviderGenerationRequest,
  type AgentProviderHealthGateway,
  type AgentProviderHealthProbeResult,
  type AgentProviderPolicyGateway,
  type AgentProviderPolicyRegistrationReceipt,
  type AgentProviderPolicyRegistrationRequest,
  type AgentProviderUpdateGateway,
  type AgentProviderUpdateRequest,
  type AgentProviderUpdateResult,
  type AgentProviderUpdateProgressEvent,
} from "../domain/agentProviderHealth";

export const REGISTER_AGENT_PROVIDER_POLICY_IPC_COMMAND = "register_agent_provider_policy" as const;
export const GET_AGENT_PROVIDER_POLICY_IPC_COMMAND = "get_agent_provider_policy" as const;
export const PROBE_AGENT_PROVIDER_HEALTH_IPC_COMMAND = "probe_agent_provider_health" as const;
export const UPDATE_AGENT_PROVIDER_IPC_COMMAND = "update_agent_provider" as const;
export const AGENT_PROVIDER_UPDATE_PROGRESS_EVENT = "agent-provider-update://progress" as const;

export type InvokeAgentProviderCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export type AgentProviderRuntimeDetector = () => boolean;
export type ListenToAgentProviderUpdateProgress = (
  event: string,
  handler: (event: { readonly payload: unknown }) => void,
) => Promise<() => void>;

const invokeAgentProviderCommand: InvokeAgentProviderCommand = (command, args) =>
  invoke(command, args);
const listenToAgentProviderUpdateProgress: ListenToAgentProviderUpdateProgress = (event, handler) =>
  listen<unknown>(event, handler);

export class TauriAgentProviderGateway
  implements AgentProviderPolicyGateway, AgentProviderHealthGateway, AgentProviderUpdateGateway
{
  constructor(
    private readonly invokeCommand: InvokeAgentProviderCommand = invokeAgentProviderCommand,
    private readonly isRuntimeAvailable: AgentProviderRuntimeDetector = isTauri,
    private readonly listenToProgress: ListenToAgentProviderUpdateProgress = listenToAgentProviderUpdateProgress,
  ) {}

  async currentAgentProviderPolicy(
    request: AgentProviderCurrentPolicyRequest,
  ): Promise<AgentProviderCurrentPolicyResult> {
    this.requireRuntime();
    const validated = validateAgentProviderCurrentPolicyRequest(request);
    const result = parseAgentProviderCurrentPolicyResult(
      await this.invokeCommand(GET_AGENT_PROVIDER_POLICY_IPC_COMMAND, { request: validated }),
    );
    if (result.kind === "unregistered") return result;
    if (result.receipt.provider !== validated.provider)
      return invalidResponse("result.receipt.provider", "the requested provider");
    return result;
  }

  async registerAgentProviderPolicy(
    request: AgentProviderPolicyRegistrationRequest,
  ): Promise<AgentProviderPolicyRegistrationReceipt> {
    this.requireRuntime();
    const validated = validateAgentProviderPolicyRegistrationRequest(request);
    const receipt = parseAgentProviderPolicyRegistrationReceipt(
      await this.invokeCommand(REGISTER_AGENT_PROVIDER_POLICY_IPC_COMMAND, {
        request: validated,
      }),
    );
    if (receipt.provider !== validated.provider) {
      return invalidResponse("receipt.provider", "the requested provider");
    }
    if (receipt.settingsRevision < validated.settingsRevision) {
      return invalidResponse(
        "receipt.settingsRevision",
        "the requested or a newer persisted settings revision",
      );
    }
    return receipt;
  }

  async probeAgentProviderHealth(
    request: AgentProviderGenerationRequest,
  ): Promise<AgentProviderHealthProbeResult> {
    this.requireRuntime();
    const validated = validateAgentProviderHealthProbeRequest(request);
    return parseAgentProviderHealthProbeResult(
      validated.provider,
      await this.invokeCommand(PROBE_AGENT_PROVIDER_HEALTH_IPC_COMMAND, { request: validated }),
    );
  }

  async updateAgentProvider(
    request: AgentProviderUpdateRequest,
  ): Promise<AgentProviderUpdateResult> {
    this.requireRuntime();
    const validated = validateAgentProviderUpdateRequest(request);
    return parseAgentProviderUpdateResult(
      await this.invokeCommand(UPDATE_AGENT_PROVIDER_IPC_COMMAND, { request: validated }),
    );
  }

  async subscribeAgentProviderUpdateProgress(
    listener: (event: AgentProviderUpdateProgressEvent) => void,
    onError: (error: unknown) => void,
  ): Promise<() => void> {
    this.requireRuntime();
    return this.listenToProgress(AGENT_PROVIDER_UPDATE_PROGRESS_EVENT, (event) => {
      try {
        listener(parseAgentProviderUpdateProgressEvent(event.payload));
      } catch (error) {
        onError(error);
      }
    });
  }

  private requireRuntime(): void {
    if (this.isRuntimeAvailable()) return;
    throw new Error("Agent provider operations require the native runtime.");
  }
}

function invalidResponse(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent provider value at ${path}: expected ${expectation}.`);
}
