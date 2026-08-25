// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "../../domain/agentTask";
import {
  AgentComposer,
  type AgentComposerProps,
  type AgentComposerRepositoryOption,
  type AgentComposerTarget,
} from "./AgentComposer";
import { formatAgentPromptBytes } from "./agentModePresentation";

describe("AgentComposer", () => {
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
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("never names the target project above the prompt", () => {
    render();

    expect(host.textContent).not.toContain("Starting in");
    expect(host.querySelector(".agent-composer__context")).toBeNull();
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector("textarea#agent-prompt")).not.toBeNull();
  });

  it("offers the repositories of the target project only when there is a choice", () => {
    render();

    expect(pickerOptionLabels(REPOSITORY_ID)).toEqual(["app", "packages/api"]);
    expect(pickerValue(REPOSITORY_ID)).toBe("/workspace/app");
    expect(trigger(REPOSITORY_ID).getAttribute("aria-label")).toBe("Repository in app");

    render({ target: { ...target(), repositoryOptions: [repo("/workspace/app", "app")] } });

    expect(host.querySelector(`#${REPOSITORY_ID}`)).toBeNull();
  });

  it("changes the repository of the next thread", () => {
    const onSelectRepository = vi.fn();
    render({ onSelectRepository });

    pickOption(REPOSITORY_ID, "/workspace/app/packages/api");

    expect(onSelectRepository).toHaveBeenCalledWith("/workspace/app/packages/api");
  });

  it("blocks a new thread while no project owns the composer", () => {
    const onSubmit = vi.fn();
    render({ onSubmit, prompt: "Fix it", target: null });

    expect(submitButton().disabled).toBe(true);
    expect(host.querySelector(".agent-composer__reason")?.textContent).toBe(
      "Choose a project in the rail to start a thread.",
    );

    submitForm();
    pressAccelerator();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks a project that has no repository and names it", () => {
    render({ prompt: "Fix it", target: { ...target(), repositoryOptions: [] } });

    expect(submitButton().disabled).toBe(true);
    expect(host.querySelector(".agent-composer__reason")?.textContent).toBe(
      "No Git repository detected in app.",
    );
    expect(host.querySelector(`#${REPOSITORY_ID}`)).toBeNull();
  });

  it("picks the checkout in the footer under the box", () => {
    const onIsolationChange = vi.fn();
    render({ onIsolationChange });

    const footer = host.querySelector(".agent-composer__footer");
    expect(footer?.querySelector(`#${CHECKOUT_ID}`)).not.toBeNull();
    expect(host.querySelector(".agent-composer__box")?.nextElementSibling).toBe(footer);
    expect(pickerValue(CHECKOUT_ID)).toBe("in-place");
    expect(trigger(CHECKOUT_ID).textContent).toContain("Local checkout");
    expect(pickerOptionLabels(CHECKOUT_ID)).toEqual(["Local checkout", "Isolated worktree"]);

    pickOption(CHECKOUT_ID, "worktree");

    expect(onIsolationChange).toHaveBeenCalledWith("worktree");
  });

  it("pre-sets the checkout and shows the reason behind the default", () => {
    render({
      isolation: "worktree",
      isolationReason: "The working tree has uncommitted changes.",
    });

    expect(pickerValue(CHECKOUT_ID)).toBe("worktree");
    expect(trigger(CHECKOUT_ID).textContent).toContain("Isolated worktree");
    expect(host.textContent).toContain("The working tree has uncommitted changes.");
  });

  it("locks a background project to an isolated worktree and says why", () => {
    render({
      isolation: "worktree",
      isolationReason: "The working tree is clean.",
      worktreeOnly: true,
      worktreeOnlyReason:
        "This project is not the active tab, so the agent only runs in an isolated worktree.",
    });

    expect(trigger(CHECKOUT_ID).disabled).toBe(true);
    expect(pickerValue(CHECKOUT_ID)).toBe("worktree");
    expect(host.textContent).toContain("only runs in an isolated worktree");
    expect(host.textContent).not.toContain("The working tree is clean.");
  });

  it("shows the thread's checkout as a locked chip in follow-up mode", () => {
    render({
      isolation: "worktree",
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
    });

    expect(host.querySelector(`#${CHECKOUT_ID}`)).toBeNull();
    expect(host.querySelector(`#${REPOSITORY_ID}`)).toBeNull();
    const lock = host.querySelector(".agent-composer__lock");
    expect(lock?.textContent).toContain("Isolated worktree");
    expect(lock?.querySelector("button")).toBeNull();
  });

  it("keeps the reply context line and the escape to a new thread", () => {
    const onNewThread = vi.fn();
    render({
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
      onNewThread,
    });

    const context = host.querySelector(".agent-composer__context");
    expect(host.querySelector('form[aria-label="Follow up on agent thread"]')).not.toBeNull();
    expect(context?.textContent).toContain("Replying in");
    expect(context?.querySelector(".agent-composer__chip--thread")?.textContent).toBe(
      "Refactor the parser",
    );
    expect(submitButton().textContent).toContain("Send");

    const escape = context?.querySelector<HTMLButtonElement>(".agent-composer__new");
    expect(escape).not.toBeNull();
    act(() => escape?.click());

    expect(onNewThread).toHaveBeenCalledTimes(1);
  });

  it("collapses every picker into one menu below 620px", () => {
    stubMatchMedia(true);
    render();

    expect(host.querySelector(".agent-composer__footer")).toBeNull();
    expect(host.querySelector(`#${CHECKOUT_ID}`)).toBeNull();
    expect(host.querySelector("#agent-launch-model")).toBeNull();

    const menu = host.querySelector<HTMLButtonElement>(
      'button[aria-label="More composer controls"]',
    );
    expect(menu).not.toBeNull();
    act(() => menu?.click());

    const panel = host.querySelector(".agent-composer__compact-panel");
    expect(panel?.querySelector("#agent-launch-model")).not.toBeNull();
    expect(panel?.querySelector("#agent-launch-effort")).not.toBeNull();
    expect(panel?.querySelector(`#${CHECKOUT_ID}`)).not.toBeNull();
    expect(panel?.querySelector(`#${REPOSITORY_ID}`)).not.toBeNull();
    expect(submitButton()).not.toBeNull();
  });

  it("keeps the locked checkout visible while the compact menu holds the pickers", () => {
    stubMatchMedia(true);
    render({
      isolation: "worktree",
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
    });

    expect(host.querySelector(".agent-composer__lock")?.textContent).toContain("Isolated worktree");
    expect(host.querySelector("#agent-launch-model")).toBeNull();
  });

  it("keeps the byte counter quiet until the prompt nears the cap", () => {
    render({ promptBytes: 6 });

    expect(host.querySelector(".agent-composer__bytes")).toBeNull();

    const near = Math.ceil(MAX_AGENT_TASK_PROMPT_BYTES * 0.8);
    render({ promptBytes: near });

    const counter = host.querySelector(".agent-composer__bytes");
    expect(counter?.textContent).toBe(
      `${formatAgentPromptBytes(near)} / ${formatAgentPromptBytes(MAX_AGENT_TASK_PROMPT_BYTES)}`,
    );
    expect(counter?.getAttribute("aria-label")).toBe(
      `${near} of ${MAX_AGENT_TASK_PROMPT_BYTES} bytes`,
    );
    expect(host.querySelector(".agent-composer__bytes--over")).toBeNull();

    render({ promptBytes: MAX_AGENT_TASK_PROMPT_BYTES + 1 });

    expect(host.querySelector(".agent-composer__bytes--over")).not.toBeNull();
  });

  it("formats the byte counter with thin-space groups on one line", () => {
    expect(formatAgentPromptBytes(32768)).toBe("32\u202f768");
    expect(formatAgentPromptBytes(999)).toBe("999");
  });

  it("shows the submit shortcut on the primary button without naming the button after it", () => {
    render({});

    const kbd = submitButton().querySelector("kbd.agent-composer__kbd");
    expect(kbd?.textContent).toMatch(/↩$/);
    expect(kbd?.getAttribute("aria-hidden")).toBe("true");
    expect(kbd?.getAttribute("aria-label")).toBeNull();
    expect(submitButton().getAttribute("aria-keyshortcuts")).toMatch(/\+Enter$/);
  });

  it("requires an explicit confirmation for an unsafe in-place run", () => {
    const onUnsafeConfirmedChange = vi.fn();
    render({
      isolation: "in-place",
      guard: { kind: "unsafe", reasons: ["dirty-tree", "dirty-editors"] },
      onUnsafeConfirmedChange,
      submitBlocked: true,
    });

    expect(host.textContent).toContain("Running in place can overwrite your work");
    expect(host.textContent).toContain("the working tree has uncommitted changes");
    expect(host.textContent).toContain("unsaved editors belong to this repository");
    expect(submitButton().disabled).toBe(true);

    toggleCheckbox("agent-unsafe-confirm", true);

    expect(onUnsafeConfirmedChange).toHaveBeenCalledWith(true);
  });

  it("hides the unsafe confirmation for a worktree run and in follow-up mode", () => {
    render({ isolation: "worktree", guard: { kind: "unsafe", reasons: ["dirty-tree"] } });

    expect(host.textContent).not.toContain("Running in place can overwrite your work");

    render({
      guard: { kind: "unsafe", reasons: ["dirty-tree"] },
      isolation: "in-place",
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
    });

    expect(host.textContent).not.toContain("Running in place can overwrite your work");
  });

  it("submits the prompt from the form and with the platform accelerator", () => {
    const onSubmit = vi.fn();
    render({ onSubmit, prompt: "Fix it" });

    submitForm();
    pressAccelerator();

    expect(onSubmit).toHaveBeenCalledTimes(2);

    render({ onSubmit, prompt: "Fix it", submitBlocked: true });
    pressAccelerator();

    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("reports the dispatch in flight", () => {
    render({ dispatching: true, submitBlocked: true });

    expect(submitButton().textContent).toContain("Starting…");
    expect(submitButton().disabled).toBe(true);
    expect(trigger(CHECKOUT_ID).disabled).toBe(true);

    render({
      dispatching: true,
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
      submitBlocked: true,
    });

    expect(submitButton().textContent).toContain("Sending…");
  });

  it("disables the follow-up and states the blocking reason", () => {
    const onSubmit = vi.fn();
    render({
      mode: {
        kind: "followUp",
        threadTitle: "Refactor the parser",
        blockedReason: "This thread has no resumable session; start a new thread.",
      },
      onSubmit,
      prompt: "Also update the tests",
    });

    expect(submitButton().disabled).toBe(true);
    expect(host.querySelector(".agent-composer__reason")?.textContent).toBe(
      "This thread has no resumable session; start a new thread.",
    );

    submitForm();
    pressAccelerator();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the model, effort and mode pickers in both composer modes", () => {
    render({ launch: { provider: "claudeCode", model: "opus", mode: "plan", effort: "high" } });

    expect(pickerValue("agent-launch-model")).toBe("opus");
    expect(pickerValue("agent-launch-effort")).toBe("high");
    expect(pickerValue("agent-launch-mode")).toBe("plan");
    expect(host.querySelector("#agent-launch-mode")?.textContent).toContain("Plan only");
    expect(
      host.querySelector("#agent-launch-mode")?.classList.contains("agent-picker__trigger--plan"),
    ).toBe(true);

    render({
      launch: { provider: "codex", model: "gpt-5.5", mode: "readOnly" },
      launchProvider: "codex",
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
    });

    expect(pickerValue("agent-launch-model")).toBe("gpt-5.5");
    expect(pickerValue("agent-launch-mode")).toBe("readOnly");
    expect(host.querySelector("#agent-launch-effort")).toBeNull();
  });

  it("reports a picked model as a whole launch value", () => {
    const onLaunchChange = vi.fn();
    render({ onLaunchChange });

    pickOption("agent-launch-model", "sonnet");

    expect(onLaunchChange).toHaveBeenCalledWith({
      provider: "claudeCode",
      model: "sonnet",
      mode: "default",
      effort: "default",
    });
  });

  it("falls back to the defaults of the configured provider when the launch is stale", () => {
    const onSubmit = vi.fn();
    render({
      launch: {
        provider: "claudeCode",
        model: "opus",
        mode: "bypassPermissions",
        effort: "default",
      },
      launchProvider: "codex",
      onSubmit,
      prompt: "Fix it",
    });

    expect(pickerOptionValues("agent-launch-mode")).toEqual([
      "default",
      "readOnly",
      "workspaceWrite",
      "dangerFullAccess",
    ]);
    expect(host.querySelector(".agent-composer__danger")).toBeNull();
    expect(submitButton().disabled).toBe(false);

    submitForm();

    expect(onSubmit).toHaveBeenCalledWith({
      launch: { provider: "codex", model: "default", mode: "default" },
      dangerousLaunchConfirmed: false,
    });
  });

  it("blocks a dangerous launch until it is confirmed for this submission", () => {
    const onSubmit = vi.fn();
    const onDangerousConfirmedChange = vi.fn();
    const dangerous = {
      provider: "claudeCode",
      model: "opus",
      mode: "bypassPermissions",
      effort: "default",
    } as const;
    render({ launch: dangerous, onDangerousConfirmedChange, onSubmit, prompt: "Fix it" });

    expect(host.querySelector(".agent-composer__danger")?.textContent).toContain(
      "Bypasses permission checks",
    );
    expect(submitButton().disabled).toBe(true);

    submitForm();
    pressAccelerator();

    expect(onSubmit).not.toHaveBeenCalled();

    toggleCheckbox("agent-launch-danger-confirm", true);

    expect(onDangerousConfirmedChange).toHaveBeenCalledWith(true);

    render({ dangerousConfirmed: true, launch: dangerous, onSubmit, prompt: "Fix it" });

    expect(submitButton().disabled).toBe(false);

    submitForm();

    expect(onSubmit).toHaveBeenCalledWith({
      launch: dangerous,
      dangerousLaunchConfirmed: true,
    });
  });

  it("never claims a confirmation for a launch that is not dangerous", () => {
    const onSubmit = vi.fn();
    render({
      dangerousConfirmed: true,
      launch: { provider: "codex", model: "gpt-5.4", mode: "workspaceWrite" },
      launchProvider: "codex",
      onSubmit,
      prompt: "Fix it",
    });

    submitForm();

    expect(onSubmit).toHaveBeenCalledWith({
      launch: { provider: "codex", model: "gpt-5.4", mode: "workspaceWrite" },
      dangerousLaunchConfirmed: false,
    });
  });

  it("carries the newly chosen launch into a follow-up submission", () => {
    const onSubmit = vi.fn();
    render({
      launch: { provider: "claudeCode", model: "sonnet", mode: "acceptEdits", effort: "max" },
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
      onSubmit,
      prompt: "Also update the tests",
    });

    pressAccelerator();

    expect(onSubmit).toHaveBeenCalledWith({
      launch: { provider: "claudeCode", model: "sonnet", mode: "acceptEdits", effort: "max" },
      dangerousLaunchConfirmed: false,
    });
  });

  function render(overrides: Partial<AgentComposerProps> = {}): void {
    act(() => root.render(<AgentComposer {...defaultProps()} {...overrides} />));
  }

  function checkbox(id: string): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(`input#${id}`);
    expect(element).not.toBeNull();
    return element ?? document.createElement("input");
  }

  function submitButton(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function toggleCheckbox(id: string, checked: boolean): void {
    const element = checkbox(id);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set?.call(
        element,
        checked,
      );
      element.dispatchEvent(new Event("click", { bubbles: true }));
    });
  }

  function trigger(id: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button#${id}`);
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function pickerValue(id: string): string {
    return trigger(id).dataset.value ?? "";
  }

  function openPicker(id: string): void {
    act(() => trigger(id).click());
  }

  function pickerOptions(id: string): ReadonlyArray<HTMLElement> {
    openPicker(id);
    const options = [...host.querySelectorAll<HTMLElement>(`#${id}-list [role="option"]`)];
    act(() => trigger(id).click());
    return options;
  }

  function pickerOptionValues(id: string): ReadonlyArray<string> {
    return pickerOptions(id).map((option) => option.dataset.value ?? "");
  }

  function pickerOptionLabels(id: string): ReadonlyArray<string> {
    return pickerOptions(id).map(
      (option) => option.querySelector(".agent-picker__label")?.textContent ?? "",
    );
  }

  function pickOption(id: string, value: string): void {
    openPicker(id);
    const option = host.querySelector<HTMLElement>(
      `#${id}-list [role="option"][data-value="${value}"]`,
    );
    expect(option).not.toBeNull();
    act(() => option?.click());
  }

  function submitForm(): void {
    const form = host.querySelector("form");
    expect(form).not.toBeNull();
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  function pressAccelerator(): void {
    const textarea = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
    expect(textarea).not.toBeNull();
    act(() => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          metaKey: true,
        }),
      );
    });
  }
});

