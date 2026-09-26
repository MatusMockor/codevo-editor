import {
  AMEND_UNAVAILABLE_REASONS,
  pushFailureMessage,
  type AgentGitCommitOutcome,
  type AgentGitCommitPort,
} from "../../../../application/rightPanel/projectGitCommitPort";
import type { AgentShipStepResult } from "../../../../domain/agentShip";
import { validateCommitMessage } from "../../../../domain/commitMessageDraft";
import type { AgentCommitSelection } from "../../../../domain/gitCommitSelection";
import { agentShipFailureLabel } from "../../agentModePresentation";

export interface AgentShipCommitActions {
  onCommit(
    threadId: string,
    message: string,
    selection?: AgentCommitSelection,
  ): Promise<AgentShipStepResult>;
  onPush(threadId: string): Promise<AgentShipStepResult>;
}

export function threadGitCommitPort(
  actions: AgentShipCommitActions,
  threadId: string,
): AgentGitCommitPort {
  const commitStep = async (
    message: string,
    selection: AgentCommitSelection,
  ): Promise<AgentGitCommitOutcome> => {
    const validated = validateCommitMessage(message);
    if (validated.kind === "invalid") return { kind: "failed", message: validated.reason };
    const result = await actions.onCommit(threadId, validated.message, selection);
    if (result.kind === "succeeded") return { kind: "committed" };
    return { kind: "failed", message: stepResultMessage(result) };
  };
  return {
    commit: commitStep,
    amendCandidate: async () => ({ kind: "unavailable", reason: AMEND_UNAVAILABLE_REASONS.thread }),
    amend: async () => ({ kind: "failed", message: AMEND_UNAVAILABLE_REASONS.thread }),
    async commitAndPush(message, selection) {
      const committed = await commitStep(message, selection);
      if (committed.kind !== "committed") return committed;
      const pushed = await actions
        .onPush(threadId)
        .catch((error: unknown): AgentShipStepResult => ({
          kind: "notRun",
          message: error instanceof Error && error.message.length > 0 ? error.message : "",
        }));
      if (pushed.kind === "succeeded") return { kind: "pushed" };
      return { kind: "pushFailed", message: pushFailureMessage(stepResultMessage(pushed)) };
    },
  };
}

function stepResultMessage(result: Exclude<AgentShipStepResult, { kind: "succeeded" }>): string {
  if (result.kind === "failed") return agentShipFailureLabel(result.failure);
  if (result.message.length > 0) return result.message;
  return "Git reported an error.";
}
