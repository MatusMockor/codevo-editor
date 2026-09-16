import { describe, expect, it, vi } from "vitest";
import { TauriAgentQuestionGateway } from "./tauriAgentQuestionGateway";
import type { AgentQuestionOwner } from "../application/agentQuestionPorts";
const local: AgentQuestionOwner = {
  kind: "local",
  workspaceId: "workspace",
  repositoryRoot: "/project",
  taskId: "task",
};
const remote: AgentQuestionOwner = {
  kind: "remote",
  serverId: "server",
  runnerId: "runner",
  taskId: "task",
};
const question = {
  id: "question",
  taskId: "task",
  provider: "codex",
  status: "pending",
  questions: [
    { id: "q", header: "", prompt: "Which?", multiple: false, allowCustom: true, options: [] },
  ],
};
const response = { answers: [{ questionId: "q", optionIds: [], text: "answer" }] };
describe("TauriAgentQuestionGateway", () => {
  it.each([local, remote])("routes list and answer for $kind", async (owner) => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([question])
      .mockResolvedValueOnce({ ...question, status: "answered", answers: response.answers });
    const gateway = new TauriAgentQuestionGateway(invoke);
    expect(await gateway.list(owner)).toEqual([question]);
    expect((await gateway.answer(owner, "question", response)).status).toBe("answered");
    expect(invoke.mock.calls.map((call) => call[0])).toEqual(
      owner.kind === "local"
        ? ["list_agent_questions", "answer_agent_question"]
        : ["list_remote_agent_questions", "answer_remote_agent_question"],
    );
    expect(invoke.mock.calls[1][1]).toEqual({
      request: {
        ...Object.fromEntries(Object.entries(owner).filter(([key]) => key !== "kind")),
        requestId: "question",
        response,
      },
    });
  });
  it.each([
    [{ ...question, taskId: "foreign" }],
    [question, question],
    [{ ...question, extra: true }],
    Array(33).fill(question),
    null,
  ])("rejects malformed or foreign lists", async (payload) => {
    const gateway = new TauriAgentQuestionGateway(vi.fn().mockResolvedValue(payload));
    await expect(gateway.list(local)).rejects.toThrow();
  });
  it("rejects mismatched answer receipts", async () => {
    const gateway = new TauriAgentQuestionGateway(
      vi.fn().mockResolvedValue({
        ...question,
        id: "foreign",
        status: "answered",
        answers: response.answers,
      }),
    );
    await expect(gateway.answer(local, question.id, response)).rejects.toThrow();
  });
  it("rejects oversized outgoing response before invoking native", async () => {
    const invoke = vi.fn();
    const gateway = new TauriAgentQuestionGateway(invoke);
    await expect(
      gateway.answer(local, question.id, {
        answers: [{ questionId: "q", optionIds: [], text: "x".repeat(66000) }],
      }),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
