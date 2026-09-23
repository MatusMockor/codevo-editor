// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForReact as waitFor } from "../test/reactTestLifecycle";
import type { AgentApprovalGateway, AgentApprovalOwner } from "./agentApprovalPorts";
import type { AgentApprovalRequest } from "../domain/agentApproval";
import { useAgentApprovals, type AgentApprovalsSurface } from "./useAgentApprovals";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

interface Props {
  readonly gateway: AgentApprovalGateway | null;
  readonly owner: AgentApprovalOwner | null;
  readonly running: boolean;
}

function renderApprovals(initial: Props) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement("div"));
  const result = {} as { current: AgentApprovalsSurface };
  function Harness(props: Props) {
    result.current = useAgentApprovals(props.gateway, props.owner, props.running);
    return null;
  }
  const rerender = (props: Props) => act(() => root.render(<Harness {...props} />));
  rerender(initial);
  cleanups.push(() => act(() => root.unmount()));
  return { result, rerender };
}

function owner(taskId: string): AgentApprovalOwner {
  return { kind: "local", workspaceId: "workspace", repositoryRoot: "/repo", taskId };
}

function approval(taskId: string, id = "approval-1"): AgentApprovalRequest {
  return {
    id,
    taskId,
    provider: "claudeCode",
    kind: "command",
    title: "Run a command?",
    detail: "npm test",
    detailTruncated: false,
    facts: [],
    decisions: ["allowOnce", "deny"],
    status: "pending",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("useAgentApprovals", () => {
  it("lists pending approvals and publishes the confirmed decision", async () => {
    const pending = approval("task-a");
    const gateway: AgentApprovalGateway = {
      listApprovals: vi.fn().mockResolvedValue([pending]),
      answerApproval: vi
        .fn()
        .mockResolvedValue({ ...pending, status: "approved", decision: "allowOnce" }),
    };
    const { result } = renderApprovals({ gateway, owner: owner("task-a"), running: false });
    await waitFor(() => expect(result.current.requests).toEqual([pending]));
    await act(() => result.current.answer(pending.id, "allowOnce"));
    expect(gateway.answerApproval).toHaveBeenCalledWith(owner("task-a"), pending.id, "allowOnce");
    expect(result.current.requests[0]?.status).toBe("approved");
    expect(result.current.answering).toBeNull();
  });

  it("ignores decisions the provider did not offer", async () => {
    const pending = approval("task-a");
    const gateway: AgentApprovalGateway = {
      listApprovals: vi.fn().mockResolvedValue([pending]),
      answerApproval: vi.fn(),
    };
    const { result } = renderApprovals({ gateway, owner: owner("task-a"), running: false });
    await waitFor(() => expect(result.current.requests).toHaveLength(1));
    await act(() => result.current.answer(pending.id, "allowForSession"));
    expect(gateway.answerApproval).not.toHaveBeenCalled();
  });

  it("drops a late list from the previous owner after switching threads", async () => {
    const late = deferred<readonly AgentApprovalRequest[]>();
    const gateway: AgentApprovalGateway = {
      listApprovals: vi.fn((current: AgentApprovalOwner) =>
        current.taskId === "task-a" ? late.promise : Promise.resolve([approval("task-b")]),
      ),
      answerApproval: vi.fn(),
    };
    const { result, rerender } = renderApprovals({
      gateway,
      owner: owner("task-a"),
      running: false,
    });
    rerender({ gateway, owner: owner("task-b"), running: false });
    await waitFor(() => expect(result.current.requests[0]?.taskId).toBe("task-b"));
    await act(async () => {
      late.resolve([approval("task-a", "foreign")]);
      await late.promise;
    });
    expect(result.current.requests.map((request) => request.id)).toEqual(["approval-1"]);
    expect(result.current.requests[0]?.taskId).toBe("task-b");
  });

  it("surfaces a failed decision for retry and stays inactive for remote owners", async () => {
    const pending = approval("task-a");
    const gateway: AgentApprovalGateway = {
      listApprovals: vi.fn().mockResolvedValue([pending]),
      answerApproval: vi.fn().mockRejectedValue(new Error("expired")),
    };
    const { result, rerender } = renderApprovals({
      gateway,
      owner: owner("task-a"),
      running: false,
    });
    await waitFor(() => expect(result.current.requests).toHaveLength(1));
    await act(async () => {
      await expect(result.current.answer(pending.id, "deny")).rejects.toThrow("expired");
    });
    expect(result.current.error).toContain("could not be confirmed");
    rerender({
      gateway,
      owner: { kind: "remote", serverId: "server", runnerId: "runner", taskId: "task-a" },
      running: true,
    });
    expect(result.current.requests).toEqual([]);
    expect(gateway.listApprovals).toHaveBeenCalledTimes(1);
  });
});
