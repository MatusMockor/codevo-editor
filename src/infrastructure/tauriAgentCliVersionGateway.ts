import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AgentCliVersionGateway,
  AgentCliVersionProbeRequest,
  AgentCliVersionProbeResult,
} from "../domain/agentCliVersion";
import {
  invokeProbeAgentCliVersionIpc,
  type InvokeAgentCliVersionCommand,
} from "./tauriAgentCliVersionIpcContract";

export type AgentCliVersionRuntimeDetector = () => boolean;

const invokeAgentCliVersionCommand: InvokeAgentCliVersionCommand = (command, args) =>
  invoke(command, args);

export class TauriAgentCliVersionGateway implements AgentCliVersionGateway {
  constructor(
    private readonly invokeCommand: InvokeAgentCliVersionCommand = invokeAgentCliVersionCommand,
    private readonly isRuntimeAvailable: AgentCliVersionRuntimeDetector = isTauri,
  ) {}

  async probeAgentCliVersion(
    request: AgentCliVersionProbeRequest,
  ): Promise<AgentCliVersionProbeResult> {
    if (!this.isRuntimeAvailable()) {
      throw new Error("Agent CLI version probes require the native runtime.");
    }
    return invokeProbeAgentCliVersionIpc(this.invokeCommand, request);
  }
}
