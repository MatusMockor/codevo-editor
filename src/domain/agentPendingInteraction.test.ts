import { describe, expect, it } from "vitest";
import type { AgentApprovalRequest } from "./agentApproval";
import type { AgentQuestionRequest } from "./agentQuestion";
import {
  agentPendingInteraction,
  agentPendingInteractionIdentity,
} from "./agentPendingInteraction";

const approval = (status: AgentApprovalRequest["status"]) => ({ status }) as AgentApprovalRequest;
const question = (status: AgentQuestionRequest["status"]) => ({ status }) as AgentQuestionRequest;

describe("agentPendingInteraction", () => {
  it("prefers a pending approval over a pending question", () => {
    expect(agentPendingInteraction([approval("pending")], [question("pending")])).toBe("approval");
    expect(agentPendingInteraction([approval("approved")], [question("pending")])).toBe("input");
    expect(agentPendingInteraction([approval("expired")], [question("answered")])).toBeNull();
    expect(agentPendingInteraction([], [])).toBeNull();
  });

  it("ignores settled approvals and cancelled or expired questions", () => {
    expect(agentPendingInteraction([approval("denied")], [question("cancelled")])).toBeNull();
    expect(agentPendingInteraction([], [question("expired"), question("pending")])).toBe("input");
  });

  it("identifies the exact pending request", () => {
    const pendingApproval = { status: "pending", id: "approval-2" } as AgentApprovalRequest;
    const pendingQuestion = { status: "pending", id: "question-7" } as AgentQuestionRequest;

    expect(
      agentPendingInteractionIdentity([approval("approved"), pendingApproval], [pendingQuestion]),
    ).toEqual({ kind: "approval", id: "approval-2" });
    expect(agentPendingInteractionIdentity([], [pendingQuestion])).toEqual({
      kind: "input",
      id: "question-7",
    });
    expect(agentPendingInteractionIdentity([], [])).toBeNull();
  });
});
