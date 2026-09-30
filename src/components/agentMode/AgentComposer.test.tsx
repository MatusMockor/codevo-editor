// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import { defaultAgentProviderPreferences } from "../../domain/agentProviderSettings";
import { defaultAgentCliDiscoveryResult } from "../../domain/agentSettings";
import type {
  AgentComposerAttachmentDraft,
  AgentComposerAttachmentsSurface,
} from "../../application/useAgentComposerAttachments";
import { MAX_AGENT_TASK_PROMPT_BYTES } from "../../domain/agentTask";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import {
  AgentComposer,
  type AgentComposerProps,
  type AgentComposerRepositoryOption,
  type AgentComposerTarget,
} from "./AgentComposer";
import { readStyleSheet } from "../cssContractTestSupport";
import { formatAgentPromptBytes } from "./agentModePresentation";

import { ClaudeModelCatalogContext } from "./useAgentClaudeModelCatalog";
import { CodexModelCatalogContext } from "./useAgentCodexModelCatalog";
import {
  BUNDLED_CODEX_MODEL_CATALOG,
  parseCodexModelCatalog,
} from "../../domain/codexModelCatalog";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  parseClaudeModelManifest,
} from "../../domain/claudeModelCatalog";

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

  it("splits the workspace menu from the repository picker for nested repositories", () => {
    render();

    expect(host.querySelector(".cv-composer__foot .agent-picker__prefix")).toBeNull();
    expect(workspaceRowLabels()).toEqual(["Local checkout", "New worktree"]);
    expect(pickerOptionLabels(REPOSITORY_ID)).toEqual(["app", "packages/api"]);
    expect(pickerGroupHeadings(REPOSITORY_ID)).toEqual(["Run in repository"]);
    const selectedOptions = pickerOptions(REPOSITORY_ID).filter(
      (option) => option.getAttribute("aria-selected") === "true",
    );
    expect(selectedOptions.map((option) => option.textContent)).toEqual(["appProject folder"]);
    expect(pickerOptionDescriptions(REPOSITORY_ID)).toEqual(["Project folder", ""]);
    expect(trigger(REPOSITORY_ID).textContent).toContain("app");

    render({ target: { ...target(), repositoryOptions: [] } });

    expect(host.querySelector(`#${REPOSITORY_ID}`)).toBeNull();
    expect(workspaceRowLabels()).toEqual(["Local checkout", "New worktree"]);
  });

  it("offers both server checkout modes and labels the server checkout truthfully", () => {
    const onIsolationChange = vi.fn();
    render({
      executionServerId: "srv-1",
      target: { ...target(), repositoryOptions: [] },
      onIsolationChange,
    });
    expect(workspaceRowLabels().slice(-2)).toEqual(["Server checkout", "New worktree"]);
    pickWorkspaceRow("New worktree");
    expect(onIsolationChange).toHaveBeenCalledWith("worktree");
    render({
      executionServerId: "srv-1",
      mode: { kind: "followUp", blockedReason: null },
      isolation: "in-place",
    });
    expect(
      [...host.querySelectorAll(".agent-composer__lock")].map((lock) => lock.textContent),
    ).toEqual(["Runs on:Server", "Checkout:Server checkout"]);
  });

  it("changes the repository of the next thread from the repository picker and names it", () => {
    const onSelectRepository = vi.fn();
    const onIsolationChange = vi.fn();
    render({ onIsolationChange, onSelectRepository });

    pickOption(REPOSITORY_ID, "root:/workspace/app/packages/api");

    expect(onSelectRepository).toHaveBeenCalledWith("/workspace/app/packages/api");
    expect(onIsolationChange).not.toHaveBeenCalled();

    render({
      target: { ...target(), selectedRepositoryRoot: "/workspace/app/packages/api" },
    });

    expect(trigger(REPOSITORY_ID).textContent).toContain("packages/api");
    openPicker(REPOSITORY_ID);
    const menu = host.querySelector('[role="listbox"][aria-label="Repository for this thread"]');
    expect(menu?.getAttribute("aria-multiselectable")).toBe("true");
    const selected = [...(menu?.querySelectorAll('[role="option"][aria-selected="true"]') ?? [])];
    expect(selected.map((option) => option.textContent)).toEqual(["packages/api"]);
    expect(
      menu?.querySelector('[data-value="root:/workspace/app"]')?.getAttribute("aria-selected"),
    ).toBe("false");
    act(() => trigger(REPOSITORY_ID).click());
  });

  it("offers only the local checkout when the target is not a Git repository", () => {
    const onIsolationChange = vi.fn();
    render({ onIsolationChange, worktreeAvailable: false });

    expect(workspaceRowLabels()).toEqual(["Local checkout"]);
    expect(pickerValue(CHECKOUT_ID)).toBe("in-place");

    render({ onIsolationChange, prompt: "Fix it", worktreeAvailable: false });
    expect(submitButton().disabled).toBe(false);
  });

  it("refreshes repository status when the workspace menu opens with mouse or keyboard", () => {
    const onRefreshIsolation = vi.fn();
    render({ onRefreshIsolation, worktreeAvailable: false });
    openPicker(CHECKOUT_ID);
    expect(onRefreshIsolation).toHaveBeenCalledTimes(1);
    expect(workspaceRow("New worktree")).toBeUndefined();
    render({ onRefreshIsolation, worktreeAvailable: true });
    expect(workspaceRow("New worktree")).toBeDefined();
    act(() => trigger(CHECKOUT_ID).click());
    act(() => {
      trigger(CHECKOUT_ID).dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    expect(onRefreshIsolation).toHaveBeenCalledTimes(2);
    render({ onRefreshIsolation, worktreeAvailable: false });
    expect(workspaceRow("New worktree")).toBeUndefined();
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

  it("lets a plain project folder start a thread and states that it runs in the local checkout", () => {
    render({
      isolationReason: "Not a Git repository · Local checkout only",
      prompt: "Fix it",
      target: { ...target(), repositoryOptions: [] },
      worktreeAvailable: false,
    });

    expect(submitButton().disabled).toBe(false);
    expect(host.querySelector(".agent-composer__reason")?.textContent).toBe(
      "Not a Git repository · Local checkout only",
    );
    expect(host.textContent).not.toContain("uncommitted");
    expect(workspaceRowLabels()).toEqual(["Local checkout"]);
  });

  it("picks the checkout in the context strip below the prompt box", () => {
    const onIsolationChange = vi.fn();
    render({ onIsolationChange });

    const box = host.querySelector(".agent-composer__box");
    const footer = host.querySelector(".agent-composer__footer");
    expect(footer?.querySelector(`#${CHECKOUT_ID}`)).not.toBeNull();
    expect(box?.closest(".cv-composer__slab")?.nextElementSibling).toBe(footer);
    expect(footer?.querySelector(`#${REPOSITORY_ID}`)).not.toBeNull();
    expect(pickerValue(CHECKOUT_ID)).toBe("in-place");
    expect(trigger(CHECKOUT_ID).textContent).toBe("Local checkout");

    pickWorkspaceRow("New worktree");

    expect(onIsolationChange).toHaveBeenCalledWith("worktree");
  });

  it("keeps the workspace menu first in compact mode and opens environment settings", () => {
    stubMatchMedia(true);
    const onOpenEnvironmentSettings = vi.fn();
    const onSubmit = vi.fn();
    render({ onOpenEnvironmentSettings, onSubmit, prompt: "Keep my draft" });

    const footer = host.querySelector(".agent-composer__footer");
    const environment = footer?.querySelector<HTMLButtonElement>(`#${CHECKOUT_ID}`);
    expect(environment?.getAttribute("aria-label")).toBe("Workspace: Local checkout");
    expect(footer?.firstElementChild?.contains(environment ?? null)).toBe(true);
    expect(footer?.querySelector("#agent-run-on")).toBeNull();
    act(() => environment?.click());
    expect(workspaceRow("Local checkout")?.getAttribute("aria-checked")).toBe("true");
    expect(onSubmit).not.toHaveBeenCalled();
    act(() =>
      document.querySelector<HTMLButtonElement>('[role="menu"] [role="menuitem"]')?.click(),
    );
    expect(onOpenEnvironmentSettings).toHaveBeenCalledTimes(1);
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Keep my draft");
  });

  it("keeps an existing local task's environment locked", () => {
    render({
      mode: { kind: "followUp", blockedReason: null },
      onOpenEnvironmentSettings: vi.fn(),
    });
    expect(host.querySelector(".agent-composer__lock")?.textContent).toBe(
      "Checkout:Local checkout",
    );
    expect(host.querySelector(`#${CHECKOUT_ID}`)).toBeNull();
  });

  it("pre-sets the checkout and shows the reason behind the default", () => {
    render({
      isolation: "worktree",
      isolationReason: "The working tree has uncommitted changes.",
    });

    expect(pickerValue(CHECKOUT_ID)).toBe("worktree");
    expect(trigger(CHECKOUT_ID).textContent).toContain("New worktree");
    const reason = host.querySelector(".agent-composer__reason");
    expect(reason?.textContent).toBe("The working tree has uncommitted changes.");
    expect(reason?.closest(".cv-composer__slab")?.nextElementSibling).toBe(
      host.querySelector(".agent-composer__footer"),
    );
  });

  it("locks a background project to an isolated worktree and says why", () => {
    const onIsolationChange = vi.fn();
    render({
      isolation: "worktree",
      isolationReason: "The working tree is clean.",
      onIsolationChange,
      worktreeOnly: true,
      worktreeOnlyReason:
        "This project is not the active tab, so the agent only runs in an isolated worktree.",
    });

    expect(trigger(CHECKOUT_ID).disabled).toBe(false);
    expect(pickerValue(CHECKOUT_ID)).toBe("worktree");
    openPicker(CHECKOUT_ID);
    expect(workspaceRow("Local checkout")?.getAttribute("aria-disabled")).toBe("true");
    expect(workspaceRow("New worktree")?.getAttribute("aria-checked")).toBe("true");
    act(() => workspaceRow("Local checkout")?.click());
    expect(onIsolationChange).not.toHaveBeenCalled();
    act(() => trigger(CHECKOUT_ID).click());
    expect(pickerOptionLabels(REPOSITORY_ID)).toEqual(["app", "packages/api"]);
    expect(host.textContent).toContain("only runs in an isolated worktree");
    expect(host.textContent).not.toContain("The working tree is clean.");
  });

  it("shows the thread's checkout as a locked chip in follow-up mode", () => {
    render({
      isolation: "worktree",
      mode: { kind: "followUp", blockedReason: null },
    });

    expect(host.querySelector(`#${CHECKOUT_ID}`)).toBeNull();
    expect(host.querySelector(`#${REPOSITORY_ID}`)).toBeNull();
    const lock = host.querySelector(".agent-composer__lock");
    expect(lock?.textContent).toBe("Checkout:Worktree");
    expect(lock?.querySelector("button")).toBeNull();
    const footer = host.querySelector(".agent-composer__footer");
    expect(footer?.contains(lock)).toBe(true);
    expect(
      host.querySelector(".agent-composer__box")?.closest(".cv-composer__slab")?.nextElementSibling,
    ).toBe(footer);
  });

  it("never repeats the thread title or a new-thread button above the prompt in follow-up mode", () => {
    render({
      mode: { kind: "followUp", blockedReason: null },
    });

    expect(host.querySelector('form[aria-label="Follow up on agent thread"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Replying in");
    expect(host.textContent).not.toContain("New thread");
    expect(host.querySelector(".agent-composer__context")).toBeNull();
    expect(host.querySelector(".agent-composer__chip--thread")).toBeNull();
    expect(host.querySelector(".agent-composer__new")).toBeNull();
    expect(submitButton().getAttribute("aria-label")).toBe("Send follow-up");
    expect(host.querySelector(".agent-composer__box")?.firstElementChild?.tagName).toBe("LABEL");
  });

  it("keeps the model picker inline and moves secondary controls into overflow below 560px", () => {
    stubMatchMedia(true);
    render();

    expect(host.querySelector(".agent-composer__footer")).not.toBeNull();
    expect(host.querySelector(`#${CHECKOUT_ID}`)).not.toBeNull();
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
    expect(panel?.querySelector(`#${CHECKOUT_ID}`)).toBeNull();
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
    pickMenuRow("agent-launch-mode", "Supervised");
    expect(onLaunchChange).toHaveBeenCalledWith(expect.objectContaining({ mode: "supervised" }));
    expect(host.querySelector('[aria-label="Composer controls"]')).not.toBeNull();
    pickOption(REPOSITORY_ID, "root:/workspace/app/packages/api");
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
      mode: { kind: "followUp", blockedReason: null },
    });

    expect(host.querySelector(".agent-composer__lock")?.textContent).toBe("Checkout:Worktree");
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
    expect(button.title).toBe("Start agent (Enter or ⌘↩)");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Enter Meta+Enter");
    expect(button.getAttribute("aria-busy")).toBeNull();
    expect(button.querySelector("kbd")).toBeNull();
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.classList.contains("agent-composer__send")).toBe(true);
    expect(button.matches('.agent-composer__send[aria-busy="true"]')).toBe(false);
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
      mode: { kind: "followUp", blockedReason: null },
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
    expect(submitButton().matches('.agent-composer__send[aria-busy="true"]')).toBe(true);
    expect(submitButton().querySelector(".cv-spinner")).not.toBeNull();
    expect(submitButton().disabled).toBe(true);
    expect(trigger(CHECKOUT_ID).disabled).toBe(true);

    render({
      dispatching: true,
      mode: { kind: "followUp", blockedReason: null },
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
        blockedReason: "This thread is archived. Unarchive it from the thread menu to continue.",
      },
      onSubmit,
      prompt: "Also update the tests",
    });

    expect(submitButton().disabled).toBe(true);
    expect(host.querySelector(".agent-composer__reason")?.textContent).toBe(
      "This thread is archived. Unarchive it from the thread menu to continue.",
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
      mode: { kind: "followUp", blockedReason: null },
    });

    expect(pickerValue("agent-launch-model")).toBe("gpt-5.5");
    expect(pickerValue("agent-launch-mode")).toBe("readOnly");
    expect(pickerValue("agent-launch-effort")).toBe("default");
    expect(host.querySelector("#agent-launch-effort")?.textContent).toBe("Default");
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

    expect(menuRowLabels("agent-launch-mode")).toEqual([
      "Read-only",
      "Workspace write",
      "Auto",
      "Full access",
      "Use Codex CLI settings",
    ]);
    expect(host.querySelector(".agent-composer__danger")).toBeNull();
    expect(submitButton().disabled).toBe(false);

    submitForm();

    expect(onSubmit).toHaveBeenCalledWith({
      launch: { provider: "codex", model: "gpt-6.1-sol", mode: "dangerFullAccess" },
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
      launch: { provider: "codex", model: "gpt-5.6-luna", mode: "workspaceWrite" },
      launchProvider: "codex",
      onSubmit,
      prompt: "Fix it",
    });

    submitForm();

    expect(onSubmit).toHaveBeenCalledWith({
      launch: { provider: "codex", model: "gpt-5.6-luna", mode: "workspaceWrite" },
      dangerousLaunchConfirmed: false,
    });
  });

  it("carries the newly chosen launch into a follow-up submission", () => {
    const onSubmit = vi.fn();
    render({
      launch: { provider: "claudeCode", model: "sonnet", mode: "acceptEdits", effort: "max" },
      mode: { kind: "followUp", blockedReason: null },
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

  it("keeps the browser flag off a submission bound for a remote execution server", () => {
    const onSubmit = vi.fn();
    const launch: AgentLaunchOptions = {
      provider: "claudeCode",
      model: "sonnet",
      mode: "acceptEdits",
      effort: "max",
      chrome: false,
    };
    render({
      executionServerId: "srv-1",
      launch,
      mode: { kind: "followUp", blockedReason: null },
      onSubmit,
      prompt: "Also update the tests",
    });

    expect(host.textContent).not.toContain("Chrome Off");
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
    const [submission] = onSubmit.mock.calls[0] as [{ readonly launch: AgentLaunchOptions }];
    expect(submission.launch).not.toHaveProperty("chrome");
  });

  it("shows and dismisses a context offer and submits the provider compact command", () => {
    const onCompactContext = vi.fn();
    render({
      compactionOffer: { key: "agt-1:1:120000", contextTokens: 120_000 },
      mode: { kind: "followUp", blockedReason: null },
      onCompactContext,
    });

    expect(host.textContent).toContain("Resume with less context");
    expect(host.textContent).toContain("120k tokens from earlier");
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
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Keep full history"]')?.click());
    expect(host.textContent).not.toContain("Resume with less context");
  });

  it("opens an accessible compaction explanation and dismisses it with Escape", () => {
    const onCompactContext = vi.fn();
    const onSubmit = vi.fn();
    render({
      compactionOffer: { key: "a:1", contextTokens: 120_000 },
      mode: { kind: "followUp", blockedReason: null },
      onCompactContext,
      onSubmit,
    });
    const info = host.querySelector<HTMLButtonElement>('[aria-label="Why compact this session?"]')!;
    const explanation = host.querySelector<HTMLParagraphElement>(
      ".agent-compaction-offer__explanation",
    )!;
    expect(info.type).toBe("button");
    expect(info.getAttribute("aria-describedby")).toBe(explanation.id);
    expect(info.getAttribute("aria-controls")).toBe(explanation.id);
    expect(explanation.hidden).toBe(true);
    act(() => info.click());
    expect(info.getAttribute("aria-expanded")).toBe("true");
    expect(explanation.hidden).toBe(false);
    expect(explanation.textContent).toContain("may no longer be cached");
    act(() => info.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(info.getAttribute("aria-expanded")).toBe("false");
    expect(explanation.hidden).toBe(true);
    expect(onCompactContext).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps dismissals per snapshot across switching threads and hides the live meter", () => {
    const onCompactContext = vi.fn();
    const props = { mode: { kind: "followUp" as const, blockedReason: null }, onCompactContext };
    render({ ...props, compactionOffer: { key: "a:1", contextTokens: 120_000 } });
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Keep full history"]')?.click());
    render({ ...props, compactionOffer: { key: "b:1", contextTokens: 120_000 } });
    expect(host.textContent).toContain("Resume with less context");
    render({ ...props, compactionOffer: { key: "a:1", contextTokens: 120_000 } });
    expect(host.textContent).not.toContain("Resume with less context");
    render({ ...props, compactionOffer: { key: "a:2", contextTokens: 120_000 } });
    expect(host.textContent).toContain("Resume with less context");
    expect(host.querySelector(".agent-context-window-meter")).toBeNull();
  });

  it("does not offer Claude resume compaction while working or on another provider or server", () => {
    const props = {
      compactionOffer: { key: "a:1", contextTokens: 120_000 },
      onCompactContext: vi.fn(),
    };
    render({ ...props, running: true });
    expect(host.textContent).not.toContain("Resume with less context");
    render({ ...props, executionServerId: "server-1" });
    expect(host.textContent).not.toContain("Resume with less context");
    render({
      ...props,
      launchProvider: "codex",
      launch: { provider: "codex", model: "default", mode: "default" },
    });
    expect(host.textContent).not.toContain("Resume with less context");
    render({ compactionOffer: props.compactionOffer });
    expect(host.textContent).not.toContain("Resume with less context");
  });

  it("keeps compact unavailable when the follow-up is blocked", () => {
    const onCompactContext = vi.fn();
    render({
      compactionOffer: { key: "a:1", contextTokens: 120_000 },
      mode: { kind: "followUp", blockedReason: "Waiting for approval" },
      onCompactContext,
    });
    expect(compactAction().disabled).toBe(true);
    act(() => compactAction().click());
    expect(onCompactContext).not.toHaveBeenCalled();
  });

  it("compacts an older session from an empty composer", () => {
    const onCompactContext = vi.fn();
    render({
      compactionOffer: { key: "agt-1:1:120000", contextTokens: 120_000 },
      mode: { kind: "followUp", blockedReason: null },
      prompt: "",
      submitBlocked: true,
      onCompactContext,
    });

    expect(submitButton().disabled).toBe(true);
    expect(compactAction().disabled).toBe(false);
    act(() => compactAction().click());
    expect(onCompactContext).toHaveBeenCalledTimes(1);
  });

  it("compacts without consuming the attachments waiting in the composer", async () => {
    const markSent = vi.fn();
    const prepareTurn = vi.fn(async () => null);
    const onCompactContext = vi.fn(async () => true);
    const onPromptChange = vi.fn();
    render({
      attachments: attachmentsSurface({ drafts: [readyAttachmentDraft()], markSent, prepareTurn }),
      attachmentTargetKey: "/workspace/app",
      compactionOffer: { key: "agt-1:1:120000", contextTokens: 120_000 },
      mode: { kind: "followUp", blockedReason: null },
      onCompactContext,
      onPromptChange,
    });

    expect(compactAction().disabled).toBe(false);
    await act(async () => compactAction().click());

    expect(onCompactContext).toHaveBeenCalledTimes(1);
    expect(markSent).not.toHaveBeenCalled();
    expect(prepareTurn).not.toHaveBeenCalled();
    expect(onPromptChange).not.toHaveBeenCalled();
    expect(host.querySelector(".agent-composer-attachment")).not.toBeNull();
  });

  it("keeps Compact disabled while an attachment is still staging", () => {
    render({
      attachments: attachmentsSurface({
        drafts: [stagingAttachmentDraft()],
        staging: true,
        blocked: true,
      }),
      attachmentTargetKey: "/workspace/app",
      compactionOffer: { key: "agt-1:1:120000", contextTokens: 120_000 },
      mode: { kind: "followUp", blockedReason: null },
      onCompactContext: vi.fn(),
    });

    expect(compactAction().disabled).toBe(true);
  });

  it("refuses compaction for a conversation running on a remote server", () => {
    const onCompactContext = vi.fn();
    render({
      compactionOffer: { key: "agt-1:1:120000", contextTokens: 120_000 },
      executionServerId: "srv-1",
      mode: { kind: "followUp", blockedReason: null },
      onCompactContext,
    });

    expect(host.querySelector(".agent-compaction-offer__action")).toBeNull();

    render({
      executionServerId: "srv-1",
      mode: { kind: "followUp", blockedReason: null },
      prompt: "/compact",
      onCompactContext,
    });
    pressEnter();
    expect(onCompactContext).not.toHaveBeenCalled();
  });

  it("keeps the typed /compact until the turn is accepted", async () => {
    const onPromptChange = vi.fn();
    const refused = vi.fn(async () => false);
    render({
      mode: { kind: "followUp", blockedReason: null },
      prompt: "/compact",
      onCompactContext: refused,
      onPromptChange,
    });

    await act(async () => {
      pressEnter();
    });
    expect(refused).toHaveBeenCalledTimes(1);
    expect(onPromptChange).not.toHaveBeenCalled();

    const accepted = vi.fn(async () => true);
    render({
      mode: { kind: "followUp", blockedReason: null },
      prompt: "/compact",
      onCompactContext: accepted,
      onPromptChange,
    });

    await act(async () => {
      pressEnter();
    });
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(onPromptChange).toHaveBeenLastCalledWith("");
  });

  it.each([
    ["new text", [{ prompt: "keep my new draft", promptRevision: 1 }]],
    [
      "text A to B to A",
      [
        { prompt: "temporary", promptRevision: 1 },
        { prompt: "/compact", promptRevision: 2 },
      ],
    ],
    ["batched edits returning to the same text", [{ prompt: "/compact", promptRevision: 2 }]],
    ["another owner", [{ promptOwnerKey: "thread-b" }]],
    ["owner A to B to A", [{ promptOwnerKey: "thread-b" }, { promptOwnerKey: "thread-a" }]],
    ["another execution server", [{ executionServerId: "server-b" }]],
  ] satisfies ReadonlyArray<readonly [string, ReadonlyArray<Partial<AgentComposerProps>>]>)(
    "preserves the draft after pending compaction with %s",
    async (_label, changes) => {
      let settle!: (accepted: boolean) => void;
      const pending = new Promise<boolean>((resolve) => {
        settle = resolve;
      });
      const onPromptChange = vi.fn();
      const prepareTurn = vi.fn(async () => null);
      const markSent = vi.fn();
      const props: Partial<AgentComposerProps> = {
        mode: { kind: "followUp", blockedReason: null },
        prompt: "/compact",
        promptOwnerKey: "thread-a",
        promptRevision: 0,
        onCompactContext: vi.fn(() => pending),
        onPromptChange,
        attachments: attachmentsSurface({
          drafts: [readyAttachmentDraft()],
          prepareTurn,
          markSent,
        }),
      };
      render(props);
      pressEnter();
      for (const change of changes) render({ ...props, ...change });
      await act(async () => {
        settle(true);
      });
      expect(onPromptChange).not.toHaveBeenCalled();
      expect(prepareTurn).not.toHaveBeenCalled();
      expect(markSent).not.toHaveBeenCalled();
      expect(host.querySelector(".agent-composer-attachment")).not.toBeNull();
    },
  );

  it("does not clear a draft after its composer unmounts during compaction", async () => {
    let settle!: (accepted: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    const onPromptChange = vi.fn();
    render({
      mode: { kind: "followUp", blockedReason: null },
      prompt: "/compact",
      promptOwnerKey: "thread-a",
      onCompactContext: () => pending,
      onPromptChange,
    });
    pressEnter();
    act(() => root.render(null));
    await act(async () => {
      settle(true);
    });
    expect(onPromptChange).not.toHaveBeenCalled();
  });

  it("keeps Compact disabled while a turn dispatches or the thread cannot resume", () => {
    const offer = {
      compactionOffer: { key: "agt-1:1:120000", contextTokens: 120_000 },
      mode: { kind: "followUp", blockedReason: null },
      onCompactContext: vi.fn(),
    } as const;

    render({ ...offer, dispatching: true, submitBlocked: true });
    expect(compactAction().disabled).toBe(true);

    render({ ...offer, providerEnabled: { claudeCode: false, codex: false } });
    expect(compactAction().disabled).toBe(true);

    render({ ...offer, mode: { kind: "followUp", blockedReason: "A turn is running." } });
    expect(compactAction().disabled).toBe(true);
  });

  it("runs /compact from the command path while an empty prompt blocks submission", () => {
    const onCompactContext = vi.fn();
    const onSubmit = vi.fn();
    render({
      mode: { kind: "followUp", blockedReason: null },
      prompt: "/compact",
      submitBlocked: true,
      onCompactContext,
      onSubmit,
    });

    expect(pressEnter().defaultPrevented).toBe(true);
    expect(onCompactContext).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows usage limits for /usage and clears the prompt, even while a turn dispatches", () => {
    const onShowUsageLimits = vi.fn();
    const onPromptChange = vi.fn();
    const onSubmit = vi.fn();
    render({
      dispatching: true,
      prompt: "/usage",
      submitBlocked: true,
      onPromptChange,
      onShowUsageLimits,
      onSubmit,
    });

    expect(pressEnter().defaultPrevented).toBe(true);
    expect(onShowUsageLimits).toHaveBeenCalledTimes(1);
    expect(onPromptChange).toHaveBeenLastCalledWith("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends on Enter in every mode and keeps Shift+Enter and IME input multiline", () => {
    const modes: ReadonlyArray<AgentComposerProps["mode"]> = [
      { kind: "new" },
      { kind: "followUp", blockedReason: null },
      STEER_MODE,
    ];
    for (const mode of modes) {
      const onSubmit = vi.fn();
      render({ mode, prompt: "Ship it", running: mode.kind === "steer", onSubmit });

      expect(pressEnter({ shiftKey: true }).defaultPrevented, mode.kind).toBe(false);
      expect(pressEnter({ altKey: true }).defaultPrevented, mode.kind).toBe(false);
      expect(pressEnter({ isComposing: true }).defaultPrevented, mode.kind).toBe(false);
      expect(onSubmit, mode.kind).not.toHaveBeenCalled();

      expect(pressEnter().defaultPrevented, mode.kind).toBe(true);
      expect(onSubmit, mode.kind).toHaveBeenCalledTimes(1);
      expect(pressEnter({ metaKey: true }).defaultPrevented, mode.kind).toBe(true);
      expect(onSubmit, mode.kind).toHaveBeenCalledTimes(2);
      expect(pressEnter({ ctrlKey: true }).defaultPrevented, mode.kind).toBe(true);
      expect(onSubmit, mode.kind).toHaveBeenCalledTimes(3);
    }
  });

  it("sends once for a held Enter and accepts the numeric keypad Enter", () => {
    const onSubmit = vi.fn();
    render({ prompt: "Ship it", onSubmit });

    expect(pressEnter({ repeat: true }).defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();

    expect(pressEnter({ code: "NumpadEnter" }).defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("never dispatches a second turn from Enter while the first one is starting", () => {
    const onSubmit = vi.fn();
    render({ prompt: "Ship it", dispatching: true, submitBlocked: true, onSubmit });

    expect(pressEnter().defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("never sends a partial slash query while the command menu is open", () => {
    const onSubmit = vi.fn();
    const onPromptChange = vi.fn();
    render({ prompt: "/mod", onSubmit, onPromptChange });
    act(() => promptField().focus());

    expect(commandMenu()).not.toBeNull();
    expect(pressEnter({ altKey: true }).defaultPrevented).toBe(false);
    expect(pressEnter({ metaKey: true }).defaultPrevented).toBe(false);
    expect(pressEnter({ ctrlKey: true }).defaultPrevented).toBe(false);
    expect(commandMenu()).not.toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();

    expect(pressEnter().defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onPromptChange).toHaveBeenLastCalledWith("");
  });

  it("refuses /compact while the running turn would queue it as a steer message", () => {
    const onCompactContext = vi.fn();
    const onSubmit = vi.fn();
    render({
      mode: STEER_MODE,
      prompt: "/compact",
      running: true,
      onCompactContext,
      onSubmit,
    });

    expect(pressEnter().defaultPrevented).toBe(true);
    expect(onCompactContext).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps Send now and Queue available alongside Stop while a turn runs", () => {
    const onStop = vi.fn();
    const onSubmit = vi.fn();
    render({ mode: STEER_MODE, running: true, onStop, onSubmit });

    const stop = stopButton();
    expect(stop.getAttribute("aria-label")).toBe("Stop agent");
    expect(stop.getAttribute("title")).toBe("Stop (Esc)");
    expect(stop.type).toBe("button");
    expect(stop.disabled).toBe(false);
    expect(host.querySelector(".agent-composer__send")).not.toBeNull();
    expect(promptField().placeholder).toBe("Queue a follow-up");
    expect(host.querySelector("form")?.getAttribute("aria-label")).toBe(
      "Follow up on agent thread",
    );
    expect(trigger("agent-launch-effort").disabled).toBe(true);
    expect(trigger("agent-launch-model").disabled).toBe(true);

    act(() => stop.click());
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(["claudeCode", "codex"] as const)(
    "chooses default and alternate delivery for %s",
    (provider) => {
      const onSubmit = vi.fn();
      for (const followUpBehavior of ["queue", "steer"] as const) {
        onSubmit.mockClear();
        render({
          mode: STEER_MODE,
          running: true,
          prompt: "Continue",
          followUpBehavior,
          launchProvider: provider,
          onSubmit,
        });
        pressEnter();
        pressEnter({ metaKey: true });
        pressEnter({ ctrlKey: true });
        act(() => host.querySelector<HTMLButtonElement>(".agent-composer__alternate")!.click());
        expect(onSubmit.mock.calls.map(([request]) => request.delivery)).toEqual(
          followUpBehavior === "queue"
            ? ["queued", "immediate", "immediate", "immediate"]
            : ["immediate", "queued", "queued", "queued"],
        );
        expect(submitButton().getAttribute("aria-label")).toBe(
          followUpBehavior === "queue" ? "Queue message" : "Send now",
        );
      }
    },
  );

  it("does not consume attachments while choosing Send now and blocks both actions during staging", () => {
    const onSubmit = vi.fn();
    const markSent = vi.fn();
    const prepareTurn = vi.fn(async () => null);
    const attachments = attachmentsSurface({
      drafts: [readyAttachmentDraft()],
      markSent,
      prepareTurn,
    });
    render({ mode: STEER_MODE, running: true, prompt: "Review image", attachments, onSubmit });
    act(() => host.querySelector<HTMLButtonElement>(".agent-composer__alternate")!.click());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ delivery: "immediate" }));
    expect(markSent).not.toHaveBeenCalled();
    expect(prepareTurn).not.toHaveBeenCalled();
    render({
      mode: STEER_MODE,
      running: true,
      prompt: "Review image",
      attachments,
      onSubmit,
      submitBlocked: true,
    });
    expect(submitButton().disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>(".agent-composer__alternate")!.disabled).toBe(
      true,
    );
    pressEnter({ metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps queue available and refuses immediate delivery when unsupported", () => {
    const onSubmit = vi.fn();
    render({
      mode: STEER_MODE,
      running: true,
      prompt: "Continue",
      followUpBehavior: "steer",
      immediateBlockedReason: "Update the server to send now.",
      onSubmit,
    });
    expect(submitButton().getAttribute("aria-label")).toBe("Queue message");
    const alternate = host.querySelector<HTMLButtonElement>(".agent-composer__alternate")!;
    expect(alternate.disabled).toBe(true);
    expect(alternate.title).toBe("Update the server to send now.");
    pressEnter({ metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    pressEnter();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ delivery: "queued" }));
  });

  it("shows pending steering on desktop while keeping Stop usable", () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    render({
      mode: STEER_MODE,
      running: true,
      dispatching: true,
      submitBlocked: true,
      onSubmit,
      onStop,
    });
    expect(stopButton().getAttribute("aria-busy")).toBe("true");
    expect(stopButton().querySelector(".cv-spinner")).not.toBeNull();
    expect(stopButton().disabled).toBe(false);
    pressAccelerator();
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => stopButton().click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("stops the run from an empty composer and from Escape in the prompt", () => {
    const onStop = vi.fn();
    render({ mode: STEER_MODE, prompt: "", running: true, submitBlocked: true, onStop });

    expect(stopButton().disabled).toBe(false);
    act(() => stopButton().click());
    expect(onStop).toHaveBeenCalledTimes(1);

    pressEscape();
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it("owns running Escape and ignores key repeats without losing the draft or focus", () => {
    const onStop = vi.fn();
    const onPromptChange = vi.fn();
    const bubbled = vi.fn();
    window.addEventListener("keydown", bubbled);
    try {
      render({ mode: STEER_MODE, prompt: "Next change", running: true, onStop, onPromptChange });
      const field = promptField();
      act(() => field.focus());
      const first = pressEscape();
      const repeated = pressEscape({ repeat: true });
      expect(first.defaultPrevented).toBe(true);
      expect(repeated.defaultPrevented).toBe(true);
      expect(bubbled).not.toHaveBeenCalled();
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(field.value).toBe("Next change");
      expect(document.activeElement).toBe(field);

      render({
        mode: { kind: "followUp", blockedReason: null },
        prompt: "Next change",
        onStop,
        onPromptChange,
      });
      expect(promptField()).toBe(field);
      expect(field.disabled).toBe(false);
      expect(document.activeElement).toBe(field);
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
          field,
          "Next change after stop",
        );
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(onPromptChange).toHaveBeenLastCalledWith("Next change after stop");
    } finally {
      window.removeEventListener("keydown", bubbled);
    }
  });

  it.each(["agent-launch-model", "agent-launch-effort"])(
    "lets Escape close an open %s popover before it stops the run",
    (id) => {
      const onStop = vi.fn();
      render({ mode: { kind: "followUp", blockedReason: null }, running: true, onStop });
      openPicker(id);
      expect(trigger(id).getAttribute("aria-expanded")).toBe("true");

      pressEscape();

      expect(onStop).not.toHaveBeenCalled();
      expect(trigger(id).getAttribute("aria-expanded")).toBe("false");

      pressEscape();

      expect(onStop).toHaveBeenCalledTimes(1);
    },
  );

  it("offers an explicit fresh draft action without sending or claiming to resume history", () => {
    const onRecoverDraft = vi.fn();
    const onSubmit = vi.fn();
    render({
      mode: { kind: "followUp", blockedReason: "This session cannot be resumed." },
      prompt: "Unsent correction",
      onRecoverDraft,
      onSubmit,
    });
    const action = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Start new thread with this draft",
    );
    expect(action).toBeDefined();
    expect(host.textContent).toContain("previous conversation is not carried over");
    expect(promptField().disabled).toBe(false);
    act(() => action?.click());
    expect(onRecoverDraft).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("reports oversized recovery without submitting or hiding the editable draft", () => {
    render({
      mode: { kind: "followUp", blockedReason: "This session cannot be resumed." },
      prompt: "Unsent correction",
      onRecoverDraft: () => "draftTooLarge",
    });
    const action = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Start new thread with this draft",
    );
    act(() => action?.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Both drafts are unchanged",
    );
    expect(promptField().value).toBe("Unsent correction");
    expect(promptField().disabled).toBe(false);
  });

  it("leaves Escape alone once the turn is no longer running", () => {
    const onStop = vi.fn();
    render({ mode: { kind: "followUp", blockedReason: null }, prompt: "Reply", onStop });

    pressEscape();
    expect(onStop).not.toHaveBeenCalled();
    expect(host.querySelector(".agent-composer__stop")).toBeNull();
    expect(submitButton().getAttribute("aria-label")).toBe("Send follow-up");
  });

  it("keeps both Stop and Send on a touch-width layout", () => {
    stubMatchMedia(true);
    const onStop = vi.fn();
    const onSubmit = vi.fn();
    render({ mode: STEER_MODE, prompt: "also run the tests", running: true, onStop, onSubmit });

    expect(host.querySelector(".agent-composer__stop")).not.toBeNull();
    const send = submitButton();
    expect(send.getAttribute("aria-label")).toBe("Queue message");
    expect(send.disabled).toBe(false);

    submitForm();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  function commandMenu(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="listbox"][aria-label="Composer commands"]');
  }

  function attachmentsSurface(
    overrides: Partial<AgentComposerAttachmentsSurface>,
  ): AgentComposerAttachmentsSurface {
    return {
      drafts: [],
      projectRootKey: "/workspace/app",
      staging: false,
      blocked: false,
      refusal: null,
      promptLineBytes: 0,
      add: async () => undefined,
      claimPaste: () => "pass-through",
      remove: () => undefined,
      clear: () => undefined,
      markSent: () => undefined,
      refuse: () => undefined,
      dismissRefusal: () => undefined,
      prepareTurn: async () => null,
      ...overrides,
    };
  }

  function compactAction(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(".agent-compaction-offer__action");
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function pressEnter(options: KeyboardEventInit = {}): KeyboardEvent {
    const field = promptField();
    field.setSelectionRange(field.value.length, field.value.length);
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      ...options,
    });
    act(() => {
      field.dispatchEvent(event);
    });
    return event;
  }

  function stopButton(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>("button.agent-composer__stop");
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function promptField(): HTMLTextAreaElement {
    const element = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
    expect(element).not.toBeNull();
    return element ?? document.createElement("textarea");
  }

  function pressEscape(options: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
      ...options,
    });
    act(() => promptField().dispatchEvent(event));
    return event;
  }

  it("dispatches the refreshed catalog default after a provider update", () => {
    const onSubmit = vi.fn();
    const props = { ...defaultProps(), prompt: "Fix it", onSubmit };
    const remote = parseClaudeModelManifest({
      ...BUNDLED_CLAUDE_MODEL_MANIFEST,
      updatedAt: "2027-01-01T00:00:00Z",
      claudeCode: [
        {
          ...BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode[0],
          choice: "claude-future-9",
          runtimeIds: ["claude-future-9"],
          label: "Claude Future 9",
          efforts: ["low"],
          defaultEffort: "low",
          contextWindows: ["200k"],
          defaultContext: "200k",
          isDefault: true,
        },
      ],
    });
    act(() =>
      root.render(
        <ClaudeModelCatalogContext.Provider value={BUNDLED_CLAUDE_MODEL_MANIFEST}>
          <AgentComposer {...props} />
        </ClaudeModelCatalogContext.Provider>,
      ),
    );
    act(() =>
      root.render(
        <ClaudeModelCatalogContext.Provider value={remote}>
          <AgentComposer {...props} />
        </ClaudeModelCatalogContext.Provider>,
      ),
    );
    expect(trigger("agent-launch-model").textContent).toContain("Claude Future 9");
    submitForm();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        launch: expect.objectContaining({
          model: "claude-future-9",
          effort: "low",
          context: "200k",
        }),
      }),
    );
  });

  it("dispatches a vanished Codex model as the default and says so", () => {
    const onSubmit = vi.fn();
    const props = {
      ...defaultProps(),
      prompt: "Fix it",
      onSubmit,
      launch: { provider: "codex", model: "gpt-5.4", mode: "readOnly", effort: "high" } as const,
      launchProvider: "codex" as const,
    };
    act(() => root.render(<AgentComposer {...props} />));
    expect(host.textContent).toContain(
      "gpt-5.4 is no longer available in Codex. This turn uses your Codex default model instead.",
    );
    submitForm();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        launch: { provider: "codex", model: "gpt-6.1-sol", mode: "readOnly" },
      }),
    );

    const live = parseCodexModelCatalog({
      ...BUNDLED_CODEX_MODEL_CATALOG,
      source: "live",
      revision: 2,
      models: [
        ...BUNDLED_CODEX_MODEL_CATALOG.models,
        {
          id: "gpt-5.4",
          label: "GPT-5.4",
          description: "Returned by the live catalog.",
          status: "current",
          isDefault: false,
          efforts: ["high"],
          defaultEffort: "high",
          upgradeTo: null,
        },
      ],
    });
    act(() =>
      root.render(
        <CodexModelCatalogContext.Provider value={live}>
          <AgentComposer {...props} />
        </CodexModelCatalogContext.Provider>,
      ),
    );
    expect(host.textContent).not.toContain("is no longer available in Codex");
    submitForm();
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        launch: { provider: "codex", model: "gpt-5.4", mode: "readOnly", effort: "high" },
      }),
    );
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

  function workspaceRows(): ReadonlyArray<HTMLButtonElement> {
    openPicker(CHECKOUT_ID);
    const rows = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"][aria-label="Workspace"] [role="menuitemradio"]',
      ),
    ];
    act(() => trigger(CHECKOUT_ID).click());
    return rows;
  }

  function workspaceRowLabels(): ReadonlyArray<string> {
    return workspaceRows().map(menuRowLabel);
  }

  function workspaceRow(label: string): HTMLButtonElement | undefined {
    return [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"][aria-label="Workspace"] [role="menuitemradio"]',
      ),
    ].find((row) => menuRowLabel(row) === label);
  }

  function pickWorkspaceRow(label: string): void {
    openPicker(CHECKOUT_ID);
    const row = workspaceRow(label);
    expect(row).toBeDefined();
    act(() => row?.click());
  }

  function menuRows(): ReadonlyArray<HTMLButtonElement> {
    return [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitemradio"]'),
    ];
  }

  function menuRowLabel(row: HTMLElement): string {
    return row.querySelector(".cv-menu__text")?.firstChild?.textContent ?? "";
  }

  function menuRowLabels(id: string): ReadonlyArray<string> {
    openPicker(id);
    const labels = menuRows().map(menuRowLabel);
    act(() => trigger(id).click());
    return labels;
  }

  function pickMenuRow(id: string, label: string): void {
    openPicker(id);
    const row = menuRows().find((candidate) => menuRowLabel(candidate) === label);
    expect(row).toBeDefined();
    act(() => row?.click());
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

describe("AgentComposer picker styling contract", () => {
  const css = readStyleSheet("components/agentMode/pickers/agentPickers.css").source;

  it("sizes ghost pickers on the 28px control step with a hover tint and a hairline divider", () => {
    const ghost = cssRule(css, "\n.agent-picker__trigger--ghost {");
    expect(ghost).toContain("background: none");
    expect(ghost).toContain("color: var(--cv-fg-muted)");
    expect(cssRule(css, "\n.agent-picker__trigger:hover:not(:disabled) {")).toContain(
      "background: var(--cv-tint-2)",
    );
    const footerGhost = cssRule(
      css,
      "\n.agent-composer__footer .agent-picker__trigger--ghost,\n.agent-composer__lock {",
    );
    expect(footerGhost).toContain("height: 28px");
    expect(footerGhost).toContain("border-radius: var(--cv-r-control)");
    expect(footerGhost).not.toContain("border:");
    expect(footerGhost).not.toContain("color:");
    expect(css).toMatch(/\n\.agent-composer__lock \{[^}]*background: var\(--cv-tint-1\)/);
    const divider = cssRule(css, "\n.agent-composer__divider {");
    expect(divider).toContain("width: 1px");
    expect(divider).toContain("height: 16px");
    expect(divider).toContain("background: var(--cv-hair-strong)");
  });

  it("floats picker menus and the compact panel on the popover shadow without rings", () => {
    for (const selector of [
      "\n.agent-picker__menu {",
      "\n.agent-composer__compact-panel {",
      "\n.agent-model-picker__dialog {",
    ]) {
      const rule = cssRule(css, selector);
      expect(rule, selector).toContain("background: var(--cv-popover)");
      expect(rule, selector).toContain("box-shadow: var(--cv-shadow-pop)");
      expect(rule, selector).toContain("z-index: var(--cv-z-popover)");
      expect(rule, selector).not.toContain("0 0 0 1px");
    }
    const trigger = cssRule(css, "\n.agent-picker__trigger {");
    expect(trigger).toContain("background: var(--cv-tint-1)");
    expect(trigger).toContain("border-radius: var(--cv-r-control)");
    expect(trigger).toContain("border: 0");
  });

  it("rings a picker trigger on focus-visible only and marks an open menu with a tint", () => {
    expect(cssRule(css, "\n.agent-picker__trigger:focus-visible {")).toContain(
      "box-shadow: var(--cv-ring-focus)",
    );
    const open = cssRule(css, "\n.agent-picker--open .agent-picker__trigger {");
    expect(open).toContain("background: var(--cv-tint-2)");
    expect(open).toContain("color: var(--cv-fg-strong)");
    expect(open).not.toContain("box-shadow");
    expect(open).not.toContain("outline");
  });

  it("keeps the plan and danger tones on hover, open and inside the footer", () => {
    expect(
      cssRule(
        css,
        "\n.agent-picker__trigger--plan:hover:not(:disabled),\n.agent-picker--open .agent-picker__trigger--plan {",
      ),
    ).toContain("color: var(--cv-accent)");
    expect(
      cssRule(
        css,
        "\n.agent-picker__trigger--danger:hover:not(:disabled),\n.agent-picker--open .agent-picker__trigger--danger {",
      ),
    ).toContain("color: var(--cv-warn)");
  });

  it("styles pickers only with declared cv tokens", () => {
    expect(css).not.toMatch(/var\(--(agent|codevo)-/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).toMatch(/var\(--cv-/);
  });
});

const STEER_MODE = { kind: "steer", threadId: "agt-1" } as const;
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

function attachmentDraft(
  overrides: Partial<AgentComposerAttachmentDraft>,
): AgentComposerAttachmentDraft {
  return {
    draftId: "draft-1",
    kind: "file",
    state: "ready",
    name: "notes.txt",
    bytes: 1_024,
    mime: null,
    width: null,
    height: null,
    attachmentId: null,
    path: null,
    previewUrl: null,
    failure: null,
    notice: null,
    missing: false,
    promptLineBytesMax: 40,
    ...overrides,
  };
}

function readyAttachmentDraft(): AgentComposerAttachmentDraft {
  return attachmentDraft({ draftId: "draft-ready" });
}

function stagingAttachmentDraft(): AgentComposerAttachmentDraft {
  return attachmentDraft({ draftId: "draft-staging", state: "staging" });
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
    refreshAll: vi.fn(async () => undefined),
    retryRegistration: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    saveWithOutcome: vi.fn(async () => ({ kind: "persisted" as const, policyRegistered: true })),
    update: vi.fn(async () => null),
  };
}
