import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AgentThreadStoreGateway,
  AgentThreadStoreOwnerRequest,
  AgentThreadStoreSnapshot,
  DeleteAgentThreadRequest,
  SaveAgentThreadRequest,
} from "../application/agentThreadPorts";
import type {
  AgentHistoryTurnPage,
  FindAgentHistoryImportRequest,
  ReadAgentHistoryTurnsRequest,
} from "../domain/agentHistory";
import type { AgentThread, AgentTurn } from "../domain/agentThread";
import {
  NO_AGENT_TURN_LOG_EVIDENCE,
  type AgentTurnLogEvidenceLookup,
} from "../domain/agentTurnContentLoss";
import {
  AgentArtifactCaptureLedger,
  captureLocalAgentArtifacts,
} from "./captureLocalAgentArtifacts";
import { TauriAgentArtifactGateway } from "./tauriAgentArtifactGateway";
import {
  deleteAgentHistoryThread,
  findAgentHistoryImport,
  loadAgentHistory,
  readAgentHistoryTurns,
  prepareAgentHistoryThreadWrite,
  savePreparedAgentHistoryThread,
  type PreparedAgentHistoryWrite,
} from "./tauriAgentHistoryIpcContract";
import type { InvokeAgentThreadStoreCommand } from "./tauriAgentThreadStoreIpcContract";

/** SQLite retains every turn; this adapter only sends changed bounded snapshots. */
export class TauriAgentHistoryGateway implements AgentThreadStoreGateway {
  private readonly acknowledged = new Map<string, WeakSet<AgentTurn>>();
  private readonly revisions = new Map<string, number>();
  private readonly pending = new Map<
    string,
    { readonly write: PreparedAgentHistoryWrite; readonly bytes: number }
  >();
  private pendingBytes = 0;
  private readonly captures = new AgentArtifactCaptureLedger();
  constructor(
    private readonly invokeCommand: InvokeAgentThreadStoreCommand = (command, args) =>
      invoke(command, args),
    private readonly available: () => boolean = isTauri,
    private readonly evidenceOf: AgentTurnLogEvidenceLookup = NO_AGENT_TURN_LOG_EVIDENCE,
  ) {}
  async loadAgentThreads(request: AgentThreadStoreOwnerRequest): Promise<AgentThreadStoreSnapshot> {
    if (!this.available()) return { threads: [], unreadable: [], evicted: 0 };
    const snapshot = await loadAgentHistory(this.invokeCommand, request);
    for (const thread of snapshot.threads) {
      const key = JSON.stringify([request.rootKey, request.ownerId, thread.threadId]);
      this.acknowledged.delete(key);
      const pending = this.pending.get(key);
      if (pending && (thread.historyRevision ?? 0) > pending.write.expectedRevision)
        this.clearPending(key);
      this.revisions.set(key, thread.historyRevision ?? 0);
    }
    return snapshot;
  }
  async saveAgentThread(request: SaveAgentThreadRequest): Promise<void> {
    if (!this.available()) return;
    const assertCurrent = () => {
      if (request.isCurrent?.() === false) throw new Error("Agent history save owner expired.");
    };
    assertCurrent();
    const key = JSON.stringify([request.rootKey, request.ownerId, request.thread.threadId]);
    const previous = this.acknowledged.get(key);
    const changed = request.thread.turns.filter((turn) => !previous?.has(turn));
    let revision =
      request.onRevision === undefined
        ? Math.max(this.revisions.get(key) ?? 0, request.thread.historyRevision ?? 0)
        : (request.thread.historyRevision ?? 0);
    const commit = async (write: PreparedAgentHistoryWrite): Promise<number> => {
      assertCurrent();
      let next: number;
      try {
        next = await savePreparedAgentHistoryThread(this.invokeCommand, write);
      } catch (error) {
        if (definiteSaveRejection(error)) this.clearPending(key, write);
        throw error;
      }
      assertCurrent();
      request.onRevision?.(next);
      assertCurrent();
      this.clearPending(key, write);
      this.revisions.delete(key);
      this.revisions.set(key, next);
      while (this.revisions.size > 4096) this.revisions.delete(this.revisions.keys().next().value!);
      return next;
    };
    const unsettled = this.pending.get(key);
    if (unsettled) revision = await commit(unsettled.write);
    for (const turn of changed.length === 0 ? [null] : changed) {
      assertCurrent();
      const write = prepareAgentHistoryThreadWrite(
        request,
        { ...request.thread, turns: turn === null ? [] : [turn] },
        revision,
      );
      const bytes = new TextEncoder().encode(JSON.stringify(write)).byteLength;
      if (this.pending.size >= 64 || this.pendingBytes + bytes > 32 * 1_024 * 1_024)
        throw new Error(
          "Agent thread pending history saves reached the memory limit. Retry saving before continuing.",
        );
      this.pending.set(key, { write, bytes });
      this.pendingBytes += bytes;
      revision = await commit(write);
    }
    assertCurrent();
    this.acknowledged.delete(key);
    this.acknowledged.set(key, new WeakSet(request.thread.turns));
    while (this.acknowledged.size > 64)
      this.acknowledged.delete(this.acknowledged.keys().next().value!);
    const isCurrent = this.captures.claim(request.thread.threadId);
    void captureLocalAgentArtifacts({
      loader: new TauriAgentArtifactGateway(this.invokeCommand),
      thread: request.thread,
      ledger: this.captures,
      isCurrent: () => isCurrent() && request.isCurrent?.() !== false,
      evidenceOf: this.evidenceOf,
    }).catch(() => undefined);
  }
  private clearPending(key: string, expected?: PreparedAgentHistoryWrite): void {
    const pending = this.pending.get(key);
    if (pending && (expected === undefined || pending.write === expected)) {
      this.pendingBytes -= pending.bytes;
      this.pending.delete(key);
    }
  }
  async readAgentHistoryTurns(
    request: ReadAgentHistoryTurnsRequest,
  ): Promise<AgentHistoryTurnPage> {
    if (!this.available()) return { turns: [], hasEarlier: false, beforeTurnId: null, revision: 0 };
    return readAgentHistoryTurns(this.invokeCommand, request);
  }
  async findAgentHistoryImport(
    request: FindAgentHistoryImportRequest,
  ): Promise<AgentThread | null> {
    if (!this.available()) return null;
    return findAgentHistoryImport(this.invokeCommand, request);
  }
  async deleteAgentThread(request: DeleteAgentThreadRequest): Promise<void> {
    const key = JSON.stringify([request.rootKey, request.ownerId, request.threadId]);
    this.acknowledged.delete(key);
    this.revisions.delete(key);
    this.clearPending(key);
    if (this.available()) await deleteAgentHistoryThread(this.invokeCommand, request);
  }
}

/** These backend rejections happen before transaction commit; transport failures remain replayable. */
function definiteSaveRejection(error: unknown): boolean {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : null;
  return (
    message !== null &&
    [
      "Agent history revision is out of bounds.",
      "Agent thread save batch exceeds 4 MiB.",
      "The saved thread has been deleted.",
      "The saved thread update is stale; reload its current revision.",
      "The saved thread update is stale.",
      "The saved turn update is stale.",
      "Agent turn exceeds the bounded history page size.",
      "Agent thread timestamp is out of bounds.",
      "Agent thread contains duplicate turn identifiers.",
      "This provider session has already been imported.",
    ].includes(message)
  );
}
