// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "../../domain/agentTask";
import { AgentComposer, type AgentComposerProps } from "./AgentComposer";
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
  });

  it("lists every repository of the selected project and reflects the selection", () => {
    render();

    const select = host.querySelector<HTMLSelectElement>("select#agent-repository");

    expect([...(select?.options ?? [])].map((option) => option.textContent)).toEqual([
      "app",
      "packages/api",
    ]);
    expect(select?.value).toBe("/workspace/app");
    expect(host.querySelector(".agent-composer__chip")?.textContent).toContain("app");
  });

  it("keeps the picker one level deep while a single project holds a single repository", () => {
    render({
      projects: [{ projectRootKey: "/workspace/app", label: "app", repositories: [repo("app")] }],
      selectedRepositoryRoot: "/workspace/app",
    });

    expect(host.querySelector("select#agent-project")).toBeNull();
    expect(host.querySelector("select#agent-repository")).toBeNull();
    expect(host.querySelector(".agent-composer__chip")?.textContent).toBe("app");
  });

  it("offers a project level as soon as a second project is dispatchable", () => {
    render({
      projects: [
        { projectRootKey: "/workspace/app", label: "app", repositories: [repo("app")] },
        {
          projectRootKey: "/workspace/api",
          label: "api-service",
          repositories: [{ repositoryRoot: "/workspace/api", label: "api-service" }],
        },
      ],
      selectedRepositoryRoot: "/workspace/app",
    });

    const select = host.querySelector<HTMLSelectElement>("select#agent-project");

    expect([...(select?.options ?? [])].map((option) => option.textContent)).toEqual([
      "app",
      "api-service",
    ]);
    expect(select?.value).toBe("/workspace/app");
    expect(host.querySelector("select#agent-repository")).toBeNull();
  });

  it("names both levels in the chip when neither level has a picker", () => {
    render({
      projects: [
        {
          projectRootKey: "/workspace/app",
          label: "monorepo",
          repositories: [{ repositoryRoot: "/workspace/app/packages/api", label: "packages/api" }],
        },
      ],
      selectedRepositoryRoot: "/workspace/app/packages/api",
    });

    expect(host.querySelector(".agent-composer__chip")?.textContent).toBe("monorepo/packages/api");
  });

  it("drops the chip once both levels are already visible as pickers", () => {
    render({
      projects: [
        {
          projectRootKey: "/workspace/app",
          label: "app",
          repositories: [
            { repositoryRoot: "/workspace/app", label: "app" },
            { repositoryRoot: "/workspace/app/packages/api", label: "packages/api" },
          ],
        },
        {
          projectRootKey: "/workspace/api",
          label: "api-service",
          repositories: [{ repositoryRoot: "/workspace/api", label: "api-service" }],
        },
      ],
      selectedRepositoryRoot: "/workspace/app",
    });

    expect(host.querySelector("select#agent-project")).not.toBeNull();
    expect(host.querySelector("select#agent-repository")).not.toBeNull();
    expect(host.querySelector(".agent-composer__chip")).toBeNull();
  });

  it("explains an empty repository list instead of offering a blank picker", () => {
    render({
      projects: [{ projectRootKey: "/workspace/app", label: "app", repositories: [] }],
      selectedRepositoryRoot: null,
    });

    expect(host.textContent).toContain("No Git repository detected");
    expect(host.querySelector("select#agent-repository")).toBeNull();
  });

  it("changes the repository of the next thread", () => {
    const onSelectRepository = vi.fn();
    render({ onSelectRepository });

    selectValue("select#agent-repository", "/workspace/app/packages/api");

    expect(onSelectRepository).toHaveBeenCalledWith("/workspace/app/packages/api");
  });

  it("changes the project of the next thread", () => {
    const onSelectProject = vi.fn();
    render({
      onSelectProject,
      projects: [
        { projectRootKey: "/workspace/app", label: "app", repositories: [repo("app")] },
        {
          projectRootKey: "/workspace/api",
          label: "api-service",
          repositories: [{ repositoryRoot: "/workspace/api", label: "api-service" }],
        },
      ],
      selectedRepositoryRoot: "/workspace/app",
    });

    selectValue("select#agent-project", "/workspace/api");

    expect(onSelectProject).toHaveBeenCalledWith("/workspace/api");
  });

  it("locks a background project to an isolated worktree and says why", () => {
    render({
      isolation: "worktree",
      isolationReason: "The working tree is clean.",
      worktreeOnly: true,
      worktreeOnlyReason:
        "This project is not the active tab, so the agent only runs in an isolated worktree.",
    });

    expect(checkbox("agent-isolation").disabled).toBe(true);
    expect(checkbox("agent-isolation").checked).toBe(true);
    expect(host.textContent).toContain("only runs in an isolated worktree");
    expect(host.textContent).not.toContain("The working tree is clean.");
  });

  it("keeps the isolation toggle usable for the active project", () => {
    render({ isolation: "worktree", isolationReason: "The working tree is clean." });

    expect(checkbox("agent-isolation").disabled).toBe(false);
    expect(host.textContent).toContain("The working tree is clean.");
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

  it("pre-sets the isolation toggle and shows the reason behind the default", () => {
    render({
      isolation: "worktree",
      isolationReason: "The working tree has uncommitted changes.",
    });

    expect(checkbox("agent-isolation").checked).toBe(true);
    expect(host.textContent).toContain("The working tree has uncommitted changes.");
  });

  it("switches isolation when the toggle is used", () => {
    const onIsolationChange = vi.fn();
    render({ isolation: "worktree", onIsolationChange });

    toggleCheckbox("agent-isolation", false);

    expect(onIsolationChange).toHaveBeenCalledWith("in-place");
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

  it("hides the unsafe confirmation for a worktree run", () => {
    render({
      isolation: "worktree",
      guard: { kind: "unsafe", reasons: ["dirty-tree"] },
    });

    expect(host.textContent).not.toContain("Running in place can overwrite your work");
  });

  it("submits the prompt from the form", () => {
    const onSubmit = vi.fn();
    render({ onSubmit, prompt: "Fix it" });

    submitForm();

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits with the platform accelerator and never while blocked", () => {
    const onSubmit = vi.fn();
    render({ onSubmit, prompt: "Fix it" });

    pressAccelerator();

    expect(onSubmit).toHaveBeenCalledTimes(1);

    render({ onSubmit, prompt: "Fix it", submitBlocked: true });
    pressAccelerator();

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("reports the dispatch in flight", () => {
    render({ dispatching: true, submitBlocked: true });

    expect(submitButton().textContent).toContain("Starting…");
    expect(submitButton().disabled).toBe(true);
  });

  it("names the target above the prompt for a new thread", () => {
    render({});

    const context = host.querySelector(".agent-composer__context");
    expect(context?.textContent).toContain("Starting in");
    expect(context?.querySelector("input#agent-isolation")).not.toBeNull();
    expect(context?.nextElementSibling?.nextElementSibling?.id).toBe("agent-prompt");
  });

  it("hides the target and isolation controls in follow-up mode", () => {
    render({
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
    });

    expect(host.querySelector('form[aria-label="Follow up on agent thread"]')).not.toBeNull();
    expect(host.querySelector("select#agent-project")).toBeNull();
    expect(host.querySelector("select#agent-repository")).toBeNull();
    expect(host.querySelector("input#agent-isolation")).toBeNull();
    expect(host.querySelector(".agent-composer__chip--thread")?.textContent).toBe(
      "Refactor the parser",
    );
    expect(host.querySelector(".agent-composer__context")?.textContent).toContain("Replying in");
    expect(host.querySelector(".agent-composer__context .agent-composer__new")).not.toBeNull();
    expect(submitButton().textContent).toContain("Send");
  });

  it("keeps the unsafe in-place confirmation out of follow-up mode", () => {
    render({
      guard: { kind: "unsafe", reasons: ["dirty-tree"] },
      isolation: "in-place",
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
    });

    expect(host.textContent).not.toContain("Running in place can overwrite your work");
  });

  it("escapes back to a new thread from follow-up mode", () => {
    const onNewThread = vi.fn();
    render({
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
      onNewThread,
    });

    const escape = host.querySelector<HTMLButtonElement>(".agent-composer__new");
    expect(escape).not.toBeNull();
    act(() => escape?.click());

    expect(onNewThread).toHaveBeenCalledTimes(1);
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

  it("reports the follow-up in flight", () => {
    render({
      dispatching: true,
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
      submitBlocked: true,
    });

    expect(submitButton().textContent).toContain("Sending…");
  });

  it("keeps the model and mode pickers in both composer modes", () => {
    render({ launch: { provider: "claudeCode", model: "opus", mode: "plan" } });

    expect(pickerValue("agent-launch-model")).toBe("opus");
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
  });

  it("reports a picked model as a whole launch value", () => {
    const onLaunchChange = vi.fn();
    render({ onLaunchChange });

    pickOption("agent-launch-model", "sonnet");

    expect(onLaunchChange).toHaveBeenCalledWith({
      provider: "claudeCode",
      model: "sonnet",
      mode: "default",
    });
  });

  it("falls back to the defaults of the configured provider when the launch is stale", () => {
    const onSubmit = vi.fn();
    render({
      launch: { provider: "claudeCode", model: "opus", mode: "bypassPermissions" },
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
    render({
      launch: { provider: "claudeCode", model: "opus", mode: "bypassPermissions" },
      onDangerousConfirmedChange,
      onSubmit,
      prompt: "Fix it",
    });

    expect(host.querySelector(".agent-composer__danger")?.textContent).toContain(
      "Bypasses permission checks",
    );
    expect(submitButton().disabled).toBe(true);

    submitForm();
    pressAccelerator();

    expect(onSubmit).not.toHaveBeenCalled();

    toggleCheckbox("agent-launch-danger-confirm", true);

    expect(onDangerousConfirmedChange).toHaveBeenCalledWith(true);

    render({
      dangerousConfirmed: true,
      launch: { provider: "claudeCode", model: "opus", mode: "bypassPermissions" },
      onSubmit,
      prompt: "Fix it",
    });

    expect(submitButton().disabled).toBe(false);

    submitForm();

    expect(onSubmit).toHaveBeenCalledWith({
      launch: { provider: "claudeCode", model: "opus", mode: "bypassPermissions" },
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
      launch: { provider: "claudeCode", model: "sonnet", mode: "acceptEdits" },
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
      onSubmit,
      prompt: "Also update the tests",
    });

    pressAccelerator();

    expect(onSubmit).toHaveBeenCalledWith({
      launch: { provider: "claudeCode", model: "sonnet", mode: "acceptEdits" },
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

  function selectValue(selector: string, value: string): void {
    const element = host.querySelector<HTMLSelectElement>(selector);
    expect(element).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        element,
        value,
      );
      element?.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function pickerValue(id: string): string {
    const trigger = host.querySelector<HTMLButtonElement>(`button#${id}`);
    expect(trigger).not.toBeNull();
    return trigger?.dataset.value ?? "";
  }

  function openPicker(id: string): void {
    const trigger = host.querySelector<HTMLButtonElement>(`button#${id}`);
    expect(trigger).not.toBeNull();
    act(() => trigger?.click());
  }

  function pickerOptionValues(id: string): ReadonlyArray<string> {
    openPicker(id);
    const values = [...host.querySelectorAll<HTMLElement>(`#${id}-list [role="option"]`)].map(
      (option) => option.dataset.value ?? "",
    );
    act(() => host.querySelector<HTMLButtonElement>(`button#${id}`)?.click());
    return values;
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

function repo(label: string): { readonly repositoryRoot: string; readonly label: string } {
  return { repositoryRoot: "/workspace/app", label };
}

function defaultProps(): AgentComposerProps {
  return {
    projects: [
      {
        projectRootKey: "/workspace/app",
        label: "app",
        repositories: [
          { repositoryRoot: "/workspace/app", label: "app" },
          { repositoryRoot: "/workspace/app/packages/api", label: "packages/api" },
        ],
      },
    ],
    selectedProjectRootKey: "/workspace/app",
    selectedRepositoryRoot: "/workspace/app",
    prompt: "",
    promptBytes: 0,
    isolation: "in-place",
    isolationReason: null,
    worktreeOnly: false,
    worktreeOnlyReason: null,
    guard: { kind: "safe" },
    unsafeConfirmed: false,
    launch: { provider: "claudeCode", model: "default", mode: "default" },
    launchProvider: "claudeCode",
    dangerousConfirmed: false,
    dispatching: false,
    submitBlocked: false,
    mode: { kind: "new" },
    onSelectProject: () => undefined,
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
