import { describe, expect, it, vi } from "vitest";
import type {
  EditorDocument,
  WorkspaceFileGateway,
  WorkspaceFileRevision,
} from "../domain/workspace";
import {
  DocumentSaveService,
  type DocumentSaveServiceDependencies,
  type DocumentSaveTarget,
} from "./documentSaveService";
import type {
  ActiveDocumentSaveStorePort,
  DocumentSaveAcknowledgement,
} from "./activeDocumentSaveStore";

const ROOT = "/workspace";
const PATH = `${ROOT}/src/User.php`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function document(
  path = PATH,
  content = "edited",
  savedContent = "saved",
): EditorDocument {
  const segments = path.split("/");
  return {
    content,
    language: "php",
    name: segments[segments.length - 1] ?? path,
    path,
    savedContent,
  };
}

function workspaceFiles(
  overrides: Partial<WorkspaceFileGateway> = {},
): WorkspaceFileGateway {
  return {
    applyWorkspaceEdit: vi.fn(async () => 0),
    createDirectory: vi.fn(async () => undefined),
    createTextFile: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    readDirectory: vi.fn(async () => []),
    readTextFile: vi.fn(async () => "disk"),
    renamePath: vi.fn(async () => undefined),
    writeTextFile: vi.fn(async () => undefined),
    ...overrides,
  } as WorkspaceFileGateway;
}

function revision(contentHash: number): WorkspaceFileRevision {
  return {
    contentHash,
    device: 1,
    inode: 2,
    modifiedNanoseconds: 3,
    modifiedSeconds: 4,
    size: 5,
  };
}

function createHarness(options: {
  documents?: Record<string, EditorDocument>;
  events?: string[];
  targetPath?: string;
  workspaceFiles?: WorkspaceFileGateway;
  overrides?: Partial<DocumentSaveServiceDependencies>;
} = {}) {
  const events = options.events ?? [];
  const documents =
    options.documents ?? ({ [PATH]: document() } as Record<string, EditorDocument>);
  let current = true;
  let writeAllowed = true;
  const settleWrite = vi.fn();
  const tryBeginWrite = vi.fn(() =>
    writeAllowed ? { granted: true as const, settle: settleWrite } : null,
  );
  const target: DocumentSaveTarget = {
    rootPath: ROOT,
    path: options.targetPath ?? PATH,
    workspaceRequestToken: 1,
    lease: { isCurrent: () => current, tryBeginWrite },
  };
  const acknowledgeSavedDocument = vi.fn(
    (
      saveTarget: DocumentSaveTarget,
      acknowledgement: DocumentSaveAcknowledgement,
    ) => {
      events.push("ack");
      const live = documents[saveTarget.path];
      if (!live) {
        return;
      }
      documents[saveTarget.path] = {
        ...live,
        content:
          live === acknowledgement.expectedDocument
            ? acknowledgement.savedDocument.content
            : live.content,
        savedContent: acknowledgement.savedDocument.content,
        revision: acknowledgement.revision,
      };
    },
  );
  const syncSavedDocument = vi.fn(async () => {
    events.push("php");
  });
  const syncSavedJavaScriptTypeScriptDocument = vi.fn(async () => {
    events.push("js");
  });
  const saveStore: ActiveDocumentSaveStorePort = {
    current: (saveTarget) => {
      if (!saveTarget.lease.isCurrent()) {
        return null;
      }

      return documents[saveTarget.path] ?? null;
    },
    acknowledgeIssuedWrite: acknowledgeSavedDocument,
    updateRevisionForIssuedWrite: (
      saveTarget,
      _expectedDocument,
      nextRevision,
    ) => {
      const live = documents[saveTarget.path];
      if (live) {
        documents[saveTarget.path] = { ...live, revision: nextRevision };
      }
    },
    updateRevision: (saveTarget, nextRevision) => {
      const live = documents[saveTarget.path];
      if (live) {
        documents[saveTarget.path] = { ...live, revision: nextRevision };
      }
    },
  };
  const dependencies: DocumentSaveServiceDependencies = {
    workspaceFiles: options.workspaceFiles ?? workspaceFiles(),
    saveStore,
    invalidatePrefetch: () => events.push("prefetch"),
    captureLocalHistorySnapshot: async () => {
      events.push("history");
    },
    formattedContentForSave: async (item) => {
      events.push("format");
      return `${item.content}:formatted`;
    },
    optimizedImportsContentForSave: (_item, content) => {
      events.push("optimize");
      return `${content}:optimized`;
    },
    organizedImportsContentForSave: async (_item, content) => {
      events.push("organize");
      return `${content}:organized`;
    },
    resolveEditorConfigForFile: async () => {
      events.push("editorconfig");
      return {};
    },
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    hasExternalFileConflict: () => false,
    ...options.overrides,
  };

  return {
    acknowledgeSavedDocument,
    dependencies,
    documents,
    events,
    save: () => new DocumentSaveService(dependencies).saveDocument(target),
    setCurrent: (value: boolean) => {
      current = value;
    },
    setWriteAllowed: (value: boolean) => {
      writeAllowed = value;
    },
    settleWrite,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    target,
    tryBeginWrite,
  };
}

