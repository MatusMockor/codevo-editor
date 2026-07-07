import { describe, expect, it } from "vitest";
import {
  currentWorkspaceSession,
  documentSessionPathTransitionForOpenedPath,
  isPersistableEditorDocumentPath,
  isSessionPathInWorkspace,
  pinDocumentSessionPath,
  replaceableDocumentSessionPreview,
  restoredActivePath,
  restoredBottomPanelView,
  workspaceSessionsEqual,
} from "./documentSessionState";
import type { WorkspaceSessionState } from "../domain/settings";

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
    ).toEqual({
      activePath: "/workspace/D.php",
      bottomPanelView: "problems",
      openPaths: ["/workspace/A.php", "/workspace/D.php"],
      sidebarView: "php",
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
      ).activePath,
    ).toBeNull();
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
    ).toEqual({
      activePath: null,
      bottomPanelView: "problems",
      openPaths: ["/workspace/A.php"],
      sidebarView: "git",
    });
  });

  it("restores terminal bottom panel sessions as problems", () => {
    expect(restoredBottomPanelView("terminal")).toBe("problems");
    expect(restoredBottomPanelView("runtime")).toBe("runtime");
  });

  it("compares workspace sessions by active path, views, and ordered paths", () => {
    const session: WorkspaceSessionState = {
      activePath: "/workspace/A.php",
      bottomPanelView: "problems",
      openPaths: ["/workspace/A.php", "/workspace/B.php"],
      sidebarView: "files",
    };

    expect(workspaceSessionsEqual(session, { ...session })).toBe(true);
    expect(
      workspaceSessionsEqual(session, {
        ...session,
        openPaths: ["/workspace/B.php", "/workspace/A.php"],
      }),
    ).toBe(false);
  });
});
