// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAgentLaunchOptions } from "../../domain/agentLaunch";
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
    attachments: { kind: "unavailable", reason: "No attachments." },
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

describe("AgentComposer stop confirmation", () => {
  function stopConfirmationButton(name: string): HTMLButtonElement {
    const match = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === name,
    );
    expect(match).toBeInstanceOf(HTMLButtonElement);
    return match as HTMLButtonElement;
  }

  function stopAnnouncer(): HTMLElement | null {
    return host.querySelector<HTMLElement>(".agent-stop-confirmation-announcer");
  }

  it("returns focus to the prompt after Stop everything or Keep running", () => {
    const onStopNow = vi.fn();
    const onCancel = vi.fn();
    render({
      onStopNow,
      stopConfirmation: { kind: "confirmBackground", liveTaskCount: 1, onCancel },
    });

    const stopEverything = stopConfirmationButton("Stop everything");
    stopEverything.focus();
    act(() => stopEverything.click());
    expect(onStopNow).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(textarea());

    const keepRunning = stopConfirmationButton("Keep running");
    keepRunning.focus();
    act(() => keepRunning.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(textarea());
  });

  it("announces the confirmation through a live region that stays mounted", () => {
    render({ stopConfirmation: null });
    const region = stopAnnouncer();
    expect(region?.getAttribute("role")).toBe("status");
    expect(region?.textContent).toBe("");

    render({
      onStopNow: vi.fn(),
      stopConfirmation: { kind: "confirmBackground", liveTaskCount: 2, onCancel: vi.fn() },
    });
    expect(stopAnnouncer()).toBe(region);
    expect(region?.textContent).toBe(
      "2 background tasks are still running. Press Stop or Esc again to end them.",
    );
  });
});

describe("AgentComposer end session confirmation", () => {
  function banner(text: string): HTMLElement | undefined {
    return [...host.querySelectorAll<HTMLElement>(".cv-composer-banner")].find((candidate) =>
      (candidate.textContent ?? "").includes(text),
    );
  }

  function action(name: string): HTMLButtonElement {
    const match = [...(banner("End Claude's session")?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === name,
    );
    expect(match).toBeInstanceOf(HTMLButtonElement);
    return match as HTMLButtonElement;
  }

  it("renders in the composer's banner stack right below a pending stop confirmation", () => {
    render({
      onStopNow: vi.fn(),
      stopConfirmation: { kind: "confirmBackground", liveTaskCount: 1, onCancel: vi.fn() },
      endSessionConfirmation: {
        threadId: "agt-2",
        title: "Nightly build",
        background: "live",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    const stack = host.querySelector(".cv-composer > .cv-composer__banners");
    const stop = banner("Press Stop or Esc again");
    const end = banner('End Claude\'s session for "Nightly build"?');
    expect(stack).not.toBeNull();
    expect(stop?.parentElement).toBe(stack);
    expect(end?.parentElement).toBe(stack);
    expect(stop?.nextElementSibling).toBe(end);
  });

  it("leaves the banner stack empty without a pending confirmation", () => {
    render({ endSessionConfirmation: null });

    expect(host.querySelector(".cv-composer__banners")?.childElementCount).toBe(0);
  });

  it("returns focus to the prompt after End session or Keep running", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render({
      endSessionConfirmation: {
        threadId: "agt-1",
        title: "Refactor the parser",
        background: "live",
        onConfirm,
        onCancel,
      },
    });

    const end = action("End session");
    end.focus();
    act(() => end.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(textarea());

    const keep = action("Keep running");
    keep.focus();
    act(() => keep.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(textarea());
  });
});

describe("AgentComposer session restart consent", () => {
  function restartButton(name: string): HTMLButtonElement {
    const match = [...host.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === name,
    );
    expect(match).toBeInstanceOf(HTMLButtonElement);
    return match as HTMLButtonElement;
  }

  const followUp = {
    running: false,
    mode: { kind: "followUp", blockedReason: null },
    launch: defaultAgentLaunchOptions("claudeCode"),
    launchProvider: "claudeCode",
  } satisfies Partial<AgentComposerProps>;

  it("stays hidden without a pending restart", () => {
    render({ ...followUp, sessionRestartConfirmation: null });
    expect(host.textContent).not.toContain("restarts Claude");
  });

  it("explains the restart and sends with consent or cancels", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render({
      ...followUp,
      onSubmit,
      sessionRestartConfirmation: { onCancel, resend: { kind: "draft" } },
    });
    expect(host.textContent).toContain(
      "Sending this restarts Claude for this thread. Restarting ends this Claude session. Background tasks it started may stop.",
    );
    act(() => restartButton("Restart and send").click());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ sessionRestartConfirmed: true }),
    );
    act(() => restartButton("Cancel").click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("restarts and compacts with the exact held compaction instead of sending the draft", () => {
    const onSubmit = vi.fn();
    const onCompactContext = vi.fn(async () => true);
    const held = {
      launch: defaultAgentLaunchOptions("claudeCode"),
      dangerousLaunchConfirmed: false,
    };
    render({
      ...followUp,
      prompt: "Unrelated draft",
      promptBytes: 15,
      onSubmit,
      onCompactContext,
      sessionRestartConfirmation: {
        onCancel: vi.fn(),
        resend: { kind: "compaction", submission: held },
      },
    });
    act(() => restartButton("Restart and send").click());
    expect(onCompactContext).toHaveBeenCalledTimes(1);
    expect(onCompactContext).toHaveBeenCalledWith({ ...held, sessionRestartConfirmed: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ["a blocked prompt", { submitBlocked: true }],
    ["a blocked thread", { mode: { kind: "followUp", blockedReason: "Archived." } }],
    ["an active question", { interaction: question(() => Promise.resolve()) }],
    ["a local slash command", { prompt: "/settings", promptBytes: 9 }],
  ] satisfies ReadonlyArray<readonly [string, Partial<AgentComposerProps>]>)(
    "restart and send honours the normal send gating for %s",
    (_name, gating) => {
      const onSubmit = vi.fn();
      render({
        ...followUp,
        onSubmit,
        onOpenProviderSettings: vi.fn(),
        sessionRestartConfirmation: { onCancel: vi.fn(), resend: { kind: "draft" } },
        ...gating,
      });
      act(() => restartButton("Restart and send").click());
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );
});
