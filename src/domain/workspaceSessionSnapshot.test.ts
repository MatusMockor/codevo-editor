import { describe, expect, it } from "vitest";
import { createInitialEditorGroupsState } from "./editorGroups";
import type { MarkdownPreviewTab } from "./markdownPreview";
import type { EditorDocument, ImageTab } from "./workspace";
import {
  buildWorkspaceNavigationSnapshot,
  buildWorkspaceSessionSnapshot,
  buildEditorSurfaceSnapshot,
  isPersistableEditorDocumentPath,
  restoredActivePath,
  selectWorkspaceNavigationRestore,
  selectEditorSurfaceRestore,
  type EditorSurfaceSnapshot,
} from "./workspaceSessionSnapshot";
import { normalizeWorkspaceSession } from "./settings";

function document(path: string): EditorDocument {
  return {
    content: `content of ${path}`,
    language: "typescript",
    name: path.split("/").pop() ?? path,
    path,
    savedContent: `content of ${path}`,
  };
}

function imageTab(path: string): ImageTab {
  return {
    byteLength: 8,
    dataUrl: "data:image/png;base64,AAAA",
    name: path.split("/").pop() ?? path,
    path,
  };
}

function markdownPreviewTab(sourcePath: string): MarkdownPreviewTab {
  return {
    content: "# Title",
    html: "<h1>Title</h1>",
    name: "Preview",
    path: `mockor-markdown-preview:${sourcePath}`,
    sourcePath,
  };
}

describe("isPersistableEditorDocumentPath", () => {
  it("rejects pseudo-tab paths and accepts file paths", () => {
    expect(isPersistableEditorDocumentPath("/src/a.ts")).toBe(true);
    expect(isPersistableEditorDocumentPath("mockor-git-diff:/src/a.ts")).toBe(false);
    expect(isPersistableEditorDocumentPath("mockor-git-history-diff:/src/a.ts")).toBe(false);
    expect(isPersistableEditorDocumentPath("mockor-markdown-preview:/readme.md")).toBe(false);
  });
});

describe("restoredActivePath", () => {
  it("keeps the active path when restored and falls back to the first restored path", () => {
    expect(restoredActivePath("/a.ts", ["/a.ts", "/b.ts"])).toBe("/a.ts");
    expect(restoredActivePath("/gone.ts", ["/a.ts", "/b.ts"])).toBe("/a.ts");
    expect(restoredActivePath(null, [])).toBeNull();
  });
});

