import {
  AgentArtifactCaptureLedger,
  captureLocalAgentArtifacts,
} from "./captureLocalAgentArtifacts";
import { TauriAgentArtifactGateway } from "./tauriAgentArtifactGateway";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AgentThread } from "../domain/agentThread";
import {
  NO_AGENT_TURN_LOG_EVIDENCE,
  type AgentTurnLogEvidenceLookup,
} from "../domain/agentTurnContentLoss";
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
  private readonly captures = new AgentArtifactCaptureLedger();

  constructor(
    private readonly invokeCommand: InvokeAgentThreadStoreCommand = invokeAgentThreadStoreCommand,
    private readonly isRuntimeAvailable: AgentThreadStoreRuntimeDetector = isTauri,
    private readonly evidenceOf: AgentTurnLogEvidenceLookup = NO_AGENT_TURN_LOG_EVIDENCE,
  ) {}

  async loadAgentThreads(request: AgentThreadStoreOwnerRequest): Promise<AgentThreadStoreSnapshot> {
    if (!this.isRuntimeAvailable()) return EMPTY_SNAPSHOT;
    return invokeLoadAgentThreadsIpc(this.invokeCommand, request);
  }

  async saveAgentThread(request: SaveAgentThreadRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) return;
    await invokeSaveAgentThreadIpc(this.invokeCommand, request);
    this.captureArtifacts(request.thread);
  }

  async deleteAgentThread(request: DeleteAgentThreadRequest): Promise<void> {
    if (!this.isRuntimeAvailable()) return;
    return invokeDeleteAgentThreadIpc(this.invokeCommand, request);
  }

  private captureArtifacts(thread: AgentThread): void {
    const isCurrent = this.captures.claim(thread.threadId);
    void captureLocalAgentArtifacts({
      loader: new TauriAgentArtifactGateway(this.invokeCommand),
      thread,
      ledger: this.captures,
      isCurrent,
      evidenceOf: this.evidenceOf,
    }).catch(() => undefined);
  }
}
