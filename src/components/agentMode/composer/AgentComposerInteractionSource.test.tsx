// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentApprovalOwner } from "../../../application/agentApprovalPorts";
import type { AgentApprovalRequest } from "../../../domain/agentApproval";
import type { AgentQuestionRequest } from "../../../domain/agentQuestion";
import { waitForReact as waitFor } from "../../../test/reactTestLifecycle";
import { FakeAgentInteractionGateway } from "../agentInteractionGatewayTestFixtures";
import type { AgentComposerInteraction } from "./agentComposerInteraction";
import { AgentComposerInteractionSource } from "./AgentComposerInteractionSource";

const owner: AgentApprovalOwner = {
  kind: "local",
  workspaceId: "workspace",
  taskId: "task",
};
const feedOwner = { workspaceId: "workspace", taskId: "task" };
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

const question: AgentQuestionRequest = {
  id: "q1",
  taskId: "task",
  provider: "claudeCode",
  status: "pending",
  questions: [
    {
      id: "question-0",
      header: "",
      prompt: "Which layout?",
      options: [{ id: "option-0", label: "Sidebar", description: "" }],
      multiple: false,
      allowCustom: true,
    },
  ],
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
    const gateway = new FakeAgentInteractionGateway();
    gateway.stage(feedOwner, { approvals: [pending] });
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
    expect(gateway.list).not.toHaveBeenCalled();
    act(() => root.render(<></>));
    expect(seen[seen.length - 1]).toBeNull();
    expect(gateway.subscribers).toBe(0);
  });

  it("publishes an approval pushed after the owner is already shown", async () => {
    const seen: Array<AgentComposerInteraction | null> = [];
    const gateway = new FakeAgentInteractionGateway();
    act(() =>
      root.render(
        <AgentComposerInteractionSource
          gateway={gateway}
          onChange={(next) => seen.push(next)}
          owner={owner}
          running
        />,
      ),
    );
    await waitFor(() => expect(gateway.subscribers).toBe(1));
    expect(seen[seen.length - 1]).toBeNull();

    act(() => gateway.push(feedOwner, { approvals: [pending] }));
    await waitFor(() => expect(seen[seen.length - 1]?.kind).toBe("approval"));

    act(() => gateway.push(feedOwner, {}));
    await waitFor(() => expect(seen[seen.length - 1]).toBeNull());
    expect(gateway.list).not.toHaveBeenCalled();
  });

  it("clears the composer slab once the question is answered instead of pinning it", async () => {
    const seen: Array<AgentComposerInteraction | null> = [];
    const answered: AgentQuestionRequest = {
      ...question,
      status: "answered",
      answers: [{ questionId: "question-0", optionIds: ["option-0"], text: "" }],
    };
    const gateway = new FakeAgentInteractionGateway();
    gateway.stage(feedOwner, { questions: [question] });
    gateway.answer.mockResolvedValue(answered);
    act(() =>
      root.render(
        <AgentComposerInteractionSource
          gateway={gateway}
          onChange={(next) => seen.push(next)}
          owner={owner}
          running
        />,
      ),
    );
    await waitFor(() => expect(seen[seen.length - 1]?.kind).toBe("question"));
    const interaction = seen[seen.length - 1];
    await act(async () => {
      if (interaction?.kind === "question") await interaction.answer({ answers: answered.answers });
    });
    expect(gateway.answer).toHaveBeenCalledTimes(1);
    expect(gateway.answer).toHaveBeenCalledWith(owner, "q1", { answers: answered.answers });
    expect(seen[seen.length - 1]).toBeNull();

    act(() => gateway.push(feedOwner, { questions: [answered] }));

    expect(seen[seen.length - 1]).toBeNull();
    expect(gateway.list).not.toHaveBeenCalled();
  });

  it("publishes nothing for a local owner when the gateway can only be polled", async () => {
    const onChange = vi.fn();
    const gateway = { list: vi.fn().mockResolvedValue([question]), answer: vi.fn() };
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
    await act(async () => {
      await Promise.resolve();
    });

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(gateway.list).not.toHaveBeenCalled();
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
