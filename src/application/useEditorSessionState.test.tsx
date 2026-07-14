// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  createInitialEditorGroupsState,
  editorGroupsReducer,
} from "../domain/editorGroups";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import type { EditorDocument, ImageTab } from "../domain/workspace";
import type { EditorSurfaceSnapshot } from "../domain/workspaceSessionSnapshot";
import {
  useEditorSessionState,
  type EditorSessionState,
} from "./useEditorSessionState";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DOCUMENT_A: EditorDocument = {
  content: "changed",
  language: "typescript",
  name: "a.ts",
  path: "/workspace/a.ts",
  savedContent: "saved",
};

const DOCUMENT_B: EditorDocument = {
  content: "export {};",
  language: "typescript",
  name: "b.ts",
  path: "/workspace/b.ts",
  savedContent: "export {};",
};

const FOREIGN_DOCUMENT: EditorDocument = {
  ...DOCUMENT_B,
  name: "foreign.ts",
  path: "/other-workspace/foreign.ts",
};

const IMAGE: ImageTab = {
  byteLength: 3,
  dataUrl: "data:image/png;base64,abc",
  name: "diagram.png",
  path: "/workspace/diagram.png",
};

const FOREIGN_IMAGE: ImageTab = {
  ...IMAGE,
  name: "foreign.png",
  path: "/other-workspace/foreign.png",
};

const PREVIEW: MarkdownPreviewTab = {
  content: "# Preview",
  html: "<h1>Preview</h1>",
  name: "README.md Preview",
  path: "markdown-preview:///workspace/README.md",
  sourcePath: "/workspace/README.md",
};

const FOREIGN_PREVIEW: MarkdownPreviewTab = {
  ...PREVIEW,
  path: "markdown-preview:///other-workspace/README.md",
  sourcePath: "/other-workspace/README.md",
};

interface Harness {
  session: () => EditorSessionState;
  unmount: () => void;
}

function renderEditorSessionState(): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { current: EditorSessionState | null } = { current: null };

  function Probe() {
    captured.current = useEditorSessionState();
    return null;
  }

  act(() => {
    root.render(<Probe />);
  });

  return {
    session: () => {
      if (!captured.current) {
        throw new Error("hook not mounted");
      }

      return captured.current;
    },
    unmount: () => {
      act(() => root.unmount());
    },
  };
}

