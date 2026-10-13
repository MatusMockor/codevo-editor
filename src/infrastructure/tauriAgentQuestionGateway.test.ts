import { describe, expect, it, vi } from "vitest";
import { isAgentApprovalGateway } from "../application/agentApprovalPorts";
import { isAgentInteractionFeed } from "../application/agentInteractionPorts";
import type {
  AgentLocalQuestionOwner,
  AgentRemoteQuestionOwner,
} from "../application/agentQuestionPorts";
import type { AgentInteractionSnapshot } from "../domain/agentInteractionSnapshot";
import type { ListenToAgentInteractionEvent } from "./tauriAgentInteractionFeed";
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
const snapshot = {
  taskId: "task",
  workspaceId: "workspace",
  sequence: 2,
  questions: [question],
  approvals: [approval],
};
const available = (): boolean => true;
const unavailable = (): boolean => false;

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

  it("keeps the remote list and answer commands unchanged", async () => {
    const invoke = vi.fn().mockResolvedValueOnce([question]).mockResolvedValueOnce(answered);
    const gateway = new TauriAgentQuestionGateway(invoke);

    await expect(gateway.list(remote)).resolves.toStrictEqual([question]);
    await expect(gateway.answer(remote, "question", response)).resolves.toMatchObject({
      status: "answered",
    });

    expect(invoke.mock.calls).toStrictEqual([
      [
        "list_remote_agent_questions",
        { request: { serverId: "server", runnerId: "runner", taskId: "task" } },
      ],
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

  it("refuses to list for a local owner and never reaches the removed list command", async () => {
    const invoke = vi.fn().mockResolvedValue([question]);
    const gateway = new TauriAgentQuestionGateway(invoke);

    await expect(gateway.list(local as unknown as AgentRemoteQuestionOwner)).rejects.toThrow();

    expect(invoke).not.toHaveBeenCalled();
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

  it.each([
    [{ ...question, taskId: "foreign" }],
    [question, question],
    [{ ...question, extra: true }],
    Array(33).fill(question),
    null,
  ])("rejects malformed or foreign remote lists", async (payload) => {
    const gateway = new TauriAgentQuestionGateway(vi.fn().mockResolvedValue(payload));
    await expect(gateway.list(remote)).rejects.toThrow();
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

  it("satisfies the interaction feed and approval gateway ports", () => {
    const gateway = new TauriAgentQuestionGateway(vi.fn());

    expect(isAgentInteractionFeed(gateway)).toBe(true);
    expect(isAgentApprovalGateway(gateway)).toBe(true);
    expect("listApprovals" in gateway).toBe(false);
  });

  it("delegates the current snapshot to the interaction command", async () => {
    const invoke = vi.fn().mockResolvedValue(snapshot);
    const gateway = new TauriAgentQuestionGateway(invoke, vi.fn(), available);

    await expect(gateway.currentInteractions(local)).resolves.toStrictEqual(snapshot);

    expect(invoke.mock.calls).toStrictEqual([
      ["get_agent_interactions", { request: { workspaceId: "workspace", taskId: "task" } }],
    ]);
  });

  it("delegates the pushed snapshot subscription and its unsubscribe", async () => {
    const handlers = new Set<(event: { payload: unknown }) => void>();
    const listen = vi.fn<ListenToAgentInteractionEvent>((_event, handler) => {
      handlers.add(handler);
      return Promise.resolve(() => {
        handlers.delete(handler);
      });
    });
    const gateway = new TauriAgentQuestionGateway(vi.fn(), listen, available);
    const received = vi.fn<(snapshot: AgentInteractionSnapshot) => void>();

    const unsubscribe = await gateway.subscribeInteractions(received);
    handlers.forEach((handler) => handler({ payload: snapshot }));
    handlers.forEach((handler) => handler({ payload: { ...snapshot, extra: true } }));
    unsubscribe();
    handlers.forEach((handler) => handler({ payload: { ...snapshot, sequence: 3 } }));

    expect(listen.mock.calls.map(([event]) => event)).toStrictEqual(["agent-task://interactions"]);
    expect(received.mock.calls).toStrictEqual([[snapshot]]);
  });

  it("degrades the interaction feed without the native runtime", async () => {
    const invoke = vi.fn();
    const listen = vi.fn<ListenToAgentInteractionEvent>();
    const gateway = new TauriAgentQuestionGateway(invoke, listen, unavailable);

    await expect(gateway.currentInteractions(local)).resolves.toStrictEqual({
      workspaceId: "workspace",
      taskId: "task",
      sequence: 0,
      questions: [],
      approvals: [],
    });
    const unsubscribe = await gateway.subscribeInteractions(vi.fn());
    unsubscribe();

    expect(invoke).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
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
