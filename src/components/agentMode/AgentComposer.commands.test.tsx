// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentComposer, type AgentComposerProps } from "./AgentComposer";

describe("composer command integration", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: AgentComposerProps;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    props = {
      target: {
        projectLabel: "app",
        projectRoot: "/workspace/app",
        selectedRepositoryRoot: "/workspace/app",
        repositoryOptions: [],
      },
      prompt: "",
      promptBytes: 0,
      isolation: "in-place",
      isolationReason: null,
      worktreeAvailable: true,
      worktreeOnly: false,
      worktreeOnlyReason: null,
      guard: { kind: "safe" },
      launch: { provider: "claudeCode", model: "opus", mode: "default", effort: "default" },
      launchProvider: "claudeCode",
      dispatching: false,
      submitBlocked: false,
      providerEnabled: { claudeCode: true, codex: true },
      mode: { kind: "new" },
      onSelectRepository: vi.fn(),
      onPromptChange: vi.fn(),
      onIsolationChange: vi.fn(),
      onLaunchChange: vi.fn(),
      onNewThread: vi.fn(),
      onOpenProviderSettings: vi.fn(),
      onSubmit: vi.fn(),
      onCompactContext: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Reflect.deleteProperty(window, "matchMedia");
  });

  function Controlled() {
    const [prompt, setPrompt] = useState(props.prompt);
    return (
      <AgentComposer
        {...props}
        prompt={prompt}
        promptBytes={new TextEncoder().encode(prompt).length}
        onPromptChange={(next) => {
          props.onPromptChange(next);
          setPrompt(next);
        }}
      />
    );
  }

  function mount(prompt: string) {
    props = { ...props, prompt };
    act(() => root.render(<Controlled />));
    act(() => textarea().focus());
  }

  function textarea(): HTMLTextAreaElement {
    const result = host.querySelector("textarea");
    if (result === null) throw new Error("Missing prompt");
    return result;
  }

  function key(key: string, options: KeyboardEventInit = {}) {
    act(() =>
      textarea().dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...options }),
      ),
    );
  }

  it("opens the real model picker from filtered suggestions without sending a turn", () => {
    mount("/mod");
    expect(
      document.querySelector('[role="listbox"][aria-label="Composer commands"]'),
    ).not.toBeNull();
    key("Enter");
    expect(host.querySelector('[role="dialog"][aria-label="Agent model"]')).not.toBeNull();
    expect(textarea().value).toBe("");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("opens permissions from the compact composer with one command", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    mount("/permissions");
    key("Enter", { metaKey: true });
    expect(
      host.querySelector('[role="listbox"][aria-label="Agent permission mode"]'),
    ).not.toBeNull();
    expect(
      host
        .querySelector('[role="listbox"][aria-label="Agent permission mode"]')
        ?.contains(document.activeElement),
    ).toBe(true);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("selects plan mode locally without overwriting model choice", () => {
    mount("/plan");
    key("Tab");
    expect(props.onLaunchChange).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claudeCode", model: "opus", mode: "plan" }),
    );
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(textarea().value).toBe("");
  });

  it("keeps provider settings reachable when providers are disabled", () => {
    props = { ...props, providerEnabled: { claudeCode: false, codex: false }, submitBlocked: true };
    mount("/settings");
    key("Enter", { metaKey: true });
    expect(props.onOpenProviderSettings).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("prepares compaction then explicitly submits it exactly once", () => {
    props = { ...props, mode: { kind: "followUp", threadTitle: "Existing", blockedReason: null } };
    mount("/compact");
    key("Enter");
    expect(textarea().value).toBe("/compact ");
    expect(props.onCompactContext).not.toHaveBeenCalled();
    key("Enter", { metaKey: true });
    expect(props.onCompactContext).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("allows typing but cannot dispatch a normal prompt with all providers disabled", () => {
    props = { ...props, providerEnabled: { claudeCode: false, codex: false } };
    mount("Make changes");
    expect(textarea().disabled).toBe(false);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    key("Enter", { metaKey: true });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("handles an exact command from the send button when starting a turn is blocked", () => {
    props = { ...props, target: null, submitBlocked: true };
    mount("/settings");
    const send = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(send?.disabled).toBe(false);
    act(() => send?.click());
    expect(props.onOpenProviderSettings).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("clears the command before preparing a new thread", () => {
    mount("/new");
    key("Enter", { metaKey: true });
    expect(props.onNewThread).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe("");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("hides Claude-only commands when composing with Codex", () => {
    props = {
      ...props,
      launchProvider: "codex",
      launch: { provider: "codex", model: "default", mode: "default" },
      mode: { kind: "followUp", threadTitle: "Existing", blockedReason: null },
    };
    mount("/");
    const list = document.querySelector('[role="listbox"][aria-label="Composer commands"]');
    expect(list?.textContent).toContain("/model");
    expect(list?.textContent).not.toContain("/plan");
    expect(list?.textContent).not.toContain("/reasoning");
    expect(list?.textContent).not.toContain("/compact");
    expect(list?.textContent).not.toContain("/btw");
  });

  it("never starts compaction while the selected thread blocks new turns", () => {
    props = {
      ...props,
      mode: { kind: "followUp", threadTitle: "Working", blockedReason: "A turn is running." },
    };
    mount("/compact");
    key("Enter", { metaKey: true });
    expect(props.onCompactContext).not.toHaveBeenCalled();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("preserves text when suggestions close and does not treat IME Enter as submission", () => {
    mount("/model");
    key("Enter", { metaKey: true, isComposing: true });
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(textarea().value).toBe("/model");
    key("Escape");
    expect(document.querySelector('[role="listbox"][aria-label="Composer commands"]')).toBeNull();
    expect(textarea().value).toBe("/model");
  });

  it("leaves a command with arguments on the ordinary prompt path", () => {
    mount("/custom review this");
    key("Enter", { metaKey: true });
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onNewThread).not.toHaveBeenCalled();
    expect(props.onLaunchChange).not.toHaveBeenCalled();
  });
});
