import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AgentRootLeaseAcquireRequest,
  AgentRootLeaseGateway,
  AgentRootLeaseReceipt,
  AgentRootLeaseReleaseRequest,
} from "../domain/agentProject";
import {
  invokeAcquireAgentRootLeaseIpc,
  invokeReleaseAgentRootLeaseIpc,
  type InvokeAgentRootLeaseCommand,
} from "./tauriAgentRootLeaseIpcContract";

export type AgentRootLeaseRuntimeDetector = () => boolean;

const invokeAgentRootLeaseCommand: InvokeAgentRootLeaseCommand = (command, args) =>
  invoke(command, args);

export class TauriAgentRootLeaseGateway implements AgentRootLeaseGateway {
  constructor(
    private readonly invokeCommand: InvokeAgentRootLeaseCommand = invokeAgentRootLeaseCommand,
    private readonly isRuntimeAvailable: AgentRootLeaseRuntimeDetector = isTauri,
  ) {}

  async acquireAgentRootLease(
    request: AgentRootLeaseAcquireRequest,
  ): Promise<AgentRootLeaseReceipt> {
    if (!this.isRuntimeAvailable()) {
      throw new Error("Agent root leases require the native runtime.");
    }
    return invokeAcquireAgentRootLeaseIpc(this.invokeCommand, request);
  }

  async releaseAgentRootLease(request: AgentRootLeaseReleaseRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) {
      throw new Error("Agent root leases require the native runtime.");
    }
    return invokeReleaseAgentRootLeaseIpc(this.invokeCommand, request);
  }
}
