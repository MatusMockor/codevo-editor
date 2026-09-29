import { describe, expect, it, vi } from "vitest";
import type { AgentApprovalRequest } from "../../../domain/agentApproval";
import type { AgentQuestionRequest } from "../../../domain/agentQuestion";
import { pickAgentComposerInteraction } from "./agentComposerInteraction";

const approval: AgentApprovalRequest = {
  id: "a1",
  taskId: "task",
  provider: "codex",
  kind: "command",
  title: "outside the sandbox",
  detail: "npm test -- orders.idempotency",
  detailTruncated: false,
  facts: [{ label: "Reason", value: "Needs network access" }],
  decisions: ["allowOnce", "allowForSession", "deny"],
  status: "pending",
};

const NO_ATTACHMENTS = { kind: "unavailable", reason: "No attachments." } as const;

const question: AgentQuestionRequest = {
  id: "q1",
  taskId: "task",
  provider: "claudeCode",
  questions: [],
  status: "pending",
};

function inputs(patch: Partial<Parameters<typeof pickAgentComposerInteraction>[0]> = {}) {
  return {
    approvals: { requests: [], answering: null, error: null, answer: vi.fn() },
    questions: {
      requests: [],
      attachments: NO_ATTACHMENTS,
      answering: null,
      error: null,
      answer: vi.fn(),
    },
    running: true,
    ...patch,
  };
}

describe("pickAgentComposerInteraction", () => {
  it("puts the first pending approval in the slab and counts the rest", () => {
    const second = { ...approval, id: "a2" };
    const picked = pickAgentComposerInteraction(
      inputs({
        approvals: { requests: [approval, second], answering: "a1", error: null, answer: vi.fn() },
      }),
    );
    expect(picked?.kind).toBe("approval");
    expect(picked?.kind === "approval" && picked.pendingCount).toBe(2);
    expect(picked?.kind === "approval" && picked.sending).toBe(true);
    expect(picked?.key).toBe("approval:task:a1");
  });

  it("routes a decision to the picked request only", async () => {
    const answer = vi.fn().mockResolvedValue(undefined);
    const picked = pickAgentComposerInteraction(
      inputs({ approvals: { requests: [approval], answering: null, error: null, answer } }),
    );
    if (picked?.kind === "approval") await picked.decide("deny");
    expect(answer).toHaveBeenCalledWith("a1", "deny");
  });

  it("falls back to a pending question, then a settled approval notice, then nothing", () => {
    expect(
      pickAgentComposerInteraction(
        inputs({
          questions: {
            requests: [question],
            attachments: NO_ATTACHMENTS,
            answering: null,
            error: null,
            answer: vi.fn(),
          },
        }),
      )?.kind,
    ).toBe("question");
    const withdrawn: AgentApprovalRequest = { ...approval, status: "cancelled" };
    expect(
      pickAgentComposerInteraction(
        inputs({
          approvals: { requests: [withdrawn], answering: null, error: null, answer: vi.fn() },
        }),
      ),
    ).toEqual({
      kind: "notice",
      key: "approval-notice:a1:cancelled",
      text: "outside the sandbox · The agent withdrew this request.",
    });
    expect(pickAgentComposerInteraction(inputs())).toBeNull();
  });

  it("shows a question error only while the thread runs", () => {
    const failing = {
      requests: [],
      attachments: NO_ATTACHMENTS,
      answering: null,
      error: "The answer could not be confirmed.",
      answer: vi.fn(),
    };
    expect(pickAgentComposerInteraction(inputs({ questions: failing }))?.kind).toBe("notice");
    expect(pickAgentComposerInteraction(inputs({ questions: failing, running: false }))).toBeNull();
  });
});
