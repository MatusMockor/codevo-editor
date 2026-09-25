import { describe, expect, it } from "vitest";
import type { EditorGroup } from "../../domain/editorGroups";
import type { EditorDocument } from "../../domain/workspace";
import { editorPanelDocuments, editorPanelDocumentsEqual } from "./editorPanelDocuments";

function doc(path: string, content = "a", savedContent = "a"): EditorDocument {
  return {
    path,
    name: path.split("/").pop() ?? path,
    content,
    savedContent,
    language: "typescript",
  };
}

const group: EditorGroup = {
  activePath: "/w/src/orders.ts",
  openPaths: ["/w/src/orders.ts", "/w/src/idempotency.ts"],
  previewPath: "/w/test/orders.test.ts",
};

describe("editorPanelDocuments", () => {
  it("lists open tabs then the preview tab, with dirty and preview flags", () => {
    const snapshot = editorPanelDocuments(group, [
      doc("/w/src/orders.ts"),
      doc("/w/src/idempotency.ts", "changed", "saved"),
      doc("/w/test/orders.test.ts"),
    ]);

    expect(snapshot).toEqual({
      activeDocumentId: "/w/src/orders.ts",
      documents: [
        {
          documentId: "/w/src/orders.ts",
          title: "orders.ts",
          path: "/w/src/orders.ts",
          dirty: false,
          preview: false,
          gitStatus: null,
        },
        {
          documentId: "/w/src/idempotency.ts",
          title: "idempotency.ts",
          path: "/w/src/idempotency.ts",
          dirty: true,
          preview: false,
          gitStatus: null,
        },
        {
          documentId: "/w/test/orders.test.ts",
          title: "orders.test.ts",
          path: "/w/test/orders.test.ts",
          dirty: false,
          preview: true,
          gitStatus: null,
        },
      ],
    });
  });

  it("drops the preview flag once the preview document is dirty", () => {
    const snapshot = editorPanelDocuments(group, [
      doc("/w/src/orders.ts"),
      doc("/w/src/idempotency.ts"),
      doc("/w/test/orders.test.ts", "edited", "saved"),
    ]);

    expect(snapshot.documents[2]).toMatchObject({ dirty: true, preview: false });
  });

  it("skips paths without a loaded document and never reports markdown previews as dirty", () => {
    const snapshot = editorPanelDocuments(
      {
        activePath: "/w/README.md",
        openPaths: ["/w/README.md", "/w/missing.ts"],
        previewPath: null,
      },
      [
        {
          content: "# x",
          html: "<h1>x</h1>",
          name: "README.md",
          path: "/w/README.md",
          sourcePath: "/w/README.md",
        },
      ],
    );

    expect(snapshot.documents.map((entry) => [entry.path, entry.dirty])).toEqual([
      ["/w/README.md", false],
    ]);
  });
});

describe("editorPanelDocumentsEqual", () => {
  it("is true for a keystroke that does not flip dirty state", () => {
    const before = editorPanelDocuments(group, [doc("/w/src/orders.ts", "a1", "a")]);
    const after = editorPanelDocuments(group, [doc("/w/src/orders.ts", "a12", "a")]);

    expect(editorPanelDocumentsEqual(before, after)).toBe(true);
  });

  it("is false when dirty, preview, order or the active document changes", () => {
    const base = editorPanelDocuments(group, [
      doc("/w/src/orders.ts"),
      doc("/w/src/idempotency.ts"),
    ]);
    const dirty = editorPanelDocuments(group, [
      doc("/w/src/orders.ts", "b", "a"),
      doc("/w/src/idempotency.ts"),
    ]);
    const active = editorPanelDocuments({ ...group, activePath: "/w/src/idempotency.ts" }, [
      doc("/w/src/orders.ts"),
      doc("/w/src/idempotency.ts"),
    ]);
    const reordered = editorPanelDocuments(
      { ...group, openPaths: ["/w/src/idempotency.ts", "/w/src/orders.ts"] },
      [doc("/w/src/orders.ts"), doc("/w/src/idempotency.ts")],
    );
    const promoted = editorPanelDocuments(
      { ...group, openPaths: [...group.openPaths, "/w/test/orders.test.ts"], previewPath: null },
      [doc("/w/src/orders.ts"), doc("/w/src/idempotency.ts"), doc("/w/test/orders.test.ts")],
    );
    const previewed = editorPanelDocuments(group, [
      doc("/w/src/orders.ts"),
      doc("/w/src/idempotency.ts"),
      doc("/w/test/orders.test.ts"),
    ]);

    expect(editorPanelDocumentsEqual(base, dirty)).toBe(false);
    expect(editorPanelDocumentsEqual(base, active)).toBe(false);
    expect(editorPanelDocumentsEqual(base, reordered)).toBe(false);
    expect(editorPanelDocumentsEqual(previewed, promoted)).toBe(false);
  });
});

describe("editorPanelDocuments git status", () => {
  it("carries each tab's git status and treats a status change as a new snapshot", () => {
    const documents = [doc("/w/src/orders.ts"), doc("/w/src/idempotency.ts")];
    const clean = editorPanelDocuments(group, documents, {});
    const modified = editorPanelDocuments(group, documents, { "/w/src/orders.ts": "modified" });

    expect(modified.documents.map((entry) => entry.gitStatus)).toEqual(["modified", null]);
    expect(editorPanelDocumentsEqual(clean, modified)).toBe(false);
    expect(
      editorPanelDocumentsEqual(
        modified,
        editorPanelDocuments(group, documents, { "/w/src/orders.ts": "modified" }),
      ),
    ).toBe(true);
  });
});
