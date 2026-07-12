import { describe, expect, it } from "vitest";
import {
  currentWorkspaceSession,
  currentWorkspaceSessionForEditorGroups,
  documentSessionPathTransitionForOpenedPath,
  isPersistableEditorDocumentPath,
  isSessionPathInWorkspace,
  pinDocumentSessionPath,
  replaceableDocumentSessionPreview,
  restoredActivePath,
  restoredBottomPanelView,
  restoreWorkspaceSession,
  workspaceSessionsEqual,
} from "./documentSessionState";
import type { WorkspaceSessionState } from "../domain/settings";
import type { EditorGroupsState } from "../domain/editorGroups";

describe("documentSessionState", () => {
  it("restores the requested active path when it is still available", () => {
    expect(
      restoredActivePath("/workspace/B.php", [
        "/workspace/A.php",
        "/workspace/B.php",
      ]),
    ).toBe("/workspace/B.php");
  });

  it("falls back to the first restored path when the active path is unavailable", () => {
    expect(
      restoredActivePath("/workspace/Missing.php", ["/workspace/A.php"]),
    ).toBe("/workspace/A.php");
    expect(restoredActivePath(null, [])).toBeNull();
  });

  it("filters transient diff documents from persisted workspace sessions", () => {
    expect(isPersistableEditorDocumentPath("/workspace/A.php")).toBe(true);
    expect(
      isPersistableEditorDocumentPath("mockor-git-diff:worktree:/workspace/A.php"),
    ).toBe(false);
    expect(
      isPersistableEditorDocumentPath(
        "mockor-git-history-diff:/workspace/A.php",
      ),
    ).toBe(false);
  });

  it("explicitly excludes Markdown preview paths from persistence", () => {
    expect(
      isPersistableEditorDocumentPath(
        "mockor-markdown-preview:/workspace/README.md",
      ),
    ).toBe(false);
  });

  it("leaves real filesystem image paths eligible for document-backed filtering", () => {
    expect(
      isPersistableEditorDocumentPath("/workspace/assets/screenshot.png"),
    ).toBe(true);
  });

  it("keeps session paths scoped to the workspace root", () => {
    expect(isSessionPathInWorkspace("/workspace", "/workspace/src/A.php")).toBe(
      true,
    );
    expect(isSessionPathInWorkspace("/workspace/", "/workspace")).toBe(true);
    expect(
      isSessionPathInWorkspace("C:\\workspace", "C:\\workspace\\src\\A.php"),
    ).toBe(true);
    expect(isSessionPathInWorkspace("/workspace", "/workspace-other/A.php"))
      .toBe(false);
  });

  it("lexically resolves dot segments before checking project isolation", () => {
    expect(
      isSessionPathInWorkspace(
        "/Users/matus/Developer/project-a",
        "/Users/matus/Developer/project-a/./src/../src/A.ts",
      ),
    ).toBe(true);
    expect(
      isSessionPathInWorkspace(
        "/Users/matus/Developer/project-a/./",
        "/Users/matus/Developer/project-a/src/A.ts",
      ),
    ).toBe(true);
    expect(
      isSessionPathInWorkspace(
        "/Users/Matus Mockor/Developer/Project A",
        "/Users/Matus Mockor/Developer/Project A/src/Feature.ts",
      ),
    ).toBe(true);
    expect(
      isSessionPathInWorkspace(
        "/Users/matus/Developer/project-a",
        "/Users/matus/Developer/project-a/../project-b/Secret.ts",
      ),
    ).toBe(false);
    expect(
      isSessionPathInWorkspace(
        "C:\\projects\\project-a",
        "C:\\projects\\project-a\\src\\..\\..\\project-b\\Secret.ts",
      ),
    ).toBe(false);
  });

  it("keeps UNC authorities immutable during lexical traversal", () => {
    expect(
      isSessionPathInWorkspace(
        "\\\\server\\share",
        "\\\\server\\share\\project\\A.ts",
      ),
    ).toBe(true);
    expect(
      isSessionPathInWorkspace(
        "\\\\foreign-server\\foreign-share",
        "\\\\server\\share\\..\\..\\foreign-server\\foreign-share\\Secret.ts",
      ),
    ).toBe(false);
  });

  it("treats a Windows drive root as the parent of its drive paths", () => {
    expect(isSessionPathInWorkspace("C:\\", "C:\\project\\A.ts")).toBe(true);
    expect(isSessionPathInWorkspace("C:\\", "D:\\project\\A.ts")).toBe(false);
  });

  it("builds a persisted workspace session from visible pinned editor paths", () => {
    expect(
      currentWorkspaceSession(
        "/workspace",
        [
          "/workspace/A.php",
          "mockor-git-diff:worktree:/workspace/B.php",
          "/other/C.php",
          "/workspace/D.php",
        ],
        "/workspace/D.php",
        "php",
        "terminal",
      ),
    ).toMatchObject({
      bottomPanelView: "problems",
      editor: {
        groups: {
          "editor-main": {
            activePath: "/workspace/D.php",
            openPaths: ["/workspace/A.php", "/workspace/D.php"],
            previewPath: null,
          },
        },
      },
      sidebarView: "php",
      version: 1,
    });
  });

  it("captures a preview path and only view positions for persisted paths", () => {
    expect(
      currentWorkspaceSession(
        "/workspace",
        ["/workspace/Pinned.php"],
        "/workspace/Preview.php",
        "files",
        "problems",
        "/workspace/Preview.php",
        {
          "/other/Outside.php": { column: 1, line: 1 },
          "/workspace/Pinned.php": { column: 3, line: 2, scrollTop: 80 },
          "/workspace/Preview.php": { column: 7, line: 5 },
        },
      ),
    ).toMatchObject({
      bottomPanelView: "problems",
      editor: {
        groups: {
          "editor-main": {
            activePath: "/workspace/Preview.php",
            openPaths: ["/workspace/Pinned.php"],
            previewPath: "/workspace/Preview.php",
          },
        },
      },
      sidebarView: "files",
      viewStates: {
        "editor-main": {
          "/workspace/Pinned.php": { column: 3, line: 2, scrollTop: 80 },
          "/workspace/Preview.php": { column: 7, line: 5 },
        },
      },
    });
  });

  it("clears the active path when it is not in the persisted session paths", () => {
    expect(
      currentWorkspaceSession(
        "/workspace",
        ["/workspace/A.php"],
        "mockor-git-diff:worktree:/workspace/B.php",
        "git",
        "history",
      ).editor.groups["editor-main"].activePath,
    ).toBe("/workspace/A.php");
  });

  it("computes preview replacement paths without dropping pinned tabs", () => {
    const pinnedPath = "/workspace/Pinned.php";
    const previousPreviewPath = "/workspace/Preview.php";
    const nextPath = "/workspace/Next.php";

    expect(
      documentSessionPathTransitionForOpenedPath({
        openPaths: [pinnedPath],
        path: nextPath,
        pin: false,
        replacedPath: previousPreviewPath,
      }),
    ).toEqual({
      nextActivePath: nextPath,
      nextOpenPaths: [pinnedPath],
      nextPreviewPath: nextPath,
    });
  });

  it("replaces a pinned path in-place when a pinned open supersedes it", () => {
    expect(
      documentSessionPathTransitionForOpenedPath({
        openPaths: ["/workspace/A.php", "/workspace/Preview.php"],
        path: "/workspace/B.php",
        pin: true,
        replacedPath: "/workspace/Preview.php",
      }),
    ).toEqual({
      nextActivePath: "/workspace/B.php",
      nextOpenPaths: ["/workspace/A.php", "/workspace/B.php"],
      nextPreviewPath: null,
    });
  });

  it("pins a preview document by adding it to open paths and clearing preview state", () => {
    expect(
      pinDocumentSessionPath(
        ["/workspace/A.php"],
        "/workspace/Preview.php",
        "/workspace/Preview.php",
      ),
    ).toEqual({
      nextOpenPaths: ["/workspace/A.php", "/workspace/Preview.php"],
      nextPreviewPath: null,
    });
  });

  it("selects only clean unpinned preview documents for replacement", () => {
    const cleanPreview = {
      content: "<?php\nfinal class Preview {}\n",
      path: "/workspace/Preview.php",
      savedContent: "<?php\nfinal class Preview {}\n",
    };
    const dirtyPreview = {
      content: "<?php\nfinal class DirtyChanged {}\n",
      path: "/workspace/Dirty.php",
      savedContent: "<?php\nfinal class Dirty {}\n",
    };

    expect(
      replaceableDocumentSessionPreview(
        cleanPreview,
        { [cleanPreview.path]: cleanPreview },
        [],
        cleanPreview.path,
      ),
    ).toBe(cleanPreview);
    expect(
      replaceableDocumentSessionPreview(
        cleanPreview,
        { [cleanPreview.path]: cleanPreview },
        [cleanPreview.path],
        cleanPreview.path,
      ),
    ).toBeNull();
    expect(
      replaceableDocumentSessionPreview(
        dirtyPreview,
        { [dirtyPreview.path]: dirtyPreview },
        [],
        dirtyPreview.path,
      ),
    ).toBeNull();
  });

  it("keeps transient git diff documents out of persisted sessions even when pinned", () => {
    expect(
      currentWorkspaceSession(
        "/workspace",
        [
          "/workspace/A.php",
          "mockor-git-diff:staged:/workspace/B.php",
          "mockor-git-history-diff:abc123:/workspace/C.php",
        ],
        "mockor-git-diff:staged:/workspace/B.php",
        "git",
        "problems",
      ),
    ).toMatchObject({
      bottomPanelView: "problems",
      editor: {
        groups: {
          "editor-main": {
            activePath: "/workspace/A.php",
            openPaths: ["/workspace/A.php"],
          },
        },
      },
      sidebarView: "git",
    });
  });

  it("restores terminal bottom panel sessions as problems", () => {
    expect(restoredBottomPanelView("terminal")).toBe("problems");
    expect(restoredBottomPanelView("runtime")).toBe("runtime");
  });

  it("compares workspace sessions by active path, views, and ordered paths", () => {
    const session = currentWorkspaceSession(
      "/workspace",
      ["/workspace/A.php", "/workspace/B.php"],
      "/workspace/A.php",
      "files",
      "problems",
    );

    const reordered: WorkspaceSessionState = {
      ...session,
      editor: {
        ...session.editor,
        groups: {
          "editor-main": {
            ...session.editor.groups["editor-main"],
            openPaths: ["/workspace/B.php", "/workspace/A.php"],
          },
        },
      },
    };

    expect(workspaceSessionsEqual(session, { ...session })).toBe(true);
    expect(workspaceSessionsEqual(session, reordered)).toBe(false);

    expect(
      workspaceSessionsEqual(
        {
          ...session,
          viewStates: {
            "editor-main": {
              "/workspace/A.php": { column: 1, foldedLines: [2], line: 1 },
            },
          },
        },
        {
          ...session,
          viewStates: {
            "editor-main": {
              "/workspace/A.php": { column: 1, foldedLines: [3], line: 1 },
            },
          },
        },
      ),
    ).toBe(false);
  });

  it("persists and restores split groups while reading each unique path once", async () => {
    const editor = splitEditorFixture();
    const session = currentWorkspaceSessionForEditorGroups(
      "/workspace",
      editor,
      "files",
      "problems",
      {
        left: { "/workspace/shared.ts": { column: 2, line: 3 } },
        right: { "/workspace/shared.ts": { column: 8, line: 9 } },
      },
    );
    const reads: string[] = [];
    const restored = await restoreWorkspaceSession(
      "/workspace",
      session,
      async (path) => {
        reads.push(path);
        if (path.endsWith("missing.ts")) {
          throw new Error("missing");
        }
        return { path };
      },
    );

    expect(reads.sort()).toEqual([
      "/workspace/left.ts",
      "/workspace/missing.ts",
      "/workspace/shared.ts",
    ]);
    expect(restored.failedPaths).toEqual(["/workspace/missing.ts"]);
    expect(restored.editor.groups.left).toMatchObject({
      activePath: "/workspace/shared.ts",
      openPaths: ["/workspace/shared.ts", "/workspace/left.ts"],
    });
    expect(restored.editor.groups.right).toMatchObject({
      activePath: "/workspace/shared.ts",
      openPaths: ["/workspace/shared.ts"],
    });
    expect(restored.viewStates).toEqual({
      left: { "/workspace/shared.ts": { column: 2, line: 3 } },
      right: { "/workspace/shared.ts": { column: 8, line: 9 } },
    });
    expect(restored.editor.layout).toEqual(editor.layout);
    expect(reads).not.toContain("/workspace/../project-b/Secret.ts");
  });

  it("does not restore a UNC traversal alias from a foreign authority", async () => {
    const validPath = "\\\\foreign-server\\foreign-share\\Valid.ts";
    const traversalPath =
      "\\\\server\\share\\..\\..\\foreign-server\\foreign-share\\Secret.ts";
    const reads: string[] = [];
    const restored = await restoreWorkspaceSession(
      "\\\\foreign-server\\foreign-share",
      workspaceSessionForPaths([validPath, traversalPath]),
      async (path) => {
        reads.push(path);
        return { path };
      },
    );

    expect(reads).toEqual([validPath]);
    expect(restored.editor.groups.main.openPaths).toEqual([validPath]);
  });

  it("restores documents beneath a Windows drive root", async () => {
    const drivePath = "C:\\project\\A.ts";
    const reads: string[] = [];
    const restored = await restoreWorkspaceSession(
      "C:\\",
      workspaceSessionForPaths([drivePath, "D:\\project\\B.ts"]),
      async (path) => {
        reads.push(path);
        return { path };
      },
    );

    expect(reads).toEqual([drivePath]);
    expect(restored.editor.groups.main).toMatchObject({
      activePath: drivePath,
      openPaths: [drivePath],
    });
  });
});

