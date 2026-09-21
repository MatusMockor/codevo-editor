import {
  isTerminalAgentTurnStatus,
  type AgentThread,
  type AgentTurnEvent,
} from "../domain/agentThread";
import { recoverAgentTurnResultStatus } from "../domain/agentTurnRestartRecovery";
import type { AgentTurnLogLoss, AgentTurnLogSummary } from "../domain/agentTurnLog";
import type { AgentTurnLogIntegration } from "./useAgentTurnLogging";

/** Read only a bounded tail: a window flag is not evidence of a missing transcript. */
export async function interruptedTurnLogLosses(
  log: Pick<AgentTurnLogIntegration, "readPage">,
  thread: AgentThread,
  summaries: ReadonlyArray<AgentTurnLogSummary>,
  owns: () => boolean,
): Promise<ReadonlyMap<string, AgentTurnLogLoss>> {
  const losses = new Map<string, AgentTurnLogLoss>();
  for (const turn of thread.turns) {
    if (!owns() || losses.size >= 16) break;
    if (isTerminalAgentTurnStatus(turn.status)) continue;
    const summary = summaries.find((entry) => entry.turnId === turn.turnId);
    if (summary === undefined || summary.sealed) continue;
    let loss: AgentTurnLogLoss =
      summary.loss.kind !== "none"
        ? summary.loss
        : turn.eventsTruncated
          ? { kind: "supervisorGap" }
          : { kind: "none" };
    if (
      summary.loss.kind === "none" &&
      turn.eventsTruncated &&
      recoverAgentTurnResultStatus(turn) !== null
    ) {
      try {
        const page = await log.readPage({
          scope: {
            rootKey: thread.owner.rootKey,
            ownerId: thread.owner.ownerId,
            threadId: thread.threadId,
            turnId: turn.turnId,
          },
          anchor: { at: "tail" },
          maxEvents: 200,
          maxBytes: 524_288,
        });
        if (!owns()) return new Map();
        if (page.loss.kind !== "none") loss = page.loss;
        const recorded = recoverAgentTurnResultStatus({
          ...turn,
          events: page.entries.map((entry) => entry.event),
        });
        if (
          !page.hasLater &&
          !page.clipped &&
          page.loss.kind === "none" &&
          recorded !== null &&
          JSON.stringify(lastResult(page.entries.map((entry) => entry.event))) ===
            JSON.stringify(lastResult(turn.events))
        )
          loss = { kind: "none" };
      } catch {
        // A missing/unreadable tail cannot prove that the final write reached disk.
      }
    }
    losses.set(turn.turnId, loss);
  }
  return losses;
}

function lastResult(events: ReadonlyArray<AgentTurnEvent>): AgentTurnEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.kind === "result") return events[index];
  }
  return undefined;
}
