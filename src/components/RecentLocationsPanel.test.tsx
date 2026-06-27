// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentLocation } from "../domain/recentLocations";
import { RecentLocationsPanel } from "./RecentLocationsPanel";

describe("RecentLocationsPanel", () => {
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

  const locations: RecentLocation[] = [
    {
      column: 5,
      line: 42,
      name: "Order.php",
      path: "/workspace/app/Order.php",
      relativePath: "app/Order.php",
      snippet: "public function total(): int",
    },
    {
      column: 1,
      line: 7,
      name: "User.php",
      path: "/workspace/app/User.php",
      relativePath: "app/User.php",
      snippet: "class User extends Model",
    },
  ];

  function render(
    props: Partial<Parameters<typeof RecentLocationsPanel>[0]> = {},
  ) {
    const onClose = vi.fn();
    const onOpen = vi.fn();

    act(() => {
      root.render(
        <RecentLocationsPanel
          isOpen
          locations={locations}
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
        <RecentLocationsPanel
          isOpen={false}
          locations={locations}
          onClose={vi.fn()}
          onOpen={vi.fn()}
        />,
      );
    });

    expect(host.querySelector(".quick-open")).toBeNull();
  });

  it("renders a footer hint row", () => {
    render();
    expect(host.querySelector(".palette-footer")).not.toBeNull();
  });

  it("lists locations most-recent first with name, line and context snippet", () => {
    render();

    const names = Array.from(
      host.querySelectorAll(".quick-open-result strong"),
    ).map((node) => node.textContent);
    expect(names).toEqual(["Order.php:42", "User.php:7"]);

    const snippets = Array.from(
      host.querySelectorAll(".recent-location-snippet"),
    ).map((node) => node.textContent);
    expect(snippets).toEqual([
      "public function total(): int",
      "class User extends Model",
    ]);
  });

  it("pre-selects the first (most recent) location", () => {
    render();

    const rows = host.querySelectorAll(".quick-open-result");
    expect(rows[0]?.className).toContain("active");
    expect(rows[1]?.className).not.toContain("active");
  });

  it("opens the selected location on Enter", () => {
    const { onOpen } = render();

    const list = host.querySelector<HTMLElement>(".quick-open-results");
    act(() => {
      list?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
    });

    expect(onOpen).toHaveBeenCalledWith(locations[0]);
  });

  it("moves selection down with ArrowDown before opening", () => {
    const { onOpen } = render();

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

    expect(onOpen).toHaveBeenCalledWith(locations[1]);
  });

  it("opens a location on click", () => {
    const { onOpen } = render();

    const secondRow = host.querySelectorAll<HTMLButtonElement>(
      ".quick-open-result",
    )[1];
    act(() => {
      secondRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpen).toHaveBeenCalledWith(locations[1]);
  });

  it("closes on Escape", () => {
    const { onClose } = render();

    const list = host.querySelector<HTMLElement>(".quick-open-results");
    act(() => {
      list?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when there are no recent locations", () => {
    render({ locations: [] });

    expect(host.querySelector(".quick-open-state")?.textContent).toBe(
      "No recent locations",
    );
  });
});
