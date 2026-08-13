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

  it("lists every repository and reflects the selected one", () => {
    render();

    const select = host.querySelector<HTMLSelectElement>("select#agent-repository");

    expect([...(select?.options ?? [])].map((option) => option.textContent)).toEqual([
      "app",
      "packages/api",
    ]);
    expect(select?.value).toBe("/workspace/app");
  });

  it("explains an empty repository list instead of offering a blank picker", () => {
    render({ repositories: [], selectedRepositoryRoot: null });

    expect(host.textContent).toContain("No Git repository detected");
  });

  it("changes the repository of the next thread", () => {
    const onSelectRepository = vi.fn();
    render({ onSelectRepository });

    selectValue("/workspace/app/packages/api");

    expect(onSelectRepository).toHaveBeenCalledWith("/workspace/app/packages/api");
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

  function selectValue(value: string): void {
    const element = host.querySelector<HTMLSelectElement>("select#agent-repository");
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

function defaultProps(): AgentComposerProps {
  return {
    repositories: [
      { repositoryRoot: "/workspace/app", label: "app" },
      { repositoryRoot: "/workspace/app/packages/api", label: "packages/api" },
    ],
    selectedRepositoryRoot: "/workspace/app",
    prompt: "",
    promptBytes: 0,
    isolation: "in-place",
    isolationReason: null,
    guard: { kind: "safe" },
    unsafeConfirmed: false,
    dispatching: false,
    submitBlocked: false,
    onSelectRepository: () => undefined,
    onPromptChange: () => undefined,
    onIsolationChange: () => undefined,
    onUnsafeConfirmedChange: () => undefined,
    onSubmit: () => undefined,
  };
}
