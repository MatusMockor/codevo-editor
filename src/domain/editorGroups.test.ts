import { describe, expect, it } from "vitest";
import {
  activateEditorGroupPath,
  closeEditorGroupPath,
  createEditorGroup,
  openEditorGroupPath,
  reorderEditorGroupTabs,
  updateEditorGroupOpenPaths,
  updateEditorGroupPreviewPath,
} from "./editorGroups";

describe("editorGroups", () => {
  const group = createEditorGroup({
    activePath: "/b",
    openPaths: ["/a", "/b"],
    previewPath: "/preview",
  });

  it("creates an empty group by default", () => {
    expect(createEditorGroup()).toEqual({
      activePath: null,
      openPaths: [],
      previewPath: null,
    });
  });

  it("activates a path without changing tab membership", () => {
    expect(activateEditorGroupPath(group, "/a")).toEqual({
      ...group,
      activePath: "/a",
    });
  });

  it("adopts an existing open transition without recomputing it", () => {
    expect(
      openEditorGroupPath(group, {
        nextActivePath: "/c",
        nextOpenPaths: ["/a", "/b", "/c"],
        nextPreviewPath: null,
      }),
    ).toEqual({
      activePath: "/c",
      openPaths: ["/a", "/b", "/c"],
      previewPath: null,
    });
  });

  it.each([
    {
      expected: {
        activePath: "/b",
        openPaths: ["/b"],
        previewPath: "/preview",
      },
      name: "inactive pinned tab",
      path: "/a",
    },
    {
      expected: {
        activePath: "/preview",
        openPaths: ["/a"],
        previewPath: "/preview",
      },
      name: "active pinned tab",
      path: "/b",
    },
    {
      expected: {
        activePath: "/b",
        openPaths: ["/a", "/b"],
        previewPath: null,
      },
      name: "inactive preview tab",
      path: "/preview",
    },
  ])("closes an $name", ({ expected, path }) => {
    expect(closeEditorGroupPath(group, path)).toEqual(expected);
  });

  it("reorders regular and preview tabs with the shared ordering rules", () => {
    expect(
      reorderEditorGroupTabs(group, {
        fromPath: "/preview",
        position: "after",
        toPath: "/a",
      }),
    ).toEqual({
      activePath: "/b",
      openPaths: ["/a", "/preview", "/b"],
      previewPath: null,
    });
  });

  it("supports React-style field updates while preserving other fields", () => {
    const withOpenPaths = updateEditorGroupOpenPaths(group, (paths) => [
      ...paths,
      "/c",
    ]);
    const withPreview = updateEditorGroupPreviewPath(
      withOpenPaths,
      (path) => (path === "/preview" ? null : path),
    );

    expect(withPreview).toEqual({
      activePath: "/b",
      openPaths: ["/a", "/b", "/c"],
      previewPath: null,
    });
    expect(group).toEqual({
      activePath: "/b",
      openPaths: ["/a", "/b"],
      previewPath: "/preview",
    });
  });
});
