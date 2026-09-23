// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentApprovalGateway,
  AgentApprovalOwner,
} from "../../application/agentApprovalPorts";
import type { AgentApprovalRequest } from "../../domain/agentApproval";
import { waitForReact as waitFor } from "../../test/reactTestLifecycle";
import { AgentThreadApprovals } from "./AgentThreadApprovals";

const owner: AgentApprovalOwner = {
  kind: "local",
  workspaceId: "workspace",
  repositoryRoot: "/repo",
  taskId: "task",
};
const pending: AgentApprovalRequest = {
  id: "codex-question-1",
  taskId: "task",
  provider: "codex",
  kind: "command",
  title: "Run a command?",
  detail: "cargo test",
  detailTruncated: false,
  facts: [{ label: "Directory", value: "/repo" }],
  decisions: ["allowOnce", "allowForSession", "deny"],
  status: "pending",
};

describe("AgentThreadApprovals", () => {
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

  it("shows the owning task's pending approval and removes it once allowed", async () => {
    const gateway: AgentApprovalGateway = {
      listApprovals: vi.fn().mockResolvedValue([pending]),
      answerApproval: vi
        .fn()
        .mockResolvedValue({ ...pending, status: "approved", decision: "allowForSession" }),
    };
    act(() =>
      root.render(<AgentThreadApprovals gateway={gateway} owner={owner} running={false} />),
    );
    await waitFor(() => expect(host.textContent).toContain("cargo test"));
    const session = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Allow for this session",
    );
    expect(session).toBeDefined();
    await act(async () => session?.click());
    expect(gateway.answerApproval).toHaveBeenCalledWith(owner, pending.id, "allowForSession");
    await waitFor(() => expect(host.querySelector(".agent-approval-card")).toBeNull());
  });

  it("renders nothing without an approval-capable gateway", () => {
    act(() => root.render(<AgentThreadApprovals gateway={null} owner={owner} running />));
    expect(host.innerHTML).toBe("");
  });
});
