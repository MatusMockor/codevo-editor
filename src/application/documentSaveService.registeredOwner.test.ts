import { describe, expect, it, vi } from "vitest";
import type {
  EditorDocument,
  WorkspaceFileGateway,
  WorkspaceFileRevision,
  WorkspaceOwnerRelativeFileGateway,
} from "../domain/workspace";
import type {
  ActiveDocumentSaveStorePort,
  DocumentSaveAcknowledgement,
  DocumentSaveTarget,
} from "./activeDocumentSaveStore";
import { createRegisteredDocumentSaveIdentity } from "./documentSaveIdentity";
import { DocumentSaveService, type DocumentSaveServiceDependencies } from "./documentSaveService";

const ROOT = "/selected/workspace";
const ALIAS_PATH = "/alias/workspace/src/server.ts";

function revision(hash: string): WorkspaceFileRevision {
  return {
    contentHash: hash,
    device: "1",
    inode: "2",
    modifiedNanoseconds: 3,
    modifiedSeconds: 4,
    size: 5,
  };
}

function rawFiles(writeTextFile = vi.fn(async () => undefined)): WorkspaceFileGateway {
  return {
    applyWorkspaceEdit: vi.fn(async () => 0),
    createDirectory: vi.fn(async () => undefined),
    createTextFile: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    readDirectory: vi.fn(async () => []),
    readTextFile: vi.fn(async () => ""),
    renamePath: vi.fn(async () => undefined),
    writeTextFile,
  };
}

function registeredHarness(workspaceId: string, writer?: WorkspaceOwnerRelativeFileGateway | null) {
  const registeredIdentity = createRegisteredDocumentSaveIdentity(
    workspaceId,
    "/canonical/workspace",
    "src/server.ts",
  )!;
  let document: EditorDocument = {
    content: "const changed = true;",
    language: "typescript",
    name: "server.ts",
    path: ALIAS_PATH,
    revision: revision("before"),
    savedContent: "const changed = false;",
  };
  const rawWrite = vi.fn(async () => undefined);
  const target: DocumentSaveTarget = {
    lease: {
      isCurrent: () => true,
      tryBeginWrite: () => ({ granted: true, settle: vi.fn() }),
    },
    path: ALIAS_PATH,
    registeredIdentity,
    rootPath: ROOT,
    workspaceRequestToken: 1,
  };
  const saveStore: ActiveDocumentSaveStorePort = {
    acknowledgeIssuedWrite: (
      _target: DocumentSaveTarget,
      acknowledgement: DocumentSaveAcknowledgement,
    ) => {
      document = {
        ...document,
        content: acknowledgement.savedDocument.content,
        revision: acknowledgement.revision,
        savedContent: acknowledgement.savedDocument.content,
      };
    },
    current: () => document,
    updateRevision: (_target, nextRevision) => {
      document = { ...document, revision: nextRevision };
    },
    updateRevisionForIssuedWrite: (_target, _expected, nextRevision) => {
      document = { ...document, revision: nextRevision };
    },
  };
  const dependencies: DocumentSaveServiceDependencies = {
    beginDocumentSelfWrite: vi.fn(() => null),
    beginRegisteredDocumentSelfWrite: vi.fn(() => null),
    captureLocalHistorySnapshot: vi.fn(async () => undefined),
    formattedContentForSave: vi.fn(async (value) => value.content),
    hasExternalFileConflict: vi.fn(() => false),
    invalidatePrefetch: vi.fn(),
    optimizedImportsContentForSave: vi.fn((_value, content) => content),
    organizedImportsContentForSave: vi.fn(async (_value, content) => content),
    resolveEditorConfigForFile: vi.fn(async () => ({})),
    saveStore,
    syncSavedDocument: vi.fn(async () => undefined),
    syncSavedJavaScriptTypeScriptDocument: vi.fn(async () => undefined),
    workspaceFiles: rawFiles(rawWrite),
    workspaceOwnerRelativeFiles: writer,
  };

  return {
    document: () => document,
    rawWrite,
    save: () => new DocumentSaveService(dependencies).saveDocument(target),
    target,
  };
}

describe("DocumentSaveService registered owner-relative persistence", () => {
  it("writes the captured owner and relative path without consulting the aliased raw path", async () => {
    const ownerWrite = vi.fn(
      async (
        _workspaceId: string,
        _relativePath: string,
        _content: string,
        _expectedRevision: WorkspaceFileRevision,
      ) => ({
        status: "success" as const,
        revision: revision("after"),
      }),
    );
    const harness = registeredHarness("workspace-a", {
      writeTextFileForWorkspaceRelativePath: ownerWrite,
    });

    await expect(harness.save()).resolves.toMatchObject({
      persistence: "written",
      status: "saved",
    });
    expect(ownerWrite).toHaveBeenCalledWith(
      "workspace-a",
      "src/server.ts",
      "const changed = true;",
      revision("before"),
    );
    expect(harness.rawWrite).not.toHaveBeenCalled();
  });

  it("fails closed when the registered writer is unavailable and never falls back to raw I/O", async () => {
    const harness = registeredHarness("workspace-a", null);

    await expect(harness.save()).resolves.toMatchObject({ status: "failed" });
    expect(harness.rawWrite).not.toHaveBeenCalled();
  });

  it.each([undefined, { status: "unknown" }])(
    "treats an invalid registered writer result as uncertain settlement without acknowledgement",
    async (invalidResult) => {
      const ownerWrite = vi.fn(async () => invalidResult);
      const harness = registeredHarness("workspace-a", {
        writeTextFileForWorkspaceRelativePath: ownerWrite,
      } as unknown as WorkspaceOwnerRelativeFileGateway);

      await expect(harness.save()).resolves.toMatchObject({ status: "partial" });
      expect(harness.document().savedContent).toBe("const changed = false;");
      expect(harness.rawWrite).not.toHaveBeenCalled();
    },
  );

  it("keeps A-B-A workspace registrations distinct at the irreversible boundary", async () => {
    const ownerWrite = vi.fn(
      async (
        _workspaceId: string,
        _relativePath: string,
        _content: string,
        _expectedRevision: WorkspaceFileRevision,
      ) => ({
        status: "success" as const,
        revision: revision("after"),
      }),
    );
    const firstA = registeredHarness("workspace-a-generation-1", {
      writeTextFileForWorkspaceRelativePath: ownerWrite,
    });
    const workspaceB = registeredHarness("workspace-b", {
      writeTextFileForWorkspaceRelativePath: ownerWrite,
    });
    const secondA = registeredHarness("workspace-a-generation-2", {
      writeTextFileForWorkspaceRelativePath: ownerWrite,
    });

    await firstA.save();
    await workspaceB.save();
    await secondA.save();

    expect(ownerWrite.mock.calls.map(([workspaceId]) => workspaceId)).toEqual([
      "workspace-a-generation-1",
      "workspace-b",
      "workspace-a-generation-2",
    ]);
    expect(firstA.rawWrite).not.toHaveBeenCalled();
    expect(workspaceB.rawWrite).not.toHaveBeenCalled();
    expect(secondA.rawWrite).not.toHaveBeenCalled();
  });
});
