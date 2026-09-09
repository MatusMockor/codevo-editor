// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult } from "../../domain/agentSettings";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "../../domain/agentTask";
import {
  AgentComposer,
  type AgentComposerProps,
  type AgentComposerRepositoryOption,
  type AgentComposerTarget,
} from "./AgentComposer";
import { readAgentModeStyles } from "./agentModeCssTestSupport";
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

  it("keeps the nested repositories inside the checkout menu instead of a Repo picker", () => {
    render();

    expect(host.querySelector(`#${REPOSITORY_ID}`)).toBeNull();
    expect(host.querySelector(".agent-composer__row .agent-picker__prefix")).toBeNull();
    expect(pickerOptionLabels(CHECKOUT_ID)).toEqual([
      "Local checkout",
      "Isolated worktree",
      "app",
      "packages/api",
    ]);
    expect(pickerGroupHeadings(CHECKOUT_ID)).toEqual(["Run in repository"]);
    const selectedOptions = pickerOptions(CHECKOUT_ID).filter(
      (option) => option.getAttribute("aria-selected") === "true",
    );
    expect(selectedOptions).toHaveLength(2);
    expect(selectedOptions[0]?.textContent).toContain("Local checkout");
    expect(selectedOptions[1]?.textContent).toBe("appProject folder");
    expect(pickerOptionDescriptions(CHECKOUT_ID)).toEqual([
      "Runs in app.",
      "Runs in a new git worktree of app.",
      "Project folder",
      "",
    ]);
    expect(host.querySelector("[data-agent-composer-target]")).toBeNull();

    render({ target: { ...target(), repositoryOptions: [] } });

    expect(pickerOptionLabels(CHECKOUT_ID)).toEqual(["Local checkout", "Isolated worktree"]);
    expect(pickerGroupHeadings(CHECKOUT_ID)).toEqual([]);
  });

  it("changes the repository of the next thread from the checkout menu and names it", () => {
    const onSelectRepository = vi.fn();
    const onIsolationChange = vi.fn();
    render({ onIsolationChange, onSelectRepository });

    pickOption(CHECKOUT_ID, "root:/workspace/app/packages/api");

    expect(onSelectRepository).toHaveBeenCalledWith("/workspace/app/packages/api");
    expect(onIsolationChange).not.toHaveBeenCalled();

    render({
      target: { ...target(), selectedRepositoryRoot: "/workspace/app/packages/api" },
    });

    expect(host.querySelector("[data-agent-composer-target]")?.textContent).toBe(
      "Repository:in packages/api",
    );
    expect(pickerOptionDescriptions(CHECKOUT_ID)[0]).toBe("Runs in packages/api.");
    openPicker(CHECKOUT_ID);
    const menu = host.querySelector('[role="listbox"][aria-label="Checkout for this thread"]');
    expect(menu?.getAttribute("aria-multiselectable")).toBe("true");
    const selected = [...(menu?.querySelectorAll('[role="option"][aria-selected="true"]') ?? [])];
    expect(selected).toHaveLength(2);
    expect(selected[0]?.textContent).toContain("Local checkout");
    expect(selected[1]?.textContent).toBe("packages/api");
    expect(
      menu?.querySelector('[data-value="root:/workspace/app"]')?.getAttribute("aria-selected"),
    ).toBe("false");
    act(() => trigger(CHECKOUT_ID).click());
  });

  it("offers only the local checkout when the target is not a Git repository", () => {
    const onIsolationChange = vi.fn();
    render({ onIsolationChange, worktreeAvailable: false });

    expect(pickerOptionLabels(CHECKOUT_ID)).toEqual(["Local checkout", "app", "packages/api"]);
    expect(pickerValue(CHECKOUT_ID)).toBe("in-place");
    expect(
      host.querySelector(`#${CHECKOUT_ID}-list [role="option"][data-value="worktree"]`),
    ).toBeNull();

    render({ onIsolationChange, prompt: "Fix it", worktreeAvailable: false });
    expect(submitButton().disabled).toBe(false);
  });

  it("refreshes repository status when the checkout menu opens with mouse or keyboard", () => {
    const onRefreshIsolation = vi.fn();
    render({ onRefreshIsolation, worktreeAvailable: false });
    openPicker(CHECKOUT_ID);
    expect(onRefreshIsolation).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="option"][data-value="worktree"]')).toBeNull();
    render({ onRefreshIsolation, worktreeAvailable: true });
    expect(host.querySelector('[role="option"][data-value="worktree"]')?.textContent).toContain(
      "Isolated worktree",
    );
    act(() => trigger(CHECKOUT_ID).click());
    act(() => {
      trigger(CHECKOUT_ID).dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    expect(onRefreshIsolation).toHaveBeenCalledTimes(2);
    render({ onRefreshIsolation, worktreeAvailable: false });
    expect(host.querySelector('[role="option"][data-value="worktree"]')).toBeNull();
  });

  it("keeps status refresh reachable for a background plain folder without nested repositories", () => {
    const onRefreshIsolation = vi.fn();
    render({
      onRefreshIsolation,
      isolation: "worktree",
      worktreeOnly: true,
      worktreeAvailable: false,
      target: { ...target(), repositoryOptions: [] },
    });
    expect(trigger(CHECKOUT_ID).disabled).toBe(false);
    openPicker(CHECKOUT_ID);
    expect(onRefreshIsolation).toHaveBeenCalledTimes(1);
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

  it("blocks submission when the selected provider is disabled", () => {
    const onSubmit = vi.fn();
    const onOpenProviderSettings = vi.fn();
    render({
      onSubmit,
      onOpenProviderSettings,
      prompt: "Fix it",
      providerEnabled: { claudeCode: false, codex: false },
      providerManagement: disabledProvidersManagement(),
    });

    expect(submitButton().disabled).toBe(true);
    expect(host.querySelector(".agent-composer__reason")?.textContent).toContain(
      "Enable an agent provider in Settings before starting a turn.",
    );
    expect(trigger("agent-launch-model").disabled).toBe(true);
    expect(trigger("agent-launch-effort").disabled).toBe(true);
    expect(trigger("agent-launch-mode").disabled).toBe(true);
    expect(trigger(CHECKOUT_ID).disabled).toBe(true);
    expect(host.querySelector<HTMLTextAreaElement>("#agent-prompt")?.disabled).toBe(false);
    const settings = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Open provider settings",
    );
    act(() => settings?.click());
    expect(onOpenProviderSettings).toHaveBeenCalledTimes(1);
    submitForm();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables unsafe in-place confirmation when all providers are disabled", () => {
    render({
      guard: { kind: "unsafe", reasons: ["dirty-tree"] },
      prompt: "Fix it",
      providerEnabled: { claudeCode: false, codex: false },
      providerManagement: disabledProvidersManagement(),
    });

    expect(trigger(CHECKOUT_ID).disabled).toBe(true);
    expect(host.querySelector("#agent-unsafe-confirm")).toBeNull();
  });

  it("disables dangerous launch confirmation when all providers are disabled", () => {
    render({
      launch: {
        provider: "claudeCode",
        model: "default",
        mode: "bypassPermissions",
        effort: "default",
      },
      prompt: "Fix it",
      providerEnabled: { claudeCode: false, codex: false },
      providerManagement: disabledProvidersManagement(),
    });

    expect(trigger("agent-launch-mode").disabled).toBe(true);
    expect(host.querySelector("#agent-launch-danger-confirm")).toBeNull();
  });

  it("lets a plain project folder start a thread and states that it runs in place", () => {
    render({
      isolationReason: "Not a Git repository · runs in place",
      prompt: "Fix it",
      target: { ...target(), repositoryOptions: [] },
      worktreeAvailable: false,
    });

    expect(submitButton().disabled).toBe(false);
    expect(host.querySelector(".agent-composer__reason")?.textContent).toBe(
      "Not a Git repository · runs in place",
    );
    expect(host.textContent).not.toContain("uncommitted");
    expect(pickerOptionLabels(CHECKOUT_ID)).toEqual(["Local checkout"]);
  });

  it("picks the checkout in the footer strip attached to the box", () => {
    const onIsolationChange = vi.fn();
    render({ onIsolationChange });

    const box = host.querySelector(".agent-composer__box");
    const footer = host.querySelector(".agent-composer__footer");
    expect(footer?.querySelector(`#${CHECKOUT_ID}`)).not.toBeNull();
    expect(box?.lastElementChild).toBe(footer);
    expect(footer?.querySelector(`#${REPOSITORY_ID}`)).toBeNull();
    expect(pickerValue(CHECKOUT_ID)).toBe("in-place");
    expect(trigger(CHECKOUT_ID).textContent).toContain("Local checkout");
    expect(pickerOptionLabels(CHECKOUT_ID).slice(0, 2)).toEqual([
      "Local checkout",
      "Isolated worktree",
    ]);

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
    const reason = host.querySelector(".agent-composer__reason");
    expect(reason?.textContent).toBe("The working tree has uncommitted changes.");
    expect(reason?.nextElementSibling).toBe(host.querySelector(".agent-composer__footer"));
  });

  it("locks a background project to an isolated worktree and says why", () => {
    render({
      isolation: "worktree",
      isolationReason: "The working tree is clean.",
      worktreeOnly: true,
      worktreeOnlyReason:
        "This project is not the active tab, so the agent only runs in an isolated worktree.",
    });

    expect(trigger(CHECKOUT_ID).disabled).toBe(false);
    expect(pickerValue(CHECKOUT_ID)).toBe("worktree");
    expect(pickerOptionLabels(CHECKOUT_ID)).toEqual(["Isolated worktree", "app", "packages/api"]);
    expect(host.textContent).toContain("only runs in an isolated worktree");
    expect(host.textContent).not.toContain("The working tree is clean.");

    render({
      isolation: "worktree",
      target: { ...target(), repositoryOptions: [] },
      worktreeOnly: true,
      worktreeOnlyReason:
        "This project is not the active tab, so the agent only runs in an isolated worktree.",
    });

    expect(trigger(CHECKOUT_ID).disabled).toBe(true);
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
    const footer = host.querySelector(".agent-composer__footer");
    expect(footer?.contains(lock)).toBe(true);
    expect(host.querySelector(".agent-composer__box")?.lastElementChild).toBe(footer);
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
    expect(submitButton().getAttribute("aria-label")).toBe("Send follow-up");

    const escape = context?.querySelector<HTMLButtonElement>(".agent-composer__new");
    expect(escape).not.toBeNull();
    act(() => escape?.click());

    expect(onNewThread).toHaveBeenCalledTimes(1);
  });

  it("keeps the model picker inline and moves secondary controls into overflow below 560px", () => {
    stubMatchMedia(true);
    render();

    expect(host.querySelector(".agent-composer__footer")).toBeNull();
    expect(host.querySelector(`#${CHECKOUT_ID}`)).toBeNull();
    expect(host.querySelector("#agent-launch-model")).not.toBeNull();

    const menu = host.querySelector<HTMLButtonElement>(
      'button[aria-label="More composer controls"]',
    );
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toBe("");
    expect(menu?.getAttribute("title")).toBe("More composer controls");
    act(() => menu?.click());

    const panel = host.querySelector(".agent-composer__compact-panel");
    expect(panel?.querySelector("#agent-launch-model")).toBeNull();
    expect(panel?.querySelector("#agent-launch-effort")).not.toBeNull();
    expect(panel?.querySelector(`#${CHECKOUT_ID}`)).not.toBeNull();
    expect(panel?.querySelector(`#${REPOSITORY_ID}`)).toBeNull();
    expect(submitButton()).not.toBeNull();
  });

  it("changes models directly and permission and repository through narrow overflow", () => {
    stubMatchMedia(true);
    const onLaunchChange = vi.fn();
    const onSelectRepository = vi.fn();
    render({ onLaunchChange, onSelectRepository });

    pickOption("agent-launch-model", "claude-opus-5");
    expect(onLaunchChange).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus-5" }),
    );
    act(() =>
      host.querySelector<HTMLButtonElement>('button[aria-label="More composer controls"]')?.click(),
    );
    pickOption("agent-launch-mode", "supervised");
    expect(onLaunchChange).toHaveBeenCalledWith(expect.objectContaining({ mode: "supervised" }));
    expect(host.querySelector('[aria-label="Composer controls"]')).not.toBeNull();
    pickOption(CHECKOUT_ID, "root:/workspace/app/packages/api");
    expect(onSelectRepository).toHaveBeenCalledWith("/workspace/app/packages/api");
  });

  it("keeps the model picker mounted while resizing and removes open overflow when widening", () => {
    let matches = false;
    const listeners: Array<() => void> = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        get matches() {
          return matches;
        },
        addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
        removeEventListener: () => undefined,
      }),
    });
    render();
    const model = trigger("agent-launch-model");
    openPicker("agent-launch-model");
    const search = host.querySelector('[aria-label="Search models"]');
    matches = true;
    act(() => listeners.forEach((listener) => listener()));
    expect(trigger("agent-launch-model")).toBe(model);
    expect(host.querySelector('[aria-label="Search models"]')).toBe(search);
    act(() => model.click());
    act(() =>
      host.querySelector<HTMLButtonElement>('button[aria-label="More composer controls"]')?.click(),
    );
    expect(host.querySelector('[aria-label="Composer controls"]')).not.toBeNull();
    matches = false;
    act(() => listeners.forEach((listener) => listener()));
    expect(host.querySelector('[aria-label="Composer controls"]')).toBeNull();
    expect(host.querySelector('button[aria-label="More composer controls"]')).toBeNull();
    expect(trigger("agent-launch-model")).toBe(model);
    expect(host.querySelector("#agent-launch-mode")).not.toBeNull();
    expect(host.querySelector(`#${CHECKOUT_ID}`)).not.toBeNull();
  });

  it("keeps the locked checkout visible while the compact menu holds the pickers", () => {
    stubMatchMedia(true);
    render({
      isolation: "worktree",
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
    });

    expect(host.querySelector(".agent-composer__lock")?.textContent).toContain("Isolated worktree");
    expect(host.querySelector("#agent-launch-model")).not.toBeNull();
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

  it("names the round send button and keeps the shortcut in its tooltip", () => {
    withMacPlatform(() => render({}));

    const button = submitButton();
    expect(button.getAttribute("aria-label")).toBe("Start agent");
    expect(button.title).toBe("Start agent (⌘↩)");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+Enter");
    expect(button.getAttribute("aria-busy")).toBeNull();
    expect(button.querySelector("kbd")).toBeNull();
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.classList.contains("agent-composer__send")).toBe(true);
    expect(button.classList.contains("agent-composer__send--busy")).toBe(false);
  });

  it("shows checkout choices without a second confirmation step", () => {
    render({
      isolation: "in-place",
      guard: { kind: "unsafe", reasons: ["dirty-tree", "dirty-editors"] },
    });

    expect(submitButton().disabled).toBe(false);

    openPicker(CHECKOUT_ID);
    expect(host.textContent).not.toContain("Accept the risk and run locally");
    expect(host.querySelector("input#agent-unsafe-confirm")).toBeNull();
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

    expect(submitButton().getAttribute("aria-label")).toBe("Starting…");
    expect(submitButton().getAttribute("aria-busy")).toBe("true");
    expect(submitButton().title).toMatch(/^Starting… \(.+↩\)$/);
    expect(submitButton().classList.contains("agent-composer__send--busy")).toBe(true);
    expect(submitButton().querySelector(".agent-composer__send-spinner")).not.toBeNull();
    expect(submitButton().disabled).toBe(true);
    expect(trigger(CHECKOUT_ID).disabled).toBe(true);

    render({
      dispatching: true,
      mode: { kind: "followUp", threadTitle: "Refactor the parser", blockedReason: null },
      submitBlocked: true,
    });

    expect(submitButton().getAttribute("aria-label")).toBe("Starting…");
    expect(submitButton().getAttribute("aria-busy")).toBe("true");
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
    render({
      launch: { provider: "claudeCode", model: "opus", mode: "supervised", effort: "high" },
    });

    expect(pickerValue("agent-launch-model")).toBe("opus");
    expect(pickerValue("agent-launch-effort")).toBe("high");
    expect(pickerValue("agent-launch-mode")).toBe("supervised");
    expect(host.querySelector("#agent-launch-mode")?.textContent).toContain("Supervised");
    expect(
      host.querySelector("#agent-launch-mode")?.classList.contains("agent-picker__trigger--ghost"),
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

    pickOption("agent-launch-model", "claude-opus-5");

    expect(onLaunchChange).toHaveBeenCalledWith({
      provider: "claudeCode",
      model: "claude-opus-5",
      mode: "bypassPermissions",
      effort: "high",
      context: "1m",
      fastMode: false,
      thinkingMode: false,
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
      "readOnly",
      "workspaceWrite",
      "auto",
      "dangerFullAccess",
    ]);
    expect(host.querySelector(".agent-composer__danger")).toBeNull();
    expect(submitButton().disabled).toBe(false);

    submitForm();

    expect(onSubmit).toHaveBeenCalledWith({
      launch: { provider: "codex", model: "gpt-5.6-sol", mode: "dangerFullAccess" },
      dangerousLaunchConfirmed: true,
    });
  });

  it("treats choosing full access as the confirmation for this submission", () => {
    const onSubmit = vi.fn();
    const dangerous = {
      provider: "claudeCode",
      model: "opus",
      mode: "bypassPermissions",
      effort: "default",
    } as const;
    render({ launch: dangerous, onSubmit, prompt: "Fix it" });

    expect(host.querySelector(".agent-composer__danger")).toBeNull();
    expect(submitButton().disabled).toBe(false);

    openPicker("agent-launch-mode");
    expect(host.querySelector("input#agent-launch-danger-confirm")).toBeNull();

    submitForm();

    expect(onSubmit).toHaveBeenCalledWith({
      launch: { ...dangerous, effort: "high", context: "1m" },
      dangerousLaunchConfirmed: true,
    });
  });

  it("never claims a confirmation for a launch that is not dangerous", () => {
    const onSubmit = vi.fn();
    render({
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
      launch: {
        provider: "claudeCode",
        model: "sonnet",
        mode: "acceptEdits",
        effort: "max",
        context: "1m",
      },
      dangerousLaunchConfirmed: false,
    });
  });

  it("shows and dismisses a context offer and submits the provider compact command", () => {
    const onCompactContext = vi.fn();
    render({
      compactionOffer: { key: "agt-1:1:120000", contextTokens: 120_000 },
      mode: { kind: "followUp", threadTitle: "Long task", blockedReason: null },
      onCompactContext,
    });

    expect(host.textContent).toContain("Resume with less context");
    expect(host.textContent).toContain("120k tokens from an older session");
    act(() => host.querySelector<HTMLButtonElement>(".agent-compaction-offer__action")?.click());
    expect(onCompactContext).toHaveBeenCalledWith({
      launch: {
        provider: "claudeCode",
        model: "claude-sonnet-5",
        mode: "bypassPermissions",
        effort: "high",
        context: "1m",
      },
      dangerousLaunchConfirmed: true,
    });
    act(() =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Dismiss context compaction suggestion"]')
        ?.click(),
    );
    expect(host.textContent).not.toContain("Resume with less context");
  });

  function render(overrides: Partial<AgentComposerProps> = {}): void {
    act(() => root.render(<AgentComposer {...defaultProps()} {...overrides} />));
  }

  function submitButton(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
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

  function pickerOptionDescriptions(id: string): ReadonlyArray<string> {
    return pickerOptions(id).map(
      (option) => option.querySelector(".agent-picker__description")?.textContent ?? "",
    );
  }

  function pickerGroupHeadings(id: string): ReadonlyArray<string> {
    openPicker(id);
    const headings = [...host.querySelectorAll<HTMLElement>(`#${id}-list .agent-picker__group`)];
    act(() => trigger(id).click());
    return headings.map((heading) => heading.textContent ?? "");
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

describe("AgentComposer Airy styling contract", () => {
  const css = readAgentModeStyles();

  it("centres the composer box at 768px, raised on radius 14 with the card shadow only", () => {
    const box = cssRule(css, "\n.agent-composer__box {");
    expect(box).toContain("max-width: 768px");
    expect(box).toContain("border-radius: var(--agent-radius-xl)");
    expect(box).toContain("box-shadow: var(--agent-shadow-raised)");
    expect(box).toContain("background: var(--agent-composer-surface)");
    expect(box).not.toContain("--agent-composer-outline");
    expect(box).not.toContain("--agent-composer-highlight");
    expect(cssRule(css, "\n.agent-composer__box:focus-within {")).toContain(
      "box-shadow: var(--agent-shadow-raised), var(--codevo-focus-ring)",
    );
    expect(cssRule(css, "\n.agent-composer {")).not.toMatch(/border-top: 1px/);
    expect(cssRule(css, "\n.agent-composer__textarea {")).toContain(
      "font-size: var(--codevo-fs-body)",
    );
    expect(cssRule(css, "\n.agent-composer__context {")).not.toContain("border-bottom");
    expect(cssRule(css, "\n.agent-composer__reason {")).not.toContain("border-top");
  });

  it("renders the send button as a 30px round primary control that idles on the active tone", () => {
    const send = cssRule(css, "\n.agent-composer__send {");
    expect(send).toContain("width: 30px");
    expect(send).toContain("height: 30px");
    expect(send).toContain("border-radius: 999px");
    expect(send).toContain("background: var(--agent-cta-bg)");
    expect(send).toContain("color: var(--agent-cta-fg)");
    expect(cssRule(css, "\n.agent-composer__send:hover:not(:disabled) {")).toContain(
      "background: var(--agent-cta-bg-hover)",
    );
    const idle = cssRule(css, "\n.agent-composer__send:disabled {");
    expect(idle).toContain("background: var(--agent-fill)");
    expect(idle).toContain("color: var(--agent-text-muted)");
    expect(idle).not.toContain("opacity");
    expect(cssRule(css, "\n.agent-composer__send:focus-visible {")).toContain(
      "box-shadow: var(--agent-focus-ring)",
    );
    expect(css).not.toContain(".agent-composer__kbd");
  });

  it("keeps ghost pickers at 28px on radius 8 with the hover tone and a tone divider", () => {
    const ghost = cssRule(css, "\n.agent-picker__trigger--ghost {");
    expect(ghost).toContain("height: 28px");
    expect(ghost).toContain("font-size: 13px");
    expect(ghost).toContain("border-radius: var(--agent-radius-sm)");
    expect(cssRule(css, "\n.agent-picker__trigger--ghost:hover:not(:disabled) {")).toContain(
      "background: var(--agent-hover)",
    );
    const footerGhost = cssRule(
      css,
      "\n.agent-composer__footer .agent-picker__trigger--ghost,\n.agent-composer__lock {",
    );
    expect(footerGhost).toContain("height: 28px");
    expect(footerGhost).toContain("border-radius: var(--agent-radius-sm)");
    expect(footerGhost).not.toContain("border:");
    expect(css).toMatch(/\n\.agent-composer__lock \{[^}]*background: var\(--agent-well\)/);
    expect(cssRule(css, "\n.agent-composer__chip {")).toContain("background: var(--agent-well)");
    const divider = cssRule(css, "\n.agent-composer__divider {");
    expect(divider).toContain("height: 16px");
    expect(divider).toContain("background: var(--agent-hover)");
    expect(divider).toContain("opacity: 0.7");
  });

  it("floats picker menus and the compact panel on the float shadow without rings", () => {
    for (const selector of [
      "\n.agent-picker__menu {",
      "\n.agent-composer__compact-panel {",
      "\n.agent-model-picker__dialog {",
    ]) {
      const rule = cssRule(css, selector);
      expect(rule, selector).toContain("box-shadow: var(--codevo-shadow-float)");
      expect(rule, selector).not.toContain("0 0 0 1px");
    }
    const trigger = cssRule(css, "\n.agent-picker__trigger {");
    expect(trigger).toContain("background: var(--agent-well)");
    expect(trigger).toContain("border-radius: var(--agent-radius-sm)");
    expect(trigger).not.toContain("border:");
  });
});

const CHECKOUT_ID = "agent-checkout";
const REPOSITORY_ID = "agent-repository";

function cssRule(source: string, selector: string): string {
  const start = source.indexOf(selector);
  expect(start, `Missing CSS selector ${selector}`).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("{", start);
  const end = source.indexOf("}", bodyStart);
  expect(end).toBeGreaterThan(bodyStart);
  return source.slice(bodyStart + 1, end);
}

function withMacPlatform(run: () => void): void {
  const saved = Object.getOwnPropertyDescriptor(navigator, "userAgentData");
  Object.defineProperty(navigator, "userAgentData", {
    configurable: true,
    value: { platform: "macOS" },
  });
  try {
    run();
  } finally {
    if (saved === undefined) Reflect.deleteProperty(navigator, "userAgentData");
    if (saved !== undefined) Object.defineProperty(navigator, "userAgentData", saved);
  }
}

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
    projectRoot: "/workspace/app",
    repositoryOptions: [repo("/workspace/app/packages/api", "packages/api")],
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
    worktreeAvailable: true,
    worktreeOnly: false,
    worktreeOnlyReason: null,
    guard: { kind: "safe" },
    launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
    launchProvider: "claudeCode",
    dispatching: false,
    submitBlocked: false,
    providerEnabled: { claudeCode: true, codex: true },
    mode: { kind: "new" },
    onSelectRepository: () => undefined,
    onPromptChange: () => undefined,
    onIsolationChange: () => undefined,
    onLaunchChange: () => undefined,
    onNewThread: () => undefined,
    onOpenProviderSettings: () => undefined,
    onSubmit: () => undefined,
  };
}

function disabledProvidersManagement(): AgentProviderManagementSurface {
  const preferences = defaultAgentProviderPreferences();
  return {
    cliDiscovery: defaultAgentCliDiscoveryResult(),
    providers: {
      claudeCode: {
        executable: {
          kind: "notFound",
          installCommand: "npm i -g @anthropic-ai/claude-code",
        },
        health: { kind: "disabled" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
      codex: {
        executable: { kind: "notFound", installCommand: "npm i -g @openai/codex" },
        health: { kind: "disabled" },
        policy: { kind: "unregistered" },
        updateState: { kind: "idle" },
        liveTurnCount: 0,
      },
    },
    selectedProviderAuthority: null,
    toast: null,
    admissionAuthority: (provider) => ({
      provider,
      revision: 1,
      disposition: { kind: "disabled" },
    }),
    authority: (provider) => ({
      settingsRevision: 1,
      provider,
      preference: { ...preferences[provider], enabled: false },
      cliPath: null,
    }),
    dismissToast: vi.fn(),
    dismissUpdate: vi.fn(async () => true),
    refresh: vi.fn(async () => undefined),
    retryRegistration: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    saveWithOutcome: vi.fn(async () => ({ kind: "persisted" as const, policyRegistered: true })),
    update: vi.fn(async () => null),
  };
}
