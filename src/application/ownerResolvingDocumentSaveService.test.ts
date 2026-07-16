import { describe, expect, it, vi } from "vitest";
import type { WorkspaceSettings } from "../domain/settings";
import type {
  EditorDocument,
  WorkspaceFileGateway,
  WorkspaceFileRevision,
} from "../domain/workspace";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import {
  OwnerDocumentSaveRepository,
  type OwnerDocumentRepositoryCandidate,
} from "./ownerDocumentSaveRepository";
import {
  OwnerResolvingDocumentSaveService,
  type OwnerDocumentSavePipeline,
} from "./ownerResolvingDocumentSaveService";

const ROOT = "/workspace";
const PATH = `${ROOT}/src/a.ts`;
const owner = createWorkspaceRuntimeOwner("workspace-a", ROOT);

function document(revision?: WorkspaceFileRevision): EditorDocument {
  return {
    content: "edited",
    language: "typescript",
    name: "a.ts",
    path: PATH,
    revision,
    savedContent: "saved",
  };
}

function workspaceFiles(
  writeTextFile: WorkspaceFileGateway["writeTextFile"],
): WorkspaceFileGateway {
  return {
    applyWorkspaceEdit: vi.fn(async () => 0),
    createDirectory: vi.fn(async () => undefined),
    createTextFile: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    readDirectory: vi.fn(async () => []),
    readTextFile: vi.fn(async () => "disk"),
    renamePath: vi.fn(async () => undefined),
    writeTextFile,
  } as WorkspaceFileGateway;
}

function revision(hash: number): WorkspaceFileRevision {
  return {
    contentHash: String(hash),
    device: "1",
    inode: "2",
    modifiedNanoseconds: 3,
    modifiedSeconds: 4,
    size: 5,
  };
}

function harness(writeTextFile: WorkspaceFileGateway["writeTextFile"]) {
  const repositoryIncarnation = {};
  const documentIncarnation = {};
  let currentDocument = document(revision(1));
  const candidate: OwnerDocumentRepositoryCandidate = {
    kind: "cached",
    owner,
    rootPath: ROOT,
    incarnation: repositoryIncarnation,
    readDocument: () => ({
      incarnation: documentIncarnation,
      document: currentDocument,
    }),
    replaceDocument: (
      _identity,
      expectedRepository,
      expectedIncarnation,
      expectedDocument,
      nextDocument,
    ) => {
      if (expectedRepository !== repositoryIncarnation) {
        return false;
      }
      if (expectedIncarnation !== documentIncarnation) {
        return false;
      }
      if (expectedDocument !== currentDocument) {
        return false;
      }

      currentDocument = nextDocument;
      return true;
    },
  };
  const settings = { formatOnSave: true } as WorkspaceSettings;
  const events: string[] = [];
  const pipeline: OwnerDocumentSavePipeline = {
    workspaceFiles: workspaceFiles(writeTextFile),
    settings,
    invalidatePrefetch: (requestedOwner, path) => {
      expect(requestedOwner).toBe(owner);
      expect(path).toBe(PATH);
      events.push("prefetch");
    },
    captureLocalHistorySnapshot: async (
      requestedOwner,
      rootPath,
      path,
      content,
    ) => {
      expect([requestedOwner, rootPath, path, content]).toEqual([
        owner,
        ROOT,
        PATH,
        "edited:formatted:optimized:organized",
      ]);
      events.push("history");
    },
    formattedContentForSave: async (
      requestedOwner,
      rootPath,
      requestedSettings,
      item,
    ) => {
      expect([requestedOwner, rootPath, requestedSettings]).toEqual([
        owner,
        ROOT,
        settings,
      ]);
      events.push("format");
      return `${item.content}:formatted`;
    },
    optimizedImportsContentForSave: (
      requestedOwner,
      rootPath,
      requestedSettings,
      _item,
      content,
    ) => {
      expect([requestedOwner, rootPath, requestedSettings]).toEqual([
        owner,
        ROOT,
        settings,
      ]);
      events.push("optimize");
      return `${content}:optimized`;
    },
    organizedImportsContentForSave: async (
      _requestedOwner,
      _rootPath,
      _settings,
      _item,
      content,
    ) => {
      events.push("organize");
      return `${content}:organized`;
    },
    resolveEditorConfigForFile: async () => ({}),
    syncSavedDocument: async (requestedOwner, rootPath) => {
      expect([requestedOwner, rootPath]).toEqual([owner, ROOT]);
      events.push("runtime-php");
    },
    syncSavedJavaScriptTypeScriptDocument: async (
      requestedOwner,
      rootPath,
    ) => {
      expect([requestedOwner, rootPath]).toEqual([owner, ROOT]);
      events.push("runtime-js");
    },
    hasExternalFileConflict: () => false,
    beginDocumentSelfWrite: () => null,
  };
  const repository = new OwnerDocumentSaveRepository({
    active: () => null,
    cached: () => candidate,
  });
  const service = new OwnerResolvingDocumentSaveService({
    repository,
    resolvePipeline: (requestedOwner, rootPath) => {
      expect([requestedOwner, rootPath]).toEqual([owner, ROOT]);
      return pipeline;
    },
  });
  const captured = currentDocument;

  return {
    currentDocument: () => currentDocument,
    editDocument: (next: EditorDocument) => {
      currentDocument = next;
    },
    events,
    save: () =>
      service.saveDocument({
        target: {
          owner,
          documentIdentity: "src/a.ts",
          document: captured,
        },
        lease: {
          isCurrent: () => true,
          tryBeginWrite: () => ({ granted: true, settle: vi.fn() }),
        },
      }),
  };
}

