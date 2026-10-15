export const AGENT_FILE_REVEAL_TIMEOUT_MS = 5_000;
export const MAX_AGENT_FILE_REVEAL_REQUESTS = 64;
export const MAX_AGENT_FILE_REVEAL_PENDING = 32;

export interface AgentFileViewerOwner {
  readonly threadId: string | null;
  readonly generation: number;
}

export type AgentFileRevealRequestState = "pending" | "settled" | "expired";

export interface AgentFileRevealRequest<Payload> {
  readonly id: number;
  readonly owner: AgentFileViewerOwner;
  readonly path: string;
  readonly line: number | null;
  readonly payload: Payload | null;
}

export interface AgentFileRevealTicket {
  readonly id: number;
  readonly settled: Promise<boolean>;
}

export interface AgentFileRevealRequests<Payload> {
  currentOwner(): AgentFileViewerOwner;
  bindOwner(threadId: string | null): void;
  isCurrentOwner(owner: AgentFileViewerOwner): boolean;
  begin(
    path: string,
    line: number | null,
    owner: AgentFileViewerOwner,
    payload: Payload | null,
  ): AgentFileRevealTicket | null;
  pending(
    id: number,
    threadId: string | null,
    path: string,
    line: number | null,
  ): AgentFileRevealRequest<Payload> | null;
  settle(id: number, accepted: boolean): void;
  stateOf(id: number): AgentFileRevealRequestState | null;
}

interface Entry<Payload> {
  readonly request: AgentFileRevealRequest<Payload>;
  state: AgentFileRevealRequestState;
  resolve(accepted: boolean): void;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createAgentFileRevealRequests<Payload>(
  timeoutMs: number = AGENT_FILE_REVEAL_TIMEOUT_MS,
): AgentFileRevealRequests<Payload> {
  const entries = new Map<number, Entry<Payload>>();
  let owner: AgentFileViewerOwner = { threadId: null, generation: 0 };
  let nextId = 0;

  const finish = (entry: Entry<Payload>, state: AgentFileRevealRequestState, accepted: boolean) => {
    if (entry.state !== "pending") return;
    entry.state = state;
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    entry.resolve(accepted);
  };

  const pendingCount = () => {
    let count = 0;
    for (const entry of entries.values()) if (entry.state === "pending") count += 1;
    return count;
  };

  const evict = () => {
    for (const [id, entry] of entries) {
      if (entries.size <= MAX_AGENT_FILE_REVEAL_REQUESTS) return;
      if (entry.state === "pending") continue;
      entries.delete(id);
    }
  };

  const isCurrentOwner = (candidate: AgentFileViewerOwner) =>
    candidate.threadId === owner.threadId && candidate.generation === owner.generation;

  return {
    currentOwner: () => owner,
    bindOwner(threadId) {
      if (owner.threadId === threadId) return;
      owner = { threadId, generation: owner.generation + 1 };
      for (const entry of entries.values()) {
        if (!isCurrentOwner(entry.request.owner)) finish(entry, "expired", false);
      }
    },
    isCurrentOwner,
    begin(path, line, requestOwner, payload) {
      if (!isCurrentOwner(requestOwner)) return null;
      if (pendingCount() >= MAX_AGENT_FILE_REVEAL_PENDING) return null;
      nextId += 1;
      const id = nextId;
      let resolve: (accepted: boolean) => void = () => undefined;
      const settled = new Promise<boolean>((done) => {
        resolve = done;
      });
      const entry: Entry<Payload> = {
        request: { id, owner: requestOwner, path, line, payload },
        state: "pending",
        resolve,
        timer: null,
      };
      entry.timer = setTimeout(() => finish(entry, "expired", false), timeoutMs);
      entries.set(id, entry);
      evict();
      return { id, settled };
    },
    pending(id, threadId, path, line) {
      const entry = entries.get(id);
      if (entry === undefined || entry.state !== "pending") return null;
      const request = entry.request;
      if (request.owner.threadId !== threadId || !isCurrentOwner(request.owner)) return null;
      if (request.path !== path || request.line !== line) return null;
      return request;
    },
    settle(id, accepted) {
      const entry = entries.get(id);
      if (entry === undefined) return;
      if (!isCurrentOwner(entry.request.owner)) {
        finish(entry, "expired", false);
        return;
      }
      finish(entry, "settled", accepted);
    },
    stateOf: (id) => entries.get(id)?.state ?? null,
  };
}
