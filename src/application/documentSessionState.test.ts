import { describe, expect, it } from "vitest";
import {
  currentWorkspaceSession,
  isPersistableEditorDocumentPath,
  isSessionPathInWorkspace,
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
