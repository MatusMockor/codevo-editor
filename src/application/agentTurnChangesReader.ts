import {
  cancelTurnChangesReads,
  classifyTurnChangesReadFailure,
  queueTurnChangesRead,
  turnChangesReadFailureReason,
} from "./agentTurnChangesReadQueue";
import {
  agentTurnChangesDenialMessage,
  isAgentTurnChangePath,
  parseAgentTurnChangeSummary,
  parseAgentTurnFileDiff,
  unsupportedAgentTurnChanges,
  type AgentTurnChangeSummary,
  type AgentTurnChangesDenialReason,
  type AgentTurnFileDiff,
} from "../domain/agentTurnChanges";

export interface AgentTurnChangesReadAuthority {
  readonly lease: object;
  readonly identity: string;
  getSummary(): Promise<AgentTurnChangeSummary>;
  getFileDiff(relativePath: string): Promise<AgentTurnFileDiff>;
}
export type AgentTurnChangesAuthorityResolution =
  | { readonly kind: "authorized"; readonly authority: AgentTurnChangesReadAuthority }
  | { readonly kind: "notApplicable" }
  | { readonly kind: "denied"; readonly reason: AgentTurnChangesDenialReason };
export type AgentTurnChangesAuthorityResolver = (
  threadId: string,
  turnId: string,
) => AgentTurnChangesAuthorityResolution;
export const TURN_CHANGES_NOT_APPLICABLE: AgentTurnChangesAuthorityResolution = {
  kind: "notApplicable",
};
export function authorizedTurnChanges(
  authority: AgentTurnChangesReadAuthority,
): AgentTurnChangesAuthorityResolution {
  return { kind: "authorized", authority };
}
const MAX_SUMMARIES = 32;
const MAX_PENDING_READS = 1028;
export const MAX_TURN_CHANGES_LEASES = MAX_PENDING_READS + MAX_SUMMARIES;
const QUEUE_FULL = "Recorded changes loading queue is full. Try again shortly.";
const UNAVAILABLE = "Recorded changes are not available for this turn.";
const FOREIGN_TURN = "The saved changes response is invalid and cannot be displayed.";
const notApplicable = (turnId: string) => unsupportedAgentTurnChanges(turnId, "notApplicable");
export function unavailableTurnChanges(
  turnId: string,
  reason = UNAVAILABLE,
): AgentTurnChangeSummary {
  return { turnId, state: "unavailable", files: [], truncated: false, reason };
}

