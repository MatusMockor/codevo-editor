// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentFileEntry } from "../domain/recentFiles";
import { RecentFilesSwitcher } from "./RecentFilesSwitcher";

describe("RecentFilesSwitcher", () => {
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

  const entries: RecentFileEntry[] = [
    { name: "Previous.ts", path: "/workspace/src/Previous.ts" },
    { name: "Older.ts", path: "/workspace/src/Older.ts" },
  ];

  function render(props: Partial<Parameters<typeof RecentFilesSwitcher>[0]>) {
    const onClose = vi.fn();
    const onOpen = vi.fn();

    act(() => {
      root.render(
        <RecentFilesSwitcher
          entries={entries}
          isOpen
          onClose={onClose}
          onOpen={onOpen}
          {...props}
        />,
      );
    });

    return { onClose, onOpen };
  }

  it("renders nothing when closed", () => {
    act(() => {
      root.render(
        <RecentFilesSwitcher
          entries={entries}
          isOpen={false}
          onClose={vi.fn()}
          onOpen={vi.fn()}
        />,
      );
    });

    expect(host.querySelector(".quick-open")).toBeNull();
  });

  it("lists recent files most-recent first", () => {
    render({});

    const rows = Array.from(host.querySelectorAll(".quick-open-result strong"));
    expect(rows.map((row) => row.textContent)).toEqual([
      "Previous.ts",
      "Older.ts",
    ]);
  });

  it("pre-selects the first (previous) file", () => {
    render({});

    const rows = host.querySelectorAll(".quick-open-result");
    expect(rows[0]?.className).toContain("active");
    expect(rows[1]?.className).not.toContain("active");
  });

  it("opens the selected file on Enter", () => {
    const { onOpen } = render({});

    const list = host.querySelector<HTMLElement>(".quick-open-results");
    act(() => {
      list?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });

    expect(onOpen).toHaveBeenCalledWith(entries[0]);
  });

  it("moves selection down with ArrowDown before opening", () => {
    const { onOpen } = render({});

    const list = host.querySelector<HTMLElement>(".quick-open-results");
    act(() => {
      list?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
      );
    });
    act(() => {
      list?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });

    expect(onOpen).toHaveBeenCalledWith(entries[1]);
  });

  it("opens a file on click", () => {
    const { onOpen } = render({});

    const secondRow = host.querySelectorAll<HTMLButtonElement>(
      ".quick-open-result",
    )[1];
    act(() => {
      secondRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpen).toHaveBeenCalledWith(entries[1]);
  });

  it("closes on Escape", () => {
    const { onClose } = render({});

    const list = host.querySelector<HTMLElement>(".quick-open-results");
    act(() => {
      list?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when there are no recent files", () => {
    render({ entries: [] });

    expect(host.querySelector(".quick-open-state")?.textContent).toBe(
      "No recent files",
    );
  });
});
