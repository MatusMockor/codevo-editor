// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentComposerCompactMenu } from "./AgentComposerCompactMenu";
import {
  AgentEnvironmentCheckoutPicker,
  type AgentEnvironmentCheckoutPickerProps,
} from "./AgentEnvironmentCheckoutPicker";

describe("AgentEnvironmentCheckoutPicker", () => {
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
    vi.restoreAllMocks();
  });

  function props(
    overrides: Partial<AgentEnvironmentCheckoutPickerProps> = {},
  ): AgentEnvironmentCheckoutPickerProps {
    return {
      checkout: overrides.isolation === "worktree" ? "newWorktree" : "localCheckout",
      disabled: false,
      isolation: "in-place",
      onIsolationChange: vi.fn(),
      onOpenEnvironmentSettings: vi.fn(),
      remote: false,
      worktreeAvailable: true,
      worktreeOnly: false,
      ...overrides,
    };
  }

  function render(overrides: Partial<AgentEnvironmentCheckoutPickerProps> = {}) {
    const next = props(overrides);
    act(() => root.render(<AgentEnvironmentCheckoutPicker {...next} />));
    return next;
  }

  function trigger(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    expect(element).not.toBeNull();
    return element ?? document.createElement("button");
  }

  function menu(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="menu"][aria-label="Workspace"]');
  }

  function rows(): HTMLButtonElement[] {
    return [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitemradio"]'),
    ];
  }

  function row(text: string): HTMLButtonElement | undefined {
    return rows().find((node) => node.textContent?.includes(text));
  }

  function press(target: Element | null, key: string): void {
    act(() => {
      target?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
    });
  }

  it("shows only the checkout on the trigger and lists checkout choices", () => {
    render();
    expect(trigger().textContent).toBe("Local checkout");
    expect(trigger().getAttribute("aria-label")).toBe("Workspace: Local checkout");
    act(() => trigger().click());
    expect(menu()?.querySelectorAll(".cv-menu__label")).toHaveLength(0);
    expect(
      rows().map((node) => node.querySelector(".cv-menu__text")?.firstChild?.textContent),
    ).toEqual(["Local checkout", "New worktree"]);
    const checked = rows()
      .filter((node) => node.getAttribute("aria-checked") === "true")
      .map((node) => node.textContent);
    expect(checked).toEqual([expect.stringContaining("Local checkout")]);
    expect(document.body.textContent).not.toContain("This computer");
  });

  it("switches to a new worktree and offers Manage environments", () => {
    const current = render();
    act(() => trigger().click());
    act(() => row("New worktree")?.click());
    expect(current.onIsolationChange).toHaveBeenCalledWith("worktree");
    expect(menu()).toBeNull();
    const worktree = render({ isolation: "worktree" });
    expect(trigger().textContent).toBe("New worktree");
    act(() => trigger().click());
    const manage = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]'),
    ].find((node) => node.textContent === "Manage environments");
    act(() => manage?.click());
    expect(worktree.onOpenEnvironmentSettings).toHaveBeenCalledOnce();
    expect(menu()).toBeNull();
  });

  it("labels the server checkout on a server", () => {
    render({ remote: true, checkout: "serverCheckout" });
    expect(trigger().textContent).toBe("Server checkout");
    act(() => trigger().click());
    expect(row("Server checkout")?.getAttribute("aria-checked")).toBe("true");
  });

  it("offers the previous worktree with its branch and leaves it for a fresh checkout", () => {
    const onSelect = vi.fn();
    const available = { threadId: "agt-9", worktreePath: "/wt/agt-9", branch: "agent/retry" };
    const current = render({
      previousWorktree: { available, selected: false, onSelect },
    });
    act(() => trigger().click());
    const previous = row("Previous worktree");
    expect(previous?.querySelector(".cv-menu__text")?.textContent).toBe(
      "Previous worktree (agent/retry)",
    );
    expect(previous?.querySelector(".cv-menu__description")).toBeNull();
    act(() => row("Previous worktree")?.click());
    expect(onSelect).toHaveBeenCalledOnce();
    const chosen = render({
      checkout: "worktree",
      isolation: "worktree",
      previousWorktree: { available, selected: true, onSelect },
    });
    expect(trigger().textContent).toBe("Worktree");
    act(() => trigger().click());
    expect(row("Previous worktree")?.getAttribute("aria-checked")).toBe("true");
    act(() => row("New worktree")?.click());
    expect(chosen.onIsolationChange).toHaveBeenCalledExactlyOnceWith("worktree");
    expect(current.onIsolationChange).not.toHaveBeenCalled();
  });

  it("refreshes isolation when it opens and omits settings without a handler", () => {
    const onRefreshIsolation = vi.fn();
    render({ onOpenEnvironmentSettings: undefined, onRefreshIsolation });
    act(() => trigger().click());
    expect(onRefreshIsolation).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("Manage environments");
  });

  it("disables Local checkout when the project requires a worktree", () => {
    const current = render({ isolation: "worktree", worktreeOnly: true, worktreeAvailable: false });
    act(() => trigger().click());
    expect(row("Local checkout")?.getAttribute("aria-disabled")).toBe("true");
    act(() => row("Local checkout")?.click());
    expect(current.onIsolationChange).not.toHaveBeenCalled();
    expect(row("New worktree")?.getAttribute("aria-checked")).toBe("true");
  });

  it("hides New worktree when worktrees are unavailable", () => {
    render({ worktreeAvailable: false });
    act(() => trigger().click());
    expect(row("New worktree")).toBeUndefined();
  });

  it("names the previous worktree without a branch when it has none", () => {
    render({
      previousWorktree: {
        available: { threadId: "agt-9", worktreePath: "/wt/agt-9", branch: null },
        selected: false,
        onSelect: vi.fn(),
      },
    });
    act(() => trigger().click());
    expect(row("Previous worktree")?.querySelector(".cv-menu__text")?.textContent).toBe(
      "Previous worktree",
    );
  });

  it("is keyboard operable: arrow opens, rows rove, Enter selects, Escape restores focus", () => {
    const current = render();
    trigger().focus();
    press(trigger(), "ArrowDown");
    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(row("Local checkout"));
    press(menu(), "ArrowDown");
    expect(document.activeElement).toBe(row("New worktree"));
    press(document.activeElement, "Enter");
    expect(current.onIsolationChange).toHaveBeenCalledWith("worktree");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    act(() => trigger().click());
    press(menu(), "End");
    expect(document.activeElement?.textContent).toBe("Manage environments");
    press(document.activeElement, "Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(current.onOpenEnvironmentSettings).not.toHaveBeenCalled();
  });

  it("closes only its own menu on Escape inside the compact panel", () => {
    act(() =>
      root.render(
        <AgentComposerCompactMenu disabled={false}>
          <AgentEnvironmentCheckoutPicker {...props()} />
        </AgentComposerCompactMenu>,
      ),
    );
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="More composer controls"]')?.click(),
    );
    act(() => trigger().click());
    press(document.activeElement, "Escape");
    expect(menu()).toBeNull();
    expect(host.querySelector('[aria-label="Composer controls"]')).not.toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes when it becomes disabled", () => {
    render();
    act(() => trigger().click());
    render({ disabled: true });
    expect(menu()).toBeNull();
    expect(trigger().disabled).toBe(true);
  });
});