function workspaceSessionForPaths(paths: string[]): WorkspaceSessionState {
  return {
    bottomPanelView: "problems",
    editor: {
      activeGroupId: "main",
      groups: {
        main: { activePath: paths[0] ?? null, openPaths: paths, previewPath: null },
      },
      layout: { groupId: "main", kind: "group" },
    },
    sidebarView: "files",
    version: 1,
  };
}

function splitEditorFixture(): EditorGroupsState {
  return {
    activeGroupId: "right",
    groups: {
      left: {
        activePath: "/workspace/missing.ts",
        openPaths: ["/workspace/shared.ts", "/workspace/missing.ts", "/workspace/left.ts"],
        previewPath: null,
      },
      right: {
        activePath: "/workspace/shared.ts",
        openPaths: [
          "/workspace/shared.ts",
          "/workspace/missing.ts",
          "/outside.ts",
          "/workspace/../project-b/Secret.ts",
          "mockor-git-diff:worktree:/workspace/transient.ts",
        ],
        previewPath: null,
      },
      empty: { activePath: null, openPaths: [], previewPath: null },
    },
    layout: {
      kind: "split",
      orientation: "horizontal",
      sizes: [0.5, 0.5],
      children: [
        { kind: "group", groupId: "left" },
        {
          kind: "split",
          orientation: "vertical",
          sizes: [0.5, 0.5],
          children: [
            { kind: "group", groupId: "right" },
            { kind: "group", groupId: "empty" },
          ],
        },
      ],
    },
  };
}
