import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  parseAgentProviderSignInResult,
  validateAgentProviderSignInRequest,
  type AgentProviderSignInGateway,
  type AgentProviderSignInRequest,
  type AgentProviderSignInResult,
} from "../domain/agentProviderSignIn";

export const START_AGENT_PROVIDER_SIGN_IN_IPC_COMMAND = "start_agent_provider_sign_in" as const;

export type InvokeAgentProviderSignInCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export type AgentProviderSignInRuntimeDetector = () => boolean;

const invokeAgentProviderSignInCommand: InvokeAgentProviderSignInCommand = (command, args) =>
  invoke(command, args);

export class TauriAgentProviderSignInGateway implements AgentProviderSignInGateway {
  constructor(
    private readonly invokeCommand: InvokeAgentProviderSignInCommand = invokeAgentProviderSignInCommand,
    private readonly isRuntimeAvailable: AgentProviderSignInRuntimeDetector = isTauri,
  ) {}

  async startAgentProviderSignIn(
    request: AgentProviderSignInRequest,
  ): Promise<AgentProviderSignInResult> {
    if (!this.isRuntimeAvailable()) {
      throw new Error("Agent provider sign-in requires the native runtime.");
    }
    const validated = validateAgentProviderSignInRequest(request);
    const result = parseAgentProviderSignInResult(
      await this.invokeCommand(START_AGENT_PROVIDER_SIGN_IN_IPC_COMMAND, { request: validated }),
    );
    if (result.provider !== validated.provider) {
      return invalidResponse("result.provider", "the requested provider");
    }
    if (result.providerGeneration !== validated.providerGeneration) {
      return invalidResponse("result.providerGeneration", "the requested provider generation");
    }
    return result;
  }
}

function invalidResponse(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent provider sign-in value at ${path}: expected ${expectation}.`);
}
