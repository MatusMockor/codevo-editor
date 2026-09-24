// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentApprovalOwner } from "../../../application/agentApprovalPorts";
import type { AgentApprovalRequest } from "../../../domain/agentApproval";
import { waitForReact as waitFor } from "../../../test/reactTestLifecycle";
import type { AgentComposerInteraction } from "./agentComposerInteraction";
import { AgentComposerInteractionSource } from "./AgentComposerInteractionSource";

const owner: AgentApprovalOwner = {
  kind: "local",
  workspaceId: "workspace",
  repositoryRoot: "/repo",
  taskId: "task",
};
const pending: AgentApprovalRequest = {
  id: "a1",
  taskId: "task",
  provider: "codex",
  kind: "command",
  title: "Run a command?",
  detail: "cargo test",
  detailTruncated: false,
  facts: [],
  decisions: ["allowOnce", "deny"],
  status: "pending",
};

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

describe("AgentComposerInteractionSource", () => {
  it("publishes the owner's pending approval and clears it on unmount", async () => {
    const seen: Array<AgentComposerInteraction | null> = [];
    const gateway = {
      list: vi.fn().mockResolvedValue([]),
      answer: vi.fn(),
      listApprovals: vi.fn().mockResolvedValue([pending]),
      answerApproval: vi
        .fn()
        .mockResolvedValue({ ...pending, status: "approved", decision: "allowOnce" }),
    };
    const onChange = (next: AgentComposerInteraction | null) => seen.push(next);
    act(() =>
      root.render(
        <AgentComposerInteractionSource
          gateway={gateway}
          onChange={onChange}
          owner={owner}
          running
        />,
      ),
    );
    await waitFor(() => expect(seen[seen.length - 1]?.kind).toBe("approval"));
    act(() => root.render(<></>));
    expect(seen[seen.length - 1]).toBeNull();
  });

  it("publishes nothing without a gateway", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <AgentComposerInteractionSource gateway={null} onChange={onChange} owner={owner} running />,
      ),
    );
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
