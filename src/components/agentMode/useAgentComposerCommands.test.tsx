// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentComposerMenuItemKey } from "../../domain/agentComposerCommand";
import type { AgentCommandCatalogServerProject } from "../../domain/agentCommandCatalogTarget";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  DeferredAgentCommandCatalogGateway,
  DeferredRemoteCommandCatalogGateway,
  agentCommandCatalogFixture,
} from "../../test/agentCommandCatalogTestSupport";
import { AgentCommandCatalogProvider } from "./AgentCommandCatalogProvider";
import { AgentCommandCatalogProjectContext } from "./useAgentCommandCatalogStore";
import { useAgentComposerCommands } from "./useAgentComposerCommands";

interface HarnessProps {
  readonly initial?: string;
  readonly provider?: AgentCliKind;
  readonly executionServerId?: string | null;
  readonly repositoryRoot?: string | null;
}

describe("composer command keyboard ownership", () => {
  let root: Root;
  let host: HTMLDivElement;
  let gateway: DeferredAgentCommandCatalogGateway;
  let remote: DeferredRemoteCommandCatalogGateway;
  const SERVER = "3f2b8c1e-5a47-4d09-9c3e-7b1a2d4e6f80";
  const PROJECT = { serverId: SERVER, runnerId: "runner-home", projectId: "codevo-editor" };
  const choose = vi.fn();
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    gateway = new DeferredAgentCommandCatalogGateway();
    remote = new DeferredRemoteCommandCatalogGateway();
    choose.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function Harness({
    initial = "/",
    provider = "claudeCode",
    executionServerId = null,
    repositoryRoot = "/workspace/app",
  }: HarnessProps) {
    const [prompt, setPrompt] = useState(initial);
    const commands = useAgentComposerCommands({
      prompt,
      provider,
      followUp: true,
      executionServerId,
      repositoryRoot,
      onChoose: (id, submit) => {
        choose(id, submit);
        if (id === "compact" && !submit) setPrompt("/compact ");
      },
      onInsert: setPrompt,
    });
    return (
      <>
        <textarea
          value={prompt}
          aria-activedescendant={commands.activeOptionId}
          onChange={(event) => {
            commands.onEdit();
            setPrompt(event.target.value);
          }}
          onFocus={commands.onFocus}
          onBlur={commands.onBlur}
          onKeyDown={commands.onKeyDown}
          onSelect={(event) => commands.onSelect(event.currentTarget)}
        />
        <output>
          {commands.open
            ? commands.rows.map(agentComposerMenuItemKey)[commands.activeIndex]
            : "closed"}
        </output>
        <ul>
          {commands.open &&
            commands.rows.map((row) => (
              <li key={agentComposerMenuItemKey(row)}>{agentComposerMenuItemKey(row)}</li>
            ))}
        </ul>
        <p>{commands.notice}</p>
        <button onClick={commands.interceptSubmit}>Send</button>
      </>
    );
  }
  function textarea(): HTMLTextAreaElement {
    const element = host.querySelector("textarea");
    expect(element).not.toBeNull();
    return element ?? document.createElement("textarea");
  }
  function render(
    initial = "/",
    props: HarnessProps = {},
    project: AgentCommandCatalogServerProject | null = null,
  ) {
    act(() =>
      root.render(
        <AgentCommandCatalogProvider gateway={gateway} remoteGateway={remote}>
          <AgentCommandCatalogProjectContext.Provider value={project}>
            <Harness initial={initial} {...props} />
          </AgentCommandCatalogProjectContext.Provider>
        </AgentCommandCatalogProvider>,
      ),
    );
    act(() => {
      textarea().setSelectionRange(initial.length, initial.length);
      textarea().focus();
    });
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
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    act(() => textarea().dispatchEvent(event));
    return event;
  }
  function active(): string | null | undefined {
    return host.querySelector("output")?.textContent;
  }
  function listed(): ReadonlyArray<string | null> {
    return [...host.querySelectorAll("li")].map((item) => item.textContent);
  }
  function send() {
    act(() => host.querySelector("button")?.click());
  }
  async function load(
    provider: AgentCliKind,
    entries: Parameters<typeof agentCommandCatalogFixture>[1],
    truncated = false,
  ) {
    await act(async () =>
      gateway.reads[gateway.reads.length - 1]?.resolve(
        agentCommandCatalogFixture(provider, entries, truncated),
      ),
    );
  }

  it("navigates without moving focus or submitting", () => {
    render();
    key("ArrowDown");
    expect(document.activeElement).toBe(host.querySelector("textarea"));
    expect(choose).not.toHaveBeenCalled();
    const selected = host.querySelector("output")?.textContent;
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(choose).toHaveBeenCalledWith(selected, false);
  });
  it("dismisses on Escape but intercepts explicit exact command submission", () => {
    render("/model");
    key("Escape");
    expect(host.querySelector("output")?.textContent).toBe("closed");
    send();
    expect(choose).toHaveBeenCalledWith("model", true);
  });
  it("leaves modified enter and IME events to the composer", () => {
    render("/model");
    expect(key("Enter", { metaKey: true }).defaultPrevented).toBe(false);
    expect(key("Enter", { isComposing: true }).defaultPrevented).toBe(false);
    expect(key("Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(choose).not.toHaveBeenCalled();
  });
  it("stages compact and requires a separate explicit send", () => {
    render("/compact");
    key("Enter");
    expect(choose).toHaveBeenCalledExactlyOnceWith("compact", false);
    expect(host.querySelector("textarea")?.value).toBe("/compact ");
    expect(host.querySelector("output")?.textContent).toBe("closed");
    send();
    expect(choose).toHaveBeenLastCalledWith("compact", true);
  });
  it("does not intercept unknown slash commands", () => {
    render("/custom");
    expect(host.querySelector("output")?.textContent).toBe("closed");
    send();
    expect(choose).not.toHaveBeenCalled();
  });
  it("still offers and intercepts an exact built-in typed with a trailing space", () => {
    render("/compact ");
    expect(listed()).toEqual(["compact"]);
    send();
    expect(choose).toHaveBeenCalledExactlyOnceWith("compact", true);
  });

  it("asks for the catalog of the composer's workspace and provider", () => {
    render("/", { provider: "codex", repositoryRoot: "/workspace/other" });
    expect(gateway.requests()).toEqual([{ repositoryRoot: "/workspace/other", provider: "codex" }]);
  });
  it("offers built-ins immediately and adds provider commands when they arrive", async () => {
    render("/");
    expect(listed()).toEqual([
      "model",
      "permissions",
      "reasoning",
      "plan",
      "new",
      "settings",
      "usage",
      "compact",
    ]);
    await load("claudeCode", [{ name: "superpowers:brainstorming" }, { name: "design-login" }]);
    expect(listed().slice(8)).toEqual([
      "command:design-login",
      "command:superpowers:brainstorming",
    ]);
    expect(active()).toBe("model");
  });
  it("keeps the menu open for long namespaced names the built-in pattern used to close", async () => {
    const name = "app-6a3293e129088191abf0875820e839da:ad-multiplier";
    render("/");
    await load("claudeCode", [{ name }]);
    type(`/${name.slice(0, 44)}`);
    expect(listed()).toEqual([`command:${name}`]);
    type(`/${name}`);
    expect(active()).toBe(`command:${name}`);
    expect(textarea().getAttribute("aria-activedescendant")).toBe(
      `agent-composer-command-command:${name}`,
    );
  });
  it("inserts a Claude command as a slash prompt without choosing or submitting", async () => {
    render("/");
    await load("claudeCode", [{ name: "design-login" }]);
    type("/des");
    expect(active()).toBe("command:design-login");
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(textarea().value).toBe("/design-login ");
    expect(active()).toBe("closed");
    expect(document.activeElement).toBe(textarea());
    expect(textarea().selectionStart).toBe("/design-login ".length);
    expect(textarea().selectionEnd).toBe("/design-login ".length);
    expect(choose).not.toHaveBeenCalled();
    send();
    expect(choose).not.toHaveBeenCalled();
  });
  it("inserts a Codex skill as a dollar mention with Enter", async () => {
    render("/", { provider: "codex" });
    await load("codex", [{ name: "work-pets:create-pet", label: "Create Pet" }]);
    type("/pet");
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(textarea().value).toBe("$work-pets:create-pet ");
    expect(active()).toBe("closed");
    expect(textarea().selectionStart).toBe("$work-pets:create-pet ".length);
    expect(choose).not.toHaveBeenCalled();
  });
  it("never intercepts a provider command on submit, typed or chosen", async () => {
    render("/");
    await load("claudeCode", [{ name: "design-login" }]);
    type("/design-login");
    expect(active()).toBe("command:design-login");
    send();
    expect(choose).not.toHaveBeenCalled();
    expect(textarea().value).toBe("/design-login");
  });
  it("closes once whitespace ends a provider command so Enter can submit it", async () => {
    render("/");
    await load("claudeCode", [{ name: "pr" }]);
    type("/pr");
    expect(active()).toBe("command:pr");
    type("/pr ");
    expect(active()).toBe("closed");
    expect(key("Enter").defaultPrevented).toBe(false);
    type("/pr fix the build");
    expect(active()).toBe("closed");
  });
  it("lets the built-in win over a provider command of the same name", async () => {
    render("/");
    await load("claudeCode", [{ name: "model" }, { name: "model-card" }]);
    type("/model");
    expect(listed()).toEqual(["model", "command:model-card"]);
    key("Enter");
    expect(choose).toHaveBeenCalledExactlyOnceWith("model", false);
  });
  it("reopens for further edits after an insertion", async () => {
    render("/");
    await load("claudeCode", [{ name: "pr" }, { name: "preview" }]);
    type("/pr");
    key("Tab");
    expect(active()).toBe("closed");
    type("/pre");
    expect(active()).toBe("command:preview");
  });
  it("offers only built-ins and asks nobody when a server thread has no resolved project", () => {
    render("/", { executionServerId: SERVER });
    expect(gateway.reads).toHaveLength(0);
    expect(remote.reads).toHaveLength(0);
    expect(listed()).toHaveLength(8);
  });
  it("offers only built-ins when the resolved project belongs to another server", () => {
    render("/", { executionServerId: "unavailable" }, PROJECT);
    expect(gateway.reads).toHaveLength(0);
    expect(remote.reads).toHaveLength(0);
    expect(listed()).toHaveLength(8);
  });
  it("ignores a resolved server project while the composer targets this machine", () => {
    render("/", {}, PROJECT);
    expect(gateway.requests()).toEqual([
      { repositoryRoot: "/workspace/app", provider: "claudeCode" },
    ]);
    expect(remote.reads).toHaveLength(0);
  });
  it("offers the runner's commands for a server thread and inserts one without submitting", async () => {
    render("/", { executionServerId: SERVER }, PROJECT);
    expect(remote.requests()).toEqual([{ ...PROJECT, provider: "claude" }]);
    expect(gateway.reads).toHaveLength(0);
    await act(async () =>
      remote.reads[0]?.resolve(
        agentCommandCatalogFixture("claudeCode", [{ name: "deploy:staging" }]),
      ),
    );
    expect(listed().slice(8)).toEqual(["command:deploy:staging"]);
    type("/stag");
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(textarea().value).toBe("/deploy:staging ");
    expect(active()).toBe("closed");
    expect(choose).not.toHaveBeenCalled();
  });
  it("drops the runner's commands when the runner identity changes under the composer", async () => {
    render("/", { executionServerId: SERVER }, PROJECT);
    await act(async () =>
      remote.reads[0]?.resolve(agentCommandCatalogFixture("claudeCode", [{ name: "deploy" }])),
    );
    expect(listed()).toContain("command:deploy");
    render("/", { executionServerId: SERVER }, { ...PROJECT, runnerId: "runner-replaced" });
    expect(listed()).toHaveLength(8);
    expect(remote.requests().map((request) => request.runnerId)).toEqual([
      "runner-home",
      "runner-replaced",
    ]);
    render("/", { executionServerId: SERVER }, null);
    expect(listed()).toHaveLength(8);
    expect(remote.reads).toHaveLength(2);
  });
  it("offers only built-ins and never asks the backend without a workspace root", () => {
    render("/", { repositoryRoot: null });
    expect(gateway.reads).toHaveLength(0);
    expect(listed()).toHaveLength(8);
  });
  it("keeps working with built-ins when the catalog cannot be read", async () => {
    render("/");
    await act(async () => gateway.reads[0]?.reject("no provider CLI"));
    expect(listed()).toHaveLength(8);
    expect(host.querySelector("p")?.textContent).toBe("");
    key("Enter");
    expect(choose).toHaveBeenCalledExactlyOnceWith("model", false);
  });
  it("says so when the cap hides matches and stops once typing narrows them", async () => {
    render("/");
    await load(
      "claudeCode",
      Array.from({ length: 204 }, (_, index) => ({ name: `cmd-${index}` })),
    );
    expect(listed()).toHaveLength(50);
    expect(host.querySelector("p")?.textContent).toBe("Showing 50 of 212. Keep typing to narrow.");
    type("/cmd-20");
    expect(listed()).toHaveLength(5);
    expect(host.querySelector("p")?.textContent).toBe("");
  });
  it("says so when the backend truncated the catalog", async () => {
    render("/");
    await load("claudeCode", [{ name: "pr" }], true);
    expect(host.querySelector("p")?.textContent).toBe(
      "Some commands are not listed. Type the full name to use one.",
    );
  });
  it("wraps keyboard navigation across built-ins and provider commands", async () => {
    render("/");
    await load("claudeCode", [{ name: "pr" }]);
    key("ArrowUp");
    expect(active()).toBe("command:pr");
    key("ArrowDown");
    expect(active()).toBe("model");
  });
});
