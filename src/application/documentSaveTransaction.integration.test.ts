import { describe, expect, it, vi } from "vitest";
import type {
  EditorDocument,
  WorkspaceFileGateway,
  WorkspaceFileRevision,
  WorkspaceTextFileSnapshot,
} from "../domain/workspace";
import {
  ActiveDocumentSaveStore,
  type ActiveDocumentSaveLease,
  type ActiveDocumentSaveStoreDependencies,
} from "./activeDocumentSaveStore";
import {
  DocumentSaveCoordinator,
  type DocumentSaveWritePermit,
} from "./documentSaveCoordinator";
import { createDocumentSaveIdentity } from "./documentSaveIdentity";
import {
  DocumentSaveService,
  type DocumentSaveResult,
} from "./documentSaveService";

const ROOT = "/workspace";
const PATH = `${ROOT}/src/User.php`;
const RELATIVE_PATH = "src/User.php";
const BASELINE = "<?php\n\n// baseline\n";
const EDITED = "<?php\n\n// edited\n";

const R1 = revision("18436989904237926841", 1);
const R2 = revision("18436989904237926842", 2);
const R3 = revision("18436989904237926843", 3);

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function revision(
  contentHash: string,
  modifiedNanoseconds: number,
): WorkspaceFileRevision {
  return {
    contentHash,
    device: "18436989904237926840",
    inode: "18436989904237926844",
    modifiedNanoseconds,
    modifiedSeconds: 1_700_000_000,
    size: BASELINE.length,
  };
}

function initialDocument(): EditorDocument {
  return {
    content: EDITED,
    language: "php",
    name: "User.php",
    path: PATH,
    revision: R1,
    savedContent: BASELINE,
  };
}

function workspaceGateway(options: {
  readSnapshot: () => Promise<WorkspaceTextFileSnapshot>;
  writeTextFile: WorkspaceFileGateway["writeTextFile"];
}): WorkspaceFileGateway {
  return {
    applyWorkspaceEdit: vi.fn(async () => 0),
    createDirectory: vi.fn(async () => undefined),
    createTextFile: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    readDirectory: vi.fn(async () => []),
    readTextFile: vi.fn(async () => BASELINE),
    readTextFileSnapshot: options.readSnapshot,
    renamePath: vi.fn(async () => undefined),
    writeTextFile: options.writeTextFile,
  };
}

function createHarness(options: {
  readSnapshot: () => Promise<WorkspaceTextFileSnapshot>;
  writeTextFile: WorkspaceFileGateway["writeTextFile"];
}) {
  const document = initialDocument();
  const documentsRef: { current: Record<string, EditorDocument> } = {
    current: { [PATH]: document },
  };
  const activeDocumentRef = { current: document as EditorDocument | null };
  const setDocuments: ActiveDocumentSaveStoreDependencies["setDocuments"] = (
    update,
  ) => {
    documentsRef.current =
      typeof update === "function" ? update(documentsRef.current) : update;
  };
  const saveStore = new ActiveDocumentSaveStore({
    activeDocumentRef,
    currentWorkspaceRootRef: { current: ROOT },
    documentsRef,
    setDocuments,
    workspaceRequestTokenRef: { current: 1 },
  });
  const service = new DocumentSaveService({
    beginDocumentSelfWrite: () => null,
    captureLocalHistorySnapshot: async () => undefined,
    formattedContentForSave: async (item) => item.content,
    hasExternalFileConflict: () => false,
    invalidatePrefetch: () => undefined,
    optimizedImportsContentForSave: (_item, content) => content,
    organizedImportsContentForSave: async (_item, content) => content,
    resolveEditorConfigForFile: async () => ({}),
    saveStore,
    syncSavedDocument: async () => undefined,
    syncSavedJavaScriptTypeScriptDocument: async () => undefined,
    workspaceFiles: workspaceGateway(options),
  });
  const coordinator = new DocumentSaveCoordinator<DocumentSaveResult>();
  const identity = createDocumentSaveIdentity(ROOT, RELATIVE_PATH);
  if (!identity) {
    throw new Error("Expected a valid integration-test save identity");
  }
  const permits: DocumentSaveWritePermit[] = [];
  const save = () =>
    coordinator.request(identity, async (lease) => {
      const observedLease: ActiveDocumentSaveLease = {
        isCurrent: lease.isCurrent,
        tryBeginWrite: () => {
          const permit = lease.tryBeginWrite();
          if (permit && !permits.includes(permit)) {
            permits.push(permit);
          }
          return permit;
        },
      };

      return service.saveDocument({
        lease: observedLease,
        path: PATH,
        rootPath: ROOT,
        workspaceRequestToken: 1,
      });
    });

  return {
    coordinator,
    currentDocument: () => documentsRef.current[PATH],
    identity,
    permits,
    save,
  };
}

