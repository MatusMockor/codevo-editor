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

const DOCUMENT_C: EditorDocument = {
  content: "const c = true;",
  language: "typescript",
  name: "c.ts",
  path: "/workspace/c.ts",
  savedContent: "const c = true;",
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
  it("publishes exact changed-document batches without replaying them", () => {
    const harness = renderEditorSessionState();
    const received: string[][] = [];
    const unsubscribe = harness.session().subscribeChangedDocuments((paths) => {
      received.push([...paths]);
    });

    act(() => {
      harness.session().reportChangedDocuments([
        DOCUMENT_A.path,
        DOCUMENT_B.path,
        DOCUMENT_A.path,
      ]);
    });

    expect(received).toEqual([[DOCUMENT_A.path, DOCUMENT_B.path]]);
    unsubscribe();

    act(() => {
      harness.session().reportChangedDocuments([DOCUMENT_C.path]);
    });

    expect(received).toHaveLength(1);
    harness.unmount();
  });

  it("commits a text preview and replaces only the clean active preview", () => {
    const harness = renderEditorSessionState();
    let replaced: EditorDocument | null = null;

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_B.path,
          openPaths: [],
          previewPath: DOCUMENT_B.path,
        }),
      );

      replaced = session.documentTabSession.commitTextOpen({
        document: DOCUMENT_A,
        pin: false,
      }).replacedDocument;

      expect(replaced).toBe(DOCUMENT_B);
      expect(session.documentsRef.current).toEqual({
        [DOCUMENT_A.path]: DOCUMENT_A,
      });
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_A.path,
        openPaths: [],
        previewPath: DOCUMENT_A.path,
      });
      expect(session.activeDocumentRef.current).toBe(DOCUMENT_A);
      expect(session.openPathsRef.current).toEqual([]);
      expect(session.previewPathRef.current).toBe(DOCUMENT_A.path);
    });

    expect(harness.session().documents).toEqual({
      [DOCUMENT_A.path]: DOCUMENT_A,
    });
    expect(harness.session().activePath).toBe(DOCUMENT_A.path);
    harness.unmount();
  });

  it("preserves dirty previews and documents visible in another group", () => {
    const harness = renderEditorSessionState();
    const dirtyPreview = { ...DOCUMENT_B, content: "changed" };
    let groups = createInitialEditorGroupsState("editor-main", {
      activePath: dirtyPreview.path,
      openPaths: [],
      previewPath: dirtyPreview.path,
    });
    groups = editorGroupsReducer(groups, {
      direction: "right",
      newGroupId: "editor-1",
      type: "split-group",
    });
    groups = {
      ...groups,
      activeGroupId: "editor-main",
      groups: {
        ...groups.groups,
        "editor-1": {
          activePath: dirtyPreview.path,
          openPaths: [dirtyPreview.path],
          previewPath: null,
        },
      },
    };

    act(() => {
      const session = harness.session();
      session.setDocuments({ [dirtyPreview.path]: dirtyPreview });
      session.updateEditorGroups(() => groups);

      const dirtyResult = session.documentTabSession.commitTextOpen({
        document: DOCUMENT_A,
        pin: false,
      });

      expect(dirtyResult.replacedDocument).toBeNull();
      expect(session.documentsRef.current[dirtyPreview.path]).toBe(
        dirtyPreview,
      );
      expect(
        session.editorGroupsRef.current.groups["editor-main"].openPaths,
      ).toContain(dirtyPreview.path);
      expect(session.editorGroupsRef.current.groups["editor-1"]).toEqual(
        groups.groups["editor-1"],
      );
    });

    act(() => {
      const session = harness.session();
      const cleanPreview = { ...dirtyPreview, content: dirtyPreview.savedContent };
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [cleanPreview.path]: cleanPreview,
      });
      session.updateEditorGroups((current) => ({
        ...current,
        activeGroupId: "editor-main",
        groups: {
          ...current.groups,
          "editor-main": {
            activePath: cleanPreview.path,
            openPaths: [],
            previewPath: cleanPreview.path,
          },
        },
      }));

      const sharedResult = session.documentTabSession.commitTextOpen({
        document: DOCUMENT_A,
        pin: true,
      });

      expect(sharedResult.replacedDocument).toBeNull();
      expect(session.documentsRef.current[cleanPreview.path]).toBe(
        cleanPreview,
      );
      expect(session.editorGroupsRef.current.groups["editor-1"].openPaths)
        .toEqual([cleanPreview.path]);
    });

    harness.unmount();
  });

  it("commits image, activation, and pinning to the active group atomically", () => {
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
      session.setDocuments({ [DOCUMENT_A.path]: DOCUMENT_A });
      session.updateEditorGroups(() => groups);
      session.documentTabSession.commitImageOpen(IMAGE);

      expect(session.imageTabsRef.current).toEqual({ [IMAGE.path]: IMAGE });
      expect(session.activeDocumentRef.current).toBeNull();
      expect(session.editorGroupsRef.current.groups["editor-main"])
        .toEqual(groups.groups["editor-main"]);
      expect(session.editorGroupsRef.current.groups["editor-1"]).toEqual({
        activePath: IMAGE.path,
        openPaths: [DOCUMENT_A.path, IMAGE.path],
        previewPath: null,
      });

      session.documentTabSession.activate(DOCUMENT_A.path);
      session.documentTabSession.pin(DOCUMENT_A.path);
      expect(session.activeDocumentRef.current).toBe(DOCUMENT_A);
      expect(session.openPathsRef.current).toEqual([
        DOCUMENT_A.path,
        IMAGE.path,
      ]);
      expect(session.editorGroupsRef.current.groups["editor-main"])
        .toEqual(groups.groups["editor-main"]);
    });

    expect(harness.session().activePath).toBe(DOCUMENT_A.path);
    expect(harness.session().imageTabs).toEqual({ [IMAGE.path]: IMAGE });
    harness.unmount();
  });

  it("removes a displaced clean text preview only after its last group membership", () => {
    const harness = renderEditorSessionState();
    const cleanPreview = {
      ...DOCUMENT_A,
      content: DOCUMENT_A.savedContent,
    };
    let groups = createInitialEditorGroupsState("editor-main", {
      activePath: cleanPreview.path,
      openPaths: [],
      previewPath: cleanPreview.path,
    });

    act(() => {
      const session = harness.session();
      session.setDocuments({ [cleanPreview.path]: cleanPreview });
      session.updateEditorGroups(() => groups);

      const result = session.documentTabSession.commitImageOpen(IMAGE);

      expect(result.replacedDocument).toBe(cleanPreview);
      expect(session.documentsRef.current[cleanPreview.path]).toBeUndefined();
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: IMAGE.path,
        openPaths: [IMAGE.path],
        previewPath: null,
      });
    });

    groups = editorGroupsReducer(groups, {
      direction: "right",
      newGroupId: "editor-1",
      type: "split-group",
    });
    groups = {
      ...groups,
      activeGroupId: "editor-main",
      groups: {
        ...groups.groups,
        "editor-1": {
          activePath: cleanPreview.path,
          openPaths: [cleanPreview.path],
          previewPath: null,
        },
      },
    };

    act(() => {
      const session = harness.session();
      session.setDocuments({ [cleanPreview.path]: cleanPreview });
      session.updateEditorGroups(() => groups);

      const result = session.documentTabSession.commitImageOpen(IMAGE);

      expect(result.replacedDocument).toBeNull();
      expect(session.documentsRef.current[cleanPreview.path]).toBe(cleanPreview);
      expect(session.editorGroupsRef.current.groups["editor-1"])
        .toEqual(groups.groups["editor-1"]);
    });

    harness.unmount();
  });

  it.each([
    {
      group: {
        activePath: DOCUMENT_A.path,
        openPaths: [DOCUMENT_B.path, DOCUMENT_A.path],
        previewPath: null,
      },
      label: "pinned",
    },
    {
      group: {
        activePath: DOCUMENT_A.path,
        openPaths: [DOCUMENT_B.path],
        previewPath: DOCUMENT_A.path,
      },
      label: "preview",
    },
  ])("globally removes an active $label document", ({ group }) => {
    const harness = renderEditorSessionState();
    let result: ReturnType<
      EditorSessionState["documentTabSession"]["removeDocument"]
    >;

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      session.setImageTabs({ [IMAGE.path]: IMAGE });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", group),
      );

      result = session.documentTabSession.removeDocument(DOCUMENT_A.path);

      expect(result).toEqual({
        closedActiveDocument: true,
        nextActivePath: DOCUMENT_B.path,
        removedDocument: DOCUMENT_A,
      });
      expect(session.documentsRef.current).toEqual({
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      expect(session.imageTabsRef.current).toEqual({ [IMAGE.path]: IMAGE });
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_B.path,
        openPaths: [DOCUMENT_B.path],
        previewPath: null,
      });
      expect(session.activeDocumentRef.current).toBe(DOCUMENT_B);
    });

    expect(harness.session().activePath).toBe(DOCUMENT_B.path);
    harness.unmount();
  });

  it("removes a non-active document without changing the active tab", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_B.path,
          openPaths: [DOCUMENT_A.path, DOCUMENT_B.path],
          previewPath: null,
        }),
      );

      expect(session.documentTabSession.removeDocument(DOCUMENT_A.path))
        .toEqual({
          closedActiveDocument: false,
          nextActivePath: DOCUMENT_B.path,
          removedDocument: DOCUMENT_A,
        });
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_B.path,
        openPaths: [DOCUMENT_B.path],
        previewPath: null,
      });
    });

    harness.unmount();
  });

  it("removes dirty documents after caller confirmation and uses ordinary fallback", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [DOCUMENT_B.path, DOCUMENT_A.path],
          previewPath: null,
        }),
      );

      const result = session.documentTabSession.removeDocument(DOCUMENT_A.path);

      expect(result.removedDocument).toBe(DOCUMENT_A);
      expect(result.nextActivePath).toBe(DOCUMENT_B.path);
      expect(session.documentsRef.current[DOCUMENT_A.path]).toBeUndefined();
    });

    harness.unmount();
  });

  it("closes a document in every group with independent fallbacks", () => {
    const harness = renderEditorSessionState();
    let groups = createInitialEditorGroupsState("editor-main", {
      activePath: DOCUMENT_A.path,
      openPaths: [DOCUMENT_B.path, DOCUMENT_A.path],
      previewPath: null,
    });
    groups = editorGroupsReducer(groups, {
      direction: "right",
      newGroupId: "editor-1",
      type: "split-group",
    });
    groups = {
      ...groups,
      activeGroupId: "editor-main",
      groups: {
        ...groups.groups,
        "editor-1": {
          activePath: DOCUMENT_A.path,
          openPaths: [DOCUMENT_C.path, DOCUMENT_A.path],
          previewPath: null,
        },
      },
    };

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
        [DOCUMENT_C.path]: DOCUMENT_C,
      });
      session.updateEditorGroups(() => groups);

      const result = session.documentTabSession.removeDocument(DOCUMENT_A.path);

      expect(result.nextActivePath).toBe(DOCUMENT_B.path);
      expect(session.editorGroupsRef.current.layout).toBe(groups.layout);
      expect(session.editorGroupsRef.current.groups).toEqual({
        "editor-main": {
          activePath: DOCUMENT_B.path,
          openPaths: [DOCUMENT_B.path],
          previewPath: null,
        },
        "editor-1": {
          activePath: DOCUMENT_C.path,
          openPaths: [DOCUMENT_C.path],
          previewPath: null,
        },
      });
    });

    harness.unmount();
  });

  it("preserves an unrelated preview and falls back to it", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [DOCUMENT_A.path],
          previewPath: DOCUMENT_B.path,
        }),
      );

      const result = session.documentTabSession.removeDocument(DOCUMENT_A.path);

      expect(result.nextActivePath).toBe(DOCUMENT_B.path);
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_B.path,
        openPaths: [],
        previewPath: DOCUMENT_B.path,
      });
      expect(session.documentsRef.current[DOCUMENT_B.path]).toBe(DOCUMENT_B);
    });

    harness.unmount();
  });

  it("no-ops for missing paths and globally removes foreign documents", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_B.path]: DOCUMENT_B,
        [FOREIGN_DOCUMENT.path]: FOREIGN_DOCUMENT,
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_B.path,
          openPaths: [DOCUMENT_B.path, FOREIGN_DOCUMENT.path],
          previewPath: null,
        }),
      );
      const documentsBeforeMissing = session.documentsRef.current;
      const groupsBeforeMissing = session.editorGroupsRef.current;

      expect(session.documentTabSession.removeDocument("/workspace/missing.ts"))
        .toEqual({
          closedActiveDocument: false,
          nextActivePath: DOCUMENT_B.path,
          removedDocument: null,
        });
      expect(session.documentsRef.current).toBe(documentsBeforeMissing);
      expect(session.editorGroupsRef.current).toBe(groupsBeforeMissing);

      expect(
        session.documentTabSession.removeDocument(FOREIGN_DOCUMENT.path),
      ).toEqual({
        closedActiveDocument: false,
        nextActivePath: DOCUMENT_B.path,
        removedDocument: FOREIGN_DOCUMENT,
      });
      expect(session.documentsRef.current).toEqual({
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      expect(session.openPathsRef.current).toEqual([DOCUMENT_B.path]);
    });

    harness.unmount();
  });

  it("refreshes only a still-clean empty document and keeps active refs current", () => {
    const harness = renderEditorSessionState();
    const emptyDocument = {
      ...DOCUMENT_B,
      content: "",
      savedContent: "",
    };

    act(() => {
      const session = harness.session();
      session.setDocuments({ [emptyDocument.path]: emptyDocument });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: emptyDocument.path,
          openPaths: [emptyDocument.path],
          previewPath: null,
        }),
      );

      const refreshed = session.documentTabSession.refreshCleanDocument(
        emptyDocument.path,
        "fresh",
      );
      expect(refreshed?.content).toBe("fresh");
      expect(session.documentsRef.current[emptyDocument.path]).toBe(refreshed);
      expect(session.activeDocumentRef.current).toBe(refreshed);

      session.setDocuments((current) => ({
        ...current,
        [emptyDocument.path]: {
          ...current[emptyDocument.path],
          content: "dirty",
        },
      }));
      expect(
        session.documentTabSession.refreshCleanDocument(
          emptyDocument.path,
          "must-not-win",
        ),
      ).toBeNull();
      expect(session.documentsRef.current[emptyDocument.path].content).toBe(
        "dirty",
      );
    });

    harness.unmount();
  });

  it("opens read-only documents as pinned or preview tabs", () => {
    const harness = renderEditorSessionState();
    const readOnlyDocument = {
      ...DOCUMENT_B,
      savedContent: undefined,
    } as unknown as EditorDocument;

    act(() => {
      const session = harness.session();
      session.documentTabSession.openReadOnlyDocument(readOnlyDocument, false);
      expect(session.documentsRef.current[DOCUMENT_B.path]).toMatchObject({
        content: DOCUMENT_B.content,
        readOnly: true,
        savedContent: DOCUMENT_B.content,
      });
      expect(session.previewPathRef.current).toBe(DOCUMENT_B.path);

      session.documentTabSession.openReadOnlyDocument(readOnlyDocument, true);
      expect(session.openPathsRef.current).toContain(DOCUMENT_B.path);
      expect(session.previewPathRef.current).toBeNull();
      expect(session.activeDocumentRef.current?.readOnly).toBe(true);
    });

    expect(harness.session().openPaths).toContain(DOCUMENT_B.path);
    expect(harness.session().previewPath).toBeNull();
    harness.unmount();
  });

  it("preserves an unrelated preview when opening a new pinned read-only document", () => {
    const harness = renderEditorSessionState();
    const readOnlyDocument = { ...DOCUMENT_B, readOnly: true };

    act(() => {
      const session = harness.session();
      session.setDocuments({ [DOCUMENT_A.path]: DOCUMENT_A });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [],
          previewPath: DOCUMENT_A.path,
        }),
      );

      session.documentTabSession.openReadOnlyDocument(readOnlyDocument, true);

      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_B.path,
        openPaths: [DOCUMENT_B.path],
        previewPath: DOCUMENT_A.path,
      });
      expect(session.documentsRef.current).toEqual({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: readOnlyDocument,
      });

      session.documentTabSession.openReadOnlyDocument(DOCUMENT_A, true);
      expect(session.previewPathRef.current).toBeNull();
      expect(session.openPathsRef.current).toEqual([
        DOCUMENT_B.path,
        DOCUMENT_A.path,
      ]);
    });

    harness.unmount();
  });

  it("safely replaces read-only previews without orphaning dirty documents", () => {
    const harness = renderEditorSessionState();
    const dirtyPreview = { ...DOCUMENT_A, content: "unsaved" };
    const readOnlyDocument = { ...DOCUMENT_B, readOnly: true };

    act(() => {
      const session = harness.session();
      session.setDocuments({ [dirtyPreview.path]: dirtyPreview });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: dirtyPreview.path,
          openPaths: [],
          previewPath: dirtyPreview.path,
        }),
      );

      const dirtyTransition = session.documentTabSession.openReadOnlyDocument(
        readOnlyDocument,
        false,
      );

      expect(dirtyTransition.replacedDocument).toBeNull();
      expect(session.documentsRef.current[dirtyPreview.path]).toBe(dirtyPreview);
      expect(session.openPathsRef.current).toEqual([dirtyPreview.path]);
      expect(session.previewPathRef.current).toBe(readOnlyDocument.path);

      const nextReadOnly = {
        ...DOCUMENT_A,
        path: "/workspace/read-only-next.ts",
        readOnly: true,
      };
      const cleanTransition = session.documentTabSession.openReadOnlyDocument(
        nextReadOnly,
        false,
      );

      expect(cleanTransition.replacedDocument).toEqual(readOnlyDocument);
      expect(
        session.documentsRef.current[readOnlyDocument.path],
      ).toBeUndefined();
      expect(session.documentsRef.current[dirtyPreview.path]).toBe(dirtyPreview);
      expect(session.previewPathRef.current).toBe(nextReadOnly.path);
    });

    harness.unmount();
  });

  it("preserves an unrelated preview when pinning an existing document", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: DOCUMENT_B,
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [],
          previewPath: DOCUMENT_A.path,
        }),
      );

      const transition = session.documentTabSession.openExistingDocument({
        path: DOCUMENT_B.path,
        pin: true,
        readOnly: false,
      });

      expect(transition?.replacedDocument).toBeNull();
      expect(session.editorGroupsRef.current.groups["editor-main"]).toEqual({
        activePath: DOCUMENT_B.path,
        openPaths: [DOCUMENT_B.path],
        previewPath: DOCUMENT_A.path,
      });
      expect(session.documentsRef.current[DOCUMENT_A.path]).toBe(DOCUMENT_A);
    });

    harness.unmount();
  });

  it("returns detached readonly snapshots that cannot alias live state", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({ [DOCUMENT_A.path]: DOCUMENT_A });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [DOCUMENT_A.path],
          previewPath: null,
        }),
      );
    });

    const snapshot = harness.session().documentTabSession.snapshot();
    const mutableDocuments = snapshot.documents as Record<
      string,
      EditorDocument
    >;
    const mutableOpenPaths = snapshot.openPaths as string[];
    mutableDocuments[DOCUMENT_A.path].content = "mutated snapshot";
    mutableOpenPaths.push("/workspace/injected.ts");

    const liveSnapshot = harness.session().documentTabSession.snapshot();
    expect(liveSnapshot.documents[DOCUMENT_A.path].content).toBe(
      DOCUMENT_A.content,
    );
    expect(liveSnapshot.openPaths).toEqual([DOCUMENT_A.path]);
    harness.unmount();
  });

  it("queries the live active path, document, and tab display name in constant time", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({ [DOCUMENT_A.path]: DOCUMENT_A });
      session.setImageTabs({ [IMAGE.path]: IMAGE });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [DOCUMENT_A.path, IMAGE.path],
          previewPath: null,
        }),
      );

      expect(session.documentTabSession.getActivePath()).toBe(
        DOCUMENT_A.path,
      );
      expect(session.documentTabSession.getDocument(DOCUMENT_A.path)).toBe(
        DOCUMENT_A,
      );
      expect(session.documentTabSession.getDocument(IMAGE.path)).toBeNull();
      expect(session.documentTabSession.getTabDisplayName(DOCUMENT_A.path))
        .toBe(DOCUMENT_A.name);
      expect(session.documentTabSession.getTabDisplayName(IMAGE.path)).toBe(
        IMAGE.name,
      );
      expect(session.documentTabSession.getTabDisplayName("/missing"))
        .toBeNull();

      session.documentTabSession.activate(IMAGE.path);
      expect(session.documentTabSession.getActivePath()).toBe(IMAGE.path);
    });

    harness.unmount();
  });

  it("keeps detached snapshots isolated while live queries observe commits", () => {
    const harness = renderEditorSessionState();

    act(() => {
      harness.session().documentTabSession.commitTextOpen({
        document: DOCUMENT_A,
        pin: true,
      });
    });

    const port = harness.session().documentTabSession;
    const detached = port.snapshot();
    const mutableDetachedDocument = detached.documents[DOCUMENT_A.path] as
      EditorDocument;
    mutableDetachedDocument.name = "detached.ts";

    expect(port.getDocument(DOCUMENT_A.path)?.name).toBe(DOCUMENT_A.name);
    expect(port.getTabDisplayName(DOCUMENT_A.path)).toBe(DOCUMENT_A.name);

    act(() => {
      harness.session().setDocuments({
        [DOCUMENT_A.path]: { ...DOCUMENT_A, name: "renamed.ts" },
      });
    });

    expect(port.getDocument(DOCUMENT_A.path)?.name).toBe("renamed.ts");
    expect(port.getTabDisplayName(DOCUMENT_A.path)).toBe("renamed.ts");
    expect(detached.documents[DOCUMENT_A.path].name).toBe("detached.ts");
    harness.unmount();
  });

  it("opens an existing document with one-way read-only state and exposes its active view", () => {
    const harness = renderEditorSessionState();

    act(() => {
      const session = harness.session();
      session.setDocuments({
        [DOCUMENT_A.path]: DOCUMENT_A,
        [DOCUMENT_B.path]: { ...DOCUMENT_B, readOnly: true },
      });
      session.updateEditorGroups(() =>
        createInitialEditorGroupsState("editor-main", {
          activePath: DOCUMENT_A.path,
          openPaths: [DOCUMENT_A.path],
          previewPath: null,
        }),
      );

      const upgraded = session.documentTabSession.openExistingDocument({
        path: DOCUMENT_A.path,
        pin: true,
        readOnly: true,
      });
      expect(upgraded?.document.readOnly).toBe(true);

      const opened = session.documentTabSession.openExistingDocument({
        path: DOCUMENT_B.path,
        pin: false,
        readOnly: false,
      });

      expect(opened?.document.readOnly).toBe(true);
      expect(opened?.replacedDocument).toBeNull();
      expect(session.documentTabSession.snapshot()).toMatchObject({
        activeDocument: opened?.document,
        activePath: DOCUMENT_B.path,
        openPaths: [DOCUMENT_A.path],
        previewPath: DOCUMENT_B.path,
      });

      const pinned = session.documentTabSession.openExistingDocument({
        path: DOCUMENT_B.path,
        pin: true,
        readOnly: false,
      });
      expect(pinned?.document.readOnly).toBe(true);
      expect(session.openPathsRef.current).toEqual([
        DOCUMENT_A.path,
        DOCUMENT_B.path,
      ]);
      expect(session.previewPathRef.current).toBeNull();
      expect(
        session.documentTabSession.openExistingDocument({
          path: "/workspace/missing.ts",
          pin: false,
          readOnly: true,
        }),
      ).toBeNull();
    });

    expect(harness.session().documents[DOCUMENT_B.path].readOnly).toBe(true);
    expect(harness.session().activePath).toBe(DOCUMENT_B.path);
    harness.unmount();
  });

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

  it("restores a legacy runtime snapshot without Markdown previews or groups", () => {
    const harness = renderEditorSessionState();
    const legacyRuntimeSnapshot = {
      activePath: DOCUMENT_A.path,
      documents: { [DOCUMENT_A.path]: DOCUMENT_A },
      imageTabs: {},
      openPaths: [DOCUMENT_A.path],
      previewPath: null,
    } as unknown as EditorSurfaceSnapshot;

    expect(() => {
      act(() => {
        harness
          .session()
          .restoreEditorSurface("/workspace", legacyRuntimeSnapshot);
      });
    }).not.toThrow();

    const restored = harness.session();
    expect(restored.documents).toEqual({ [DOCUMENT_A.path]: DOCUMENT_A });
    expect(restored.markdownPreviewTabs).toEqual({});
    expect(restored.editorGroups.groups["editor-main"]).toEqual({
      activePath: DOCUMENT_A.path,
      openPaths: [DOCUMENT_A.path],
      previewPath: null,
    });
    expect(restored.activeDocumentRef.current).toEqual(DOCUMENT_A);

    harness.unmount();
  });
});