describe("buildEditorSurfaceSnapshot", () => {
  it("filters pseudo-tab documents and unbacked open paths", () => {
    const documents = {
      "/src/a.ts": document("/src/a.ts"),
      "mockor-git-diff:/src/a.ts": document("mockor-git-diff:/src/a.ts"),
      "mockor-git-history-diff:/src/a.ts": document("mockor-git-history-diff:/src/a.ts"),
    };
    const imageTabs = { "/logo.png": imageTab("/logo.png") };
    const markdownPreviewTabs = {
      "mockor-markdown-preview:/readme.md": markdownPreviewTab("/readme.md"),
    };
    const editorGroups = createInitialEditorGroupsState("editor-main");

    const snapshot = buildEditorSurfaceSnapshot({
      activePath: "/src/a.ts",
      documents,
      editorGroups,
      imageTabs,
      markdownPreviewTabs,
      openPaths: [
        "/src/a.ts",
        "mockor-git-diff:/src/a.ts",
        "/logo.png",
        "mockor-markdown-preview:/readme.md",
        "/missing.ts",
      ],
      previewPath: null,
    });

    expect(Object.keys(snapshot.documents)).toEqual(["/src/a.ts"]);
    expect(snapshot.openPaths).toEqual([
      "/src/a.ts",
      "/logo.png",
      "mockor-markdown-preview:/readme.md",
    ]);
    expect(snapshot.imageTabs).toBe(imageTabs);
    expect(snapshot.markdownPreviewTabs).toBe(markdownPreviewTabs);
    expect(snapshot.editorGroups).toBe(editorGroups);
  });

  it("keeps preview and active paths only when they stay backed", () => {
    const backed = buildEditorSurfaceSnapshot({
      activePath: "/logo.png",
      documents: { "/src/a.ts": document("/src/a.ts") },
      editorGroups: createInitialEditorGroupsState("editor-main"),
      imageTabs: { "/logo.png": imageTab("/logo.png") },
      markdownPreviewTabs: {},
      openPaths: ["/logo.png"],
      previewPath: "/src/a.ts",
    });

    expect(backed.previewPath).toBe("/src/a.ts");
    expect(backed.activePath).toBe("/logo.png");

    const unbacked = buildEditorSurfaceSnapshot({
      activePath: "mockor-git-diff:/src/a.ts",
      documents: {
        "mockor-git-diff:/src/a.ts": document("mockor-git-diff:/src/a.ts"),
      },
      editorGroups: createInitialEditorGroupsState("editor-main"),
      imageTabs: {},
      markdownPreviewTabs: {},
      openPaths: [],
      previewPath: "/missing.ts",
    });

    expect(unbacked.previewPath).toBeNull();
    expect(unbacked.activePath).toBeNull();
  });

  it("handles empty inputs", () => {
    const editorGroups = createInitialEditorGroupsState("editor-main");
    const snapshot = buildEditorSurfaceSnapshot({
      activePath: null,
      documents: {},
      editorGroups,
      imageTabs: {},
      markdownPreviewTabs: {},
      openPaths: [],
      previewPath: null,
    });

    expect(snapshot).toEqual({
      activePath: null,
      documents: {},
      editorGroups,
      imageTabs: {},
      markdownPreviewTabs: {},
      openPaths: [],
      previewPath: null,
    });
  });
});

