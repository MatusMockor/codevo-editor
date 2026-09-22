import {
  isAgentTurnChangePath,
  parseAgentTurnChangeSummary,
  parseAgentTurnFileDiff,
  type AgentTurnChangeSummary,
  type AgentTurnFileDiff,
} from "../domain/agentTurnChanges";

export interface AgentTurnChangesReadAuthority {
  readonly lease: object;
  readonly identity: string;
  getSummary(): Promise<AgentTurnChangeSummary>;
  getFileDiff(relativePath: string): Promise<AgentTurnFileDiff>;
}
export type AgentTurnChangesAuthorityResolver = (
  threadId: string,
  turnId: string,
) => AgentTurnChangesReadAuthority | null;
const MAX_SUMMARIES = 32;
const MAX_IN_FLIGHT = 64;
const UNAVAILABLE = "Recorded changes are not available for this turn.";
export function unavailableTurnChanges(
  turnId: string,
  reason = UNAVAILABLE,
): AgentTurnChangeSummary {
  return { turnId, state: "unavailable", files: [], truncated: false, reason };
}

/** Read immutable recorded changes only; a failed read never falls back to current Git state. */
export function createAgentTurnChangesReader(resolve: AgentTurnChangesAuthorityResolver) {
  let disposed = false;
  let active = 0;
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
    return live !== null && live.lease === captured.lease && live.identity === captured.identity;
  };
  const getTurnChanges = async (
    threadId: string,
    turnId: string,
  ): Promise<AgentTurnChangeSummary> => {
    const authority = disposed ? null : resolve(threadId, turnId);
    if (authority === null) return unavailableTurnChanges(turnId);
    const key = keyFor(threadId, turnId);
    const cached = summaries.get(key);
    if (cached && current(threadId, turnId, cached.authority)) return cached.value;
    summaries.delete(key);
    const pending = loading.get(key);
    if (pending && current(threadId, turnId, pending.authority)) return pending.promise;
    if (active >= MAX_IN_FLIGHT)
      return unavailableTurnChanges(turnId, "Too many changes are loading. Try again.");
    active += 1;
    const request = { authority, promise: Promise.resolve(unavailableTurnChanges(turnId)) };
    request.promise = Promise.resolve().then(async () => {
      try {
        if (!current(threadId, turnId, authority)) return unavailableTurnChanges(turnId);
        const value = parseAgentTurnChangeSummary(await authority.getSummary());
        if (!current(threadId, turnId, authority) || value.turnId !== turnId)
          return unavailableTurnChanges(turnId);
        summaries.delete(key);
        if (value.state === "ready") summaries.set(key, { authority, value });
        while (summaries.size > MAX_SUMMARIES) summaries.delete(summaries.keys().next().value!);
        return value;
      } catch {
        return unavailableTurnChanges(turnId);
      } finally {
        active -= 1;
        if (loading.get(key) === request) loading.delete(key);
      }
    });
    loading.set(key, request);
    return request.promise;
  };
  return {
    getTurnChanges,
    async getTurnFileDiff(
      threadId: string,
      turnId: string,
      relativePath: string,
    ): Promise<AgentTurnFileDiff> {
      const authority = disposed ? null : resolve(threadId, turnId);
      if (authority === null || !isAgentTurnChangePath(relativePath)) throw new Error(UNAVAILABLE);
      const summary = await getTurnChanges(threadId, turnId);
      if (
        !current(threadId, turnId, authority) ||
        summary.state !== "ready" ||
        !summary.files.some((file) => file.relativePath === relativePath) ||
        active >= MAX_IN_FLIGHT
      )
        throw new Error(UNAVAILABLE);
      active += 1;
      try {
        const result = parseAgentTurnFileDiff(await authority.getFileDiff(relativePath));
        if (!current(threadId, turnId, authority) || result.relativePath !== relativePath)
          throw new Error(UNAVAILABLE);
        return result;
      } finally {
        active -= 1;
      }
    },
    dispose() {
      disposed = true;
      summaries.clear();
      loading.clear();
    },
  };
}
