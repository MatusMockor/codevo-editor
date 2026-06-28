// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStashEntry } from "../domain/git";
import { GitStashPanel } from "./GitStashPanel";

describe("GitStashPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const stashes: GitStashEntry[] = [
    { branch: "main", index: 0, message: "WIP on main: a", timestamp: 1700000000 },
    { branch: null, index: 1, message: "On feature: b", timestamp: 1700100000 },
  ];

  function renderPanel(overrides: Partial<Parameters<typeof GitStashPanel>[0]> = {}) {
    const props = {
      diff: null,
      diffLoading: false,
      isLoading: false,
      isOpen: true,
      message: "",
      onApply: vi.fn(),
      onClose: vi.fn(),
      onDrop: vi.fn(),
      onMessageChange: vi.fn(),
      onPop: vi.fn(),
      onSave: vi.fn(),
      onSelect: vi.fn(),
      selectedIndex: null,
      stashes,
      ...overrides,
    };

    act(() => {
      root.render(<GitStashPanel {...props} />);
    });

    return props;
  }

  it("renders nothing when closed", () => {
    renderPanel({ isOpen: false });

    expect(host.querySelector(".git-stash-panel")).toBeNull();
  });

  it("lists stashes with their messages", () => {
    renderPanel();

    const rows = host.querySelectorAll(".git-stash-row");
    expect(rows).toHaveLength(2);
    expect(host.textContent).toContain("WIP on main: a");
    expect(host.textContent).toContain("On feature: b");
  });

  it("invokes save with the entered message", () => {
    const props = renderPanel({ message: "save me" });

    const button = host.querySelector(
      '[aria-label="Stash working tree changes"]',
    ) as HTMLButtonElement;
    act(() => {
      button.click();
    });

    expect(props.onSave).toHaveBeenCalledWith("save me");
  });

  it("invokes apply and pop for a stash", () => {
    const props = renderPanel();

    const apply = host.querySelector(
      '[aria-label="Apply stash 0"]',
    ) as HTMLButtonElement;
    const pop = host.querySelector(
      '[aria-label="Pop stash 1"]',
    ) as HTMLButtonElement;

    act(() => apply.click());
    act(() => pop.click());

    expect(props.onApply).toHaveBeenCalledWith(0);
    expect(props.onPop).toHaveBeenCalledWith(1);
  });

  it("requires an inline confirmation before dropping a stash", () => {
    const props = renderPanel();

    const drop = host.querySelector(
      '[aria-label="Drop stash 0"]',
    ) as HTMLButtonElement;
    act(() => drop.click());

    // First click only arms the destructive confirmation; it must not drop yet.
    expect(props.onDrop).not.toHaveBeenCalled();

    const confirm = host.querySelector(
      '[aria-label="Confirm drop stash 0"]',
    ) as HTMLButtonElement;
    expect(confirm).not.toBeNull();
    act(() => confirm.click());

    expect(props.onDrop).toHaveBeenCalledWith(0);
  });

  it("selects a stash to preview its diff", () => {
    const props = renderPanel();

    const row = host.querySelectorAll(".git-stash-row")[1] as HTMLButtonElement;
    act(() => row.click());

    expect(props.onSelect).toHaveBeenCalledWith(1);
  });
});
