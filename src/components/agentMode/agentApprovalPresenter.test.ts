import { describe, expect, it } from "vitest";
import type { AgentApprovalRequest } from "../../domain/agentApproval";
import { presentAgentApproval, visibleAgentApprovals } from "./agentApprovalPresenter";

const base: AgentApprovalRequest = {
  id: "a-1",
  taskId: "task",
  provider: "claudeCode",
  kind: "plan",
  title: "Approve the plan?",
  detail: "1. Do it",
  detailTruncated: true,
  facts: [],
  decisions: ["allowOnce", "deny"],
  status: "pending",
};

describe("agentApprovalPresenter", () => {
  it("presents plan approvals as approve or keep planning", () => {
    const view = presentAgentApproval(base);
    expect(view.actions.map((action) => action.label)).toEqual(["Approve plan", "Keep planning"]);
    expect(view.detailLabel).toBe("Plan");
    expect(view.truncatedNote).not.toBeNull();
  });

  it("offers session approval only when the provider offered it", () => {
    const command = presentAgentApproval({
      ...base,
      kind: "command",
      decisions: ["allowOnce", "allowForSession", "deny"],
    });
    expect(command.actions.map((action) => action.label)).toEqual([
      "Allow once",
      "Allow for this session",
      "Deny",
    ]);
    expect(command.actions.map((action) => action.tone)).toEqual([
      "primary",
      "secondary",
      "danger",
    ]);
  });

  it("settled approvals have no actions and truthful status", () => {
    expect(presentAgentApproval({ ...base, status: "timedOut" })).toMatchObject({
      actions: [],
      statusText: "No decision was made in time, so the agent was told no.",
    });
    expect(presentAgentApproval({ ...base, status: "denied", decision: "deny" }).statusText).toBe(
      "Kept planning",
    );
  });

  it("shows pending approvals and only an unexpected last settlement otherwise", () => {
    const approved: AgentApprovalRequest = {
      ...base,
      id: "a-0",
      status: "approved",
      decision: "allowOnce",
    };
    expect(visibleAgentApprovals([approved, base])).toEqual([base]);
    expect(visibleAgentApprovals([approved])).toEqual([]);
    const expired: AgentApprovalRequest = { ...base, status: "expired" };
    expect(visibleAgentApprovals([approved, expired])).toEqual([expired]);
  });

  it("labels Codex file change details as the file list", () => {
    expect(
      presentAgentApproval({ ...base, provider: "codex", kind: "fileChange" }).detailLabel,
    ).toBe("Files");
    expect(presentAgentApproval({ ...base, kind: "fileChange" }).detailLabel).toBe("Change");
  });
});
