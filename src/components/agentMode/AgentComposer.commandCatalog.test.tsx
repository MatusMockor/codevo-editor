// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import wireContract from "../../../contracts/agent-command-catalog-wire.json";
import {
  parseAgentCommandCatalog,
  type AgentCommandCatalog,
} from "../../domain/agentCommandCatalog";
import type { AgentCommandCatalogServerProject } from "../../domain/agentCommandCatalogTarget";
import {
  DeferredAgentCommandCatalogGateway,
  DeferredRemoteCommandCatalogGateway,
  agentCommandCatalogFixture,
} from "../../test/agentCommandCatalogTestSupport";
import { AgentCommandCatalogProvider } from "./AgentCommandCatalogProvider";
import { AgentCommandCatalogProjectContext } from "./useAgentCommandCatalogStore";
import { AgentComposer, type AgentComposerProps } from "./AgentComposer";

const claudeCommands = parseAgentCommandCatalog(wireContract.catalogs[0].value);
const codexSkills = parseAgentCommandCatalog(wireContract.catalogs[1].value);

describe("composer provider command catalog", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: AgentComposerProps;
  let gateway: DeferredAgentCommandCatalogGateway;
  let remote: DeferredRemoteCommandCatalogGateway;
  let project: AgentCommandCatalogServerProject | null;
  const SERVER = "3f2b8c1e-5a47-4d09-9c3e-7b1a2d4e6f80";
  const PROJECT = { serverId: SERVER, runnerId: "runner-home", projectId: "codevo-editor" };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    gateway = new DeferredAgentCommandCatalogGateway();
    remote = new DeferredRemoteCommandCatalogGateway();
    project = null;
    props = {
      target: target("/workspace/app"),
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
  });

  function target(repositoryRoot: string): NonNullable<AgentComposerProps["target"]> {
    return {
      projectLabel: "app",
      projectRoot: repositoryRoot,
      selectedRepositoryRoot: repositoryRoot,
      repositoryOptions: [],
    };
  }

  function Controlled({ current }: { readonly current: AgentComposerProps }) {
    const [prompt, setPrompt] = useState(current.prompt);
    return (
      <AgentComposer
        {...current}
        prompt={prompt}
        promptBytes={new TextEncoder().encode(prompt).length}
        onPromptChange={(next) => {
          current.onPromptChange(next);
          setPrompt(next);
        }}
      />
    );
  }

  function render() {
    act(() =>
      root.render(
        <AgentCommandCatalogProvider gateway={gateway} remoteGateway={remote}>
          <AgentCommandCatalogProjectContext.Provider value={project}>
            <Controlled current={props} />
          </AgentCommandCatalogProjectContext.Provider>
        </AgentCommandCatalogProvider>,
      ),
    );
  }

  function mount(prompt: string, overrides: Partial<AgentComposerProps> = {}) {
    props = { ...props, ...overrides, prompt };
    render();
    act(() => {
      textarea().setSelectionRange(prompt.length, prompt.length);
      textarea().focus();
    });
  }

  function textarea(): HTMLTextAreaElement {
    const element = host.querySelector<HTMLTextAreaElement>("textarea#agent-prompt");
    expect(element).not.toBeNull();
    return element ?? document.createElement("textarea");
  }

  function type(value: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea(),
        value,
      );
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      textarea().setSelectionRange(value.length, value.length);
      textarea().dispatchEvent(new Event("select", { bubbles: true }));
    });
  }

  function key(key: string, options: KeyboardEventInit = {}) {
    act(() =>
      textarea().dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ...options }),
      ),
    );
  }

  function menu(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="listbox"][aria-label="Composer commands"]');
  }

  function options(): ReadonlyArray<HTMLElement> {
    return [...(menu()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
  }

  function option(text: string): HTMLElement | undefined {
    return options().find((candidate) => candidate.textContent?.includes(text));
  }

  async function answer(catalog: AgentCommandCatalog, read = gateway.reads.length - 1) {
    await act(async () => gateway.reads[read]?.resolve(catalog));
  }

  it("lists the workspace's Claude commands under the built-ins", async () => {
    mount("/");
    expect(gateway.requests()).toEqual([
      { repositoryRoot: "/workspace/app", provider: "claudeCode" },
    ]);
    expect(options()).toHaveLength(8);
    await answer(claudeCommands);
    expect(options().map((row) => row.id)).toEqual([
      "agent-composer-command-model",
      "agent-composer-command-permissions",
      "agent-composer-command-reasoning",
      "agent-composer-command-plan",
      "agent-composer-command-new",
      "agent-composer-command-settings",
      "agent-composer-command-usage",
      "agent-composer-command-mcp",
      "agent-composer-command-command:design-login",
      "agent-composer-command-command:superpowers:brainstorming",
      "agent-composer-command-command:code-review",
    ]);
    const brainstorming = option("/superpowers:brainstorming");
    expect(brainstorming?.textContent).toContain("Explore requirements before building.");
    expect(brainstorming?.textContent).toContain("[topic]");
    expect(
      brainstorming?.querySelector(".agent-composer-commands__description")?.getAttribute("title"),
    ).toBe("Explore requirements before building.");
    expect(
      option("/code-review")?.querySelector(".agent-composer-commands__description"),
    ).toBeNull();
  });

  it("keeps every option id unique, whitespace-free and reachable from the textarea", async () => {
    mount("/");
    await answer(
      agentCommandCatalogFixture("claudeCode", [
        { name: "a.b" },
        { name: "a:b" },
        { name: "a-b" },
        { name: "a_b" },
        { name: "A.B" },
      ]),
    );
    const ids = options().map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0 && !/\s/.test(id))).toBe(true);
    type("/a:b");
    const activeId = textarea().getAttribute("aria-activedescendant");
    expect(activeId).toBe("agent-composer-command-command:a:b");
    const active = document.getElementById(activeId ?? "");
    expect(active?.getAttribute("aria-selected")).toBe("true");
    expect(active?.getAttribute("role")).toBe("option");
    expect(textarea().getAttribute("aria-controls")).toBe(menu()?.id);
    expect(options().filter((row) => row.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("separates the first provider command from the built-ins above it", async () => {
    mount("/");
    await answer(claudeCommands);
    const grouped = options().filter((row) =>
      row.classList.contains("agent-composer-commands__option--group"),
    );
    expect(grouped.map((row) => row.id)).toEqual(["agent-composer-command-command:design-login"]);
  });

  it("inserts the highlighted Claude command with Enter and does not submit", async () => {
    mount("/");
    await answer(claudeCommands);
    type("/brain");
    expect(options().map((row) => row.id)).toEqual([
      "agent-composer-command-command:superpowers:brainstorming",
    ]);
    key("Enter");
    expect(textarea().value).toBe("/superpowers:brainstorming ");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(textarea());
    expect(textarea().selectionStart).toBe("/superpowers:brainstorming ".length);
    expect(textarea().selectionEnd).toBe("/superpowers:brainstorming ".length);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onPromptChange).toHaveBeenLastCalledWith("/superpowers:brainstorming ");
    key("Enter");
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe("/superpowers:brainstorming ");
  });

  it("inserts with Tab after arrow navigation", async () => {
    mount("/");
    await answer(claudeCommands);
    type("/co");
    expect(options().map((row) => row.id)).toEqual(["agent-composer-command-command:code-review"]);
    type("/de");
    key("ArrowDown");
    key("ArrowUp");
    key("Tab");
    expect(textarea().value).toBe("/design-login ");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("inserts a Codex skill as a dollar mention", async () => {
    mount("/", {
      launchProvider: "codex",
      launch: { provider: "codex", model: "default", mode: "default" },
    });
    expect(gateway.requests()).toEqual([{ repositoryRoot: "/workspace/app", provider: "codex" }]);
    await answer(codexSkills);
    const createPet = option("$work-pets:create-pet");
    expect(createPet?.textContent).toContain("Create Pet");
    expect(createPet?.textContent).toContain("Create a new pet for this workspace.");
    type("/create");
    key("Enter");
    expect(textarea().value).toBe("$work-pets:create-pet ");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(textarea());
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("inserts on click without taking focus away from the prompt", async () => {
    mount("/");
    await answer(claudeCommands);
    const row = option("/design-login");
    const pressed = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      row?.dispatchEvent(pressed);
      row?.click();
    });
    expect(pressed.defaultPrevented).toBe(true);
    expect(textarea().value).toBe("/design-login ");
    expect(document.activeElement).toBe(textarea());
    expect(menu()).toBeNull();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("still routes /model to Codevo's picker when the provider ships a model command", async () => {
    mount("/");
    await answer(
      agentCommandCatalogFixture("claudeCode", [
        { name: "model", description: "Provider model command." },
        { name: "usage" },
      ]),
    );
    expect(menu()?.textContent).not.toContain("Provider model command.");
    expect(options()).toHaveLength(8);
    type("/model");
    key("Enter");
    expect(host.querySelector('[role="dialog"][aria-label="Agent model"]')).not.toBeNull();
    expect(textarea().value).toBe("");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("submits a typed provider command with arguments as an ordinary prompt", async () => {
    mount("/");
    await answer(claudeCommands);
    type("/design-login some args");
    expect(menu()).toBeNull();
    key("Enter");
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe("/design-login some args");
    expect(props.onLaunchChange).not.toHaveBeenCalled();
  });

  it("submits an exactly typed provider command from the send button untouched", async () => {
    mount("/");
    await answer(claudeCommands);
    type("/design-login");
    act(() => host.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(textarea().value).toBe("/design-login");
  });

  it("offers built-ins only and probes nothing for a server thread without a resolved project", async () => {
    mount("/", { executionServerId: SERVER });
    expect(gateway.reads).toHaveLength(0);
    expect(remote.reads).toHaveLength(0);
    expect(options()).toHaveLength(8);
    type("/des");
    expect(menu()).toBeNull();
    expect(gateway.reads).toHaveLength(0);
    expect(remote.reads).toHaveLength(0);
  });

  it("lists the runner's commands for a server thread and inserts one without submitting", async () => {
    project = PROJECT;
    mount("/", { executionServerId: SERVER });
    expect(remote.requests()).toEqual([{ ...PROJECT, provider: "claude" }]);
    expect(gateway.reads).toHaveLength(0);
    await act(async () => remote.reads[0]?.resolve(claudeCommands));
    expect(options().map((row) => row.id)).toContain(
      "agent-composer-command-command:superpowers:brainstorming",
    );
    type("/brain");
    key("Enter");
    expect(textarea().value).toBe("/superpowers:brainstorming ");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(textarea());
    expect(props.onSubmit).not.toHaveBeenCalled();
    key("Enter");
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });

  it("inserts a runner's Codex skill as a dollar mention", async () => {
    project = PROJECT;
    mount("/", {
      executionServerId: SERVER,
      launchProvider: "codex",
      launch: { provider: "codex", model: "default", mode: "default" },
    });
    expect(remote.requests()).toEqual([{ ...PROJECT, provider: "codex" }]);
    await act(async () => remote.reads[0]?.resolve(codexSkills));
    type("/create");
    key("Enter");
    expect(textarea().value).toBe("$work-pets:create-pet ");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("never shows a late local catalog on a server thread or a runner catalog locally", async () => {
    mount("/");
    project = PROJECT;
    props = { ...props, executionServerId: SERVER };
    render();
    await answer(claudeCommands, 0);
    expect(options()).toHaveLength(8);
    await act(async () =>
      remote.reads[0]?.resolve(agentCommandCatalogFixture("claudeCode", [{ name: "runner-only" }])),
    );
    expect(menu()?.textContent).toContain("/runner-only");
    expect(menu()?.textContent).not.toContain("/design-login");
    project = null;
    props = { ...props, executionServerId: null };
    render();
    expect(menu()?.textContent).toContain("/design-login");
    expect(menu()?.textContent).not.toContain("/runner-only");
    expect(gateway.reads).toHaveLength(1);
    expect(remote.reads).toHaveLength(1);
  });

  it("offers built-ins only without a workspace", () => {
    mount("/", { target: null, mode: { kind: "followUp", blockedReason: null } });
    expect(gateway.reads).toHaveLength(0);
    expect(options().map((row) => row.id)).toContain("agent-composer-command-compact");
  });

  it("works without a catalog provider in the tree", () => {
    props = { ...props, prompt: "/" };
    act(() => root.render(<Controlled current={props} />));
    act(() => textarea().focus());
    expect(options()).toHaveLength(8);
  });

  it("never shows a late catalog of the previous workspace or provider", async () => {
    mount("/");
    props = { ...props, target: target("/workspace/other") };
    render();
    expect(gateway.requests().map((request) => request.repositoryRoot)).toEqual([
      "/workspace/app",
      "/workspace/other",
    ]);
    await answer(claudeCommands, 0);
    expect(options()).toHaveLength(8);
    await answer(agentCommandCatalogFixture("claudeCode", [{ name: "other-only" }]), 1);
    expect(options().map((row) => row.id)).toContain("agent-composer-command-command:other-only");
    expect(menu()?.textContent).not.toContain("/design-login");
    props = { ...props, target: target("/workspace/app") };
    render();
    expect(menu()?.textContent).toContain("/design-login");
    expect(menu()?.textContent).not.toContain("/other-only");
    expect(gateway.reads).toHaveLength(2);
  });

  it("states when the list is capped instead of presenting it as complete", async () => {
    mount("/");
    await answer(
      agentCommandCatalogFixture(
        "claudeCode",
        Array.from({ length: 205 }, (_, index) => ({ name: `cmd-${index}` })),
      ),
    );
    expect(options()).toHaveLength(50);
    const notice = document.getElementById("agent-composer-commands-notice");
    expect(notice?.textContent).toBe("Showing 50 of 213. Keep typing to narrow.");
    expect(notice?.closest('[role="listbox"]')).toBeNull();
    expect(notice?.getAttribute("role")).toBeNull();
    expect(menu()?.getAttribute("aria-describedby")).toBe("agent-composer-commands-notice");
    type("/cmd-20");
    expect(options()).toHaveLength(6);
    expect(document.getElementById("agent-composer-commands-notice")).toBeNull();
    expect(menu()?.hasAttribute("aria-describedby")).toBe(false);
  });

  it("states when the backend truncated the catalog", async () => {
    mount("/");
    await answer(parseAgentCommandCatalog(wireContract.catalogs[3].value));
    expect(document.getElementById("agent-composer-commands-notice")?.textContent).toBe(
      "Some commands are not listed. Type the full name to use one.",
    );
  });

  it("keeps the built-in menu usable when the catalog read fails", async () => {
    mount("/");
    await act(async () => gateway.reads[0]?.reject("claude is not installed"));
    expect(options()).toHaveLength(8);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    type("/plan");
    key("Tab");
    expect(props.onLaunchChange).toHaveBeenCalledWith(expect.objectContaining({ mode: "plan" }));
  });
});
