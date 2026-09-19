import type { AgentArtifactLoader, AgentArtifactOwner } from "../application/agentArtifactPorts";
import { AGENT_ARTIFACT_REFERENCE_LIMIT } from "../domain/agentArtifact";
import {
  agentArtifactFailureRetryable,
  classifyAgentArtifactFailure,
} from "../domain/agentArtifactFailure";
import { isTerminalAgentTurnStatus, type AgentThread, type AgentTurn } from "../domain/agentThread";
import { agentTurnArtifactReferences } from "../domain/agentTurnArtifactReferences";

/** Pinned against contracts/agent-artifact-errors.json so both sides refuse the same turns. */
export const AGENT_ARTIFACT_CAPTURE_RULE =
  "Capture only a terminal turn that has no terminal successor.";
export const AGENT_ARTIFACT_CAPTURE_ATTEMPTS = 3;
export const AGENT_ARTIFACT_CAPTURE_LEDGER_LIMIT = 256;

type AgentArtifactCaptureOutcome = "captured" | "transient" | "permanent";

const SEPARATOR = "\u0000";

function touch(entries: Map<string, number>, key: string, value: number): void {
  entries.delete(key);
  entries.set(key, value);
}

function evict(entries: Map<string, number>, retained: (key: string) => boolean): void {
  for (const key of entries.keys()) {
    if (entries.size <= AGENT_ARTIFACT_CAPTURE_LEDGER_LIMIT) return;
    if (retained(key)) continue;
    entries.delete(key);
  }
}

const NEVER_RETAINED = (): boolean => false;

/** Bounded per-session memory so a settled reference never costs another native resolve. */
export class AgentArtifactCaptureLedger {
  private readonly attempts = new Map<string, number>();
  private readonly leases = new Map<string, number>();
  private readonly running = new Map<string, number>();
  private issued = 0;

  claim(threadId: string): () => boolean {
    this.issued += 1;
    const lease = this.issued;
    touch(this.leases, threadId, lease);
    evict(this.leases, (key) => this.running.has(key));
    return () => this.leases.get(threadId) === lease;
  }

  hold(threadId: string): () => void {
    this.running.set(threadId, (this.running.get(threadId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release(threadId);
    };
  }

  isSettled(key: string): boolean {
    return (this.attempts.get(key) ?? 0) >= AGENT_ARTIFACT_CAPTURE_ATTEMPTS;
  }

  record(key: string, outcome: AgentArtifactCaptureOutcome): void {
    if (outcome === "transient") {
      touch(this.attempts, key, (this.attempts.get(key) ?? 0) + 1);
      evict(this.attempts, NEVER_RETAINED);
      return;
    }
    touch(this.attempts, key, AGENT_ARTIFACT_CAPTURE_ATTEMPTS);
    evict(this.attempts, NEVER_RETAINED);
  }

  private release(threadId: string): void {
    const held = this.running.get(threadId) ?? 0;
    if (held > 1) {
      this.running.set(threadId, held - 1);
      return;
    }
    this.running.delete(threadId);
    evict(this.leases, (key) => this.running.has(key));
  }
}

export interface AgentArtifactCaptureInput {
  readonly loader: AgentArtifactLoader;
  readonly thread: AgentThread;
  readonly ledger: AgentArtifactCaptureLedger;
  readonly isCurrent: () => boolean;
}

/**
 * Save immutable output snapshots without extending the save's critical path. Only the newest
 * terminal turn can be captured; every other turn is refused natively, so it is never attempted.
 */
export async function captureLocalAgentArtifacts({
  loader,
  thread,
  ledger,
  isCurrent,
}: AgentArtifactCaptureInput): Promise<void> {
  const turn = newestTerminalTurn(thread);
  if (turn === null) return;
  const owner: AgentArtifactOwner = {
    kind: "local",
    ...thread.owner,
    threadId: thread.threadId,
    turnId: turn.turnId,
  };
  const release = ledger.hold(thread.threadId);
  try {
    let budget = AGENT_ARTIFACT_REFERENCE_LIMIT;
    for (const reference of agentTurnArtifactReferences(turn)) {
      if (budget === 0) return;
      const key = captureKey(thread, turn.turnId, reference.path);
      if (ledger.isSettled(key)) continue;
      if (!isCurrent()) return;
      budget -= 1;
      const outcome = await resolveOutcome(loader, owner, reference.path);
      if (!isCurrent()) return;
      ledger.record(key, outcome);
    }
  } finally {
    release();
  }
}

async function resolveOutcome(
  loader: AgentArtifactLoader,
  owner: AgentArtifactOwner,
  path: string,
): Promise<AgentArtifactCaptureOutcome> {
  try {
    await loader.resolve(owner, path);
    return "captured";
  } catch (error) {
    if (agentArtifactFailureRetryable(classifyAgentArtifactFailure(error))) return "transient";
    return "permanent";
  }
}

function newestTerminalTurn(thread: AgentThread): AgentTurn | null {
  for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
    const turn = thread.turns[index];
    if (turn === undefined) continue;
    if (isTerminalAgentTurnStatus(turn.status)) return turn;
  }
  return null;
}

function captureKey(thread: AgentThread, turnId: string, path: string): string {
  return [thread.owner.rootKey, thread.owner.ownerId, thread.threadId, turnId, path].join(
    SEPARATOR,
  );
}
