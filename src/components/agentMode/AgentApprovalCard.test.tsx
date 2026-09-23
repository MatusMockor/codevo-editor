// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentApprovalDecision, AgentApprovalRequest } from "../../domain/agentApproval";
import { waitForReact as waitFor } from "../../test/reactTestLifecycle";
import { AgentApprovalCard } from "./AgentApprovalCard";
import { presentAgentApproval } from "./agentApprovalPresenter";

const plan: AgentApprovalRequest = {
  id: "claude-plan",
  taskId: "task",
  provider: "claudeCode",
  kind: "plan",
  title: "Approve the plan?",
  detail: "1. Write tests\n2. Fix the bug",
  detailTruncated: false,
  facts: [{ label: "Tool", value: "ExitPlanMode" }],
  decisions: ["allowOnce", "deny"],
  status: "pending",
};

describe("AgentApprovalCard", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(
    request: AgentApprovalRequest,
    onDecide: (decision: AgentApprovalDecision) => Promise<void>,
    error: string | null = null,
  ) {
    act(() =>
      root.render(
        <AgentApprovalCard
          view={presentAgentApproval(request)}
          pending={false}
          error={error}
          onDecide={onDecide}
        />,
      ),
    );
  }

  function button(label: string): HTMLButtonElement {
    const found = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    expect(found).toBeDefined();
    return found as HTMLButtonElement;
  }

  it("shows the plan text and approves it with a focusable button", async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(plan, onDecide);
    expect(host.querySelector("h3")?.textContent).toBe("Approve the plan?");
    expect(host.querySelector("pre")?.textContent).toContain("2. Fix the bug");
    const approve = button("Approve plan");
    approve.focus();
    expect(document.activeElement).toBe(approve);
    await act(async () => approve.click());
    expect(onDecide).toHaveBeenCalledWith("allowOnce");
  });

  it("disables every action while a decision is in flight", async () => {
    let settle!: () => void;
    const onDecide = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    render(plan, onDecide);
    await act(async () => button("Keep planning").click());
    expect(button("Approve plan").disabled).toBe(true);
    await act(async () => button("Approve plan").click());
    expect(onDecide).toHaveBeenCalledTimes(1);
    await act(async () => settle());
    await waitFor(() => expect(button("Approve plan").disabled).toBe(false));
  });

  it("reports a failed decision so the user can retry", async () => {
    const onDecide = vi.fn().mockRejectedValue(new Error("gone"));
    render({ ...plan, kind: "command", title: "Run a command?" }, onDecide);
    await act(async () => button("Allow once").click());
    await waitFor(() =>
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("try again"),
    );
    expect(button("Deny").disabled).toBe(false);
  });

  it("renders settled approvals as a status line without actions", () => {
    render({ ...plan, status: "timedOut" }, vi.fn());
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("told no");
  });
});
