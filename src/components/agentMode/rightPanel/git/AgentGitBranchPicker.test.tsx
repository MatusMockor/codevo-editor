// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  click,
  mountUi,
  press,
  type MountedUi,
} from "../../../../ui/foundation/foundationTestSupport";
import { AgentGitBranchPicker, type AgentGitBranchPickerProps } from "./AgentGitBranchPicker";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function props(overrides: Partial<AgentGitBranchPickerProps> = {}): AgentGitBranchPickerProps {
  return {
    currentBranch: "feat/idempotency-keys",
    defaultBranch: "main",
    localBranches: [
      "chore/deps-2026-09",
      "feat/idempotency-keys",
      "feat/order-webhooks",
      "fix/payments-timeout",
      "main",
    ],
    remoteBranches: ["origin/feat/rate-limit", "origin/main", "origin/release/1.4"],
    worktreeBranches: ["fix/payments-timeout"],
    busy: false,
    switchDisabledReason: null,
    onSwitch: vi.fn(),
    onCreate: vi.fn(),
    ...overrides,
  };
}

function render(next: AgentGitBranchPickerProps): HTMLElement {
  ui = ui ?? mountUi();
  ui.render(<AgentGitBranchPicker {...next} />);
  return ui.host;
}

function trigger(host: HTMLElement): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
  expect(found).not.toBeNull();
  return found as HTMLButtonElement;
}

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Switch branch"]');
  expect(found).not.toBeNull();
  return found as HTMLElement;
}

function options(): string[] {
  return [...dialog().querySelectorAll('[role="option"]')].map(
    (option) => option.textContent ?? "",
  );
}

