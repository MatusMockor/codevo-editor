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
import { McpAddServer } from "./McpAddServer";
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
      <McpAddServer configuredNames={[]} management={store} provider="claudeCode" target={target} />
    );
    ui.render(add(APP));
    click(button("Add Claude Code MCP server"));
    type("Name", "docs");
    type("URL", "https://docs.example.com/mcp");

    ui.render(add(API));
    click(present(document.querySelector('[role="dialog"] button[type="submit"]')));
    expect(management.changes.requests().map((request) => request.target)).toEqual([APP]);
    expect(store.activity(APP, "docs").kind).toBe("changing");
    expect(store.activity(API, "docs").kind).toBe("idle");
  });
});
