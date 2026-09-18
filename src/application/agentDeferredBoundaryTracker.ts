import type { AgentTurn } from "../domain/agentThread";

interface BoundaryAnchor {
  readonly turnId: string;
  readonly sequence: number;
  readonly allowSettled: boolean;
  readonly retry?: boolean;
}

/** One queue head per newly observed provider boundary, independent of retained output. */
export class AgentDeferredBoundaryTracker {
  private readonly anchors = new Map<string, BoundaryAnchor>();

  retain(threadIds: Iterable<string>): void {
    const retained = new Set(threadIds);
    for (const id of this.anchors.keys()) {
      if (!retained.has(id)) this.anchors.delete(id);
    }
  }

  anchor(threadId: string, turn: AgentTurn | null, allowSettled: boolean): void {
    if (turn === null) {
      this.anchors.delete(threadId);
      return;
    }
    this.anchors.set(threadId, {
      turnId: turn.turnId,
      sequence: turn.queueBoundarySequence ?? 0,
      allowSettled,
    });
  }

  retry(threadId: string): void {
    const anchor = this.anchors.get(threadId);
    if (anchor !== undefined) this.anchors.set(threadId, { ...anchor, retry: true });
  }

  takeDue(threadId: string, turn: AgentTurn): boolean {
    const anchor = this.anchors.get(threadId);
    if (anchor === undefined || anchor.turnId !== turn.turnId) {
      const due = turn.foregroundSettled === true;
      this.anchor(threadId, turn, !due);
      return due;
    }
    const due =
      anchor.retry === true ||
      (turn.queueBoundarySequence ?? 0) > anchor.sequence ||
      (anchor.allowSettled && turn.foregroundSettled === true);
    if (due) this.anchor(threadId, turn, false);
    return due;
  }
}
