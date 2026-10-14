import { describe, expect, it, vi } from "vitest";
import { isAgentApprovalGateway, type AgentApprovalOwner } from "../application/agentApprovalPorts";
import { TauriAgentApprovalGateway } from "./tauriAgentApprovalGateway";

const owner: AgentApprovalOwner = {
  kind: "local",
  workspaceId: "workspace",
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
const approved = { ...wire, status: "approved", decision: "allowForSession" };

describe("TauriAgentApprovalGateway", () => {
  it("satisfies the approval gateway port without a list capability", () => {
    const gateway = new TauriAgentApprovalGateway(vi.fn());

    expect(isAgentApprovalGateway(gateway)).toBe(true);
    expect("listApprovals" in gateway).toBe(false);
  });

  it("sends a closed decision with only the workspace and task identity", async () => {
    const invoke = vi.fn().mockResolvedValue(approved);
    const gateway = new TauriAgentApprovalGateway(invoke);

    await expect(gateway.answerApproval(owner, wire.id, "allowForSession")).resolves.toMatchObject({
      status: "approved",
    });

    expect(invoke.mock.calls).toStrictEqual([
      [
        "answer_agent_approval",
        {
          request: {
            workspaceId: "workspace",
            taskId: "task-1",
            requestId: wire.id,
            decision: "allowForSession",
          },
        },
      ],
    ]);
  });

  it("drops a stale repository root carried by a local owner", async () => {
    const invoke = vi.fn().mockResolvedValue(approved);
    const gateway = new TauriAgentApprovalGateway(invoke);
    const widened: AgentApprovalOwner = Object.assign({ repositoryRoot: "/repo/nested" }, owner);

    await gateway.answerApproval(widened, wire.id, "allowForSession");

    expect(invoke.mock.calls[0]?.[1]).toStrictEqual({
      request: {
        workspaceId: "workspace",
        taskId: "task-1",
        requestId: wire.id,
        decision: "allowForSession",
      },
    });
  });

  it("requires the backend to confirm the same decision", async () => {
    const gateway = new TauriAgentApprovalGateway(
      vi.fn().mockResolvedValue({ ...wire, status: "approved", decision: "allowOnce" }),
    );

    await expect(gateway.answerApproval(owner, wire.id, "deny")).rejects.toThrow();
    await expect(gateway.answerApproval(owner, wire.id, "allowForSession")).rejects.toThrow();
  });

  it.each([
    ["a receipt of another task", { ...approved, taskId: "task-2" }],
    ["a receipt of another request", { ...approved, id: "codex-question-2" }],
    ["a receipt that is still pending", wire],
    ["a receipt with an unknown key", { ...approved, extra: true }],
    ["a list instead of a receipt", [approved]],
  ])("fails closed for %s", async (_label, payload) => {
    const gateway = new TauriAgentApprovalGateway(vi.fn().mockResolvedValue(payload));

    await expect(gateway.answerApproval(owner, wire.id, "allowForSession")).rejects.toThrow();
  });

  it.each([
    ["an unknown decision", owner, wire.id, "always"],
    ["an invalid request id", owner, "", "deny"],
    ["a blank workspace", { ...owner, workspaceId: "" }, wire.id, "deny"],
    ["a path-like workspace", { ...owner, workspaceId: "/repo" }, wire.id, "deny"],
    ["a blank task", { ...owner, taskId: "" }, wire.id, "deny"],
    ["a remote owner", { kind: "remote", serverId: "server", taskId: "task-1" }, wire.id, "deny"],
  ])("rejects %s before invoking native", async (_label, invalidOwner, requestId, decision) => {
    const invoke = vi.fn();
    const gateway = new TauriAgentApprovalGateway(invoke);

    await expect(
      gateway.answerApproval(invalidOwner as AgentApprovalOwner, requestId, decision as "deny"),
    ).rejects.toThrow();

    expect(invoke).not.toHaveBeenCalled();
  });
});
