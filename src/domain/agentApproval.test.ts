import { describe, expect, it } from "vitest";
import { parseAgentApprovalRequest } from "./agentApproval";

const pending = {
  id: "claude-abc",
  taskId: "task-1",
  provider: "claudeCode",
  kind: "command",
  title: "Run a command?",
  detail: "npm test",
  detailTruncated: false,
  facts: [{ label: "Directory", value: "/repo" }],
  decisions: ["allowOnce", "deny"],
  status: "pending",
};

describe("parseAgentApprovalRequest", () => {
  it("accepts the exact pending and settled wire shapes", () => {
    expect(parseAgentApprovalRequest(pending)).toEqual(pending);
    expect(
      parseAgentApprovalRequest({ ...pending, status: "approved", decision: "allowOnce" }),
    ).toMatchObject({ status: "approved", decision: "allowOnce" });
    expect(parseAgentApprovalRequest({ ...pending, status: "timedOut" }).status).toBe("timedOut");
  });

  it("rejects unknown fields, kinds, and decisions", () => {
    expect(() => parseAgentApprovalRequest({ ...pending, env: "SECRET=1" })).toThrow();
    expect(() => parseAgentApprovalRequest({ ...pending, kind: "shell" })).toThrow();
    expect(() =>
      parseAgentApprovalRequest({ ...pending, decisions: ["allowAlways", "deny"] }),
    ).toThrow();
    expect(() => parseAgentApprovalRequest({ ...pending, decisions: ["allowOnce"] })).toThrow();
    expect(() => parseAgentApprovalRequest({ ...pending, status: "unknown" })).toThrow();
  });

  it("rejects settlements that contradict the offered decisions", () => {
    expect(() => parseAgentApprovalRequest({ ...pending, status: "approved" })).toThrow();
    expect(() =>
      parseAgentApprovalRequest({ ...pending, status: "approved", decision: "allowForSession" }),
    ).toThrow();
    expect(() =>
      parseAgentApprovalRequest({ ...pending, status: "denied", decision: "allowOnce" }),
    ).toThrow();
    expect(() => parseAgentApprovalRequest({ ...pending, decision: "deny" })).toThrow();
  });

  it("bounds detail and fact sizes", () => {
    expect(() =>
      parseAgentApprovalRequest({ ...pending, detail: "x".repeat(16 * 1024 + 1) }),
    ).toThrow();
    expect(() =>
      parseAgentApprovalRequest({
        ...pending,
        facts: Array.from({ length: 9 }, () => ({ label: "A", value: "b" })),
      }),
    ).toThrow();
  });
});