describe("DocumentSaveService", () => {
  it("runs transform, write, acknowledgement, durability, PHP, and JS in order", async () => {
    const events: string[] = [];
    const writeTextFile = vi.fn(async () => {
      events.push("write");
      return { status: "success" as const, revision: revision(2) };
    });
    const harness = createHarness({
      events,
      workspaceFiles: workspaceFiles({ writeTextFile }),
    });
    harness.settleWrite.mockImplementation(() => events.push("settle"));

    const result = await harness.save();

    expect(result).toEqual(
      expect.objectContaining({ status: "saved", contentIsCurrent: true }),
    );
    expect(events).toEqual([
      "format",
      "optimize",
      "organize",
      "editorconfig",
      "write",
      "ack",
      "settle",
      "prefetch",
      "history",
      "php",
      "js",
    ]);
    expect(writeTextFile).toHaveBeenCalledWith(
      PATH,
      "edited:formatted:optimized:organized",
    );
    expect(harness.syncSavedDocument).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ path: PATH }),
      expect.any(Function),
    );
    expect(
      harness.syncSavedJavaScriptTypeScriptDocument,
    ).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ path: PATH }),
      expect.any(Function),
    );
  });

  it("targets the requested path instead of an active-document concept", async () => {
    const otherPath = `${ROOT}/src/Other.php`;
    const other = document(otherPath, "other");
    const harness = createHarness({
      documents: { [PATH]: document(PATH, "active"), [otherPath]: other },
      targetPath: otherPath,
    });

    const result = await harness.save();

    expect(result.status).toBe("saved");
    expect(harness.documents[PATH].savedContent).toBe("saved");
    expect(harness.documents[otherPath].savedContent).toBe(
      "other:formatted:optimized:organized",
    );
  });

  it("returns a write conflict with its authoritative disk snapshot", async () => {
    const diskRevision = revision(9);
    const harness = createHarness({
      workspaceFiles: workspaceFiles({
        readTextFileSnapshot: vi.fn(async () => ({
          content: "disk",
          revision: diskRevision,
        })),
        writeTextFile: vi.fn(async () => ({
          status: "conflict" as const,
          message: "changed",
        })),
      }),
    });

    await expect(harness.save()).resolves.toEqual({
      status: "conflict",
      document: harness.documents[PATH],
      snapshot: { content: "disk", revision: diskRevision },
    });
  });

  it("distinguishes failed and partial-durability writes", async () => {
    const failed = createHarness({
      workspaceFiles: workspaceFiles({
        writeTextFile: vi.fn(async () => ({
          status: "error" as const,
          message: "denied",
        })),
      }),
    });
    const partialRevision = revision(3);
    const partial = createHarness({
      workspaceFiles: workspaceFiles({
        writeTextFile: vi.fn(async () => ({
          status: "partial" as const,
          message: "directory sync failed",
          revision: partialRevision,
        })),
      }),
    });

    await expect(failed.save()).resolves.toEqual({
      status: "failed",
      error: expect.objectContaining({ message: "denied" }),
    });
    await expect(partial.save()).resolves.toEqual({
      status: "partial",
      error: expect.objectContaining({
        message:
          "The file was saved, but durability could not be confirmed: directory sync failed",
      }),
    });
    expect(partial.documents[PATH].revision).toEqual(partialRevision);
  });

  it("reconciles a partial revision after the save token expires", async () => {
    const partialRevision = revision(4);
    const write = deferred<{
      status: "partial";
      message: string;
      revision: WorkspaceFileRevision;
    }>();
    const harness = createHarness({
      workspaceFiles: workspaceFiles({
        writeTextFile: vi.fn(() => write.promise),
      }),
    });
    const save = harness.save();
    await vi.waitFor(() => expect(harness.tryBeginWrite).toHaveBeenCalledOnce());
    harness.setCurrent(false);

    write.resolve({
      status: "partial",
      message: "directory sync failed",
      revision: partialRevision,
    });

    await expect(save).resolves.toEqual({ status: "stale" });
    expect(harness.documents[PATH]).toEqual(
      expect.objectContaining({
        content: "edited",
        savedContent: "saved",
        revision: partialRevision,
      }),
    );
    expect(harness.settleWrite).toHaveBeenCalledOnce();
    expect(harness.events).not.toContain("prefetch");
    expect(harness.events).not.toContain("history");
  });

  it("settles the write barrier before reading a slow conflict snapshot", async () => {
    const diskRevision = revision(9);
    const snapshot = deferred<{
      content: string;
      revision: WorkspaceFileRevision;
    }>();
    const events: string[] = [];
    const harness = createHarness({
      events,
      workspaceFiles: workspaceFiles({
        readTextFileSnapshot: vi.fn(() => {
          events.push("read");
          return snapshot.promise;
        }),
        writeTextFile: vi.fn(async () => ({
          status: "conflict" as const,
          message: "changed",
        })),
      }),
    });
    harness.settleWrite.mockImplementation(() => events.push("settle"));
    const save = harness.save();

    await vi.waitFor(() => expect(harness.settleWrite).toHaveBeenCalledOnce());

    expect(events.indexOf("settle")).toBeLessThan(events.indexOf("read"));
    const completed = vi.fn();
    void save.then(completed);
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();

    snapshot.resolve({ content: "disk", revision: diskRevision });

    await expect(save).resolves.toEqual({
      status: "conflict",
      document: harness.documents[PATH],
      snapshot: { content: "disk", revision: diskRevision },
    });
  });

  it("returns stale when its root-explicit target guard expires", async () => {
    let release!: (value: string) => void;
    const formatted = new Promise<string>((resolve) => {
      release = resolve;
    });
    const harness = createHarness({
      overrides: { formattedContentForSave: vi.fn(() => formatted) },
    });
    const save = harness.save();

    harness.setCurrent(false);
    release("formatted");

    await expect(save).resolves.toEqual({ status: "stale" });
    expect(harness.dependencies.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
  });

  it("returns stale when the lease denies the write permit", async () => {
    const harness = createHarness();
    harness.setWriteAllowed(false);

    await expect(harness.save()).resolves.toEqual({ status: "stale" });

    expect(harness.tryBeginWrite).toHaveBeenCalledOnce();
    expect(
      harness.dependencies.workspaceFiles.writeTextFile,
    ).not.toHaveBeenCalled();
    expect(harness.settleWrite).not.toHaveBeenCalled();
  });

  it("blocks without writing when the live document becomes read-only during formatting", async () => {
    let release!: (value: string) => void;
    const formatted = new Promise<string>((resolve) => {
      release = resolve;
    });
    const harness = createHarness({
      overrides: { formattedContentForSave: vi.fn(() => formatted) },
    });
    const save = harness.save();
    await vi.waitFor(() =>
      expect(
        harness.dependencies.formattedContentForSave,
      ).toHaveBeenCalledOnce(),
    );
    harness.documents[PATH] = {
      ...harness.documents[PATH],
      readOnly: true,
    };

    release("formatted");

    await expect(save).resolves.toEqual({
      status: "blocked",
      reason: "readOnly",
    });
    expect(
      harness.dependencies.workspaceFiles.writeTextFile,
    ).not.toHaveBeenCalled();
  });

  it("preserves a concurrent edit while acknowledging the content written", async () => {
    let release!: () => void;
    const write = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createHarness({
      workspaceFiles: workspaceFiles({
        writeTextFile: vi.fn(() => write),
      }),
    });
    const save = harness.save();
    await vi.waitFor(() =>
      expect(harness.dependencies.workspaceFiles.writeTextFile).toHaveBeenCalledOnce(),
    );
    harness.documents[PATH] = {
      ...harness.documents[PATH],
      content: "typed during write",
    };

    release();
    await expect(save).resolves.toEqual(
      expect.objectContaining({ status: "saved", contentIsCurrent: false }),
    );
    expect(harness.documents[PATH]).toEqual(
      expect.objectContaining({
        content: "typed during write",
        savedContent: "edited:formatted:optimized:organized",
      }),
    );
    expect(harness.events).not.toContain("php");
    expect(harness.events).not.toContain("js");
  });

  it("acknowledges an issued write but suppresses stale side effects", async () => {
    let release!: () => void;
    const write = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createHarness({
      workspaceFiles: workspaceFiles({ writeTextFile: vi.fn(() => write) }),
    });
    const save = harness.save();
    await vi.waitFor(() => expect(harness.tryBeginWrite).toHaveBeenCalledOnce());
    harness.setCurrent(false);

    release();

    await expect(save).resolves.toEqual({ status: "stale" });
    expect(harness.documents[PATH].savedContent).toBe(
      "edited:formatted:optimized:organized",
    );
    expect(harness.settleWrite).toHaveBeenCalledOnce();
    expect(harness.events).not.toContain("prefetch");
    expect(harness.events).not.toContain("history");
    expect(harness.events).not.toContain("php");
    expect(harness.events).not.toContain("js");
  });

  it.each(["failure", "conflict"] as const)(
    "settles the issued write after a %s",
    async (outcome) => {
      const harness = createHarness({
        workspaceFiles: workspaceFiles({
          writeTextFile: vi.fn(async () =>
            outcome === "conflict"
              ? { status: "conflict" as const, message: "changed" }
              : { status: "error" as const, message: "denied" },
          ),
        }),
      });

      await harness.save();

      expect(harness.settleWrite).toHaveBeenCalledOnce();
      expect(harness.acknowledgeSavedDocument).not.toHaveBeenCalled();
    },
  );
});