describe("workspace navigation snapshot", () => {
  it("survives a simulated restart with recent files, locations, and back-forward history", () => {
    const navigation = buildWorkspaceNavigationSnapshot({
      navigationHistory: {
        backStack: [
          {
            path: "/workspace/a.ts",
            position: { column: 2, lineNumber: 3 },
          },
        ],
        forwardStack: [
          {
            path: "/workspace/b.ts",
            position: { column: 4, lineNumber: 5 },
          },
        ],
      },
      recentFiles: [{ name: "a.ts", path: "/workspace/a.ts" }],
      recentLocations: [
        {
          column: 2,
          line: 3,
          name: "a.ts",
          path: "/workspace/a.ts",
          relativePath: "a.ts",
          snippet: "const a = 1;",
        },
      ],
      rootPath: "/workspace",
    });
    expect(navigation.backStack[0]?.path).toBe("a.ts");
    expect(navigation.recentFiles[0]?.path).toBe("a.ts");
    const persisted = JSON.parse(
      JSON.stringify({
        ...normalizeWorkspaceSession({}),
        navigation,
      }),
    );
    const restored = selectWorkspaceNavigationRestore(
      normalizeWorkspaceSession(persisted),
      "/workspace",
    );

    expect(restored.recentFiles).toEqual([{ name: "a.ts", path: "/workspace/a.ts" }]);
    expect(restored.recentLocations[0]?.snippet).toBe("const a = 1;");
    expect(restored.navigationHistory).toEqual({
      backStack: [
        {
          path: "/workspace/a.ts",
          position: { column: 2, lineNumber: 3 },
        },
      ],
      forwardStack: [
        {
          path: "/workspace/b.ts",
          position: { column: 4, lineNumber: 5 },
        },
      ],
    });
  });

  it("enforces entry and byte caps when writing a snapshot", () => {
    const snapshot = buildWorkspaceNavigationSnapshot({
      navigationHistory: {
        backStack: Array.from({ length: 150 }, (_, index) => ({
          path: `/workspace/back-${index}.ts`,
          position: { column: 1, lineNumber: index + 1 },
        })),
        forwardStack: Array.from({ length: 150 }, (_, index) => ({
          path: `/workspace/forward-${index}.ts`,
          position: { column: 1, lineNumber: index + 1 },
        })),
      },
      recentFiles: Array.from({ length: 75 }, (_, index) => ({
        name: `file-${index}.ts`,
        path: `/workspace/file-${index}.ts`,
      })),
      recentLocations: Array.from({ length: 75 }, (_, index) => ({
        column: 1,
        line: index + 1,
        name: `file-${index}.ts`,
        path: `/workspace/file-${index}.ts`,
        relativePath: `file-${index}.ts`,
        snippet: "x".repeat(4_000),
      })),
      rootPath: "/workspace",
    });

    expect(snapshot.recentFiles).toHaveLength(50);
    expect(snapshot.recentLocations.length).toBeLessThanOrEqual(50);
    expect(snapshot.backStack.length).toBeLessThanOrEqual(100);
    expect(snapshot.forwardStack.length).toBeLessThanOrEqual(100);
    expect(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength).toBeLessThanOrEqual(
      128 * 1_024,
    );
  });

  it("restores stale entries without eager filesystem work", () => {
    const stalePath = "/workspace/deleted.ts";
    const restored = selectWorkspaceNavigationRestore(
      normalizeWorkspaceSession({
        ...normalizeWorkspaceSession({}),
        navigation: {
          backStack: [
            {
              path: stalePath,
              position: { column: 1, lineNumber: 1 },
            },
          ],
          forwardStack: [],
          recentFiles: [{ name: "deleted.ts", path: stalePath }],
          recentLocations: [
            {
              column: 1,
              line: 1,
              name: "deleted.ts",
              path: stalePath,
              relativePath: "deleted.ts",
              snippet: "deleted",
            },
          ],
        },
      }),
      "/workspace",
    );

    expect(restored.recentFiles[0]?.path).toBe(stalePath);
    expect(restored.recentLocations[0]?.path).toBe(stalePath);
    expect(restored.navigationHistory.backStack[0]?.path).toBe(stalePath);
  });

  it("keeps workspace snapshots isolated across A to B to A", () => {
    const sessions = new Map<string, ReturnType<typeof normalizeWorkspaceSession>>();
    const build = (root: string) =>
      normalizeWorkspaceSession({
        ...normalizeWorkspaceSession({}),
        navigation: buildWorkspaceNavigationSnapshot({
          navigationHistory: { backStack: [], forwardStack: [] },
          recentFiles: [{ name: "index.ts", path: `${root}/index.ts` }],
          recentLocations: [],
          rootPath: root,
        }),
      });

    sessions.set("/workspace-a", build("/workspace-a"));
    sessions.set("/workspace-b", build("/workspace-b"));

    expect(
      selectWorkspaceNavigationRestore(sessions.get("/workspace-a")!, "/workspace-a").recentFiles[0]
        ?.path,
    ).toBe("/workspace-a/index.ts");
    expect(
      selectWorkspaceNavigationRestore(sessions.get("/workspace-b")!, "/workspace-b").recentFiles[0]
        ?.path,
    ).toBe("/workspace-b/index.ts");
    expect(
      selectWorkspaceNavigationRestore(sessions.get("/workspace-a")!, "/workspace-a").recentFiles[0]
        ?.path,
    ).toBe("/workspace-a/index.ts");
  });

  it("restores relative paths beneath the selected workspace alias", () => {
    const session = normalizeWorkspaceSession({
      ...normalizeWorkspaceSession({}),
      navigation: {
        backStack: [{ path: "src/a.ts", position: { column: 1, lineNumber: 2 } }],
        forwardStack: [],
        recentFiles: [{ name: "a.ts", path: "src/a.ts" }],
        recentLocations: [],
      },
    });

    const restored = selectWorkspaceNavigationRestore(session, "/alias/workspace");

    expect(restored.navigationHistory.backStack[0]?.path).toBe("/alias/workspace/src/a.ts");
    expect(restored.recentFiles[0]?.path).toBe("/alias/workspace/src/a.ts");
  });

  it("removes an empty navigation key after the final entry is cleared", () => {
    const session = normalizeWorkspaceSession({
      ...normalizeWorkspaceSession({}),
      navigation: {
        backStack: [{ path: "a.ts", position: { column: 1, lineNumber: 1 } }],
        forwardStack: [],
        recentFiles: [],
        recentLocations: [],
      },
    });
    const navigation = buildWorkspaceNavigationSnapshot({
      navigationHistory: { backStack: [], forwardStack: [] },
      recentFiles: [],
      recentLocations: [],
      rootPath: "/workspace",
    });

    expect(buildWorkspaceSessionSnapshot(session, session.navigation, navigation).navigation).toBe(
      undefined,
    );
  });

  it("drops foreign workspace paths on write and restore", () => {
    const navigation = buildWorkspaceNavigationSnapshot({
      navigationHistory: {
        backStack: [
          {
            path: "/workspace-b/foreign.ts",
            position: { column: 1, lineNumber: 1 },
          },
        ],
        forwardStack: [],
      },
      recentFiles: [
        { name: "owned.ts", path: "/workspace-a/owned.ts" },
        { name: "foreign.ts", path: "/workspace-b/foreign.ts" },
      ],
      recentLocations: [],
      rootPath: "/workspace-a",
    });

    expect(navigation.backStack).toEqual([]);
    expect(navigation.recentFiles).toEqual([{ name: "owned.ts", path: "owned.ts" }]);

    const restored = selectWorkspaceNavigationRestore(
      normalizeWorkspaceSession({
        ...normalizeWorkspaceSession({}),
        navigation: {
          ...navigation,
          backStack: [
            {
              path: "/workspace-b/foreign.ts",
              position: { column: 1, lineNumber: 1 },
            },
          ],
        },
      }),
      "/workspace-a",
    );

    expect(restored.navigationHistory.backStack).toEqual([]);
  });
});

