// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "../../domain/agentTask";
import { AgentComposer, type AgentComposerProps } from "./AgentComposer";

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

  it("reports the prompt size in UTF-8 bytes and warns above the cap", () => {
    render({ promptBytes: 6 });

    expect(host.textContent).toContain(`6 / ${MAX_AGENT_TASK_PROMPT_BYTES} bytes`);

    render({ promptBytes: MAX_AGENT_TASK_PROMPT_BYTES + 1 });

    expect(host.querySelector(".agent-composer__bytes--over")).not.toBeNull();
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
    dispatching: false,
    submitBlocked: false,
    mode: { kind: "new" },
    onSelectProject: () => undefined,
    onSelectRepository: () => undefined,
    onPromptChange: () => undefined,
    onIsolationChange: () => undefined,
    onUnsafeConfirmedChange: () => undefined,
    onNewThread: () => undefined,
    onSubmit: () => undefined,
  };
}