describe("useEditorSessionState", () => {
  it("synchronizes live refs in the same tick", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({ [DOCUMENT_A.path]: DOCUMENT_A });
      expect(session.documentsRef.current).toEqual({
        [DOCUMENT_A.path]: DOCUMENT_A,
      });

      session.setImageTabs({ [IMAGE.path]: IMAGE });
      expect(session.imageTabsRef.current).toEqual({ [IMAGE.path]: IMAGE });

      session.setMarkdownPreviewTabs({ [PREVIEW.path]: PREVIEW });
      expect(session.markdownPreviewTabsRef.current).toEqual({
        [PREVIEW.path]: PREVIEW,
      });

      session.setOpenPaths([DOCUMENT_A.path]);
      session.setActivePath(DOCUMENT_A.path);
      expect(session.openPathsRef.current).toEqual([DOCUMENT_A.path]);
      expect(session.editorGroupsRef.current.groups["editor-main"].activePath)
        .toBe(DOCUMENT_A.path);
      expect(session.activeDocumentRef.current).toBe(DOCUMENT_A);
    });

    harness.unmount();
  });

  it("routes compatibility setters to the currently active group", () => {
    const harness = renderEditorSessionState();
    let groups = createInitialEditorGroupsState("editor-main", {
      activePath: DOCUMENT_A.path,
      openPaths: [DOCUMENT_A.path],
      previewPath: null,
    });
    groups = editorGroupsReducer(groups, {
      direction: "right",
      newGroupId: "editor-1",
      type: "split-group",
    });

    act(() => {
      const session = harness.session();
      session.updateEditorGroups(() => groups);
      session.setOpenPaths([DOCUMENT_B.path]);
      session.setPreviewPath(PREVIEW.path);
      session.setActivePath(PREVIEW.path);
    });

    const current = harness.session().editorGroups;
    expect(current.groups["editor-main"]).toEqual({
      activePath: DOCUMENT_A.path,
      openPaths: [DOCUMENT_A.path],
      previewPath: null,
    });
    expect(current.groups["editor-1"]).toEqual({
      activePath: PREVIEW.path,
      openPaths: [DOCUMENT_B.path],
      previewPath: PREVIEW.path,
    });

    harness.unmount();
  });

  it("resets and restores a dirty document and preview membership snapshot", () => {
    const harness = renderEditorSessionState();
    const groups = createInitialEditorGroupsState("editor-main", {
      activePath: PREVIEW.path,
      openPaths: [DOCUMENT_A.path],
      previewPath: PREVIEW.path,
    });
    let snapshot: ReturnType<EditorSessionState["snapshotEditorSurface"]>;

    act(() => {
      const session = harness.session();
      session.setDocuments({ [DOCUMENT_A.path]: DOCUMENT_A });
      session.setMarkdownPreviewTabs({ [PREVIEW.path]: PREVIEW });
      session.updateEditorGroups(() => groups);
      snapshot = session.snapshotEditorSurface("/workspace");
      session.resetEditorSurfaceState();

      expect(session.documentsRef.current).toEqual({});
      expect(session.markdownPreviewTabsRef.current).toEqual({});
      expect(session.openPathsRef.current).toEqual([]);
      expect(session.previewPathRef.current).toBeNull();

      session.restoreEditorSurface("/workspace", snapshot);
    });

    const restored = harness.session();
    expect(restored.documents[DOCUMENT_A.path]).toEqual(DOCUMENT_A);
    expect(restored.documents[DOCUMENT_A.path].content).not.toBe(
      restored.documents[DOCUMENT_A.path].savedContent,
    );
    expect(restored.markdownPreviewTabs[PREVIEW.path]).toEqual(PREVIEW);
    expect(restored.activePath).toBe(PREVIEW.path);
    expect(restored.openPaths).toEqual([DOCUMENT_A.path]);
    expect(restored.previewPath).toBe(PREVIEW.path);
    expect(restored.nextEditorGroupIdRef.current).toBe(1);

    harness.unmount();
  });

  it("creates a root-scoped snapshot while preserving same-root groups", () => {
    const harness = renderEditorSessionState();
    const gitDiff = {
      ...DOCUMENT_A,
      path: "mockor-git-diff:worktree:/workspace/a.ts",
    };
    let groups = createInitialEditorGroupsState("editor-main", {
      activePath: FOREIGN_DOCUMENT.path,
      openPaths: [DOCUMENT_A.path, FOREIGN_DOCUMENT.path, gitDiff.path],
      previewPath: FOREIGN_PREVIEW.path,
    });
    groups = editorGroupsReducer(groups, {
      direction: "right",
      newGroupId: "editor-1",
      type: "split-group",
    });
    groups = {
      ...groups,
      activeGroupId: "editor-1",
      groups: {
        ...groups.groups,
        "editor-1": {
          activePath: PREVIEW.path,
          openPaths: [DOCUMENT_B.path, IMAGE.path, FOREIGN_IMAGE.path],
          previewPath: PREVIEW.path,
        },
      },
    };
    let snapshot!: EditorSurfaceSnapshot;

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
        [FOREIGN_DOCUMENT.path]: FOREIGN_DOCUMENT,
        [gitDiff.path]: gitDiff,
      });
      session.setImageTabs({
        [IMAGE.path]: IMAGE,
        [FOREIGN_IMAGE.path]: FOREIGN_IMAGE,
      });
      session.setMarkdownPreviewTabs({
        [PREVIEW.path]: PREVIEW,
        [FOREIGN_PREVIEW.path]: FOREIGN_PREVIEW,
      });
      session.updateEditorGroups(() => groups);
      snapshot = session.snapshotEditorSurface("/workspace");
    });

    expect(Object.keys(snapshot.documents)).toEqual([
      DOCUMENT_A.path,
      DOCUMENT_B.path,
    ]);
    expect(snapshot.imageTabs).toEqual({ [IMAGE.path]: IMAGE });
    expect(snapshot.markdownPreviewTabs).toEqual({ [PREVIEW.path]: PREVIEW });
    expect(snapshot.editorGroups?.groups["editor-main"]).toEqual({
      activePath: DOCUMENT_A.path,
      openPaths: [DOCUMENT_A.path],
      previewPath: null,
    });
    expect(snapshot.editorGroups?.groups["editor-1"]).toEqual({
      activePath: PREVIEW.path,
      openPaths: [DOCUMENT_B.path, IMAGE.path],
      previewPath: PREVIEW.path,
    });
    expect(snapshot.activePath).toBe(PREVIEW.path);
    expect(snapshot.openPaths).toEqual([DOCUMENT_B.path, IMAGE.path]);
    expect(snapshot.previewPath).toBe(PREVIEW.path);

    act(() => {
      const session = harness.session();
      session.resetEditorSurfaceState();
      session.restoreEditorSurface("/workspace", {
        activePath: FOREIGN_DOCUMENT.path,
        documents: {
          [DOCUMENT_A.path]: DOCUMENT_A,
          [DOCUMENT_B.path]: DOCUMENT_B,
          [FOREIGN_DOCUMENT.path]: FOREIGN_DOCUMENT,
          [gitDiff.path]: gitDiff,
        },
        editorGroups: groups,
        imageTabs: {
          [IMAGE.path]: IMAGE,
          [FOREIGN_IMAGE.path]: FOREIGN_IMAGE,
        },
        markdownPreviewTabs: {
          [PREVIEW.path]: PREVIEW,
          [FOREIGN_PREVIEW.path]: FOREIGN_PREVIEW,
        },
        openPaths: [FOREIGN_DOCUMENT.path],
        previewPath: FOREIGN_PREVIEW.path,
      });
    });

    const restored = harness.session();
    expect(Object.keys(restored.documents)).toEqual([
      DOCUMENT_A.path,
      DOCUMENT_B.path,
    ]);
    expect(restored.imageTabs).toEqual({ [IMAGE.path]: IMAGE });
    expect(restored.markdownPreviewTabs).toEqual({ [PREVIEW.path]: PREVIEW });
    expect(restored.editorGroups).toEqual(snapshot.editorGroups);
    expect(restored.activePath).toBe(PREVIEW.path);
    expect(restored.openPaths).toEqual([DOCUMENT_B.path, IMAGE.path]);
    expect(restored.previewPath).toBe(PREVIEW.path);
    harness.unmount();
  });

  it("restores legacy snapshots without editor groups and synchronizes refs", () => {
    const harness = renderEditorSessionState();
    const legacySnapshot: EditorSurfaceSnapshot = {
      activePath: "/workspace/missing.ts",
      documents: {
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
      },
      imageTabs: {},
      markdownPreviewTabs: {},
      openPaths: [
        DOCUMENT_A.path,
        DOCUMENT_B.path,
        "/workspace/missing.ts",
      ],
      previewPath: DOCUMENT_B.path,
    };

    act(() => {
      const session = harness.session();
      session.restoreEditorSurface("/workspace", legacySnapshot);

      expect(session.documentsRef.current).toEqual(legacySnapshot.documents);
      expect(session.editorGroupsRef.current.activeGroupId).toBe("editor-main");
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_A.path,
        openPaths: [DOCUMENT_A.path],
        previewPath: DOCUMENT_B.path,
      });
      expect(session.openPathsRef.current).toEqual([DOCUMENT_A.path]);
      expect(session.previewPathRef.current).toBe(DOCUMENT_B.path);
      expect(session.activeDocumentRef.current).toEqual(DOCUMENT_A);
    });

    const restored = harness.session();
    expect(restored.activePath).toBe(DOCUMENT_A.path);
    expect(restored.openPaths).toEqual([DOCUMENT_A.path]);
    expect(restored.previewPath).toBe(DOCUMENT_B.path);
    expect(restored.documents[DOCUMENT_A.path].content).not.toBe(
      restored.documents[DOCUMENT_A.path].savedContent,
    );
    harness.unmount();
  });
});