describe("selectEditorSurfaceRestore", () => {
  it("round-trips a built snapshot", () => {
    const documents = {
      "/src/a.ts": document("/src/a.ts"),
      "/src/b.ts": document("/src/b.ts"),
    };
    const imageTabs = { "/logo.png": imageTab("/logo.png") };
    const markdownPreviewTabs = {
      "mockor-markdown-preview:/readme.md": markdownPreviewTab("/readme.md"),
    };
    const editorGroups = createInitialEditorGroupsState("editor-main", {
      activePath: "/src/a.ts",
      openPaths: ["/src/a.ts", "/src/b.ts", "/logo.png", "mockor-markdown-preview:/readme.md"],
      previewPath: null,
    });
    const snapshot = buildEditorSurfaceSnapshot({
      activePath: "/src/a.ts",
      documents,
      editorGroups,
      imageTabs,
      markdownPreviewTabs,
      openPaths: ["/src/a.ts", "/src/b.ts", "/logo.png", "mockor-markdown-preview:/readme.md"],
      previewPath: null,
    });

    const restore = selectEditorSurfaceRestore(snapshot);

    expect(restore.documents).toEqual(documents);
    expect(restore.imageTabs).toBe(imageTabs);
    expect(restore.markdownPreviewTabs).toBe(markdownPreviewTabs);
    expect(restore.openPaths).toEqual([
      "/src/a.ts",
      "/src/b.ts",
      "/logo.png",
      "mockor-markdown-preview:/readme.md",
    ]);
    expect(restore.previewPath).toBeNull();
    expect(restore.activePath).toBe("/src/a.ts");
    expect(restore.editorGroups.groups["editor-main"]).toEqual({
      activePath: "/src/a.ts",
      openPaths: ["/src/a.ts", "/src/b.ts", "/logo.png", "mockor-markdown-preview:/readme.md"],
      previewPath: null,
    });
  });

  it("filters non-persistable documents and drops open paths losing their backing", () => {
    const snapshot: EditorSurfaceSnapshot = {
      activePath: "mockor-git-diff:/src/a.ts",
      documents: {
        "/src/a.ts": document("/src/a.ts"),
        "mockor-git-diff:/src/a.ts": document("mockor-git-diff:/src/a.ts"),
      },
      editorGroups: createInitialEditorGroupsState("editor-main", {
        activePath: "mockor-git-diff:/src/a.ts",
        openPaths: ["/src/a.ts", "mockor-git-diff:/src/a.ts"],
        previewPath: null,
      }),
      imageTabs: {},
      markdownPreviewTabs: {},
      openPaths: ["/src/a.ts", "mockor-git-diff:/src/a.ts"],
      previewPath: null,
    };

    const restore = selectEditorSurfaceRestore(snapshot);

    expect(Object.keys(restore.documents)).toEqual(["/src/a.ts"]);
    expect(restore.openPaths).toEqual(["/src/a.ts"]);
    expect(restore.activePath).toBe("/src/a.ts");
    expect(restore.editorGroups.groups["editor-main"]).toEqual({
      activePath: "/src/a.ts",
      openPaths: ["/src/a.ts"],
      previewPath: null,
    });
  });

  it("reconciles each editor group against the available paths", () => {
    const base = createInitialEditorGroupsState("left", {
      activePath: "/src/a.ts",
      openPaths: ["/src/a.ts", "/gone.ts"],
      previewPath: null,
    });
    const editorGroups = {
      ...base,
      groups: {
        ...base.groups,
        right: {
          activePath: "/gone2.ts",
          openPaths: ["/logo.png", "/gone2.ts"],
          previewPath: "/src/a.ts",
        },
      },
    };
    const snapshot: EditorSurfaceSnapshot = {
      activePath: "/src/a.ts",
      documents: { "/src/a.ts": document("/src/a.ts") },
      editorGroups,
      imageTabs: { "/logo.png": imageTab("/logo.png") },
      markdownPreviewTabs: {},
      openPaths: ["/src/a.ts", "/logo.png"],
      previewPath: null,
    };

    const restore = selectEditorSurfaceRestore(snapshot);

    expect(restore.editorGroups.groups.left).toEqual({
      activePath: "/src/a.ts",
      openPaths: ["/src/a.ts"],
      previewPath: null,
    });
    expect(restore.editorGroups.groups.right).toEqual({
      activePath: "/logo.png",
      openPaths: ["/logo.png"],
      previewPath: "/src/a.ts",
    });
    expect(restore.editorGroups.activeGroupId).toBe("left");
    expect(restore.editorGroups.layout).toBe(editorGroups.layout);
  });

  it("derives fallback editor groups when the snapshot has none", () => {
    const snapshot: EditorSurfaceSnapshot = {
      activePath: "/gone.ts",
      documents: {
        "/src/a.ts": document("/src/a.ts"),
        "/src/b.ts": document("/src/b.ts"),
      },
      imageTabs: {},
      markdownPreviewTabs: {},
      openPaths: ["/src/a.ts", "/src/b.ts", "/gone.ts"],
      previewPath: "/src/b.ts",
    };

    const restore = selectEditorSurfaceRestore(snapshot);

    expect(restore.activePath).toBe("/src/a.ts");
    expect(restore.previewPath).toBe("/src/b.ts");
    expect(restore.editorGroups.activeGroupId).toBe("editor-main");
    expect(restore.editorGroups.groups["editor-main"]).toEqual({
      activePath: "/src/a.ts",
      openPaths: ["/src/a.ts"],
      previewPath: "/src/b.ts",
    });
  });

  it("treats a legacy snapshot without markdown preview tabs as empty", () => {
    const legacySnapshot = {
      activePath: null,
      documents: {},
      editorGroups: createInitialEditorGroupsState("editor-main"),
      imageTabs: {},
      openPaths: [],
      previewPath: null,
    } as unknown as EditorSurfaceSnapshot;

    const restore = selectEditorSurfaceRestore(legacySnapshot);

    expect(restore.markdownPreviewTabs).toEqual({});
    expect(restore.openPaths).toEqual([]);
    expect(restore.activePath).toBeNull();
  });
});
