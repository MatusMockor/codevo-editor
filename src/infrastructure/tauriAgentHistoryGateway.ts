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
import {
  isTerminalAgentTurnStatus,
  type AgentThread,
  type AgentTurn,
  type AgentTurnEvent,
} from "../domain/agentThread";
import { planAgentHistoryTurnDelta } from "../domain/agentHistoryTurnDelta";
import { agentHistoryTurnProjection } from "../domain/agentThreadWire";
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
  type AgentHistorySaveReceipt,
  type PreparedAgentHistoryWrite,
} from "./tauriAgentHistoryIpcContract";
import type { InvokeAgentThreadStoreCommand } from "./tauriAgentThreadStoreIpcContract";
import {
  prepareAgentHistoryTurnDelta,
  savePreparedAgentHistoryTurnDelta,
  type PreparedAgentHistoryTurnDelta,
} from "./tauriAgentHistoryDeltaIpcContract";

export const MIN_AGENT_HISTORY_DELTA_RETAINED_BYTES = 16 * 1_024;

interface AcknowledgedTurnBase {
  readonly turnId: string;
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly terminal: boolean;
}

interface StoredTurnBase {
  readonly events: ReadonlyArray<AgentTurnEvent>;
  readonly digest: string;
}

type PendingHistoryWrite =
  | { readonly kind: "full"; readonly write: PreparedAgentHistoryWrite }
  | { readonly kind: "delta"; readonly write: PreparedAgentHistoryTurnDelta };

interface PendingHistoryEntry {
  readonly write: PendingHistoryWrite;
  readonly base: AcknowledgedTurnBase | null;
  readonly bytes: number;
}

