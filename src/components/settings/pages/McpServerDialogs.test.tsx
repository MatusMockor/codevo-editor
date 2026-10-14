// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMcpServerManagementCoordinator } from "../../../application/agentMcpServerManagementStore";
import { agentMcpServersSource } from "../../../application/agentMcpServersGateway";
import { AgentMcpServersStatusStore } from "../../../application/agentMcpServersStore";
import type { AgentMcpServerActions } from "../../../domain/agentMcpServerActions";
import {
  localAgentMcpServersTarget,
  type AgentMcpServersTarget,
} from "../../../domain/agentMcpServersTarget";
import {
  DeferredAgentMcpServerManagement,
  ManualScheduler,
  RecordingUrlOpener,
} from "../../../test/agentMcpServerManagementTestSupport";
import { DeferredAgentMcpServersGateway } from "../../../test/agentMcpServersTestSupport";
import { click, mountUi, type MountedUi } from "../../../ui/foundation/foundationTestSupport";
import { McpAddServerMenu } from "./McpAddServer";
import { McpServerActionsMenu } from "./McpServerActionsMenu";

function present<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).toBeDefined();
  return value as T;
}

const APP = present(localAgentMcpServersTarget("/work/app", "claudeCode"));
const API = present(localAgentMcpServersTarget("/work/api", "claudeCode"));

function actions(removeFrom: AgentMcpServerActions["removeFrom"]): AgentMcpServerActions {
  return { signIn: false, signInAgain: false, signOut: false, removeFrom };
}

function button(label: string): HTMLButtonElement {
  return present(
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) =>
        candidate.getAttribute("aria-label") === label || candidate.textContent === label,
    ),
  );
}

function type(label: string, text: string): void {
  const caption = present(
    [...document.querySelectorAll<HTMLLabelElement>("label")].find(
      (candidate) => candidate.textContent === label,
    ),
  );
  const input = present(document.getElementById(caption.htmlFor)) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("MCP server dialogs keep the owner they were opened for", () => {
  let ui: MountedUi;

  beforeEach(() => {
    ui = mountUi();
  });

  afterEach(() => {
    ui.unmount();
  });

  it("removes through the callback and scope captured when the confirmation opened", () => {
    const removeFromA = vi.fn();
    const removeFromB = vi.fn();
    const menu = (onRemove: () => void, removeFrom: "local" | "user") => (
      <McpServerActionsMenu
        actions={actions(removeFrom)}
        name="linear"
        onRemove={onRemove}
        onSignInAgain={() => undefined}
        onSignOut={() => undefined}
        provider="claudeCode"
      />
    );
    ui.render(menu(removeFromA, "local"));
    click(button("More actions for linear"));
    click(present(document.querySelector('[role="menuitem"]')));
    const dialog = present(document.querySelector('[role="alertdialog"]'));
    expect(dialog.textContent).toContain("for this project.");

    ui.render(menu(removeFromB, "user"));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      "for this project.",
    );
    click(button("Remove"));
    expect(removeFromA).toHaveBeenCalledExactlyOnceWith("local");
    expect(removeFromB).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("adds to the target captured when the add dialog opened", () => {
    const management = new DeferredAgentMcpServerManagement();
    const statuses = new AgentMcpServersStatusStore(
      agentMcpServersSource(new DeferredAgentMcpServersGateway(), null, {
        confirm: async () => "unavailable",
        support: () => "unavailable",
      }),
    );
    const store = new AgentMcpServerManagementCoordinator({
      management,
      statuses,
      urlOpener: new RecordingUrlOpener(),
      scheduler: new ManualScheduler(),
    });
    const add = (target: AgentMcpServersTarget) => (
      <McpAddServerMenu
        options={[{ configuredNames: [], management: store, provider: "claudeCode", target }]}
      />
    );
    ui.render(add(APP));
    click(button("Add server"));
    click(present(document.querySelector('[role="menuitem"]')));
    type("Name", "docs");
    type("URL", "https://docs.example.com/mcp");

    ui.render(add(API));
    click(present(document.querySelector('[role="dialog"] button[type="submit"]')));
    expect(management.changes.requests().map((request) => request.target)).toEqual([APP]);
    expect(store.activity(APP, "docs").kind).toBe("changing");
    expect(store.activity(API, "docs").kind).toBe("idle");
  });

  function addOptions(providers: ReadonlyArray<"claudeCode" | "codex">) {
    const store = new AgentMcpServerManagementCoordinator({
      management: new DeferredAgentMcpServerManagement(),
      statuses: new AgentMcpServersStatusStore(
        agentMcpServersSource(new DeferredAgentMcpServersGateway(), null, {
          confirm: async () => "unavailable",
          support: () => "unavailable",
        }),
      ),
      urlOpener: new RecordingUrlOpener(),
      scheduler: new ManualScheduler(),
    });
    return providers.map((provider) => ({
      configuredNames: [],
      management: store,
      provider,
      target: present(localAgentMcpServersTarget("/work/app", provider)),
    }));
  }

  function menuItemLabels(): ReadonlyArray<string | null | undefined> {
    return [...document.querySelectorAll('[role="menuitem"] .cv-menu__text')].map(
      (item) => item.textContent,
    );
  }

  it("dismisses the open add menu and keeps focus on its button when a provider goes away", () => {
    const both = addOptions(["claudeCode", "codex"]);
    ui.render(<McpAddServerMenu options={both} />);
    const add = button("Add server");
    act(() => add.focus());
    click(add);
    expect(menuItemLabels()).toEqual(["Claude Code", "Codex"]);
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");

    ui.render(<McpAddServerMenu options={both.filter((option) => option.provider === "codex")} />);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(add.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(add);

    click(add);
    expect(menuItemLabels()).toEqual(["Codex"]);
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
  });

  it("does not reopen the add menu by itself when providers come back", () => {
    const both = addOptions(["claudeCode", "codex"]);
    ui.render(<McpAddServerMenu options={both} />);
    const add = button("Add server");
    act(() => add.focus());
    click(add);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    ui.render(<McpAddServerMenu options={[]} />);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(add.disabled).toBe(true);
    expect(add.getAttribute("aria-expanded")).toBe("false");

    ui.render(<McpAddServerMenu options={both} />);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(add.disabled).toBe(false);
    expect(add.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement?.closest('[role="menu"]') ?? null).toBeNull();
  });

  it("drops an open add draft once its provider is no longer offered", () => {
    const store = new AgentMcpServerManagementCoordinator({
      management: new DeferredAgentMcpServerManagement(),
      statuses: new AgentMcpServersStatusStore(
        agentMcpServersSource(new DeferredAgentMcpServersGateway(), null, {
          confirm: async () => "unavailable",
          support: () => "unavailable",
        }),
      ),
      urlOpener: new RecordingUrlOpener(),
      scheduler: new ManualScheduler(),
    });
    const add = (offered: boolean) => (
      <McpAddServerMenu
        options={
          offered
            ? [{ configuredNames: [], management: store, provider: "claudeCode", target: APP }]
            : []
        }
      />
    );
    ui.render(add(true));
    click(button("Add server"));
    click(present(document.querySelector('[role="menuitem"]')));
    type("Name", "docs");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    ui.render(add(false));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(button("Add server").disabled).toBe(true);

    ui.render(add(true));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    click(button("Add server"));
    click(present(document.querySelector('[role="menuitem"]')));
    const name = [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')][0];
    expect(name?.value).toBe("");
  });
});