/** Read immutable recorded changes only; a failed read never falls back to current Git state. */
export function createAgentTurnChangesReader(resolve: AgentTurnChangesAuthorityResolver) {
  let disposed = false;
  const queueOwner = {};
  const fileReads = new Set<AgentTurnChangesReadAuthority>();
  const summaries = new Map<
    string,
    { authority: AgentTurnChangesReadAuthority; value: AgentTurnChangeSummary }
  >();
  const loading = new Map<
    string,
    { authority: AgentTurnChangesReadAuthority; promise: Promise<AgentTurnChangeSummary> }
  >();
  const keyFor = (threadId: string, turnId: string) => JSON.stringify([threadId, turnId]);
  const current = (threadId: string, turnId: string, captured: AgentTurnChangesReadAuthority) => {
    if (disposed) return false;
    const live = resolve(threadId, turnId);
    if (live.kind !== "authorized") return false;
    return live.authority.lease === captured.lease && live.authority.identity === captured.identity;
  };
  const forget = (key: string) => {
    summaries.delete(key);
    loading.delete(key);
  };
  const getTurnChanges = async (
    threadId: string,
    turnId: string,
  ): Promise<AgentTurnChangeSummary> => {
    const key = keyFor(threadId, turnId);
    if (
      loading.size + fileReads.size >= MAX_PENDING_READS &&
      !loading.has(key) &&
      !summaries.has(key)
    )
      return unavailableTurnChanges(turnId, QUEUE_FULL);
    const resolution = disposed ? TURN_CHANGES_NOT_APPLICABLE : resolve(threadId, turnId);
    if (resolution.kind !== "authorized") forget(key);
    if (resolution.kind === "notApplicable") return notApplicable(turnId);
    if (resolution.kind === "denied")
      return unavailableTurnChanges(turnId, agentTurnChangesDenialMessage(resolution.reason));
    const authority = resolution.authority;
    const cached = summaries.get(key);
    if (cached && current(threadId, turnId, cached.authority)) return cached.value;
    summaries.delete(key);
    const pending = loading.get(key);
    if (pending && current(threadId, turnId, pending.authority)) return pending.promise;
    const request = { authority, promise: Promise.resolve(notApplicable(turnId)) };
    request.promise = Promise.resolve().then(async () => {
      try {
        if (!current(threadId, turnId, authority)) return notApplicable(turnId);
        const value = parseAgentTurnChangeSummary(
          await queueTurnChangesRead(
            queueOwner,
            () => current(threadId, turnId, authority),
            () => authority.getSummary(),
          ),
        );
        if (!current(threadId, turnId, authority)) return notApplicable(turnId);
        if (value.turnId !== turnId) return unavailableTurnChanges(turnId, FOREIGN_TURN);
        summaries.delete(key);
        if (value.state === "ready" || value.state === "unsupported")
          summaries.set(key, { authority, value });
        while (summaries.size > MAX_SUMMARIES) summaries.delete(summaries.keys().next().value!);
        return value;
      } catch (error) {
        const failure = classifyTurnChangesReadFailure(error);
        if (failure.kind === "notApplicable") return notApplicable(turnId);
        return unavailableTurnChanges(turnId, failure.reason);
      } finally {
        if (loading.get(key) === request) loading.delete(key);
      }
    });
    loading.set(key, request);
    return request.promise;
  };
  const cancelPendingReads = () => {
    cancelTurnChangesReads(queueOwner);
    summaries.clear();
    loading.clear();
  };
  return {
    cancelPendingReads,
    retainsLease: (lease: object) =>
      [...loading.values(), ...summaries.values()].some(
        (entry) => entry.authority.lease === lease,
      ) || [...fileReads].some((authority) => authority.lease === lease),
    getTurnChanges,
    async getTurnFileDiff(
      threadId: string,
      turnId: string,
      relativePath: string,
    ): Promise<AgentTurnFileDiff> {
      if (loading.size + fileReads.size >= MAX_PENDING_READS) throw new Error(QUEUE_FULL);
      const resolution = disposed ? TURN_CHANGES_NOT_APPLICABLE : resolve(threadId, turnId);
      if (resolution.kind === "denied")
        throw new Error(agentTurnChangesDenialMessage(resolution.reason));
      if (resolution.kind === "notApplicable" || !isAgentTurnChangePath(relativePath))
        throw new Error(UNAVAILABLE);
      const authority = resolution.authority;
      fileReads.add(authority);
      try {
        const summary = await getTurnChanges(threadId, turnId);
        if (
          !current(threadId, turnId, authority) ||
          summary.state !== "ready" ||
          !summary.files.some((file) => file.relativePath === relativePath)
        )
          throw new Error(UNAVAILABLE);
        try {
          const result = parseAgentTurnFileDiff(
            await queueTurnChangesRead(
              queueOwner,
              () => current(threadId, turnId, authority),
              () => authority.getFileDiff(relativePath),
            ),
          );
          if (!current(threadId, turnId, authority) || result.relativePath !== relativePath)
            throw new Error(UNAVAILABLE);
          return result;
        } catch (error) {
          throw new Error(turnChangesReadFailureReason(error));
        }
      } finally {
        fileReads.delete(authority);
      }
    },
    dispose() {
      disposed = true;
      cancelPendingReads();
    },
  };
}