/** SQLite retains every turn; this adapter only sends changed bounded snapshots. */
export class TauriAgentHistoryGateway implements AgentThreadStoreGateway {
  private readonly acknowledged = new Map<string, WeakSet<AgentTurn>>();
  private readonly revisions = new Map<string, number>();
  private readonly bases = new Map<string, Map<string, StoredTurnBase>>();
  private readonly pending = new Map<string, PendingHistoryEntry>();
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
      if ((this.revisions.get(key) ?? 0) > (thread.historyRevision ?? 0)) continue;
      this.acknowledged.delete(key);
      this.bases.delete(key);
      const pending = this.pending.get(key);
      if (pending && (thread.historyRevision ?? 0) > pending.write.write.expectedRevision)
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
    const known = this.revisions.get(key);
    const incoming = request.thread.historyRevision ?? 0;
    if (
      known === undefined ||
      (request.onRevision === undefined ? incoming > known : incoming !== known)
    )
      this.bases.delete(key);
    let revision =
      request.onRevision === undefined
        ? Math.max(this.revisions.get(key) ?? 0, request.thread.historyRevision ?? 0)
        : (request.thread.historyRevision ?? 0);
    const commit = async (entry: PendingHistoryEntry): Promise<number | null> => {
      assertCurrent();
      let receipt: AgentHistorySaveReceipt | null;
      try {
        receipt =
          entry.write.kind === "full"
            ? await savePreparedAgentHistoryThread(this.invokeCommand, entry.write.write)
            : await savePreparedAgentHistoryTurnDelta(this.invokeCommand, entry.write.write);
      } catch (error) {
        if (definiteSaveRejection(error)) this.clearPending(key, entry);
        throw error;
      }
      if (receipt === null) {
        this.clearPending(key, entry);
        this.bases.delete(key);
        return null;
      }
      const next = receipt.revision;
      assertCurrent();
      request.onRevision?.(next);
      assertCurrent();
      this.clearPending(key, entry);
      this.revisions.delete(key);
      this.revisions.set(key, next);
      while (this.revisions.size > 4096) this.revisions.delete(this.revisions.keys().next().value!);
      if (entry.base !== null) this.recordBase(key, entry.base, receipt.eventsDigest);
      return next;
    };
    const track = (write: PendingHistoryWrite, base: AcknowledgedTurnBase | null) => {
      const bytes = new TextEncoder().encode(JSON.stringify(write.write)).byteLength;
      if (this.pending.size >= 64 || this.pendingBytes + bytes > 32 * 1_024 * 1_024)
        throw new Error(
          "Agent thread pending history saves reached the memory limit. Retry saving before continuing.",
        );
      const entry = { write, base, bytes };
      this.pending.set(key, entry);
      this.pendingBytes += bytes;
      return entry;
    };
    const unsettled = this.pending.get(key);
    if (unsettled) revision = (await commit(unsettled)) ?? revision;
    for (const turn of changed.length === 0 ? [null] : changed) {
      assertCurrent();
      const projected = turn === null ? null : agentHistoryTurnProjection(turn);
      const base =
        projected === null
          ? null
          : {
              turnId: projected.turnId,
              events: projected.events,
              terminal: isTerminalAgentTurnStatus(projected.status),
            };
      const delta =
        projected === null ? null : this.prepareDelta(key, request, projected, revision);
      if (delta !== null) {
        const saved = await commit(track({ kind: "delta", write: delta }, base));
        if (saved !== null) {
          revision = saved;
          continue;
        }
      }
      const write = prepareAgentHistoryThreadWrite(
        request,
        { ...request.thread, turns: turn === null ? [] : [turn] },
        revision,
      );
      revision = (await commit(track({ kind: "full", write }, base))) ?? revision;
    }
    assertCurrent();
    this.acknowledged.delete(key);
    this.acknowledged.set(key, new WeakSet(request.thread.turns));
    while (this.acknowledged.size > 64)
      this.acknowledged.delete(this.acknowledged.keys().next().value!);
    this.retainBases(key, request.thread.turns);
    const isCurrent = this.captures.claim(request.thread.threadId);
    void captureLocalAgentArtifacts({
      loader: new TauriAgentArtifactGateway(this.invokeCommand),
      thread: request.thread,
      ledger: this.captures,
      isCurrent: () => isCurrent() && request.isCurrent?.() !== false,
      evidenceOf: this.evidenceOf,
    }).catch(() => undefined);
  }
  private prepareDelta(
    key: string,
    request: SaveAgentThreadRequest,
    projected: AgentTurn,
    revision: number,
  ): PreparedAgentHistoryTurnDelta | null {
    if (request.thread.externalOrigin?.history !== undefined) return null;
    const base = this.bases.get(key)?.get(projected.turnId);
    if (base === undefined) return null;
    const plan = planAgentHistoryTurnDelta(base.events, projected.events);
    if (plan === null || plan.retainedBytes < MIN_AGENT_HISTORY_DELTA_RETAINED_BYTES) return null;
    return prepareAgentHistoryTurnDelta(
      request,
      request.thread,
      projected,
      plan,
      base.digest,
      revision,
    );
  }
  private recordBase(key: string, base: AcknowledgedTurnBase, digest: string | null): void {
    const turns = this.bases.get(key) ?? new Map<string, StoredTurnBase>();
    this.bases.delete(key);
    if (base.terminal || digest === null) turns.delete(base.turnId);
    else turns.set(base.turnId, { events: base.events, digest });
    if (turns.size === 0) return;
    this.bases.set(key, turns);
    while (this.bases.size > 64) this.bases.delete(this.bases.keys().next().value!);
  }
  private retainBases(key: string, turns: ReadonlyArray<AgentTurn>): void {
    const bases = this.bases.get(key);
    if (bases === undefined) return;
    const live = new Set(turns.map((turn) => turn.turnId));
    for (const turnId of [...bases.keys()]) if (!live.has(turnId)) bases.delete(turnId);
  }
  private clearPending(key: string, expected?: PendingHistoryEntry): void {
    const pending = this.pending.get(key);
    if (pending && (expected === undefined || pending === expected)) {
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
    this.bases.delete(key);
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
