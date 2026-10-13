import { describe, expect, it, vi } from "vitest";
import type { AgentInteractionSnapshot } from "../domain/agentInteractionSnapshot";
import type { AgentQuestionRequest } from "../domain/agentQuestion";
import type { AgentThread } from "../domain/agentThread";
import type { AgentInteractionFeed } from "./agentInteractionPorts";
import type { AgentQuestionGateway } from "./agentQuestionPorts";
import { agentThreadHasPendingInput } from "./agentThreadPendingInput";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";

const WORKSPACE = "workspace";
const TASK = "task";

function thread(): AgentThread {
  const view = projectRemoteAgentThreads({
    serverId: "server",
    runnerId: "runner",
    interactiveQuestionsSupported: true,
    projects: [],
    tasks: [
      {
        id: TASK,
        runnerId: "runner",
        sequence: 1,
        provider: "codex",
        status: "running",
        parts: [{ type: "text", text: "Prompt" }],
        createdAt: "2026-09-16T12:00:00Z",
      },
    ],
    replays: new Map(),
    resumes: new Map(),
  })[0];
  return {
    ...view.thread,
    owner: { rootKey: "/repo", ownerId: WORKSPACE, repositoryRoot: "/repo/nested" },
  };
}

function question(status: "pending" | "cancelled" | "expired"): AgentQuestionRequest {
  return {
    id: `question-${status}`,
    taskId: TASK,
    provider: "claudeCode",
    status,
    questions: [
      {
        id: "q",
        header: "Choose",
        prompt: "Which?",
        multiple: false,
        allowCustom: true,
        options: [{ id: "a", label: "A", description: "" }],
      },
    ],
  };
}

function snapshot(
  sequence: number,
  questions: readonly AgentQuestionRequest[],
): AgentInteractionSnapshot {
  return { workspaceId: WORKSPACE, taskId: TASK, sequence, questions, approvals: [] };
}

function feedGateway(
  currentInteractions: AgentInteractionFeed["currentInteractions"],
): AgentQuestionGateway & AgentInteractionFeed {
  return {
    list: vi.fn(),
    answer: vi.fn(),
    currentInteractions: vi.fn(currentInteractions),
    subscribeInteractions: vi.fn(),
  };
}

describe("agentThreadHasPendingInput", () => {
  it("reads the running turn once through the feed and reports its pending question", async () => {
    const gateway = feedGateway(() =>
      Promise.resolve(snapshot(3, [question("cancelled"), question("pending")])),
    );
    await expect(agentThreadHasPendingInput(gateway, thread())).resolves.toBe(true);
    expect(gateway.currentInteractions).toHaveBeenCalledTimes(1);
    expect(gateway.currentInteractions).toHaveBeenCalledWith({
      workspaceId: WORKSPACE,
      taskId: TASK,
    });
    expect(gateway.list).not.toHaveBeenCalled();
    expect(gateway.subscribeInteractions).not.toHaveBeenCalled();
  });

  it.each<{ readonly name: string; readonly observed: AgentInteractionSnapshot }>([
    { name: "no question session", observed: snapshot(0, []) },
    { name: "an empty list", observed: snapshot(4, []) },
    {
      name: "only settled questions",
      observed: snapshot(5, [
        question("cancelled"),
        question("expired"),
        {
          ...question("pending"),
          id: "question-answered",
          status: "answered",
          answers: [{ questionId: "q", optionIds: ["a"], text: "" }],
        },
      ]),
    },
    {
      name: "only a pending approval",
      observed: {
        ...snapshot(6, []),
        approvals: [
          {
            id: "approval",
            taskId: TASK,
            provider: "claudeCode",
            kind: "command",
            title: "Run a command?",
            detail: "npm test",
            detailTruncated: false,
            facts: [],
            decisions: ["allowOnce", "deny"],
            status: "pending",
          },
        ],
      },
    },
  ])("reports no pending input for $name", async ({ observed }) => {
    const gateway = feedGateway(() => Promise.resolve(observed));
    await expect(agentThreadHasPendingInput(gateway, thread())).resolves.toBe(false);
  });

  it("reports no pending input without a gateway or with a gateway that is not a feed", async () => {
    const legacy: AgentQuestionGateway = { list: vi.fn(), answer: vi.fn() };
    await expect(agentThreadHasPendingInput(undefined, thread())).resolves.toBe(false);
    await expect(agentThreadHasPendingInput(legacy, thread())).resolves.toBe(false);
    expect(legacy.list).not.toHaveBeenCalled();
  });

  it("keeps the input when the thread or its running turn is missing", async () => {
    const gateway = feedGateway(() => Promise.resolve(snapshot(0, [])));
    await expect(agentThreadHasPendingInput(gateway, undefined)).resolves.toBe(true);
    await expect(agentThreadHasPendingInput(gateway, { ...thread(), turns: [] })).resolves.toBe(
      true,
    );
    expect(gateway.currentInteractions).not.toHaveBeenCalled();
  });

  it("propagates a rejected read", async () => {
    const gateway = feedGateway(() => Promise.reject(new Error("Agent task is unavailable.")));
    await expect(agentThreadHasPendingInput(gateway, thread())).rejects.toThrow(
      "Agent task is unavailable.",
    );
  });
});
