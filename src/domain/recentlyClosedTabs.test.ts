import { describe, expect, it } from "vitest";
import {
  clearRecentlyClosedTabs,
  emptyRecentlyClosedTabs,
  hasRecentlyClosedTabs,
  popRecentlyClosedTab,
  pushRecentlyClosedTab,
} from "./recentlyClosedTabs";

describe("recentlyClosedTabs", () => {
  it("pushes entries and pops them in LIFO order", () => {
    let tabs = emptyRecentlyClosedTabs();
    tabs = pushRecentlyClosedTab(tabs, "/a", { path: "/a/one.ts" });
    tabs = pushRecentlyClosedTab(tabs, "/a", { path: "/a/two.ts" });

    const first = popRecentlyClosedTab(tabs, "/a");
    const second = popRecentlyClosedTab(first.tabs, "/a");

    expect(first.entry?.path).toBe("/a/two.ts");
    expect(second.entry?.path).toBe("/a/one.ts");
    expect(hasRecentlyClosedTabs(second.tabs, "/a")).toBe(false);
  });

  it("caps each workspace stack at ten entries", () => {
    let tabs = emptyRecentlyClosedTabs();

    for (let index = 1; index <= 11; index += 1) {
      tabs = pushRecentlyClosedTab(tabs, "/a", {
        path: `/a/${index}.ts`,
      });
    }

    const paths: string[] = [];
    while (hasRecentlyClosedTabs(tabs, "/a")) {
      const popped = popRecentlyClosedTab(tabs, "/a");
      tabs = popped.tabs;
      paths.push(popped.entry?.path ?? "");
    }

    expect(paths).toEqual([
      "/a/11.ts",
      "/a/10.ts",
      "/a/9.ts",
      "/a/8.ts",
      "/a/7.ts",
      "/a/6.ts",
      "/a/5.ts",
      "/a/4.ts",
      "/a/3.ts",
      "/a/2.ts",
    ]);
  });

  it("deduplicates a path by moving its newest view state to the front", () => {
    let tabs = emptyRecentlyClosedTabs();
    tabs = pushRecentlyClosedTab(tabs, "/a", { path: "/a/one.ts" });
    tabs = pushRecentlyClosedTab(tabs, "/a", { path: "/a/two.ts" });
    tabs = pushRecentlyClosedTab(tabs, "/a", {
      path: "/a/one.ts",
      viewState: { column: 5, line: 8 },
    });

    const first = popRecentlyClosedTab(tabs, "/a");
    const second = popRecentlyClosedTab(first.tabs, "/a");

    expect(first.entry).toEqual({
      path: "/a/one.ts",
      viewState: { column: 5, line: 8 },
    });
    expect(second.entry?.path).toBe("/a/two.ts");
    expect(popRecentlyClosedTab(second.tabs, "/a").entry).toBeNull();
  });

  it("keeps workspace roots isolated during push, pop, and clear", () => {
    let tabs = emptyRecentlyClosedTabs();
    tabs = pushRecentlyClosedTab(tabs, "/a", { path: "/a/one.ts" });
    tabs = pushRecentlyClosedTab(tabs, "/b", { path: "/b/one.ts" });

    const poppedA = popRecentlyClosedTab(tabs, "/a");

    expect(poppedA.entry?.path).toBe("/a/one.ts");
    expect(hasRecentlyClosedTabs(poppedA.tabs, "/a")).toBe(false);
    expect(hasRecentlyClosedTabs(poppedA.tabs, "/b")).toBe(true);

    const clearedB = clearRecentlyClosedTabs(poppedA.tabs, "/b");

    expect(hasRecentlyClosedTabs(clearedB, "/a")).toBe(false);
    expect(hasRecentlyClosedTabs(clearedB, "/b")).toBe(false);
  });

  it("clears a stack through a trailing-slash root variant", () => {
    const tabs = pushRecentlyClosedTab(emptyRecentlyClosedTabs(), "/workspace", {
      path: "/workspace/example.ts",
    });

    const cleared = clearRecentlyClosedTabs(tabs, "/workspace/");

    expect(hasRecentlyClosedTabs(cleared, "/workspace")).toBe(false);
  });
});
