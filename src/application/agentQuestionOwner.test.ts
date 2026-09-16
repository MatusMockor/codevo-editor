import { describe, expect, it } from "vitest";
import { agentQuestionOwner } from "./agentQuestionOwner";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";
import type { AgentThreadView } from "./agentThreadPorts";
function view(supported = false): AgentThreadView {
  return projectRemoteAgentThreads({
    serverId: "server",
    runnerId: "runner",
    interactiveQuestionsSupported: supported,
    projects: [],
    tasks: [
      {
        id: "task",
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
}
describe("agentQuestionOwner", () => {
  it("does not poll legacy runners and captures exact supported remote owner", () => {
    expect(agentQuestionOwner(view())).toBeNull();
    expect(agentQuestionOwner(view(true))).toEqual({
      kind: "remote",
      serverId: "server",
      runnerId: "runner",
      taskId: "task",
    });
  });
  it("selects local app-server tasks and excludes the unsupported exec transport", () => {
    const remote = view();
    const local: AgentThreadView = {
      ...remote,
      execution: undefined,
      thread: {
        ...remote.thread,
        owner: { rootKey: "root", ownerId: "workspace", repositoryRoot: "/repo" },
        turns: remote.thread.turns.map((turn) => ({ ...turn, codexTransport: "appServer" })),
      },
    };
    expect(agentQuestionOwner(local)).toEqual({
      kind: "local",
      workspaceId: "workspace",
      repositoryRoot: "/repo",
      taskId: "task",
    });
    expect(
      agentQuestionOwner({
        ...local,
        thread: {
          ...local.thread,
          turns: local.thread.turns.map((turn) => ({ ...turn, codexTransport: "exec" })),
        },
      }),
    ).toBeNull();
  });
  it("enables Claude and handles empty selections", () => {
    const remote = view();
    const local: AgentThreadView = {
      ...remote,
      execution: undefined,
      thread: { ...remote.thread, provider: { kind: "claudeCode", sessionId: null } },
    };
    expect(agentQuestionOwner(local)?.kind).toBe("local");
    expect(agentQuestionOwner(null)).toBeNull();
    expect(agentQuestionOwner({ ...local, thread: { ...local.thread, turns: [] } })).toBeNull();
  });
});
