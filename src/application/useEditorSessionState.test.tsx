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
import {
  useEditorSessionState,
  type EditorSessionState,
} from "./useEditorSessionState";

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

const IMAGE: ImageTab = {
  byteLength: 3,
  dataUrl: "data:image/png;base64,abc",
  name: "diagram.png",
  path: "/workspace/diagram.png",
};

const PREVIEW: MarkdownPreviewTab = {
  content: "# Preview",
  html: "<h1>Preview</h1>",
  name: "README.md Preview",
  path: "markdown-preview:///workspace/README.md",
  sourcePath: "/workspace/README.md",
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
      snapshot = session.snapshotEditorSurface();
      session.resetEditorSurfaceState();

      expect(session.documentsRef.current).toEqual({});
      expect(session.markdownPreviewTabsRef.current).toEqual({});
      expect(session.openPathsRef.current).toEqual([]);
      expect(session.previewPathRef.current).toBeNull();

      session.restoreEditorSurface(snapshot);
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
});
