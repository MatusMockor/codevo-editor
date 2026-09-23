import { describe, expect, it, vi } from "vitest";
import type { AgentApprovalOwner } from "../application/agentApprovalPorts";
import { TauriAgentApprovalGateway } from "./tauriAgentApprovalGateway";
import { TauriAgentQuestionGateway } from "./tauriAgentQuestionGateway";

const owner: AgentApprovalOwner = {
  kind: "local",
  workspaceId: "workspace",
  repositoryRoot: "/repo",
  taskId: "task-1",
};
const wire = {
  id: "codex-question-1",
  taskId: "task-1",
  provider: "codex",
  kind: "command",
  title: "Run a command?",
  detail: "ls",
  detailTruncated: false,
  facts: [],
  decisions: ["allowOnce", "allowForSession", "deny"],
  status: "pending",
};

describe("TauriAgentApprovalGateway", () => {
  it("lists local approvals with the exact owner authority", async () => {
    const invoke = vi.fn().mockResolvedValue([wire]);
    const gateway = new TauriAgentApprovalGateway(invoke);
    await expect(gateway.listApprovals(owner)).resolves.toEqual([wire]);
    expect(invoke).toHaveBeenCalledWith("list_agent_approvals", {
      request: { workspaceId: "workspace", repositoryRoot: "/repo", taskId: "task-1" },
    });
  });

  it("fails closed for foreign tasks, duplicates, and remote owners", async () => {
    await expect(
      new TauriAgentApprovalGateway(
        vi.fn().mockResolvedValue([{ ...wire, taskId: "task-2" }]),
      ).listApprovals(owner),
    ).rejects.toThrow();
    await expect(
      new TauriAgentApprovalGateway(vi.fn().mockResolvedValue([wire, wire])).listApprovals(owner),
    ).rejects.toThrow();
    const invoke = vi.fn();
    const remote = new TauriAgentApprovalGateway(invoke);
    const remoteOwner: AgentApprovalOwner = {
      kind: "remote",
      serverId: "server",
      runnerId: "runner",
      taskId: "task-1",
    };
    await expect(remote.listApprovals(remoteOwner)).resolves.toEqual([]);
    await expect(remote.answerApproval(remoteOwner, wire.id, "deny")).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends a closed decision and requires the backend to confirm the same one", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ ...wire, status: "approved", decision: "allowForSession" })
      .mockResolvedValueOnce({ ...wire, status: "approved", decision: "allowOnce" });
    const gateway = new TauriAgentApprovalGateway(invoke);
    await expect(gateway.answerApproval(owner, wire.id, "allowForSession")).resolves.toMatchObject({
      status: "approved",
    });
    expect(invoke).toHaveBeenCalledWith("answer_agent_approval", {
      request: {
        workspaceId: "workspace",
        repositoryRoot: "/repo",
        taskId: "task-1",
        requestId: wire.id,
        decision: "allowForSession",
      },
    });
    await expect(gateway.answerApproval(owner, wire.id, "deny")).rejects.toThrow();
    await expect(
      gateway.answerApproval(owner, wire.id, "always" as unknown as "deny"),
    ).rejects.toThrow();
  });

  it("is exposed by the question gateway used in the composition root", async () => {
    const invoke = vi.fn().mockResolvedValue([wire]);
    await expect(new TauriAgentQuestionGateway(invoke).listApprovals(owner)).resolves.toHaveLength(
      1,
    );
  });
});
