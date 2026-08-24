import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AgentThreadStoreGateway,
  AgentThreadStoreOwnerRequest,
  AgentThreadStoreSnapshot,
  DeleteAgentThreadRequest,
  SaveAgentThreadRequest,
} from "../application/agentThreadPorts";
import {
  invokeDeleteAgentThreadIpc,
  invokeLoadAgentThreadsIpc,
  invokeSaveAgentThreadIpc,
  type InvokeAgentThreadStoreCommand,
} from "./tauriAgentThreadStoreIpcContract";

export type AgentThreadStoreRuntimeDetector = () => boolean;

const invokeAgentThreadStoreCommand: InvokeAgentThreadStoreCommand = (command, args) =>
  invoke(command, args);

const EMPTY_SNAPSHOT: AgentThreadStoreSnapshot = Object.freeze({
  threads: Object.freeze([]),
  unreadable: Object.freeze([]),
  evicted: 0,
});

export class TauriAgentThreadStoreGateway implements AgentThreadStoreGateway {
  constructor(
    private readonly invokeCommand: InvokeAgentThreadStoreCommand = invokeAgentThreadStoreCommand,
    private readonly isRuntimeAvailable: AgentThreadStoreRuntimeDetector = isTauri,
  ) {}

  async loadAgentThreads(request: AgentThreadStoreOwnerRequest): Promise<AgentThreadStoreSnapshot> {
    if (!this.isRuntimeAvailable()) return EMPTY_SNAPSHOT;
    return invokeLoadAgentThreadsIpc(this.invokeCommand, request);
  }

  async saveAgentThread(request: SaveAgentThreadRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) return;
    return invokeSaveAgentThreadIpc(this.invokeCommand, request);
  }

  async deleteAgentThread(request: DeleteAgentThreadRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) return;
    return invokeDeleteAgentThreadIpc(this.invokeCommand, request);
  }
}
