import type { AcknowledgeAgentTaskOutputRequest } from "../domain/agentTask";

interface OutputAcknowledgementOwner {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly isCurrent: () => boolean;
  readonly acknowledge: (request: AcknowledgeAgentTaskOutputRequest) => Promise<void>;
  readonly onFailure: (error: unknown) => void;
}

/** One in-flight acknowledgement and one cumulative sequence per exact stream owner. */
export function createAgentOutputAcknowledgement(owner: OutputAcknowledgementOwner): {
  consumed(sequence: number): void;
} {
  let consumed = 0;
  let acknowledged = 0;
  let scheduled = false;
  let failed = false;
  const flush = async (): Promise<void> => {
    let attempts = 0;
    try {
      while (owner.isCurrent() && acknowledged < consumed) {
        const sequence = consumed;
        try {
          await owner.acknowledge({
            taskId: owner.taskId,
            workspaceId: owner.workspaceId,
            sequence,
          });
          if (!owner.isCurrent()) return;
          acknowledged = sequence;
          attempts = 0;
        } catch (error) {
          if (!owner.isCurrent()) return;
          attempts += 1;
          if (attempts >= 3) {
            failed = true;
            owner.onFailure(error);
            return;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
      }
    } finally {
      scheduled = false;
    }
  };
  return {
    consumed(sequence) {
      if (failed || !owner.isCurrent() || sequence <= consumed) return;
      consumed = sequence;
      if (scheduled) return;
      scheduled = true;
      // Coalesce synchronous output delivery without retaining the output payloads.
      void Promise.resolve().then(flush);
    },
  };
}
