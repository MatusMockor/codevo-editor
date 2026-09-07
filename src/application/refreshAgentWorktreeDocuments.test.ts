import { createWorkspaceEditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import { DocumentSessionStore } from "./documentSessionStore";
import { createDocumentSaveIdentity } from "./documentSaveIdentity";
import { createEditorDocumentDirtyProjection } from "./editorSessionDirtyProjection";
import { describe, expect, it, vi } from "vitest";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import {
  refreshAgentWorktreeDocuments,
  type AgentWorktreeDocumentRefreshInput,
} from "./refreshAgentWorktreeDocuments";

function fixture() {
  const document: EditorDocument = {
    path: "/worktree/a.ts",
    name: "a.ts",
    language: "typescript",
    content: "old",
    savedContent: "old",
    readOnly: true,
  };
  const files: WorkspaceFileGateway = {
    readTextFile: vi.fn(async () => "new"),
    readDirectory: vi.fn(async () => []),
    createDirectory: vi.fn(),
    createTextFile: vi.fn(),
    deletePath: vi.fn(),
    renamePath: vi.fn(),
    writeTextFile: vi.fn(),
    applyWorkspaceEdit: vi.fn(),
  };
  const input: AgentWorktreeDocumentRefreshInput = {
    refreshExternalCleanDocument: vi.fn(() => false),
    resolveDocumentSessionDirtyProjection: () => null,
    documentsRef: { current: { [document.path]: document } },
    activeDocumentRef: { current: document },
    setDocuments: vi.fn(),
    workspaceFiles: files,
    reportChangedDocuments: vi.fn(),
    reportNotice: vi.fn(),
  };
  const event = {
    rootPath: "/worktree",
    path: "/worktree",
    relativePath: "",
    kind: "rescanRequired" as const,
  };
  return { input, event, document, files };
}

describe("external worktree document refresh", () => {
  it("refreshes clean read-only content and active snapshot without expanding write authority", async () => {
    const { input, event, document } = fixture();
    await refreshAgentWorktreeDocuments(input, event, () => true);
    expect(input.documentsRef.current[document.path]).toMatchObject({
      content: "new",
      savedContent: "new",
      readOnly: true,
    });
    expect(input.activeDocumentRef.current).toBe(input.documentsRef.current[document.path]);
    expect(input.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
  });
  it("refreshes clean worktree documents regardless of existing editor read-only flag", async () => {
    for (const readOnly of [undefined, false]) {
      const { input, event, document } = fixture();
      document.readOnly = readOnly;
      await refreshAgentWorktreeDocuments(input, event, () => true);
      expect(input.documentsRef.current[document.path]).toMatchObject({ content: "new" });
      expect(input.documentsRef.current[document.path].readOnly).toBe(readOnly);
    }
  });
  it("preserves dirty buffers and reports disk changes", async () => {
    const { input, event, document } = fixture();
    document.content = "unsaved";
    await refreshAgentWorktreeDocuments(input, event, () => true);
    expect(input.documentsRef.current[document.path]).toBe(document);
    expect(input.workspaceFiles.readTextFile).not.toHaveBeenCalled();
    expect(input.reportNotice).toHaveBeenCalledOnce();
  });
  it("rejects a read when the owner or document changes while awaiting disk", async () => {
    for (const change of ["owner", "document"] as const) {
      const { input, event, document, files } = fixture();
      let settle: (text: string) => void = () => undefined;
      files.readTextFile = () =>
        new Promise((resolve) => {
          settle = resolve;
        });
      let current = true;
      const pending = refreshAgentWorktreeDocuments(input, event, () => current);
      if (change === "owner") current = false;
      else input.documentsRef.current[document.path] = { ...document, content: "typed" };
      settle("disk");
      await pending;
      expect(input.setDocuments).not.toHaveBeenCalled();
      expect(input.reportChangedDocuments).not.toHaveBeenCalled();
    }
  });
  it("preserves missing-file contents and ignores unrelated open files", async () => {
    const { input, event, document, files } = fixture();
    files.readTextFile = vi.fn(async () => {
      throw new Error("missing");
    });
    await refreshAgentWorktreeDocuments(input, event, () => true);
    expect(input.documentsRef.current[document.path]).toBe(document);
    expect(input.reportNotice).toHaveBeenCalledOnce();
    await refreshAgentWorktreeDocuments(input, { ...event, rootPath: "/other" }, () => true);
    expect(files.readTextFile).toHaveBeenCalledOnce();
  });
});

function liveProjection(document: EditorDocument) {
  const store = new DocumentSessionStore();
  const admitted = store.activateOwner({
    canonicalRoot: "/worktree",
    rootPath: "/worktree",
    workspaceId: "worktree",
    ownerKey: createWorkspaceEditorSessionOwnerKey("/worktree"),
  });
  if (admitted.status !== "activated") throw new Error("owner admission");
  const opened = store.open(admitted.lease, {
    document,
    identity: createDocumentSaveIdentity("/worktree", "a.ts")!,
  });
  if (opened.status !== "opened") throw new Error("document admission");
  const checkpoint = {
    alternativeVersionId: 1,
    contentVersion: 1,
    modelVersionId: 1,
    utf16Length: document.content.length,
  };
  const sourceIncarnation = {};
  const receipt = store.capture(opened.lease)!;
  const synchronization = store.issueLiveDocumentSynchronization(
    receipt,
    sourceIncarnation,
    checkpoint,
    document.content,
  );
  const attached = store.attachLiveDocument(receipt, {
    checkpoint,
    sourceIncarnation,
    holderIncarnation: {},
    synchronization,
  });
  if (attached.status !== "attached") throw new Error("live admission");
  return {
    store,
    lease: opened.lease,
    projection: createEditorDocumentDirtyProjection(store, opened.lease),
    markDirty: () =>
      store.checkpointLiveDocument(attached.attachment, {
        ...checkpoint,
        alternativeVersionId: 2,
        contentVersion: 2,
        modelVersionId: 2,
        utf16Length: document.content.length + 1,
      }),
  };
}

describe("authoritative worktree live dirty state", () => {
  it("keeps a dirty live model when the legacy document still appears clean", async () => {
    const { input, event, document } = fixture();
    const live = liveProjection(document);
    live.markDirty();
    await refreshAgentWorktreeDocuments(
      { ...input, resolveDocumentSessionDirtyProjection: () => live.projection },
      event,
      () => true,
    );
    expect(input.workspaceFiles.readTextFile).not.toHaveBeenCalled();
    expect(input.documentsRef.current[document.path]).toBe(document);
    expect(input.reportNotice).toHaveBeenCalledOnce();
  });
  it("rejects replacement when the model becomes dirty during the disk read", async () => {
    const { input, event, document, files } = fixture();
    const live = liveProjection(document);
    let finish: (content: string) => void = () => undefined;
    files.readTextFile = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const pending = refreshAgentWorktreeDocuments(
      { ...input, resolveDocumentSessionDirtyProjection: () => live.projection },
      event,
      () => true,
    );
    live.markDirty();
    finish("branch contents");
    await pending;
    expect(input.documentsRef.current[document.path]).toBe(document);
    expect(input.setDocuments).not.toHaveBeenCalled();
    expect(input.reportNotice).toHaveBeenCalledOnce();
  });
});

it("uses the admitted baseline transaction for clean worktree reads and preserves rejected transactions", async () => {
  for (const accepts of [false, true]) {
    const { input, event, document } = fixture();
    document.readOnly = false;
    const live = liveProjection(document);
    const refreshExternalCleanDocument = vi.fn(
      (expected: EditorDocument, replacement: EditorDocument) => {
        expect(expected).toBe(document);
        if (!accepts) return false;
        const receipt = live.store.capture(live.lease)!;
        const refreshed = live.store.refreshCleanDocument(
          receipt,
          replacement.content,
          replacement.revision,
        );
        expect(refreshed.status).toBe("applied");
        input.documentsRef.current = { [document.path]: replacement };
        return true;
      },
    );
    await refreshAgentWorktreeDocuments(
      {
        ...input,
        refreshExternalCleanDocument,
        resolveDocumentSessionDirtyProjection: () => live.projection,
      },
      event,
      () => true,
    );
    expect(refreshExternalCleanDocument).toHaveBeenCalledOnce();
    expect(input.setDocuments).not.toHaveBeenCalled();
    if (!accepts) {
      expect(input.documentsRef.current[document.path]).toBe(document);
      expect(input.reportNotice).toHaveBeenCalledOnce();
      expect(input.reportChangedDocuments).not.toHaveBeenCalled();
      continue;
    }
    const refreshed = live.store.getDocumentSnapshot(live.lease);
    if (refreshed.status !== "available") throw new Error("missing document");
    expect(refreshed.document.savedContent).toBe("new");
    expect(refreshed.dirty).toBe(false);
    live.store.edit(live.store.capture(live.lease)!, "new edit");
    const edited = live.store.getDocumentSnapshot(live.lease);
    if (edited.status !== "available") throw new Error("missing edited document");
    expect(edited.document.savedContent).toBe("new");
    expect(edited.dirty).toBe(true);
    expect(input.reportChangedDocuments).toHaveBeenCalledWith([document.path]);
  }
});