const CHECKOUT_ID = "agent-checkout";
const REPOSITORY_ID = "agent-repository";

function stubMatchMedia(matches: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

function repo(repositoryRoot: string, label: string): AgentComposerRepositoryOption {
  return { repositoryRoot, label };
}

function target(): AgentComposerTarget {
  return {
    projectLabel: "app",
    repositoryOptions: [
      repo("/workspace/app", "app"),
      repo("/workspace/app/packages/api", "packages/api"),
    ],
    selectedRepositoryRoot: "/workspace/app",
  };
}

function defaultProps(): AgentComposerProps {
  return {
    target: target(),
    prompt: "",
    promptBytes: 0,
    isolation: "in-place",
    isolationReason: null,
    worktreeOnly: false,
    worktreeOnlyReason: null,
    guard: { kind: "safe" },
    unsafeConfirmed: false,
    launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
    launchProvider: "claudeCode",
    dangerousConfirmed: false,
    dispatching: false,
    submitBlocked: false,
    mode: { kind: "new" },
    onSelectRepository: () => undefined,
    onPromptChange: () => undefined,
    onIsolationChange: () => undefined,
    onUnsafeConfirmedChange: () => undefined,
    onLaunchChange: () => undefined,
    onDangerousConfirmedChange: () => undefined,
    onNewThread: () => undefined,
    onSubmit: () => undefined,
  };
}
