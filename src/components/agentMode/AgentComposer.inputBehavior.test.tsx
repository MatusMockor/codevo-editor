// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import type { AgentFollowUpBehavior } from "../../domain/agentFollowUpBehavior";
import type { AgentComposerMode, AgentComposerSubmission } from "./AgentComposer";
import {
  AgentComposerController,
  type AgentComposerControllerProps,
} from "./AgentComposerController";

const COMMAND = "nohup sh -c 'npm run dev > /tmp/dev.log 2>&1' &";
const LAUNCH = {
  provider: "claudeCode",
  model: "default",
  mode: "default",
  effort: "default",
} as const;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  agentComposerDraftStore.reset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  agentComposerDraftStore.reset();
});

describe("AgentComposer prompt text input", () => {
  it("opts the prompt out of WebKit smart quotes, dashes and autocorrection", () => {
    renderController({
      mode: { kind: "new" },
      running: false,
      behavior: "queue",
      submit: async () => true,
    });

    const prompt = promptField();
    expect(prompt.getAttribute("spellcheck")).toBe("false");
    expect(prompt.getAttribute("autocorrect")).toBe("off");
    expect(prompt.getAttribute("autocapitalize")).toBe("off");
    expect(prompt.getAttribute("autocomplete")).toBe("off");
  });
});

describe("AgentComposer send button", () => {
  it.each<{
    readonly name: string;
    readonly mode: AgentComposerMode;
    readonly running: boolean;
    readonly behavior: AgentFollowUpBehavior;
    readonly button: string;
    readonly delivery: AgentComposerSubmission["delivery"];
  }>([
    {
      name: "idle new thread",
      mode: { kind: "new" },
      running: false,
      behavior: "queue",
      button: "Start agent",
      delivery: undefined,
    },
    {
      name: "idle follow-up",
      mode: { kind: "followUp", blockedReason: null },
      running: false,
      behavior: "queue",
      button: "Send follow-up",
      delivery: undefined,
    },
    {
      name: "running turn, queue behaviour",
      mode: { kind: "steer", threadId: "agt-1" },
      running: true,
      behavior: "queue",
      button: "Queue message",
      delivery: "queued",
    },
    {
      name: "running turn, queue behaviour, Send now",
      mode: { kind: "steer", threadId: "agt-1" },
      running: true,
      behavior: "queue",
      button: "Send now",
      delivery: "immediate",
    },
    {
      name: "running turn, steer behaviour",
      mode: { kind: "steer", threadId: "agt-1" },
      running: true,
      behavior: "steer",
      button: "Send now",
      delivery: "immediate",
    },
    {
      name: "running turn, steer behaviour, Queue message",
      mode: { kind: "steer", threadId: "agt-1" },
      running: true,
      behavior: "steer",
      button: "Queue message",
      delivery: "queued",
    },
  ])(
    "submits exactly once on a single click right after typing and keeps the prompt focused ($name)",
    ({ mode, running, behavior, button, delivery }) => {
      const submit = vi.fn<AgentComposerControllerProps["submit"]>(async () => true);
      renderController({ mode, running, behavior, submit });

      const prompt = promptField();
      act(() => prompt.focus());
      typeInto(prompt, COMMAND);
      expect(sendButton(button).disabled).toBe(false);

      clickLikeAPointer(sendButton(button), prompt);

      expect(submit).toHaveBeenCalledTimes(1);
      const [submitted, submission] = submit.mock.calls[0] ?? [];
      expect(submitted).toBe(COMMAND);
      expect(submission?.delivery).toBe(delivery);
      expect(promptField().value).toBe("");
      expect(document.activeElement).toBe(promptField());
    },
  );

  it("keeps Send disabled for an empty draft and enables it on the first keystroke", () => {
    const submit = vi.fn(async () => true);
    renderController({ mode: { kind: "new" }, running: false, behavior: "queue", submit });

    expect(sendButton("Start agent").disabled).toBe(true);
    const prompt = promptField();
    act(() => prompt.focus());
    typeInto(prompt, "l");
    expect(sendButton("Start agent").disabled).toBe(false);
  });
});

function renderController({
  mode,
  running,
  behavior,
  submit,
}: {
  readonly mode: AgentComposerMode;
  readonly running: boolean;
  readonly behavior: AgentFollowUpBehavior;
  readonly submit: AgentComposerControllerProps["submit"];
}): void {
  const props: AgentComposerControllerProps = {
    followUpBehavior: behavior,
    composerProps: {
      draftKey: "agt-1",
      promptOwnerKey: "agt-1",
      target: {
        projectLabel: "app",
        projectRoot: "/workspace/app",
        selectedRepositoryRoot: "/workspace/app",
        repositoryOptions: [],
      },
      isolation: "in-place",
      isolationReason: null,
      worktreeAvailable: false,
      worktreeOnly: false,
      worktreeOnlyReason: null,
      guard: { kind: "safe" },
      launch: LAUNCH,
      launchProvider: "claudeCode",
      dispatching: false,
      running,
      mode,
      onStop: () => undefined,
      onSelectRepository: () => undefined,
      onIsolationChange: () => undefined,
      onLaunchChange: () => undefined,
      onNewThread: () => undefined,
    },
    providerManagement: null as unknown as AgentComposerControllerProps["providerManagement"],
    providerEnabled: { claudeCode: true, codex: true },
    submissionBlocked: false,
    submit,
    onOpenProviderSettings: () => undefined,
  };
  act(() => root.render(<AgentComposerController {...props} />));
}

function promptField(): HTMLTextAreaElement {
  const field = host.querySelector<HTMLTextAreaElement>("#agent-prompt");
  expect(field).not.toBeNull();
  return field ?? document.createElement("textarea");
}

function sendButton(name: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  expect(button).not.toBeNull();
  return button ?? document.createElement("button");
}

function typeInto(field: HTMLTextAreaElement, text: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  expect(setValue).toBeDefined();
  for (let index = 1; index <= text.length; index += 1) {
    act(() => {
      setValue?.call(field, text.slice(0, index));
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

function clickLikeAPointer(button: HTMLButtonElement, focused: HTMLTextAreaElement): void {
  const pointer = { bubbles: true, cancelable: true, button: 0 };
  const mouseDown = new MouseEvent("mousedown", pointer);
  act(() => {
    button.dispatchEvent(new PointerEvent("pointerdown", pointer));
    button.dispatchEvent(mouseDown);
  });
  if (!mouseDown.defaultPrevented) act(() => focused.blur());
  act(() => {
    button.dispatchEvent(new PointerEvent("pointerup", pointer));
    button.dispatchEvent(new MouseEvent("mouseup", pointer));
  });
  act(() => button.click());
}
