import { describe, expect, it, vi } from "vitest";
import { isAgentApprovalGateway } from "../application/agentApprovalPorts";
import type {
  AgentLocalQuestionOwner,
  AgentRemoteQuestionOwner,
} from "../application/agentQuestionPorts";
import { TauriAgentQuestionGateway } from "./tauriAgentQuestionGateway";

const local: AgentLocalQuestionOwner = {
  kind: "local",
  workspaceId: "workspace",
  taskId: "task",
};
const remote: AgentRemoteQuestionOwner = {
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
const answered = { ...question, status: "answered", answers: response.answers };
const approval = {
  id: "approval",
  taskId: "task",
  provider: "codex",
  kind: "command",
  title: "Run a command?",
  detail: "ls",
  detailTruncated: false,
  facts: [],
  decisions: ["allowOnce", "allowForSession", "deny"],
  status: "pending",
};

describe("TauriAgentQuestionGateway", () => {
  it("answers a local question with only the workspace and task identity", async () => {
    const invoke = vi.fn().mockResolvedValue(answered);
    const gateway = new TauriAgentQuestionGateway(invoke);

    await expect(gateway.answer(local, "question", response)).resolves.toMatchObject({
      status: "answered",
    });

    expect(invoke.mock.calls).toStrictEqual([
      [
        "answer_agent_question",
        { request: { workspaceId: "workspace", taskId: "task", requestId: "question", response } },
      ],
    ]);
  });

  it("drops a stale repository root carried by a local owner", async () => {
    const invoke = vi.fn().mockResolvedValue(answered);
    const gateway = new TauriAgentQuestionGateway(invoke);
    const widened: AgentLocalQuestionOwner = Object.assign(
      { repositoryRoot: "/repo/nested" },
      local,
    );

    await gateway.answer(widened, "question", response);

    expect(invoke.mock.calls[0]?.[1]).toStrictEqual({
      request: { workspaceId: "workspace", taskId: "task", requestId: "question", response },
    });
  });

  it("keeps the remote answer command unchanged and no longer lists remote questions", async () => {
    const invoke = vi.fn().mockResolvedValueOnce(answered);
    const gateway = new TauriAgentQuestionGateway(invoke);

    await expect(gateway.answer(remote, "question", response)).resolves.toMatchObject({
      status: "answered",
    });

    expect("list" in gateway).toBe(false);
    expect(invoke.mock.calls).toStrictEqual([
      [
        "answer_remote_agent_question",
        {
          request: {
            serverId: "server",
            runnerId: "runner",
            taskId: "task",
            requestId: "question",
            response,
          },
        },
      ],
    ]);
  });

  it.each([
    ["blank workspace", { ...local, workspaceId: "" }],
    ["path-like workspace", { ...local, workspaceId: "/repo" }],
    ["blank task", { ...local, taskId: "" }],
    ["blank server", { ...remote, serverId: "" }],
    ["blank runner", { ...remote, runnerId: "" }],
  ])("rejects an owner with %s before invoking native", async (_label, owner) => {
    const invoke = vi.fn();
    const gateway = new TauriAgentQuestionGateway(invoke);

    await expect(gateway.answer(owner, "question", response)).rejects.toThrow();

    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([local, remote])("rejects mismatched answer receipts for $kind", async (owner) => {
    const gateway = new TauriAgentQuestionGateway(
      vi.fn().mockResolvedValue({ ...answered, id: "foreign" }),
    );
    await expect(gateway.answer(owner, question.id, response)).rejects.toThrow();
  });

  it("rejects an answer receipt that belongs to another task", async () => {
    const gateway = new TauriAgentQuestionGateway(
      vi.fn().mockResolvedValue({ ...answered, taskId: "foreign" }),
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

  it("satisfies the approval gateway port and no longer serves the per-task interaction feed", () => {
    const gateway = new TauriAgentQuestionGateway(vi.fn());

    expect(isAgentApprovalGateway(gateway)).toBe(true);
    expect("listApprovals" in gateway).toBe(false);
    expect("currentInteractions" in gateway).toBe(false);
    expect("subscribeInteractions" in gateway).toBe(false);
  });

  it("answers approvals through the approval command for a local owner", async () => {
    const invoke = vi.fn().mockResolvedValue({ ...approval, status: "denied", decision: "deny" });
    const gateway = new TauriAgentQuestionGateway(invoke);

    await expect(gateway.answerApproval(local, "approval", "deny")).resolves.toMatchObject({
      status: "denied",
    });

    expect(invoke.mock.calls).toStrictEqual([
      [
        "answer_agent_approval",
        {
          request: {
            workspaceId: "workspace",
            taskId: "task",
            requestId: "approval",
            decision: "deny",
          },
        },
      ],
    ]);
  });
});
