// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPickerMenu, type AgentPickerMenuProps } from "./AgentPickerMenu";
import { agentPickerOption } from "./agentPickerOption";

function repositoryOptions(count: number, prefix = "repo") {
  return [
    agentPickerOption("in-place", "Local checkout"),
    agentPickerOption("worktree", "Isolated worktree"),
    agentPickerOption(
      "root:/project",
      "Project",
      "Project folder",
      null,
      null,
      null,
      "Run in repository",
      true,
    ),
    ...Array.from({ length: count }, (_, index) =>
      agentPickerOption(
        `root:/project/packages/${prefix}-${index}`,
        `${prefix}-${index}`,
        null,
        null,
        null,
        null,
        "Run in repository",
      ),
    ),
  ];
}

describe("checkout repository search", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("keeps the six-repository menu unchanged and adds search at twelve", () => {
    render({ options: repositoryOptions(6) });
    click(trigger());
    expect(host.querySelector('input[type="search"]')).toBeNull();
    expect(rows()).toHaveLength(9);
    expect(document.activeElement?.getAttribute("data-value")).toBe("in-place");
    render({ options: repositoryOptions(12) });
    expect(search()).not.toBeNull();
    expect(rows()).toHaveLength(15);
    expect(document.activeElement).toBe(search());
    expect(host.querySelector('[role="listbox"]')?.contains(search())).toBe(false);
  });

  it("bounds 500 repositories to fifty rows and reaches every page", () => {
    const onChange = vi.fn();
    render({ options: repositoryOptions(500), onChange });
    click(trigger());
    expect(rows()).toHaveLength(53);
    expect(host.textContent).toContain("1–50 of 500 repositories");
    const seen = new Set<string>();
    for (let page = 0; page < 10; page += 1) {
      expect(rows()).toHaveLength(53);
      for (const row of rows().slice(3)) seen.add(row.dataset.value ?? "");
      if (page < 9) click(button("Next repository page"));
    }
    expect(seen.size).toBe(500);
    expect(button("Next repository page").disabled).toBe(true);
    expect(host.textContent).toContain("451–500 of 500 repositories");
    click(rows()[52]);
    expect(onChange).toHaveBeenCalledWith("root:/project/packages/repo-499");
    expect(document.activeElement).toBe(trigger());
  });

  it("matches literal labels and full paths without hiding isolation or the project folder", async () => {
    render({ options: repositoryOptions(500) });
    click(trigger());
    input("PACKAGES/REPO-49");
    expect(rows()).toHaveLength(3);
    expect(host.textContent).toContain("Searching repositories…");
    await settle();
    expect(rows()).toHaveLength(14);
    expect(host.textContent).toContain("1–11 of 11 repositories");
    expect(document.activeElement).toBe(search());
    input("[repo.*]");
    await settle();
    expect(rows().map((row) => row.dataset.value)).toEqual([
      "in-place",
      "worktree",
      "root:/project",
    ]);
    expect(host.textContent).toContain("No matching repositories");
    keydown(search(), "ArrowDown");
    expect(document.activeElement).toBe(search());
    input("");
    expect(rows()).toHaveLength(53);
    expect(host.textContent).toContain("1–50 of 500 repositories");
  });

  it("keeps input editing and IME keys separate from list navigation and selection", async () => {
    const onChange = vi.fn();
    render({ options: repositoryOptions(100), onChange });
    click(trigger());
    for (const key of [" ", "Home", "End"])
      expect(keydown(search(), key).defaultPrevented).toBe(false);
    keydown(search(), "Enter");
    expect(onChange).not.toHaveBeenCalled();
    expect(keydown(search(), "Escape", true).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(search());
    input("repo-99");
    keydown(search(), "ArrowDown");
    expect(document.activeElement).toBe(search());
    await settle();
    expect(document.activeElement).toBe(search());
    keydown(search(), "ArrowDown");
    expect(document.activeElement?.getAttribute("data-value")).toBe(
      "root:/project/packages/repo-99",
    );
    keydown(rows()[3]!, "Enter");
    expect(onChange).toHaveBeenCalledWith("root:/project/packages/repo-99");
  });

  it("does not let hover or asynchronous results steal input focus", async () => {
    render({ options: repositoryOptions(500) });
    click(trigger());
    act(() => rows()[20]?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(document.activeElement).toBe(search());
    input("repo-4");
    await settle();
    expect(document.activeElement).toBe(search());
    keydown(search(), "Escape");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("cancels superseded queries and does not publish a previous option snapshot", async () => {
    const oldOptions = repositoryOptions(500, "old");
    render({ options: oldOptions });
    click(trigger());
    input("old-49");
    await act(async () => vi.advanceTimersByTimeAsync(100));
    input("old-2");
    render({ options: repositoryOptions(500, "new") });
    expect(search().value).toBe("");
    expect(rows().some((row) => row.textContent?.includes("old-"))).toBe(false);
    await settle();
    expect(host.textContent).not.toContain("old-");
    input("new-499");
    click(trigger());
    await settle();
    click(trigger());
    expect(search().value).toBe("");
    expect(rows()).toHaveLength(53);
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("caps query input and retains normal keyboard behavior on page controls", async () => {
    render({ options: repositoryOptions(101) });
    click(trigger());
    expect(search().maxLength).toBe(256);
    input("x".repeat(300));
    expect(search().value).toHaveLength(256);
    input("");
    const next = button("Next repository page");
    act(() => next.focus());
    expect(keydown(next, " ").defaultPrevented).toBe(false);
    click(next);
    expect(document.activeElement).toBe(next);
    expect(host.textContent).toContain("51–100 of 101 repositories");
    keydown(next, "Escape");
    expect(document.activeElement).toBe(trigger());
    await settle();
  });

  it("reports entries beyond the search limit and lets users browse them after clearing", async () => {
    const options = [
      ...repositoryOptions(12),
      agentPickerOption(
        "root:/project/large",
        "x".repeat(4097),
        null,
        null,
        null,
        null,
        "Run in repository",
      ),
    ];
    render({ options });
    click(trigger());
    expect(host.textContent).toContain("name exceeds display limit");
    input("repo");
    await settle();
    expect(host.textContent).toContain(
      "1 repositories exceed the search limit. Clear search to browse them.",
    );
    expect(rows()).toHaveLength(15);
    input("");
    expect(rows()).toHaveLength(16);
    expect(host.textContent).not.toContain("exceed the search limit");
  });

  it("reduces rendered repository work while preserving generic menus", async () => {
    const renderIcon = vi.fn();
    function Icon() {
      renderIcon();
      return <svg />;
    }
    const options = repositoryOptions(500).map((option, index) =>
      index < 3 ? option : { ...option, icon: <Icon /> },
    );
    render({ options, menuLayout: "default" });
    click(trigger());
    expect(renderIcon).toHaveBeenCalledTimes(500);
    const previousNodes = host.querySelectorAll("*").length;
    expect(host.querySelector('input[type="search"]')).toBeNull();
    click(trigger());
    renderIcon.mockClear();
    render({ options });
    click(trigger());
    expect(renderIcon).toHaveBeenCalledTimes(50);
    expect(host.querySelectorAll("*").length).toBeLessThan(previousNodes / 5);
    renderIcon.mockClear();
    input("repo-499");
    await settle();
    expect(renderIcon).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(4);
  });

  function render(overrides: Partial<AgentPickerMenuProps>) {
    act(() =>
      root.render(
        <AgentPickerMenu
          id="checkout"
          label="Checkout"
          value="in-place"
          options={[]}
          disabled={false}
          tone={null}
          prefix={null}
          describedBy={null}
          align="start"
          menuLayout="checkout"
          onChange={() => undefined}
          {...overrides}
        />,
      ),
    );
  }
  function trigger() {
    return host.querySelector<HTMLButtonElement>("#checkout")!;
  }
  function search() {
    return host.querySelector<HTMLInputElement>('input[type="search"]')!;
  }
  function rows() {
    return [...host.querySelectorAll<HTMLElement>('[role="option"]')];
  }
  function button(label: string) {
    return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  }
  function click(element: HTMLElement | undefined) {
    act(() => element?.click());
  }
  function input(value: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        search(),
        value,
      );
      search().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  function keydown(element: HTMLElement, key: string, isComposing = false) {
    const event = new KeyboardEvent("keydown", {
      key,
      isComposing,
      bubbles: true,
      cancelable: true,
    });
    act(() => element.dispatchEvent(event));
    return event;
  }
  async function settle() {
    await act(async () => vi.runAllTimersAsync());
  }
});