describe("document save transaction integration", () => {
  it("reconciles an unchanged baseline and succeeds through a distinct second permit", async () => {
    const writeTextFile = vi
      .fn<WorkspaceFileGateway["writeTextFile"]>()
      .mockResolvedValueOnce({
        message: "revision changed",
        status: "conflict",
      })
      .mockResolvedValueOnce({ revision: R3, status: "success" });
    const harness = createHarness({
      readSnapshot: async () => ({ content: BASELINE, revision: R2 }),
      writeTextFile,
    });

    await expect(harness.save()).resolves.toEqual({
      result: expect.objectContaining({
        contentIsCurrent: true,
        status: "saved",
      }),
      status: "saved",
    });
    expect(writeTextFile).toHaveBeenNthCalledWith(1, PATH, EDITED, R1);
    expect(writeTextFile).toHaveBeenNthCalledWith(2, PATH, EDITED, R2);
    expect(harness.permits).toHaveLength(2);
    expect(harness.permits[1]).not.toBe(harness.permits[0]);
    expect(harness.currentDocument()).toMatchObject({
      content: EDITED,
      revision: R3,
      savedContent: EDITED,
    });
  });

  it("does not retry or overwrite actual external content", async () => {
    const externalContent = "<?php\n\n// changed externally\n";
    const writeTextFile = vi
      .fn<WorkspaceFileGateway["writeTextFile"]>()
      .mockResolvedValue({
        message: "revision changed",
        status: "conflict",
      });
    const harness = createHarness({
      readSnapshot: async () => ({ content: externalContent, revision: R2 }),
      writeTextFile,
    });

    await expect(harness.save()).resolves.toEqual({
      result: expect.objectContaining({
        snapshot: { content: externalContent, revision: R2 },
        status: "conflict",
      }),
      status: "saved",
    });
    expect(writeTextFile).toHaveBeenCalledTimes(1);
    expect(harness.permits).toHaveLength(1);
    expect(harness.currentDocument()).toMatchObject({
      content: EDITED,
      revision: R1,
      savedContent: BASELINE,
    });
  });

  it("prevents a second write when a drain starts between conflict and retry", async () => {
    const snapshotRequested = deferred<void>();
    const releaseSnapshot = deferred<WorkspaceTextFileSnapshot>();
    const drainStarted = deferred<void>();
    const releaseDrain = deferred<void>();
    const writeTextFile = vi
      .fn<WorkspaceFileGateway["writeTextFile"]>()
      .mockResolvedValue({
        message: "revision changed",
        status: "conflict",
      });
    const harness = createHarness({
      readSnapshot: async () => {
        snapshotRequested.resolve();
        return releaseSnapshot.promise;
      },
      writeTextFile,
    });

    const save = harness.save();
    await snapshotRequested.promise;
    const drain = harness.coordinator.runWithIssuedWriteDrain(
      { kind: "file", ...harness.identity },
      async () => {
        drainStarted.resolve();
        await releaseDrain.promise;
      },
    );
    await drainStarted.promise;
    releaseSnapshot.resolve({ content: BASELINE, revision: R2 });

    await expect(save).resolves.toEqual({
      result: { status: "stale" },
      status: "saved",
    });
    expect(writeTextFile).toHaveBeenCalledTimes(1);
    expect(harness.permits).toHaveLength(1);
    expect(harness.currentDocument()).toMatchObject({
      content: EDITED,
      revision: R2,
      savedContent: BASELINE,
    });

    releaseDrain.resolve();
    await expect(drain).resolves.toBeUndefined();
  });
});
