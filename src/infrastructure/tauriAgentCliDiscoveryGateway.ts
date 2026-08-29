import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AgentCliDiscoveryGateway,
  AgentCliDiscoveryRequest,
  AgentCliDiscoveryResult,
} from "../domain/agentSettings";
import {
  invokeDiscoverAgentClisIpc,
  type InvokeAgentCliDiscoveryCommand,
} from "./tauriAgentCliDiscoveryIpcContract";

export type AgentCliDiscoveryRuntimeDetector = () => boolean;

const invokeAgentCliDiscoveryCommand: InvokeAgentCliDiscoveryCommand = (command, args) =>
  invoke(command, args);

export class TauriAgentCliDiscoveryGateway implements AgentCliDiscoveryGateway {
  constructor(
    private readonly invokeCommand: InvokeAgentCliDiscoveryCommand = invokeAgentCliDiscoveryCommand,
    private readonly isRuntimeAvailable: AgentCliDiscoveryRuntimeDetector = isTauri,
  ) {}

  async discoverAgentClis(request: AgentCliDiscoveryRequest): Promise<AgentCliDiscoveryResult> {
    if (!this.isRuntimeAvailable()) {
      throw new Error("Agent CLI discovery requires the native runtime.");
    }
    return invokeDiscoverAgentClisIpc(this.invokeCommand, request);
  }
}
