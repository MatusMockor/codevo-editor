// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentQuestionRequest } from "../../domain/agentQuestion";
import { AgentComposer, type AgentComposerProps } from "./AgentComposer";
import { presentAgentApproval } from "./agentApprovalPresenter";
import type { AgentComposerInteraction } from "./composer/agentComposerInteraction";

const QUESTION: AgentQuestionRequest = {
  id: "q1",
  taskId: "task",
  provider: "codex",
  status: "pending",
  questions: [
    {
      id: "database",
      header: "Database",
      prompt: "Which database should I use?",
      multiple: false,
      allowCustom: false,
      options: [
        { id: "sqlite", label: "SQLite", description: "" },
        { id: "postgres", label: "PostgreSQL", description: "" },
      ],
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
  vi.restoreAllMocks();
});

function props(overrides: Partial<AgentComposerProps>): AgentComposerProps {
  return {
    target: null,
    prompt: "hidden draft",
    promptBytes: 12,
    isolation: "in-place",
    isolationReason: null,
    worktreeAvailable: false,
    worktreeOnly: false,
    worktreeOnlyReason: null,
    guard: { kind: "safe" },
    launch: { provider: "codex", model: "default", mode: "workspaceWrite" },
    launchProvider: "codex",
    dispatching: false,
    running: true,
    submitBlocked: false,
    providerEnabled: { claudeCode: true, codex: true },
    mode: { kind: "steer", threadId: "agt-1" },
    onSelectRepository: () => undefined,
    onPromptChange: () => undefined,
    onIsolationChange: () => undefined,
    onLaunchChange: () => undefined,
    onNewThread: () => undefined,
    onOpenProviderSettings: () => undefined,
    onSubmit: () => undefined,
    ...overrides,
  };
}

function question(
  answer: Extract<AgentComposerInteraction, { kind: "question" }>["answer"],
): AgentComposerInteraction {
  return {
    kind: "question",
    key: "question:task:q1",
    request: QUESTION,
    sending: false,
    error: null,
    answer,
  };
}

function approval(): AgentComposerInteraction {
  return {
    kind: "approval",
    key: "approval:task:a1",
    pendingCount: 1,
    sending: false,
    error: null,
    decide: () => Promise.resolve(),
    view: presentAgentApproval({
      id: "a1",
      taskId: "task",
      provider: "codex",
      kind: "command",
      title: "outside the sandbox",
      detail: "npm test",
      detailTruncated: false,
      facts: [],
      decisions: ["allowOnce", "deny"],
      status: "pending",
    }),
  };
}

function render(overrides: Partial<AgentComposerProps>): void {
  act(() => root.render(<AgentComposer {...props(overrides)} />));
}

function textarea(): HTMLTextAreaElement {
  const element = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
  expect(element).not.toBeNull();
  return element ?? document.createElement("textarea");
}

describe("AgentComposer interactions", () => {
  it("answers a question without sending the hidden draft, steer or queued edit", async () => {
    const onSubmit = vi.fn();
    const answer = vi.fn(() => Promise.resolve());
    const commit = vi.fn(() => Promise.resolve(true));
    render({
      interaction: question(answer),
      onSubmit,
      queuedEdit: {
        threadId: "agt-1",
        lease: 1,
        prompt: "hidden draft",
        attachments: [],
        onRemoveAttachment: () => undefined,
        onCancel: () => undefined,
        commit,
      },
    });

    const option = [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')][0];
    act(() => option?.click());
    const send = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent === "Send answer",
    );
    expect(send?.closest("form")?.classList.contains("agent-composer")).toBe(false);
    await act(async () => send?.click());

    expect(answer).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not submit the draft when the composer form is submitted during an interaction", () => {
    const onSubmit = vi.fn();
    render({ interaction: question(() => Promise.resolve()), onSubmit });

    const form = host.querySelector<HTMLFormElement>("form.agent-composer");
    act(() => form?.requestSubmit());

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("hands focus into the question panel when it takes over the composer", () => {
    render({ interaction: null });
    act(() => textarea().focus());

    render({ interaction: question(() => Promise.resolve()) });

    const panel = host.querySelector(".cv-composer-interaction--question");
    expect(panel).not.toBeNull();
    expect(panel?.contains(document.activeElement)).toBe(true);
  });

  it.each([
    ["question", () => question(() => Promise.resolve())],
    ["approval", approval],
  ] as const)("returns focus to the prompt when the %s ends", (_kind, interaction) => {
    render({ interaction: interaction() });
    expect(host.querySelector(".cv-composer-interaction")?.contains(document.activeElement)).toBe(
      true,
    );

    render({ interaction: null });

    expect(document.activeElement).toBe(textarea());
  });

  it("leaves focus alone when the user moved it elsewhere before the interaction ended", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    render({ interaction: question(() => Promise.resolve()) });
    act(() => outside.focus());

    render({ interaction: null });

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
