// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useExternalCleanDocumentRefresh } from "./useExternalCleanDocumentRefresh";
import { createEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import { DocumentSessionStore } from "./documentSessionStore";
import { EditorSessionDocumentAuthoritySidecar } from "./editorSessionDocumentAuthority";
import { getEditorDocumentDirtySnapshot } from "./editorSessionDirtyProjection";
import type { ResolveEditorDocumentDirtyProjection } from "./editorDocumentExternalChangeProtection";
import type { EditorDocument } from "../domain/workspace";

let root: Root;
afterEach(() => act(() => root.unmount()));
function deferred() {
  let resolve!: (content: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness() {
  const path = "/a/file.ts";
  const doc: EditorDocument = {
    path,
    name: "file.ts",
    language: "typescript",
    content: "before",
    savedContent: "before",
  };
  const documentsRef: { current: Record<string, EditorDocument> } = { current: { [path]: doc } };
  const activeDocumentRef = { current: doc as EditorDocument | null };
  const currentWorkspaceRootRef = { current: "/a" as string | null };
  const read = vi.fn(async (_path: string) => "after");
  const reportChangedDocuments = vi.fn();
  const dependencies = {
    workspaceRoot: "/a" as string | null,
    refreshExternalCleanDocument: undefined as
      ((expected: EditorDocument, replacement: EditorDocument) => boolean) | undefined,
    resolveDocumentSessionDirtyProjection: undefined as
      ResolveEditorDocumentDirtyProjection | undefined,
    documentsRef,
    activeDocumentRef,
    currentWorkspaceRootRef,
    workspaceFiles: {
      readTextFile: read,
      applyWorkspaceEdit: vi.fn(),
      createDirectory: vi.fn(),
      createTextFile: vi.fn(),
      deletePath: vi.fn(),
      readDirectory: vi.fn(),
      renamePath: vi.fn(),
      writeTextFile: vi.fn(),
    } as Parameters<typeof useExternalCleanDocumentRefresh>[0]["workspaceFiles"],
    reportChangedDocuments,
    reportErrorForActiveWorkspaceRoot: vi.fn(),
    setDocuments: (
      update: Parameters<typeof useExternalCleanDocumentRefresh>[0]["setDocuments"] extends (
        arg: infer T,
      ) => void
        ? T
        : never,
    ) => {
      documentsRef.current = typeof update === "function" ? update(documentsRef.current) : update;
    },
    resolveDocumentSaveOwnership: (_root: string, documentPath: string) => ({
      canonicalRoot: "/a",
      workspaceId: "owner-1",
      workspaceRelativePath: documentPath.slice(3),
    }),
  };
  let refresh!: ReturnType<typeof useExternalCleanDocumentRefresh>;
  function Harness() {
    refresh = useExternalCleanDocumentRefresh(dependencies);
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root.render(<Harness />));
  return {
    path,
    doc,
    dependencies,
    read,
    documentsRef,
    activeDocumentRef,
    reportChangedDocuments,
    refresh: () => refresh("/a", path),
    render: (workspaceRoot: string) => {
      dependencies.workspaceRoot = workspaceRoot;
      currentWorkspaceRootRef.current = workspaceRoot;
      act(() => root.render(<Harness />));
    },
  };
}
it("refreshes the exact clean document and active buffer before reporting", async () => {
  const test = harness();
  await act(() => test.refresh());
  expect(test.documentsRef.current[test.path].content).toBe("after");
  expect(test.activeDocumentRef.current).toBe(test.documentsRef.current[test.path]);
  expect(test.reportChangedDocuments).toHaveBeenCalledWith([test.path]);
});
it("ignores an old read after workspace A to B to A", async () => {
  const test = harness();
  const pending = deferred();
  test.read.mockReturnValue(pending.promise);
  const run = test.refresh();
  test.render("/b");
  test.render("/a");
  pending.resolve("stale");
  await act(() => run);
  expect(test.documentsRef.current[test.path]).toBe(test.doc);
});
it("keeps the most recent checkout snapshot when reads complete backwards", async () => {
  const test = harness();
  const first = deferred();
  const second = deferred();
  test.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const old = test.refresh();
  const fresh = test.refresh();
  second.resolve("new branch");
  await act(() => fresh);
  first.resolve("old branch");
  await act(() => old);
  expect(test.documentsRef.current[test.path].content).toBe("new branch");
  expect(test.reportChangedDocuments).toHaveBeenCalledOnce();
});
it("preserves edits made during a pending read", async () => {
  const test = harness();
  const pending = deferred();
  test.read.mockReturnValue(pending.promise);
  const run = test.refresh();
  test.documentsRef.current[test.path] = { ...test.doc, content: "unsaved" };
  pending.resolve("disk");
  await act(() => run);
  expect(test.documentsRef.current[test.path].content).toBe("unsaved");
  expect(test.reportChangedDocuments).not.toHaveBeenCalled();
});
it("rejects a replaced registered workspace even at the same path", async () => {
  const test = harness();
  const pending = deferred();
  test.read.mockReturnValue(pending.promise);
  const run = test.refresh();
  test.dependencies.resolveDocumentSaveOwnership = () => ({
    canonicalRoot: "/a",
    workspaceId: "owner-2",
    workspaceRelativePath: "file.ts",
  });
  test.render("/a");
  pending.resolve("old owner");
  await act(() => run);
  expect(test.documentsRef.current[test.path]).toBe(test.doc);
});

it("reports an unreadable checkout file only for the current document owner", async () => {
  const test = harness();
  const error = new Error("file cannot be read");
  test.read.mockRejectedValue(error);
  await act(() => test.refresh());
  expect(test.dependencies.reportErrorForActiveWorkspaceRoot).toHaveBeenCalledWith(
    "/a",
    "File refresh",
    error,
  );
  expect(test.documentsRef.current[test.path]).toBe(test.doc);
  test.dependencies.reportErrorForActiveWorkspaceRoot.mockClear();
  const pending = deferred();
  test.read.mockImplementation(async () => {
    await pending.promise;
    throw error;
  });
  const run = test.refresh();
  test.render("/b");
  pending.resolve("");
  await act(() => run);
  expect(test.dependencies.reportErrorForActiveWorkspaceRoot).not.toHaveBeenCalled();
});

function attachLiveProjection(test: ReturnType<typeof harness>) {
  const sidecar = new EditorSessionDocumentAuthoritySidecar(new DocumentSessionStore());
  expect(
    sidecar.activateOwner(
      {
        canonicalRoot: "/a",
        rootPath: "/a",
        workspaceId: "owner-1",
        ownerKey: createEditorSessionOwnerKey("owner-1", "/a"),
      },
      test.dependencies.resolveDocumentSaveOwnership,
      test.documentsRef.current,
    ),
  ).toBe(true);
  const lifecycle = sidecar.resolveLifecycle(test.path)!;
  const group = sidecar.createGroupAuthority(lifecycle, "editor-main", test.path, {})!;
  const revision = (version: number) => ({
    alternativeVersionId: version,
    contentVersion: version,
    modelVersionId: version,
    mode: version === 1 ? ("retained" as const) : ("incremental" as const),
    utf16Length: 6,
  });
  const attachment = sidecar.attachEditorGroupLiveDocument(
    group,
    { captureCurrentContent: () => "before", holderIncarnation: {}, modelIncarnation: {} },
    revision(1),
    () => true,
  )!;
  expect(attachment).not.toBeNull();
  const projection = sidecar.resolveDocumentDirtyProjection(lifecycle)!;
  test.dependencies.resolveDocumentSessionDirtyProjection = () => projection;
  test.render("/a");
  return { projection, dirty: () => expect(attachment.observe(revision(2))).toBe(true) };
}

it("preserves an authoritative live draft whose legacy document still looks clean", async () => {
  const test = harness();
  const live = attachLiveProjection(test);
  live.dirty();
  expect(test.doc.content).toBe(test.doc.savedContent);
  expect(getEditorDocumentDirtySnapshot(live.projection)).toEqual({
    status: "available",
    dirty: true,
  });
  await act(() => test.refresh());
  expect(test.read).not.toHaveBeenCalled();
  expect(test.documentsRef.current[test.path]).toBe(test.doc);
  expect(test.dependencies.reportErrorForActiveWorkspaceRoot).toHaveBeenCalledWith(
    "/a",
    "File refresh",
    expect.objectContaining({
      message: expect.stringContaining("unsaved editor changes were kept"),
    }),
  );
});

it("rechecks live dirty authority after the disk read without copying typed text", async () => {
  const test = harness();
  const live = attachLiveProjection(test);
  const pending = deferred();
  test.read.mockReturnValue(pending.promise);
  const run = test.refresh();
  live.dirty();
  pending.resolve("new branch");
  await act(() => run);
  expect(test.documentsRef.current[test.path]).toBe(test.doc);
  expect(test.reportChangedDocuments).not.toHaveBeenCalled();
  expect(getEditorDocumentDirtySnapshot(live.projection)).toEqual({
    status: "available",
    dirty: true,
  });
});

it("delegates clean replacement before mutating document refs and respects atomic refusal", async () => {
  const test = harness();
  const replace = vi.fn((expected: EditorDocument, replacement: EditorDocument) => {
    expect(test.documentsRef.current[test.path]).toBe(expected);
    test.documentsRef.current[test.path] = replacement;
    return true;
  });
  test.dependencies.refreshExternalCleanDocument = replace;
  test.render("/a");
  await act(() => test.refresh());
  expect(replace).toHaveBeenCalledOnce();
  expect(test.documentsRef.current[test.path].content).toBe("after");
  test.reportChangedDocuments.mockClear();
  const before = test.documentsRef.current[test.path];
  replace.mockImplementation(() => false);
  await act(() => test.refresh());
  expect(test.documentsRef.current[test.path]).toBe(before);
  expect(test.reportChangedDocuments).not.toHaveBeenCalled();
});