describe("OwnerResolvingDocumentSaveService", () => {
  it("saves cached state through the owner/root-explicit pipeline", async () => {
    const writeTextFile = vi.fn(async () => ({
      status: "success" as const,
      revision: revision(2),
    }));
    const subject = harness(writeTextFile);

    await expect(subject.save()).resolves.toEqual(
      expect.objectContaining({ status: "saved", contentIsCurrent: true }),
    );
    expect(writeTextFile).toHaveBeenCalledWith(
      PATH,
      "edited:formatted:optimized:organized",
      revision(1),
    );
    expect(subject.currentDocument()).toEqual(
      expect.objectContaining({
        content: "edited:formatted:optimized:organized",
        savedContent: "edited:formatted:optimized:organized",
        revision: revision(2),
      }),
    );
    expect(subject.events).toEqual([
      "format",
      "optimize",
      "organize",
      "prefetch",
      "history",
      "runtime-php",
      "runtime-js",
    ]);
  });

  it("preserves typing during a full write while acknowledging saved content", async () => {
    let release!: () => void;
    const write = new Promise<void>((resolve) => {
      release = resolve;
    });
    const nextRevision = revision(2);
    const writeTextFile = vi.fn(async () => {
      await write;
      return { status: "success" as const, revision: nextRevision };
    });
    const subject = harness(writeTextFile);

    const save = subject.save();
    await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce());
    subject.editDocument({
      ...subject.currentDocument(),
      content: "typed during write",
    });
    release();

    await expect(save).resolves.toEqual(
      expect.objectContaining({ status: "saved", contentIsCurrent: false }),
    );
    expect(subject.currentDocument()).toEqual(
      expect.objectContaining({
        content: "typed during write",
        savedContent: "edited:formatted:optimized:organized",
        revision: nextRevision,
      }),
    );
    expect(subject.events).toEqual([
      "format",
      "optimize",
      "organize",
      "prefetch",
      "history",
    ]);
  });

  it("preserves conflict results from DocumentSaveService", async () => {
    const subject = harness(
      vi.fn(async () => ({
        status: "conflict" as const,
        message: "revision changed",
      })),
    );

    await expect(subject.save()).resolves.toEqual(
      expect.objectContaining({ status: "conflict" }),
    );
    expect(subject.currentDocument().savedContent).toBe("saved");
  });

  it("preserves partial-write revision acknowledgement and result", async () => {
    const nextRevision = revision(2);
    const subject = harness(
      vi.fn(async () => ({
        status: "partial" as const,
        revision: nextRevision,
        message: "fsync failed",
      })),
    );

    const result = await subject.save();

    expect(result).toEqual(expect.objectContaining({ status: "partial" }));
    expect(subject.currentDocument()).toEqual(
      expect.objectContaining({
        content: "edited",
        savedContent: "saved",
        revision: nextRevision,
      }),
    );
    expect(subject.events).toEqual(["format", "optimize", "organize"]);
  });

  it("preserves typing during a partial write while acknowledging its revision", async () => {
    let release!: () => void;
    const write = new Promise<void>((resolve) => {
      release = resolve;
    });
    const nextRevision = revision(2);
    const writeTextFile = vi.fn(async () => {
      await write;
      return {
        status: "partial" as const,
        revision: nextRevision,
        message: "fsync failed",
      };
    });
    const subject = harness(writeTextFile);

    const save = subject.save();
    await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce());
    subject.editDocument({
      ...subject.currentDocument(),
      content: "typed during write",
    });
    release();

    await expect(save).resolves.toEqual(
      expect.objectContaining({ status: "partial" }),
    );
    expect(subject.currentDocument()).toEqual(
      expect.objectContaining({
        content: "typed during write",
        savedContent: "saved",
        revision: nextRevision,
      }),
    );
    expect(subject.events).toEqual(["format", "optimize", "organize"]);
  });

  it.each(["format", "organize"] as const)(
    "blocks the write when an external conflict appears during async %s",
    async (step) => {
      let conflict = false;
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const writeTextFile = vi.fn(async () => ({
        status: "success" as const,
        revision: revision(2),
      }));
      const repositoryIncarnation = {};
      const documentIncarnation = {};
      const currentDocument = document(revision(1));
      const candidate: OwnerDocumentRepositoryCandidate = {
        kind: "cached",
        owner,
        rootPath: ROOT,
        incarnation: repositoryIncarnation,
        readDocument: () => ({
          incarnation: documentIncarnation,
          document: currentDocument,
        }),
        replaceDocument: () => false,
      };
      const repository = new OwnerDocumentSaveRepository({
        active: () => null,
        cached: () => candidate,
      });
      const service = new OwnerResolvingDocumentSaveService({
        repository,
        resolvePipeline: () => ({
          workspaceFiles: workspaceFiles(writeTextFile),
          settings: {} as WorkspaceSettings,
          invalidatePrefetch: () => undefined,
          captureLocalHistorySnapshot: async () => undefined,
          formattedContentForSave: async (_owner, _root, _settings, item) => {
            if (step === "format") {
              await pending;
            }
            return item.content;
          },
          optimizedImportsContentForSave: (
            _owner,
            _root,
            _settings,
            _item,
            content,
          ) => content,
          organizedImportsContentForSave: async (
            _owner,
            _root,
            _settings,
            _item,
            content,
          ) => {
            if (step === "organize") {
              await pending;
            }
            return content;
          },
          resolveEditorConfigForFile: async () => ({}),
          syncSavedDocument: async () => undefined,
          syncSavedJavaScriptTypeScriptDocument: async () => undefined,
          hasExternalFileConflict: () => conflict,
          beginDocumentSelfWrite: () => null,
        }),
      });

      const save = service.saveDocument({
        target: {
          owner,
          documentIdentity: "src/a.ts",
          document: currentDocument,
        },
        lease: {
          isCurrent: () => true,
          tryBeginWrite: () => ({ granted: true, settle: vi.fn() }),
        },
      });
      await Promise.resolve();
      conflict = true;
      release();

      await expect(save).resolves.toEqual({
        status: "blocked",
        reason: "external",
      });
      expect(writeTextFile).not.toHaveBeenCalled();
    },
  );
});
