// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentOpenMenu, type AgentOpenMenuProps } from "./AgentOpenMenu";
import {
  AGENT_OPEN_MISSING_REASON,
  AGENT_OPEN_NO_TARGET_REASON,
} from "./agentThreadHeaderPresentation";

const PATH = "/workspace/app/.worktrees/agt-1";

describe("AgentOpenMenu", () => {
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

  it("opens the files surface from the primary button", () => {
    const onOpenSurface = vi.fn();
    render({ onOpenSurface });

    act(() => button("Open in Editor").click());

    expect(onOpenSurface).toHaveBeenCalledWith("files");
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("lists reveal, terminal, editor and copy entries in the menu", async () => {
    const onRevealPath = vi.fn(() => Promise.resolve());
    const onCopyPath = vi.fn();
    const onOpenSurface = vi.fn();
    render({ onCopyPath, onOpenSurface, onRevealPath });

    act(() => button("Open options").click());
    await act(async () => {});

    expect(items()).toEqual([
      "Reveal in Finder",
      "Open in Terminal",
      "Open in Editor",
      "Copy path",
    ]);
    expect(button("Open options").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.textContent).toBe("Reveal in Finder");

    act(() => item("Reveal in Finder").click());
    expect(onRevealPath).toHaveBeenCalledWith(PATH);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button("Open options"));

    act(() => button("Open options").click());
    act(() => item("Open in Terminal").click());
    expect(onOpenSurface).toHaveBeenCalledWith("terminal");

    act(() => button("Open options").click());
    act(() => item("Copy path").click());
    expect(onCopyPath).toHaveBeenCalledTimes(1);
  });

  it("reports a failed reveal through the callback", async () => {
    const failure = new Error("no file manager");
    const onRevealFailed = vi.fn();
    render({ onRevealFailed, onRevealPath: () => Promise.reject(failure) });

    act(() => button("Open options").click());
    act(() => item("Reveal in Finder").click());
    await act(async () => {});

    expect(onRevealFailed).toHaveBeenCalledWith(failure);
  });

  it("closes on Escape and on an outside click", () => {
    render({});

    act(() => button("Open options").click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector('[role="menu"]')).toBeNull();

    act(() => button("Open options").click());
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("moves focus with the arrow keys inside the menu", () => {
    render({});
    act(() => button("Open options").click());
    const menu = host.querySelector<HTMLElement>('[role="menu"]');
    expect(menu).not.toBeNull();

    act(() => {
      menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe("Open in Terminal");
    act(() => {
      menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe("Reveal in Finder");
  });

  it("disables both halves with a reason when the worktree is gone or there is no target", () => {
    render({ target: { path: PATH, missing: true } });
    expect(button("Open in Editor").disabled).toBe(true);
    expect(button("Open in Editor").title).toBe(AGENT_OPEN_MISSING_REASON);
    expect(button("Open options").disabled).toBe(true);

    render({ target: null });
    expect(button("Open options").title).toBe(AGENT_OPEN_NO_TARGET_REASON);
  });

  function render(overrides: Partial<AgentOpenMenuProps>): void {
    const props: AgentOpenMenuProps = {
      target: { path: PATH, missing: false },
      onOpenSurface: vi.fn(),
      onRevealPath: vi.fn(() => Promise.resolve()),
      onCopyPath: vi.fn(),
      onRevealFailed: vi.fn(),
      ...overrides,
    };
    act(() => {
      root.render(<AgentOpenMenu {...props} />);
    });
  }

  function button(label: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(element, `Missing button ${label}`).not.toBeNull();
    return element as HTMLButtonElement;
  }

  function items(): ReadonlyArray<string> {
    return [...host.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent ?? "");
  }

  function item(label: string): HTMLButtonElement {
    const element = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === label,
    );
    expect(element, `Missing item ${label}`).toBeDefined();
    return element as HTMLButtonElement;
  }
});
