// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentApprovalOwner } from "../../../application/agentApprovalPorts";
import type { AgentApprovalRequest } from "../../../domain/agentApproval";
import type { AgentQuestionRequest } from "../../../domain/agentQuestion";
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

  it("clears the composer slab once the question is answered instead of pinning it", async () => {
    const seen: Array<AgentComposerInteraction | null> = [];
    const answered: AgentQuestionRequest = {
      ...question,
      status: "answered",
      answers: [{ questionId: "question-0", optionIds: ["option-0"], text: "" }],
    };
    const gateway = {
      list: vi.fn().mockResolvedValueOnce([question]).mockResolvedValue([answered]),
      answer: vi.fn().mockResolvedValue(answered),
    };
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
