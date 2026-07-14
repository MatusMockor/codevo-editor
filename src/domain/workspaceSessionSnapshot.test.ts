import { describe, expect, it } from "vitest";
import { createInitialEditorGroupsState } from "./editorGroups";
import type { MarkdownPreviewTab } from "./markdownPreview";
import type { EditorDocument, ImageTab } from "./workspace";
import {
  buildEditorSurfaceSnapshot,
  isPersistableEditorDocumentPath,
  restoredActivePath,
  selectEditorSurfaceRestore,
  type EditorSurfaceSnapshot,
} from "./workspaceSessionSnapshot";

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
    expect(isPersistableEditorDocumentPath("mockor-git-diff:/src/a.ts")).toBe(
      false,
    );
    expect(
      isPersistableEditorDocumentPath("mockor-git-history-diff:/src/a.ts"),
    ).toBe(false);
    expect(
      isPersistableEditorDocumentPath("mockor-markdown-preview:/readme.md"),
    ).toBe(false);
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
      "mockor-git-history-diff:/src/a.ts": document(
        "mockor-git-history-diff:/src/a.ts",
      ),
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
      openPaths: [
        "/src/a.ts",
        "/src/b.ts",
        "/logo.png",
        "mockor-markdown-preview:/readme.md",
      ],
      previewPath: null,
    });
    const snapshot = buildEditorSurfaceSnapshot({
      activePath: "/src/a.ts",
      documents,
      editorGroups,
      imageTabs,
      markdownPreviewTabs,
      openPaths: [
        "/src/a.ts",
        "/src/b.ts",
        "/logo.png",
        "mockor-markdown-preview:/readme.md",
      ],
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
      openPaths: [
        "/src/a.ts",
        "/src/b.ts",
        "/logo.png",
        "mockor-markdown-preview:/readme.md",
      ],
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
