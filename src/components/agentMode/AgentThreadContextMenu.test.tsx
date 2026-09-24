// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentThreadContextMenu } from "./AgentThreadContextMenu";
import { agentThreadContextMenu } from "./agentThreadContextMenuModel";

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

const nodes = agentThreadContextMenu({
  branch: "main",
  pinned: false,
  archived: false,
  running: false,
  snoozed: false,
  settled: false,
  canMarkUnread: true,
  now: 0,
});

function menuItem(label: string): HTMLButtonElement {
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent === label,
  );
  expect(item).toBeDefined();
  return item as HTMLButtonElement;
}

function keyDown(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("AgentThreadContextMenu", () => {
  it("runs an item, closes, and supports keyboard navigation into a submenu", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    act(() =>
      root.render(
        <AgentThreadContextMenu
          anchor={{ x: 10, y: 20 }}
          nodes={nodes}
          onAction={onAction}
          onClose={onClose}
        />,
      ),
    );
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Thread actions"]');
    expect(menu).not.toBeNull();
    expect(document.activeElement?.textContent).toContain("New thread on main");
    keyDown(document.activeElement as Element, "ArrowDown");
    expect(document.activeElement?.textContent).toContain("Pin thread");
    const copy = menuItem("Copy");
    act(() => copy.focus());
    keyDown(copy, "ArrowRight");
    act(() => menuItem("Copy thread ID").click());
    expect(onAction).toHaveBeenCalledWith({
      kind: "command",
      command: { kind: "copy", detail: "threadId" },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the checked section and keeps disabled items inert with their reason", () => {
    const onAction = vi.fn();
    const running = agentThreadContextMenu({
      branch: null,
      pinned: true,
      archived: false,
      running: true,
      snoozed: false,
      settled: false,
      canMarkUnread: false,
      now: 0,
    });
    act(() =>
      root.render(
        <AgentThreadContextMenu
          anchor={{ x: 0, y: 0 }}
          nodes={running}
          onAction={onAction}
          onClose={vi.fn()}
        />,
      ),
    );
    const remove = menuItem("Delete");
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    const describedBy = remove.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe(
      "Stop the agent before deleting this thread.",
    );
    expect(remove.getAttribute("title")).toBe("Stop the agent before deleting this thread.");
    expect(menuItem("Rename thread").hasAttribute("aria-describedby")).toBe(false);
    act(() => remove.click());
    expect(onAction).not.toHaveBeenCalled();
    act(() => menuItem("Move to").click());
    const pinned = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent === "Pinned",
    );
    expect(pinned?.getAttribute("aria-checked")).toBe("true");
  });

  it("closes on Escape without running anything", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    act(() =>
      root.render(
        <AgentThreadContextMenu
          anchor={{ x: 0, y: 0 }}
          nodes={nodes}
          onAction={onAction}
          onClose={onClose}
        />,
      ),
    );
    keyDown(document.activeElement as Element, "Escape");
    expect(onClose).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });
});
