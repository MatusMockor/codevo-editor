import { describe, expect, it } from "vitest";
import {
  activateEditorGroupPath,
  closeEditorGroupPath,
  closeEditorGroup,
  closeEditorGroupTab,
  countDirtyEditorDocuments,
  countEditorGroupMemberships,
  createEditorGroup,
  createInitialEditorGroupsState,
  editorGroupPathReferenceCount,
  editorGroupsReducer,
  editorGroupsUniquePaths,
  isLastEditorGroupMembership,
  normalizeEditorGroupsState,
  openEditorGroupPath,
  reorderEditorGroupTabs,
  updateEditorGroupOpenPaths,
  updateEditorGroupPreviewPath,
} from "./editorGroups";
import { editorGroupIdsInLayout } from "./editorLayout";

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

describe("EditorGroupsState", () => {
  function twoGroups() {
    let state = createInitialEditorGroupsState("left", createEditorGroup({
      activePath: "/shared",
      openPaths: ["/a", "/shared"],
      previewPath: null,
    }));
    state = editorGroupsReducer(state, {
      type: "split-group",
      groupId: "left",
      newGroupId: "right",
      direction: "right",
    });
    return state;
  }

  it("migrates the one-element seam to a stable string identifier", () => {
    const legacy = [createEditorGroup({ activePath: "/a", openPaths: ["/a"], previewPath: null })];
    expect(normalizeEditorGroupsState(legacy, "editor-main")).toEqual({
      groups: { "editor-main": legacy[0] },
      activeGroupId: "editor-main",
      layout: { kind: "group", groupId: "editor-main" },
    });
  });

  it("splits the target and copies only its current-file membership", () => {
    const state = twoGroups();
    expect(state.activeGroupId).toBe("right");
    expect(state.groups.right).toEqual({
      activePath: "/shared",
      openPaths: ["/shared"],
      previewPath: null,
    });
    expect(editorGroupIdsInLayout(state.layout)).toEqual(["left", "right"]);
    expect(editorGroupsReducer(state, {
      type: "split-group",
      groupId: "missing",
      newGroupId: "other",
      direction: "down",
    })).toBe(state);
    expect(editorGroupsReducer(state, {
      type: "split-group",
      newGroupId: "right",
      direction: "down",
    })).toBe(state);
  });

  it("preserves preview status when copying current membership during split", () => {
    const initial = createInitialEditorGroupsState("one", {
      activePath: "/preview",
      openPaths: ["/pinned"],
      previewPath: "/preview",
    });
    const split = editorGroupsReducer(initial, {
      type: "split-group",
      newGroupId: "two",
      direction: "down",
    });
    expect(split.groups.two).toEqual({ activePath: "/preview", openPaths: [], previewPath: "/preview" });
  });

  it("keeps same-file memberships independent across groups", () => {
    let state = twoGroups();
    state = editorGroupsReducer(state, { type: "open-tab", groupId: "left", path: "/left-preview", preview: true });
    state = editorGroupsReducer(state, { type: "open-tab", groupId: "right", path: "/right-preview", preview: true });
    state = editorGroupsReducer(state, { type: "open-tab", groupId: "left", path: "/replacement", preview: true });
    expect(state.groups.left.previewPath).toBe("/replacement");
    expect(state.groups.right.previewPath).toBe("/right-preview");
  });

  it("reports non-final then final membership closure without owning documents", () => {
    const state = twoGroups();
    const first = closeEditorGroupTab(state, "left", "/shared");
    expect(first).toMatchObject({ membershipRemoved: true, finalMembershipRemoved: false });
    expect(editorGroupPathReferenceCount(first.state, "/shared")).toBe(1);
    const last = closeEditorGroupTab(first.state, "right", "/shared");
    expect(last).toMatchObject({ membershipRemoved: true, finalMembershipRemoved: true });
    expect(closeEditorGroupTab(last.state, "right", "/missing").state).toBe(last.state);
  });

  it("promotes a dirty preview in every group containing it", () => {
    let state = createInitialEditorGroupsState("one", { activePath: "/dirty", openPaths: [], previewPath: "/dirty" });
    state = editorGroupsReducer(state, { type: "split-group", newGroupId: "two", direction: "right" });
    state = editorGroupsReducer(state, { type: "promote-dirty-tab", path: "/dirty" });
    expect(state.groups.one).toMatchObject({ openPaths: ["/dirty"], previewPath: null });
    expect(state.groups.two).toMatchObject({ openPaths: ["/dirty"], previewPath: null });
  });

  it("opens, activates, pins, closes, and reorders tabs within the requested group", () => {
    let state = twoGroups();
    state = editorGroupsReducer(state, { type: "open-tab", groupId: "right", path: "/preview", preview: true });
    state = editorGroupsReducer(state, { type: "pin-tab", groupId: "right", path: "/preview" });
    state = editorGroupsReducer(state, { type: "open-tab", groupId: "right", path: "/last" });
    state = editorGroupsReducer(state, {
      type: "reorder-tab",
      groupId: "right",
      fromPath: "/last",
      toPath: "/shared",
      position: "before",
    });
    expect(state.groups.right.openPaths).toEqual(["/last", "/shared", "/preview"]);
    state = editorGroupsReducer(state, { type: "activate-tab", groupId: "right", path: "/shared" });
    expect(state.groups.right.activePath).toBe("/shared");
    const unchanged = editorGroupsReducer(state, {
      type: "reorder-tab",
      groupId: "right",
      fromPath: "/a",
      toPath: "/shared",
      position: "after",
    });
    expect(unchanged).toBe(state);
  });

  it("moves and copies tabs between valid groups and rejects cross-group mistakes", () => {
    let state = twoGroups();
    state = editorGroupsReducer(state, {
      type: "transfer-tab",
      fromGroupId: "left",
      toGroupId: "right",
      path: "/a",
      mode: "copy",
    });
    expect(state.groups.left.openPaths).toContain("/a");
    expect(state.groups.right.openPaths).toContain("/a");
    state = editorGroupsReducer(state, {
      type: "transfer-tab",
      fromGroupId: "left",
      toGroupId: "right",
      path: "/a",
      mode: "move",
    });
    expect(state.groups.left.openPaths).not.toContain("/a");
    const unchanged = editorGroupsReducer(state, {
      type: "transfer-tab",
      fromGroupId: "left",
      toGroupId: "missing",
      path: "/shared",
      mode: "move",
    });
    expect(unchanged).toBe(state);
  });

  it("closes nested groups, normalizes the tree, and retains one empty group", () => {
    let state = twoGroups();
    state = editorGroupsReducer(state, { type: "split-group", groupId: "right", newGroupId: "bottom", direction: "down" });
    state = editorGroupsReducer(state, { type: "activate-group", groupId: "bottom" });
    const closed = closeEditorGroup(state, "right");
    expect(closed.closed).toBe(true);
    expect(editorGroupIdsInLayout(closed.state.layout)).toEqual(["left", "bottom"]);
    expect(closed.state.activeGroupId).toBe("bottom");
    const withoutBottom = closeEditorGroup(closed.state, "bottom");
    expect(withoutBottom.state.activeGroupId).toBe("left");
    const last = closeEditorGroup(withoutBottom.state, "left");
    expect(last.closed).toBe(false);
    expect(last.state.groups.left).toEqual(createEditorGroup());
  });

  it("activates the adjacent group when the active nested group closes", () => {
    let state = twoGroups();
    state = editorGroupsReducer(state, {
      type: "split-group",
      groupId: "right",
      newGroupId: "bottom",
      direction: "down",
    });
    expect(closeEditorGroup(state, "bottom").state.activeGroupId).toBe("right");
  });

  it("repairs malformed state while retaining valid groups and a stable active group", () => {
    const repaired = normalizeEditorGroupsState({
      groups: {
        one: { activePath: "/a", openPaths: ["/a", "/a"], previewPath: null },
        two: { activePath: "/b", openPaths: ["/b"], previewPath: null },
      },
      activeGroupId: "two",
      layout: { kind: "split", children: [{ kind: "group", groupId: "missing" }] },
    }, "fallback");
    expect(Object.keys(repaired.groups)).toEqual(["one", "two"]);
    expect(new Set(editorGroupIdsInLayout(repaired.layout))).toEqual(new Set(["one", "two"]));
    expect(repaired.activeGroupId).toBe("two");
    expect(repaired.groups.one.openPaths).toEqual(["/a"]);
  });

  it("remaps paths everywhere and handles destination collisions", () => {
    let state = twoGroups();
    state = editorGroupsReducer(state, { type: "remap-path", fromPath: "/shared", toPath: "/renamed" });
    expect(editorGroupPathReferenceCount(state, "/renamed")).toBe(2);
    expect(state.groups.left.activePath).toBe("/renamed");
    let collision = editorGroupsReducer(state, { type: "open-tab", groupId: "left", path: "/preview", preview: true });
    collision = editorGroupsReducer(collision, { type: "remap-path", fromPath: "/preview", toPath: "/a" });
    expect(collision.groups.left.openPaths).toContain("/a");
    expect(collision.groups.left.previewPath).toBeNull();

    let reverseCollision = editorGroupsReducer(state, {
      type: "open-tab",
      groupId: "left",
      path: "/preview",
      preview: true,
    });
    reverseCollision = editorGroupsReducer(reverseCollision, {
      type: "remap-path",
      fromPath: "/a",
      toPath: "/preview",
    });
    expect(reverseCollision.groups.left.openPaths).toContain("/preview");
    expect(reverseCollision.groups.left.previewPath).toBeNull();
  });

  it("treats prototype property names as group IDs only when they are own properties", () => {
    const state = createInitialEditorGroupsState("main");
    expect(editorGroupsReducer(state, {
      type: "activate-group",
      groupId: "toString",
    })).toBe(state);
    expect(editorGroupsReducer(state, {
      type: "open-tab",
      groupId: "toString",
      path: "/a",
    })).toBe(state);
    expect(editorGroupsReducer(state, {
      type: "split-group",
      groupId: "toString",
      newGroupId: "other",
      direction: "right",
    })).toBe(state);

    const normalized = normalizeEditorGroupsState({
      groups: Object.assign(Object.create(null), {
        toString: {
          activePath: "/a",
          openPaths: ["/a"],
          previewPath: null,
        },
      }),
      activeGroupId: "toString",
      layout: { kind: "group", groupId: "toString" },
    }, "fallback");
    const prototypeGroupId: string = "toString";
    expect(normalized.activeGroupId).toBe(prototypeGroupId);
    expect(normalized.groups[prototypeGroupId].openPaths).toEqual(["/a"]);
    const opened = editorGroupsReducer(normalized, {
      type: "open-tab",
      groupId: prototypeGroupId,
      path: "/b",
    });
    expect(opened.groups[prototypeGroupId].openPaths).toEqual(["/a", "/b"]);
  });

  it("distinguishes unique dirty documents from group memberships", () => {
    const state = twoGroups();
    expect(editorGroupsUniquePaths(state)).toEqual(["/a", "/shared"]);
    expect(countEditorGroupMemberships(state)).toBe(3);
    expect(countDirtyEditorDocuments(state, new Set(["/shared"]))).toEqual({
      uniqueDocuments: 1,
      memberships: 2,
    });
    expect(isLastEditorGroupMembership(state, "left", "/a")).toBe(true);
    expect(isLastEditorGroupMembership(state, "left", "/shared")).toBe(false);
  });

  it("clamps splitter resizing through the reducer", () => {
    const resized = editorGroupsReducer(twoGroups(), {
      type: "resize-split",
      splitPath: [],
      sizes: [100, 0],
    });
    expect(resized.layout).toMatchObject({ sizes: [0.9, 0.09999999999999998] });
    expect(editorGroupsReducer(resized, { type: "resize-split", splitPath: [4], sizes: [1, 1] })).toBe(resized);
  });
});