function type(input: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function input(label: string): HTMLInputElement {
  const found = dialog().querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(found, label).not.toBeNull();
  return found as HTMLInputElement;
}

function dialogButton(text: string): HTMLButtonElement {
  const found = [...dialog().querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  expect(found, text).toBeDefined();
  return found as HTMLButtonElement;
}

describe("AgentGitBranchPicker", () => {
  it("opens a labelled dialog with searchable refs and badges", () => {
    const host = render(props());
    expect(trigger(host).getAttribute("aria-expanded")).toBe("false");
    expect(trigger(host).textContent).toContain("feat/idempotency-keys");

    click(trigger(host));

    expect(trigger(host).getAttribute("aria-expanded")).toBe("true");
    expect(input("Search refs").getAttribute("placeholder")).toBe("Search refs…");
    expect(options()).toEqual([
      "feat/idempotency-keyscurrent",
      "maindefault",
      "chore/deps-2026-09",
      "feat/order-webhooks",
      "fix/payments-timeoutworktree",
      "origin/feat/rate-limitremote",
      "origin/release/1.4remote",
    ]);
    expect(dialog().querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain(
      "feat/idempotency-keys",
    );

    type(input("Search refs"), "feat");
    expect(options()).toEqual([
      "feat/idempotency-keyscurrent",
      "feat/order-webhooks",
      "origin/feat/rate-limitremote",
    ]);
  });

  it("switches to a chosen branch and closes", () => {
    const next = props();
    const host = render(next);
    click(trigger(host));

    const main = [...dialog().querySelectorAll<HTMLElement>('[role="option"]')].find((option) =>
      option.textContent?.startsWith("main"),
    );
    click(main as HTMLElement);

    expect(next.onSwitch).toHaveBeenCalledWith({ name: "main", kind: "local", badge: "default" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("creates a branch, optionally in a new worktree", () => {
    const next = props();
    const host = render(next);
    click(trigger(host));

    expect(input("New branch name").value).toBe("");
    expect(dialogButton("Create").disabled).toBe(true);
    expect(dialog().textContent).toContain("from feat/idempotency-keys");
    type(input("New branch name"), "feat/idempotency-ttl");
    click(dialogButton("Create"));
    expect(next.onCreate).toHaveBeenCalledWith("feat/idempotency-ttl", { worktree: false });

    click(trigger(host));
    type(input("New branch name"), "feat/idempotency-ttl");
    click(
      dialog().querySelector(
        '[role="switch"][aria-label="Check out in a new worktree"]',
      ) as HTMLElement,
    );
    press(input("New branch name"), "Enter");
    expect(next.onCreate).toHaveBeenLastCalledWith("feat/idempotency-ttl", { worktree: true });
  });

  it("explains an invalid branch name and disables Create", () => {
    const host = render(props());
    click(trigger(host));

    type(input("New branch name"), "bad name");

    expect(dialogButton("Create").disabled).toBe(true);
    expect(dialog().textContent).toContain(
      "Use a branch name without spaces or special characters.",
    );
  });

  it("disables switching with a reason and forces new branches into a new worktree", () => {
    const next = props({ switchDisabledReason: "This thread's worktree stays on its own branch." });
    const host = render(next);
    click(trigger(host));

    const all = [...dialog().querySelectorAll<HTMLElement>('[role="option"]')];
    expect(all.every((option) => option.getAttribute("aria-disabled") === "true")).toBe(true);
    click(all[1] as HTMLElement);
    press(input("Search refs"), "Enter");
    expect(next.onSwitch).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("This thread's worktree stays on its own branch.");
    expect(dialog().textContent).toContain("New branches from this thread open in a new worktree.");
    const worktreeSwitch = dialog().querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Check out in a new worktree"]',
    );
    expect(worktreeSwitch?.getAttribute("aria-checked")).toBe("true");
    expect(worktreeSwitch?.disabled).toBe(true);

    type(input("New branch name"), "feat/next");
    click(dialogButton("Create"));
    expect(next.onCreate).toHaveBeenCalledWith("feat/next", { worktree: true });
  });

  it("moves the active option with the arrow keys and marks the current branch separately", () => {
    const next = props();
    const host = render(next);
    click(trigger(host));
    const search = input("Search refs");
    const listbox = dialog().querySelector<HTMLElement>('[role="listbox"]');
    expect(search.getAttribute("role")).toBe("combobox");
    expect(search.getAttribute("aria-controls")).toBe(listbox?.id);

    const activeText = (): string | null => {
      const id = search.getAttribute("aria-activedescendant");
      expect(id).not.toBeNull();
      const option = document.getElementById(id as string);
      expect(option?.getAttribute("aria-selected")).toBe("true");
      return option?.textContent ?? null;
    };
    expect(activeText()).toBe("feat/idempotency-keyscurrent");

    press(search, "ArrowDown");
    press(search, "ArrowDown");
    expect(activeText()).toBe("chore/deps-2026-09");
    const current = dialog().querySelector('[role="option"][aria-current="true"]');
    expect(current?.textContent).toBe("feat/idempotency-keyscurrent");
    expect(current?.getAttribute("aria-selected")).toBe("false");
    expect(dialog().querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(1);

    press(search, "ArrowUp");
    expect(activeText()).toBe("maindefault");
    press(search, "Enter");
    expect(next.onSwitch).toHaveBeenCalledWith({ name: "main", kind: "local", badge: "default" });
  });

  it("scrolls the keyboard-active option into view", () => {
    const scrolled: Array<{ readonly text: string | null; readonly options: unknown }> = [];
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value(this: Element, options?: unknown) {
        scrolled.push({ text: this.textContent, options });
      },
    });
    try {
      const host = render(props());
      click(trigger(host));
      scrolled.length = 0;
      const search = input("Search refs");
      press(search, "ArrowDown");
      press(search, "ArrowDown");
      expect(scrolled[scrolled.length - 1]).toEqual({
        text: "chore/deps-2026-09",
        options: { block: "nearest" },
      });
    } finally {
      if (original === undefined) Reflect.deleteProperty(Element.prototype, "scrollIntoView");
      if (original !== undefined)
        Object.defineProperty(Element.prototype, "scrollIntoView", original);
    }
  });

  it("keeps keyboard navigation working where scrollIntoView is unavailable", () => {
    expect("scrollIntoView" in Element.prototype).toBe(false);
    const next = props();
    const host = render(next);
    click(trigger(host));
    const search = input("Search refs");
    press(search, "ArrowDown");
    press(search, "Enter");
    expect(next.onSwitch).toHaveBeenCalledWith({ name: "main", kind: "local", badge: "default" });
  });

  it("selects the first match with Enter and closes on Escape returning focus", () => {
    const next = props();
    const host = render(next);
    click(trigger(host));
    type(input("Search refs"), "release");
    press(input("Search refs"), "Enter");
    expect(next.onSwitch).toHaveBeenCalledWith({
      name: "origin/release/1.4",
      kind: "remote",
      badge: "remote",
    });

    click(trigger(host));
    press(dialog(), "Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger(host));
  });
});
