import { describe, expect, it } from "vitest";
import { reorderPaths, reorderVisibleTabs } from "./tabOrdering";

describe("reorderPaths", () => {
  const paths = ["/a", "/b", "/c", "/d"];

  it("moves a tab left before the target", () => {
    expect(reorderPaths(paths, "/d", "/b", "before")).toEqual([
      "/a",
      "/d",
      "/b",
      "/c",
    ]);
  });

  it("moves a tab right after the target", () => {
    expect(reorderPaths(paths, "/a", "/c", "after")).toEqual([
      "/b",
      "/c",
      "/a",
      "/d",
    ]);
  });

  it("moves the first tab to the last position", () => {
    expect(reorderPaths(paths, "/a", "/d", "after")).toEqual([
      "/b",
      "/c",
      "/d",
      "/a",
    ]);
  });

  it("moves the last tab to the first position", () => {
    expect(reorderPaths(paths, "/d", "/a", "before")).toEqual([
      "/d",
      "/a",
      "/b",
      "/c",
    ]);
  });

  it("returns a new equal array for a same-position no-op", () => {
    const reordered = reorderPaths(paths, "/b", "/b", "after");

    expect(reordered).toEqual(paths);
    expect(reordered).not.toBe(paths);
  });

  it.each([
    ["missing source", "/missing", "/b"],
    ["missing target", "/b", "/missing"],
  ])("returns a new equal array for a %s no-op", (_name, fromPath, toPath) => {
    const reordered = reorderPaths(paths, fromPath, toPath, "before");

    expect(reordered).toEqual(paths);
    expect(reordered).not.toBe(paths);
  });
});

describe("reorderVisibleTabs", () => {
  it("reorders regular tabs without folding the preview into open paths", () => {
    expect(
      reorderVisibleTabs({
        fromPath: "/b",
        openPaths: ["/a", "/b"],
        position: "before",
        previewPath: "/preview",
        toPath: "/a",
      }),
    ).toEqual({
      openPaths: ["/b", "/a"],
      previewPath: "/preview",
    });
  });

  it("promotes a dragged preview into open paths at the target slot", () => {
    expect(
      reorderVisibleTabs({
        fromPath: "/preview",
        openPaths: ["/a", "/b"],
        position: "after",
        previewPath: "/preview",
        toPath: "/a",
      }),
    ).toEqual({
      openPaths: ["/a", "/preview", "/b"],
      previewPath: null,
    });
  });

  it("moves a regular tab to the end when dropped on the preview end anchor", () => {
    expect(
      reorderVisibleTabs({
        fromPath: "/a",
        openPaths: ["/a", "/b", "/c"],
        position: "before",
        previewPath: "/preview",
        toPath: "/preview",
      }),
    ).toEqual({
      openPaths: ["/b", "/c", "/a"],
      previewPath: "/preview",
    });
  });
});
