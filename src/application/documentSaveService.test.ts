import { describe, expect, it, vi } from "vitest";
import type {
  EditorDocument,
  WorkspaceFileGateway,
  WorkspaceFileRevision,
} from "../domain/workspace";
import {
  DocumentSaveService,
  type DocumentSaveAcknowledgement,
  type DocumentSaveServiceDependencies,
  type DocumentSaveTarget,
} from "./documentSaveService";

const ROOT = "/workspace";
const PATH = `${ROOT}/src/User.php`;

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
  const target: DocumentSaveTarget = {
    rootPath: ROOT,
    path: options.targetPath ?? PATH,
    isCurrent: () => current,
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
  const dependencies: DocumentSaveServiceDependencies = {
    workspaceFiles: options.workspaceFiles ?? workspaceFiles(),
    getDocument: (path) => documents[path] ?? null,
    acknowledgeSavedDocument,
    updateDocumentRevision: (saveTarget, nextRevision) => {
      const live = documents[saveTarget.path];
      if (live) {
        documents[saveTarget.path] = { ...live, revision: nextRevision };
      }
    },
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
    syncSavedDocument: async () => {
      events.push("php");
    },
    syncSavedJavaScriptTypeScriptDocument: async () => {
      events.push("js");
    },
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
    target,
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
      "prefetch",
      "history",
      "php",
      "js",
    ]);
    expect(writeTextFile).toHaveBeenCalledWith(
      PATH,
      "edited:formatted:optimized:organized",
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
});
