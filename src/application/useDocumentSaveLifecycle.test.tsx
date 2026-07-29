// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePrefetchCache } from "../domain/filePrefetchCache";
import type { LocalHistoryGateway } from "../domain/localHistory";
import { MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS } from "../domain/liveDocumentContentAuthority";
import { defaultWorkspaceSettings } from "../domain/settings";
import type {
  EditorDocument,
  WorkspaceFileGateway,
  WorkspaceFileRevision,
  WorkspaceWriteResult,
} from "../domain/workspace";
import type { ActiveDocumentSaveStorePort } from "./activeDocumentSaveStore";
import {
  createEslintFixOnSaveParticipant,
  orderedDocumentSaveParticipants,
  type DocumentSaveParticipant,
} from "./documentSaveParticipants";
import {
  EditorActiveLiveDocumentSaveCoordinator,
  type EditorActiveLiveDocumentSaveAdmissionPort,
  type EditorActiveLiveDocumentSaveRejectionReason,
} from "./editorActiveLiveDocumentSaveCoordinator";
import { createRegisteredDocumentSaveIdentity } from "./documentSaveIdentity";
import { createPrettierSaveParticipant } from "./prettierSaveParticipant";
import {
  useDocumentSaveLifecycle,
  type DocumentSaveLifecycle,
  type DocumentSaveLifecycleDependencies,
} from "./useDocumentSaveLifecycle";

const ROOT = "/workspace";
const PATH = `${ROOT}/src/User.php`;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function document(content = "edited", savedContent = "saved"): EditorDocument {
  return {
    content,
    language: "php",
    name: "User.php",
    path: PATH,
    savedContent,
  };
}

function revision(contentHash: string): WorkspaceFileRevision {
  return {
    contentHash,
    device: "1",
    inode: "2",
    modifiedNanoseconds: 3,
    modifiedSeconds: 4,
    size: 5,
  };
}

function workspaceFiles(overrides: Partial<WorkspaceFileGateway> = {}): WorkspaceFileGateway {
  return {
    applyWorkspaceEdit: vi.fn(async () => 0),
    createDirectory: vi.fn(async () => undefined),
    createTextFile: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    readDirectory: vi.fn(async () => []),
    readTextFile: vi.fn(async () => ""),
    renamePath: vi.fn(async () => undefined),
    writeTextFile: vi.fn(async () => undefined),
    ...overrides,
  } as WorkspaceFileGateway;
}

function localHistoryGateway(overrides: Partial<LocalHistoryGateway> = {}): LocalHistoryGateway {
  return {
    listVersions: vi.fn(async () => []),
    readVersion: vi.fn(async () => ""),
    recordSnapshot: vi.fn(async () => null),
    ...overrides,
  } as LocalHistoryGateway;
}

interface Harness {
  lifecycle: () => DocumentSaveLifecycle;
  dependencies: DocumentSaveLifecycleDependencies;
  currentWorkspaceRootRef: { current: string | null };
  workspaceRequestTokenRef: { current: number };
  activeDocumentRef: { current: EditorDocument | null };
  documentsRef: { current: Record<string, EditorDocument> };
  workspaceFiles: WorkspaceFileGateway;
  localHistoryGateway: LocalHistoryGateway;
  syncSavedDocument: ReturnType<typeof vi.fn>;
  syncSavedJavaScriptTypeScriptDocument: ReturnType<typeof vi.fn>;
  setMessage: ReturnType<typeof vi.fn>;
  runEslintAnalysisOnSave: ReturnType<typeof vi.fn>;
  runPhpstanAnalysisOnSave: ReturnType<typeof vi.fn>;
  replaceDocument: (next: EditorDocument) => void;
  rerender: (overrides: Partial<DocumentSaveLifecycleDependencies>) => void;
  unmount: () => void;
}

function renderLifecycle(
  overrides: Partial<DocumentSaveLifecycleDependencies> = {},
  options: { strictMode?: boolean } = {},
): Harness {
  const initialDocument = overrides.activeDocument ?? document();
  const currentWorkspaceRootRef = { current: ROOT as string | null };
  const workspaceRequestTokenRef = { current: 1 };
  const activeDocumentRef = {
    current: initialDocument as EditorDocument | null,
  };
  const documentsRef = {
    current: { [initialDocument.path]: initialDocument } as Record<string, EditorDocument>,
  };
  const files = workspaceFiles();
  const history = localHistoryGateway();
  const syncSavedDocument = vi.fn(async () => undefined);
  const syncSavedJavaScriptTypeScriptDocument = vi.fn(async () => undefined);
  const setMessage = vi.fn();
  const runEslintAnalysisOnSave = vi.fn();
  const runPhpstanAnalysisOnSave = vi.fn();

  const dependencies: DocumentSaveLifecycleDependencies = {
    workspaceRoot: ROOT,
    activeDocument: initialDocument,
    workspaceSettings: defaultWorkspaceSettings(),
    currentWorkspaceRootRef,
    workspaceRequestTokenRef,
    activeDocumentRef,
    documentsRef,
    filePrefetchCacheRef: { current: new FilePrefetchCache() },
    setDocuments: ((update: Parameters<DocumentSaveLifecycleDependencies["setDocuments"]>[0]) => {
      documentsRef.current = typeof update === "function" ? update(documentsRef.current) : update;
    }) as DocumentSaveLifecycleDependencies["setDocuments"],
    setMessage,
    localHistoryGateway: history,
    workspaceFiles: files,
    formattedContentForSave: vi.fn(async (item: EditorDocument) => item.content),
    optimizedImportsContentForSave: vi.fn((_item: EditorDocument, content: string) => content),
    organizedImportsContentForSave: vi.fn(
      async (_item: EditorDocument, content: string) => content,
    ),
    resolveEditorConfigForFile: vi.fn(async () => ({})),
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    beginDocumentSelfWrite: () => null,
    activeLiveDocumentSaveCoordinator: fallbackLiveSaveCoordinator(),
    reportErrorForActiveWorkspaceRoot: vi.fn(),
    runEslintAnalysisOnSave,
    runPhpstanAnalysisOnSave,
    ...overrides,
  };
  const container = globalThis.document.createElement("div");
  const root = createRoot(container);
  let currentLifecycle: DocumentSaveLifecycle | null = null;

  function Component() {
    currentLifecycle = useDocumentSaveLifecycle(dependencies);
    return null;
  }

  const render = () =>
    root.render(
      options.strictMode ? (
        <StrictMode>
          <Component />
        </StrictMode>
      ) : (
        <Component />
      ),
    );

  act(render);

  return {
    lifecycle: () => {
      if (!currentLifecycle) {
        throw new Error("save lifecycle is not mounted");
      }
      return currentLifecycle;
    },
    dependencies,
    currentWorkspaceRootRef,
    workspaceRequestTokenRef,
    activeDocumentRef,
    documentsRef,
    workspaceFiles: dependencies.workspaceFiles,
    localHistoryGateway: dependencies.localHistoryGateway,
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    setMessage,
    runEslintAnalysisOnSave,
    runPhpstanAnalysisOnSave,
    replaceDocument: (next) => {
      documentsRef.current = { ...documentsRef.current, [next.path]: next };
      activeDocumentRef.current = next;
    },
    rerender: (next) => {
      Object.assign(dependencies, next);
      act(render);
    },
    unmount: () => act(() => root.unmount()),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useDocumentSaveLifecycle", () => {
  it("blocks an active TypeScript save before its exact-live binding is published", async () => {
    const staleReactDocument = {
      ...document("stale react", "saved"),
      language: "typescript",
      name: "User.ts",
    };
    const onDidSaveDocument = vi.fn();
    const harness = renderLifecycle({
      activeDocument: staleReactDocument,
      activeLiveDocumentSaveCoordinator: new EditorActiveLiveDocumentSaveCoordinator(),
      onDidSaveDocument,
    });

    let result!: Awaited<ReturnType<DocumentSaveLifecycle["saveDocument"]>>;
    await act(async () => {
      result = await harness.lifecycle().saveDocument(PATH);
    });

    expect(result).toEqual({
      reason: "exactLiveDocumentUnavailable",
      status: "blocked",
    });
    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    expect(onDidSaveDocument).not.toHaveBeenCalled();
    expect(harness.documentsRef.current[PATH]).toBe(staleReactDocument);
    expect(harness.setMessage).toHaveBeenCalledWith(
      "The live editor content changed before it could be captured safely. Try saving again.",
    );
    harness.unmount();
  });

  it.each([
    [
      "document-too-large",
      "exactLiveDocumentTooLarge",
      "The live editor content is too large to save safely. Reduce the file size and try again.",
    ],
    [
      "exact-live-unavailable",
      "exactLiveDocumentUnavailable",
      "The live editor content changed before it could be captured safely. Try saving again.",
    ],
  ] as const)(
    "blocks Ctrl+S for %s exact-live capture without writing stale React content",
    async (liveReason, resultReason, message) => {
      const staleReactDocument = {
        ...document("stale react", "saved"),
        language: "typescript",
        name: "User.ts",
      };
      const onDidSaveDocument = vi.fn();
      const activeLiveDocumentSaveCoordinator = rejectingLiveSaveCoordinator(liveReason);
      const harness = renderLifecycle({
        activeDocument: staleReactDocument,
        activeLiveDocumentSaveCoordinator,
        onDidSaveDocument,
      });

      let result!: Awaited<ReturnType<DocumentSaveLifecycle["saveDocument"]>>;
      await act(async () => {
        result = await harness.lifecycle().saveDocument(PATH);
      });

      expect(result).toEqual({ reason: resultReason, status: "blocked" });
      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
      expect(onDidSaveDocument).not.toHaveBeenCalled();
      expect(harness.syncSavedDocument).not.toHaveBeenCalled();
      expect(harness.documentsRef.current[PATH]).toBe(staleReactDocument);
      expect(harness.setMessage).toHaveBeenCalledWith(message);
      harness.unmount();
    },
  );

  it("keeps oversized exact-live autosave dirty and writes zero bytes", async () => {
    vi.useFakeTimers();
    const staleReactDocument = {
      ...document("stale react", "saved"),
      language: "typescript",
      name: "User.ts",
    };
    const onDidSaveDocument = vi.fn();
    const harness = renderLifecycle({
      activeDocument: staleReactDocument,
      activeLiveDocumentSaveCoordinator: rejectingLiveSaveCoordinator("document-too-large"),
      onDidSaveDocument,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: true,
      },
    });

    await act(async () => vi.advanceTimersByTimeAsync(900));

    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    expect(onDidSaveDocument).not.toHaveBeenCalled();
    expect(harness.documentsRef.current[PATH]).toBe(staleReactDocument);
    expect(harness.setMessage).toHaveBeenCalledWith(
      "The live editor content is too large to save safely. Reduce the file size and try again.",
    );
    harness.unmount();
  });

  it("does not present a rejected exact-live save after its workspace authority rotates", async () => {
    const staleReactDocument = {
      ...document("stale react", "saved"),
      language: "typescript",
      name: "User.ts",
    };
    let rotateWorkspace = () => undefined;
    const coordinator: EditorActiveLiveDocumentSaveAdmissionPort = {
      admit: vi.fn(() => {
        rotateWorkspace();
        return { reason: "exact-live-unavailable" as const, status: "rejected" as const };
      }),
      publish: vi.fn(),
    };
    const harness = renderLifecycle({
      activeDocument: staleReactDocument,
      activeLiveDocumentSaveCoordinator: coordinator,
    });
    rotateWorkspace = () => {
      harness.currentWorkspaceRootRef.current = "/replacement";
      harness.workspaceRequestTokenRef.current += 1;
    };

    let result!: Awaited<ReturnType<DocumentSaveLifecycle["saveDocument"]>>;
    await act(async () => {
      result = await harness.lifecycle().saveDocument(PATH);
    });

    expect(result).toEqual({ reason: "exactLiveDocumentUnavailable", status: "blocked" });
    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    expect(harness.setMessage).not.toHaveBeenCalled();
    expect(harness.documentsRef.current[PATH]).toBe(staleReactDocument);
    harness.unmount();
  });

  it("returns a saved result for a path-targeted non-active document", async () => {
    const otherPath = `${ROOT}/src/Other.php`;
    const otherDocument: EditorDocument = {
      ...document("other", "old"),
      name: "Other.php",
      path: otherPath,
    };
    const harness = renderLifecycle();
    harness.documentsRef.current = {
      ...harness.documentsRef.current,
      [otherPath]: otherDocument,
    };

    let result!: Awaited<ReturnType<DocumentSaveLifecycle["saveDocument"]>>;
    await act(async () => {
      result = await harness.lifecycle().saveDocument(otherPath);
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "saved",
        document: expect.objectContaining({ path: otherPath }),
      }),
    );
    expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(otherPath, "other");
    expect(harness.activeDocumentRef.current?.path).toBe(PATH);
    harness.unmount();
  });

  it("reports a successfully written document for cache invalidation", async () => {
    const onDidSaveDocument = vi.fn();
    const harness = renderLifecycle({ onDidSaveDocument });

    await act(async () => {
      await harness.lifecycle().saveDocument(PATH);
    });

    expect(onDidSaveDocument).toHaveBeenCalledExactlyOnceWith(
      ROOT,
      expect.objectContaining({ content: "edited", path: PATH }),
    );
    harness.unmount();
  });

  it("returns conflict details while keeping conflict presentation in the hook", async () => {
    const snapshot = { content: "disk", revision: null };
    const detectSaveConflict = vi.fn();
    const harness = renderLifecycle({
      detectSaveConflict,
      workspaceFiles: workspaceFiles({
        readTextFileSnapshot: vi.fn(async () => snapshot),
        writeTextFile: vi.fn(async () => ({
          status: "conflict" as const,
          message: "changed",
        })),
      }),
    });

    let result!: Awaited<ReturnType<DocumentSaveLifecycle["saveDocument"]>>;
    await act(async () => {
      result = await harness.lifecycle().saveDocument(PATH);
    });

    expect(result).toEqual(expect.objectContaining({ status: "conflict", snapshot }));
    expect(detectSaveConflict).toHaveBeenCalledWith(
      ROOT,
      harness.documentsRef.current[PATH],
      snapshot,
    );
    expect(harness.setMessage).toHaveBeenCalledWith(
      "The file changed on disk. Review the conflict before saving.",
    );
    harness.unmount();
  });

  it("returns the latest saved result to a coalesced request", async () => {
    const firstWrite = deferred<void>();
    const writeTextFile = vi
      .fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue(undefined);
    const harness = renderLifecycle({
      workspaceFiles: workspaceFiles({ writeTextFile }),
    });

    const first = harness.lifecycle().saveDocument(PATH);
    await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce());
    harness.replaceDocument(document("second"));
    const coalesced = harness.lifecycle().saveDocument(PATH);
    harness.replaceDocument(document("latest"));
    const latest = harness.lifecycle().saveDocument(PATH);
    firstWrite.resolve();

    let results!: Awaited<ReturnType<DocumentSaveLifecycle["saveDocument"]>>[];
    await act(async () => {
      results = await Promise.all([first, coalesced, latest]);
    });

    expect(results[0]).toEqual(
      expect.objectContaining({ status: "saved", contentIsCurrent: false }),
    );
    expect(results[1]).toEqual(
      expect.objectContaining({ status: "saved", contentIsCurrent: true }),
    );
    expect(results[2]).toEqual(
      expect.objectContaining({ status: "saved", contentIsCurrent: true }),
    );
    expect(results[1]).toBe(results[2]);
    expect(writeTextFile).toHaveBeenNthCalledWith(2, PATH, "latest");
    harness.unmount();
  });

  it("shares a canonical save lane while writing each selected alias", async () => {
    const aliasPath = `${ROOT}/src/Alias.php`;
    const beforeRevision = revision("before");
    const afterRevision = revision("after");
    const firstWrite = deferred<WorkspaceWriteResult>();
    const writeOwnerRelative = vi
      .fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue({ status: "success", revision: afterRevision });
    const resolveDocumentSaveOwnership = vi.fn(() =>
      createRegisteredDocumentSaveIdentity("workspace-a", "/real/workspace", "src/User.php"),
    );
    const selectedDocument = {
      ...document(),
      revision: beforeRevision,
    };
    const harness = renderLifecycle({
      activeDocument: selectedDocument,
      resolveDocumentSaveOwnership,
      workspaceOwnerRelativeFiles: {
        writeTextFileForWorkspaceRelativePath: writeOwnerRelative,
      },
    });
    const aliasDocument = {
      ...document("alias edited"),
      name: "Alias.php",
      path: aliasPath,
      revision: beforeRevision,
    };
    harness.documentsRef.current = {
      ...harness.documentsRef.current,
      [aliasPath]: aliasDocument,
    };

    const selectedSave = harness.lifecycle().saveDocument(PATH);
    await vi.waitFor(() => expect(writeOwnerRelative).toHaveBeenCalledOnce());
    const aliasSave = harness.lifecycle().saveDocument(aliasPath);
    firstWrite.resolve({ status: "success", revision: afterRevision });

    await act(async () => {
      await Promise.all([selectedSave, aliasSave]);
    });

    expect(resolveDocumentSaveOwnership).toHaveBeenCalledTimes(2);
    expect(resolveDocumentSaveOwnership).toHaveBeenNthCalledWith(1, ROOT, PATH);
    expect(resolveDocumentSaveOwnership).toHaveBeenNthCalledWith(2, ROOT, aliasPath);
    expect(writeOwnerRelative).toHaveBeenNthCalledWith(
      1,
      "workspace-a",
      "src/User.php",
      "edited",
      beforeRevision,
    );
    expect(writeOwnerRelative).toHaveBeenNthCalledWith(
      2,
      "workspace-a",
      "src/User.php",
      "alias edited",
      beforeRevision,
    );
    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    expect(harness.localHistoryGateway.recordSnapshot).toHaveBeenNthCalledWith(
      2,
      ROOT,
      "src/Alias.php",
      "alias edited",
    );
    expect(harness.syncSavedDocument).toHaveBeenNthCalledWith(
      2,
      ROOT,
      expect.objectContaining({ path: aliasPath }),
      expect.any(Function),
    );
    expect(harness.setMessage).toHaveBeenLastCalledWith("Saved Alias.php");
    harness.unmount();
  });

  it("rejects a save without canonical ownership", async () => {
    const outsidePath = "/outside/User.php";
    const resolveDocumentSaveOwnership = vi.fn(() => null);
    const harness = renderLifecycle({ resolveDocumentSaveOwnership });
    harness.documentsRef.current[outsidePath] = {
      ...document("outside edited"),
      path: outsidePath,
    };

    await expect(harness.lifecycle().saveDocument(outsidePath)).resolves.toEqual({
      status: "stale",
    });

    expect(resolveDocumentSaveOwnership).toHaveBeenCalledOnce();
    expect(resolveDocumentSaveOwnership).toHaveBeenCalledWith(ROOT, outsidePath);
    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("safely rejects an outside-root save through the legacy fallback", async () => {
    const outsidePath = "/outside/User.php";
    const harness = renderLifecycle();
    harness.documentsRef.current[outsidePath] = {
      ...document("outside edited"),
      path: outsidePath,
    };

    await expect(harness.lifecycle().saveDocument(outsidePath)).resolves.toEqual({
      status: "stale",
    });

    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    harness.unmount();
  });

  it.each(["readOnly", "conflict", "failed"] as const)(
    "returns the latest %s result to a coalesced request",
    async (terminalStatus) => {
      const firstWrite = deferred<void>();
      const error = new Error("latest write failed");
      const snapshot = { content: "disk", revision: null };
      const latestWrite = vi.fn(async () => {
        if (terminalStatus === "conflict") {
          return { status: "conflict" as const, message: "changed" };
        }
        if (terminalStatus === "failed") {
          throw error;
        }
      });
      const writeTextFile = vi
        .fn()
        .mockImplementationOnce(() => firstWrite.promise)
        .mockImplementation(latestWrite);
      const harness = renderLifecycle({
        workspaceFiles: workspaceFiles({
          readTextFileSnapshot: vi.fn(async () => snapshot),
          writeTextFile,
        }),
      });

      const first = harness.lifecycle().saveDocument(PATH);
      await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce());
      harness.replaceDocument(document("second"));
      const coalesced = harness.lifecycle().saveDocument(PATH);
      harness.replaceDocument({
        ...document("latest"),
        readOnly: terminalStatus === "readOnly",
      });
      const latest = harness.lifecycle().saveDocument(PATH);
      firstWrite.resolve();

      let results!: Awaited<ReturnType<DocumentSaveLifecycle["saveDocument"]>>[];
      await act(async () => {
        results = await Promise.all([first, coalesced, latest]);
      });

      expect(results[0]).toEqual(
        expect.objectContaining({ status: "saved", contentIsCurrent: false }),
      );
      expect(results[1]).toBe(results[2]);
      if (terminalStatus === "readOnly") {
        expect(results[1]).toEqual({ status: "blocked", reason: "readOnly" });
        expect(latestWrite).not.toHaveBeenCalled();
        harness.unmount();
        return;
      }
      if (terminalStatus === "conflict") {
        expect(results[1]).toEqual(expect.objectContaining({ status: "conflict", snapshot }));
        harness.unmount();
        return;
      }

      expect(results[1]).toEqual({ status: "failed", error });
      harness.unmount();
    },
  );

  it("writes and acknowledges through history and did-save in order", async () => {
    const events: string[] = [];
    const writeTextFile = vi.fn(async () => {
      events.push("write");
    });
    const recordSnapshot = vi.fn(async () => {
      events.push("history");
      return null;
    });
    const syncSavedDocument = vi.fn(async () => {
      events.push("didSave");
    });
    const harness = renderLifecycle({
      workspaceFiles: workspaceFiles({ writeTextFile }),
      localHistoryGateway: localHistoryGateway({ recordSnapshot }),
      syncSavedDocument,
    });

    await act(async () => harness.lifecycle().saveActiveDocument());

    expect(events).toEqual(["write", "history", "didSave"]);
    expect(writeTextFile).toHaveBeenCalledWith(PATH, "edited");
    expect(recordSnapshot).toHaveBeenCalledWith(ROOT, "src/User.php", "edited");
    expect(harness.documentsRef.current[PATH]).toEqual(
      expect.objectContaining({ content: "edited", savedContent: "edited" }),
    );
    expect(syncSavedDocument).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ path: PATH, content: "edited" }),
      expect.any(Function),
    );
    expect(harness.syncSavedJavaScriptTypeScriptDocument).toHaveBeenCalledWith(
      ROOT,
      expect.objectContaining({ path: PATH, content: "edited" }),
      expect.any(Function),
    );
    expect(harness.setMessage).toHaveBeenCalledWith("Saved User.php");
    harness.unmount();
  });

  it.each([
    ["ESLint", "typescript", "eslintAnalyseOnSave", "runEslintAnalysisOnSave"],
    ["PHPStan", "php", "phpstanAnalyseOnSave", "runPhpstanAnalysisOnSave"],
  ] as const)(
    "suppresses %s analysis and all persistence effects for an unchanged save",
    async (_label, language, setting, analysisSpy) => {
      vi.useFakeTimers();
      const clean = { ...document("baseline", "baseline"), language };
      const harness = renderLifecycle({
        activeDocument: clean,
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          [setting]: true,
        },
      });
      const invalidatePrefetch = vi.spyOn(
        harness.dependencies.filePrefetchCacheRef.current,
        "invalidate",
      );

      let result!: Awaited<ReturnType<DocumentSaveLifecycle["saveDocument"]>>;
      await act(async () => {
        result = await harness.lifecycle().saveDocument(PATH);
      });
      await act(async () => vi.advanceTimersByTimeAsync(500));

      expect(result).toEqual(
        expect.objectContaining({
          status: "saved",
          contentIsCurrent: true,
          persistence: "unchanged",
          contentChanged: false,
        }),
      );
      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
      expect(invalidatePrefetch).not.toHaveBeenCalled();
      expect(harness.localHistoryGateway.recordSnapshot).not.toHaveBeenCalled();
      expect(harness.syncSavedDocument).not.toHaveBeenCalled();
      expect(harness.syncSavedJavaScriptTypeScriptDocument).not.toHaveBeenCalled();
      expect(harness[analysisSpy]).not.toHaveBeenCalled();
      harness.unmount();
    },
  );

  it.each([
    ["ESLint", "typescript", "eslintAnalyseOnSave", "runEslintAnalysisOnSave"],
    ["PHPStan", "php", "phpstanAnalyseOnSave", "runPhpstanAnalysisOnSave"],
  ] as const)(
    "syncs and schedules %s analysis when formatting restores the saved baseline",
    async (_label, language, setting, analysisSpy) => {
      vi.useFakeTimers();
      const dirty = { ...document("dirty", "baseline"), language };
      const harness = renderLifecycle({
        activeDocument: dirty,
        formattedContentForSave: vi.fn(async () => "baseline"),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          [setting]: true,
        },
      });

      let result!: Awaited<ReturnType<DocumentSaveLifecycle["saveDocument"]>>;
      await act(async () => {
        result = await harness.lifecycle().saveDocument(PATH);
      });
      await act(async () => vi.advanceTimersByTimeAsync(500));

      expect(result).toEqual(
        expect.objectContaining({
          status: "saved",
          contentIsCurrent: true,
          persistence: "unchanged",
          contentChanged: true,
        }),
      );
      expect(harness.documentsRef.current[PATH].content).toBe("baseline");
      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
      expect(harness.localHistoryGateway.recordSnapshot).not.toHaveBeenCalled();
      expect(harness.syncSavedDocument).toHaveBeenCalledWith(
        ROOT,
        expect.objectContaining({ content: "baseline" }),
        expect.any(Function),
      );
      expect(harness.syncSavedJavaScriptTypeScriptDocument).toHaveBeenCalledWith(
        ROOT,
        expect.objectContaining({ content: "baseline" }),
        expect.any(Function),
      );
      expect(harness[analysisSpy]).toHaveBeenCalledWith(ROOT);
      harness.unmount();
    },
  );

  it.each(["root", "token"] as const)(
    "drops the pipeline when the workspace %s becomes stale",
    async (guard) => {
      const formatting = deferred<string>();
      const harness = renderLifecycle({
        formattedContentForSave: vi.fn(() => formatting.promise),
      });

      const save = harness.lifecycle().saveActiveDocument();
      await vi.waitFor(() =>
        expect(harness.dependencies.formattedContentForSave).toHaveBeenCalledOnce(),
      );
      if (guard === "root") {
        harness.currentWorkspaceRootRef.current = "/other";
      } else {
        harness.workspaceRequestTokenRef.current += 1;
      }
      formatting.resolve("formatted");
      await save;

      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
      expect(harness.documentsRef.current[PATH].savedContent).toBe("saved");
      harness.unmount();
    },
  );

  it("reconciles an issued write without stale UI or save side effects", async () => {
    const write = deferred<void>();
    const harness = renderLifecycle({
      workspaceFiles: workspaceFiles({
        writeTextFile: vi.fn(() => write.promise),
      }),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        phpstanAnalyseOnSave: true,
      },
    });
    const invalidatePrefetch = vi.spyOn(
      harness.dependencies.filePrefetchCacheRef.current,
      "invalidate",
    );
    const save = harness.lifecycle().saveDocument(PATH);
    await vi.waitFor(() => expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledOnce());
    harness.replaceDocument(document("C2", "saved"));
    harness.workspaceRequestTokenRef.current += 1;

    write.resolve();

    await expect(save).resolves.toEqual({ status: "stale" });
    expect(harness.documentsRef.current[PATH]).toEqual(
      expect.objectContaining({ content: "C2", savedContent: "edited" }),
    );
    expect(invalidatePrefetch).not.toHaveBeenCalled();
    expect(harness.localHistoryGateway.recordSnapshot).not.toHaveBeenCalled();
    expect(harness.syncSavedDocument).not.toHaveBeenCalled();
    expect(harness.syncSavedJavaScriptTypeScriptDocument).not.toHaveBeenCalled();
    expect(harness.setMessage).not.toHaveBeenCalled();
    expect(harness.runPhpstanAnalysisOnSave).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("finishes an active save before entering an exclusion", async () => {
    const write = deferred<void>();
    const events: string[] = [];
    const harness = renderLifecycle({
      workspaceFiles: workspaceFiles({
        writeTextFile: vi.fn(async () => {
          await write.promise;
          events.push("write");
        }),
      }),
      localHistoryGateway: localHistoryGateway({
        recordSnapshot: vi.fn(async () => {
          events.push("history");
          return null;
        }),
      }),
      syncSavedDocument: vi.fn(async () => {
        events.push("didSave");
      }),
    });
    const save = harness.lifecycle().saveActiveDocument();
    await vi.waitFor(() => expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledOnce());
    const operation = vi.fn(async () => {
      events.push("operation");
      return "done";
    });
    const exclusion = harness
      .lifecycle()
      .runWithDocumentSaveExclusion({ kind: "file", rootPath: ROOT, path: PATH }, operation);

    expect(operation).not.toHaveBeenCalled();
    write.resolve();
    await expect(Promise.all([save, exclusion])).resolves.toEqual([undefined, "done"]);
    expect(events).toEqual(["write", "history", "didSave", "operation"]);
    harness.unmount();
  });

  it("enters an issued-write drain after acknowledgement without waiting for post-write work", async () => {
    const write = deferred<void>();
    const history = deferred<void>();
    const operation = vi.fn(async () => "done");
    const harness = renderLifecycle({
      workspaceFiles: workspaceFiles({
        writeTextFile: vi.fn(() => write.promise),
      }),
      localHistoryGateway: localHistoryGateway({
        recordSnapshot: vi.fn(async () => {
          await history.promise;
          return null;
        }),
      }),
    });
    let saveSettled = false;
    const save = harness
      .lifecycle()
      .saveActiveDocument()
      .finally(() => {
        saveSettled = true;
      });
    await vi.waitFor(() => expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledOnce());

    const drain = harness
      .lifecycle()
      .runWithIssuedWriteDrain({ kind: "workspace", rootPath: ROOT }, operation);
    expect(operation).not.toHaveBeenCalled();

    write.resolve();
    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
    await expect(drain).resolves.toBe("done");
    expect(saveSettled).toBe(false);

    history.resolve();
    await save;
    harness.unmount();
  });

  it("drops pending and newly requested saves inside an exclusion", async () => {
    const write = deferred<void>();
    const harness = renderLifecycle({
      workspaceFiles: workspaceFiles({
        writeTextFile: vi.fn(() => write.promise),
      }),
    });
    const firstSave = harness.lifecycle().saveActiveDocument();
    await vi.waitFor(() => expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledOnce());
    harness.replaceDocument(document("pending"));
    const pendingSave = harness.lifecycle().saveActiveDocument();
    const operation = vi.fn(async () => undefined);
    const exclusion = harness
      .lifecycle()
      .runWithDocumentSaveExclusion({ kind: "workspace", rootPath: ROOT }, operation);
    harness.replaceDocument(document("new"));
    const newSave = harness.lifecycle().saveActiveDocument();

    await expect(newSave).resolves.toBeUndefined();
    write.resolve();
    await Promise.all([firstSave, pendingSave, exclusion]);

    expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("invalidates an in-flight save synchronously", async () => {
    const formatting = deferred<string>();
    const harness = renderLifecycle({
      formattedContentForSave: vi.fn(() => formatting.promise),
    });

    const save = harness.lifecycle().saveActiveDocument();
    harness.lifecycle().invalidateDocumentSave(ROOT, PATH);
    formatting.resolve("formatted");
    await save;

    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("invalidates a pending prepare through an equivalent workspace alias", async () => {
    const formatting = deferred<string>();
    const aliasRoot = "/workspace-alias";
    const aliasPath = `${aliasRoot}/src/User.php`;
    const resolveDocumentSaveOwnership = vi.fn(() =>
      createRegisteredDocumentSaveIdentity("workspace-a", "/real/workspace", "src/User.php"),
    );
    const harness = renderLifecycle({
      formattedContentForSave: vi.fn(() => formatting.promise),
      resolveDocumentSaveOwnership,
    });

    const save = harness.lifecycle().saveActiveDocument();
    await vi.waitFor(() =>
      expect(harness.dependencies.formattedContentForSave).toHaveBeenCalledOnce(),
    );

    harness.lifecycle().invalidateDocumentSave(aliasRoot, aliasPath);
    formatting.resolve("formatted");
    await save;

    expect(resolveDocumentSaveOwnership).toHaveBeenLastCalledWith(aliasRoot, aliasPath);
    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    harness.unmount();
  });

  it.each(["file", "workspace"] as const)(
    "drains an alias %s exclusion before granting a pending write",
    async (kind) => {
      const formatting = deferred<string>();
      const aliasRoot = "/workspace-alias";
      const aliasPath = `${aliasRoot}/src/User.php`;
      const events: string[] = [];
      const resolveDocumentSaveOwnership = vi.fn(() =>
        createRegisteredDocumentSaveIdentity("workspace-a", "/real/workspace", "src/User.php"),
      );
      const harness = renderLifecycle({
        formattedContentForSave: vi.fn(async () => {
          const content = await formatting.promise;
          events.push("prepared");
          return content;
        }),
        resolveDocumentSaveOwnership,
      });

      const save = harness.lifecycle().saveActiveDocument();
      await vi.waitFor(() =>
        expect(harness.dependencies.formattedContentForSave).toHaveBeenCalledOnce(),
      );
      const operation = vi.fn(async () => {
        events.push("operation");
      });
      const scope =
        kind === "file"
          ? { kind, rootPath: aliasRoot, path: aliasPath }
          : { kind, rootPath: aliasRoot };
      const exclusion = harness.lifecycle().runWithDocumentSaveExclusion(scope, operation);

      expect(operation).not.toHaveBeenCalled();
      formatting.resolve("formatted");
      await Promise.all([save, exclusion]);

      expect(events).toEqual(["prepared", "operation"]);
      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
      harness.unmount();
    },
  );

  it("keeps the coordinator live through StrictMode effect replay", async () => {
    const harness = renderLifecycle({}, { strictMode: true });

    await act(async () => harness.lifecycle().saveActiveDocument());

    expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(PATH, "edited");
    harness.unmount();
  });

  it("disposes in-flight work on unmount", async () => {
    const formatting = deferred<string>();
    const harness = renderLifecycle({
      formattedContentForSave: vi.fn(() => formatting.promise),
    });
    const save = harness.lifecycle().saveActiveDocument();
    await vi.waitFor(() =>
      expect(harness.dependencies.formattedContentForSave).toHaveBeenCalledOnce(),
    );

    harness.unmount();
    formatting.resolve("formatted");
    await save;

    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
  });

  it("clears a pending autosave timer when autosave is disabled", async () => {
    vi.useFakeTimers();
    const dirty = document();
    const harness = renderLifecycle({
      activeDocument: dirty,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: true,
      },
    });

    harness.rerender({
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        autoSave: false,
      },
    });
    await act(async () => vi.advanceTimersByTimeAsync(900));

    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("runs save participants after the LSP content chain on the content to be written", async () => {
    const order: string[] = [];
    const participantInputs: string[] = [];
    const participant: DocumentSaveParticipant = {
      id: "test.transform",
      appliesTo: () => true,
      run: async (content) => {
        order.push("participant");
        participantInputs.push(content);
        return `${content}+participant`;
      },
    };
    const formattedContentForSave = vi.fn(async (item: EditorDocument) => {
      order.push("format");
      return `${item.content}+formatted`;
    });
    const organizedImportsContentForSave = vi.fn(async (_item: EditorDocument, content: string) => {
      order.push("organize");
      return `${content}+organized`;
    });
    const harness = renderLifecycle({
      formattedContentForSave,
      organizedImportsContentForSave,
      saveParticipants: [participant],
    });

    await act(async () => harness.lifecycle().saveActiveDocument());

    expect(order).toEqual(["format", "organize", "participant"]);
    expect(participantInputs).toEqual(["edited+formatted+organized"]);
    expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
      PATH,
      "edited+formatted+organized+participant",
    );
    harness.unmount();
  });

  it("runs save participants for the admitted exact-live document instead of the stale React object", async () => {
    const staleReactDocument = {
      ...document("stale react", "saved"),
      language: "typescript",
      name: "User.ts",
    };
    const exactDocument = Object.freeze({
      ...staleReactDocument,
      content: "exact live",
    });
    const participant: DocumentSaveParticipant = {
      id: "test.exact-live",
      appliesTo: () => true,
      run: vi.fn(async (content, context) => {
        expect(context.document).toBe(exactDocument);
        expect(context.isStale()).toBe(false);
        return `${content}+participant`;
      }),
    };
    const admission = exactLiveSaveAdmission(exactDocument);
    const harness = renderLifecycle({
      activeDocument: staleReactDocument,
      activeLiveDocumentSaveCoordinator: admission.coordinator,
      saveParticipants: [participant],
    });

    await act(async () => {
      await harness.lifecycle().saveDocument(PATH);
    });

    expect(participant.run).toHaveBeenCalledOnce();
    expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
      PATH,
      "exact live+participant",
    );
    expect(harness.documentsRef.current[PATH]).toBe(staleReactDocument);
    harness.unmount();
  });

  it.each(["edit", "retirement", "workspace A → B → A"] as const)(
    "stops an exact-live participant save when %s invalidates its authority during await",
    async (invalidation) => {
      const participantResult = deferred<string>();
      const staleReactDocument = {
        ...document("stale react", "saved"),
        language: "typescript",
        name: "User.ts",
      };
      const exactDocument = Object.freeze({
        ...staleReactDocument,
        content: "exact live",
      });
      const participant: DocumentSaveParticipant = {
        id: "test.slow-exact-live",
        appliesTo: () => true,
        run: vi.fn(() => participantResult.promise),
      };
      const admission = exactLiveSaveAdmission(exactDocument);
      const harness = renderLifecycle({
        activeDocument: staleReactDocument,
        activeLiveDocumentSaveCoordinator: admission.coordinator,
        saveParticipants: [participant],
      });

      const save = harness.lifecycle().saveDocument(PATH);
      await vi.waitFor(() => expect(participant.run).toHaveBeenCalledOnce());
      admission.retire();
      if (invalidation === "workspace A → B → A") {
        harness.currentWorkspaceRootRef.current = "/other";
        harness.workspaceRequestTokenRef.current += 1;
        harness.currentWorkspaceRootRef.current = ROOT;
      }
      participantResult.resolve("must not be written");
      await save;

      expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
      expect(harness.documentsRef.current[PATH]).toBe(staleReactDocument);
      harness.unmount();
    },
  );

  it("rejects an oversized exact-live participant transform through write admission without mutating React state", async () => {
    const staleReactDocument = {
      ...document("stale react", "saved"),
      language: "typescript",
      name: "User.ts",
    };
    const exactDocument = Object.freeze({
      ...staleReactDocument,
      content: "exact live",
    });
    const oversized = "x".repeat(MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS + 1);
    const participant: DocumentSaveParticipant = {
      id: "test.oversized-transform",
      appliesTo: () => true,
      run: vi.fn(async () => oversized),
    };
    const admission = exactLiveSaveAdmission(exactDocument, {
      acceptPreparedContent: (content) => content.length <= MAX_LIVE_DOCUMENT_METADATA_UTF16_UNITS,
    });
    const harness = renderLifecycle({
      activeDocument: staleReactDocument,
      activeLiveDocumentSaveCoordinator: admission.coordinator,
      saveParticipants: [participant],
    });

    let result!: Awaited<ReturnType<DocumentSaveLifecycle["saveDocument"]>>;
    await act(async () => {
      result = await harness.lifecycle().saveDocument(PATH);
    });

    expect(result).toEqual({ status: "stale" });
    expect(admission.prepareIssuedWrite).toHaveBeenCalledWith(
      expect.anything(),
      exactDocument,
      expect.objectContaining({ content: oversized }),
    );
    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    expect(harness.documentsRef.current[PATH]).toBe(staleReactDocument);
    harness.unmount();
  });

  it("saves the original content and reports a failing participant", async () => {
    const error = new Error("participant exploded");
    const failing: DocumentSaveParticipant = {
      id: "failing",
      appliesTo: () => true,
      run: async () => {
        throw error;
      },
    };
    const reportErrorForActiveWorkspaceRoot = vi.fn();
    const harness = renderLifecycle({
      reportErrorForActiveWorkspaceRoot,
      saveParticipants: [failing],
    });

    await act(async () => harness.lifecycle().saveActiveDocument());

    expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(PATH, "edited");
    expect(harness.documentsRef.current[PATH].savedContent).toBe("edited");
    expect(reportErrorForActiveWorkspaceRoot).toHaveBeenCalledWith(
      ROOT,
      'Save Participant "failing"',
      error,
    );
    harness.unmount();
  });

  it("drops a participant transform when the workspace root goes stale mid-run", async () => {
    const running = deferred<string>();
    const participant: DocumentSaveParticipant = {
      id: "slow",
      appliesTo: () => true,
      run: vi.fn(() => running.promise),
    };
    const harness = renderLifecycle({ saveParticipants: [participant] });

    const save = harness.lifecycle().saveActiveDocument();
    await vi.waitFor(() => expect(participant.run).toHaveBeenCalledOnce());
    harness.currentWorkspaceRootRef.current = "/other";
    running.resolve("hijacked");
    await save;

    expect(harness.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    expect(harness.documentsRef.current[PATH].savedContent).toBe("saved");
    harness.unmount();
  });

  it("schedules ESLint analysis after a save when only fix-on-save is enabled", async () => {
    vi.useFakeTimers();
    const tsDocument = { ...document(), language: "typescript" };
    const harness = renderLifecycle({
      activeDocument: tsDocument,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        eslintFixOnSave: true,
      },
    });

    await act(async () => {
      await harness.lifecycle().saveDocument(PATH);
    });
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(harness.runEslintAnalysisOnSave).toHaveBeenCalledWith(ROOT);
    harness.unmount();
  });

  it("applies stored ESLint fixes to a clean buffer through the save pipeline", async () => {
    vi.useFakeTimers();
    const content = "const value = 1;;\n";
    const clean = { ...document(content, content), language: "typescript" };
    const eslintFixOnSave = createEslintFixOnSaveParticipant({
      analyseDocument: async () => ({
        status: "ok",
        diagnostics: [
          {
            filePath: "src/file.ts",
            line: 1,
            column: 1,
            endLine: 1,
            endColumn: 2,
            message: "Fixable",
            identifier: "test-rule",
            severity: 2,
            fix: { range: [16, 17], text: "" },
          },
        ],
        totals: { errorCount: 1, warningCount: 0, fileCount: 1 },
      }),
    });
    const harness = renderLifecycle({
      activeDocument: clean,
      saveParticipants: orderedDocumentSaveParticipants({
        eslintFixOnSave,
        prettierFormatOnSave: createPrettierSaveParticipant({
          prettierFormatting: {
            format: async () => ({ status: "unavailable" as const }),
          },
        }),
      }),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        eslintFixOnSave: true,
      },
    });

    await act(async () => {
      await harness.lifecycle().saveDocument(PATH);
    });

    expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(PATH, "const value = 1;\n");
    expect(harness.documentsRef.current[PATH]).toEqual(
      expect.objectContaining({
        content: "const value = 1;\n",
        savedContent: "const value = 1;\n",
      }),
    );

    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(harness.runEslintAnalysisOnSave).toHaveBeenCalledWith(ROOT);
    harness.unmount();
  });

  it("skips ESLint fixes when the LSP chain changes the written content", async () => {
    const content = "const value = 1;;\n";
    const clean = { ...document(content, content), language: "typescript" };
    const eslintFixOnSave = createEslintFixOnSaveParticipant({
      analyseDocument: async () => ({
        status: "ok",
        diagnostics: [],
        totals: { errorCount: 0, warningCount: 0, fileCount: 0 },
      }),
    });
    const harness = renderLifecycle({
      activeDocument: clean,
      formattedContentForSave: vi.fn(async (item: EditorDocument) => `${item.content}formatted\n`),
      saveParticipants: orderedDocumentSaveParticipants({
        eslintFixOnSave,
        prettierFormatOnSave: createPrettierSaveParticipant({
          prettierFormatting: {
            format: async () => ({ status: "unavailable" as const }),
          },
        }),
      }),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        eslintFixOnSave: true,
      },
    });

    await act(async () => {
      await harness.lifecycle().saveDocument(PATH);
    });

    expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
      PATH,
      "const value = 1;;\nformatted\n",
    );
    harness.unmount();
  });

  it("runs delayed save analysis only while mounted", async () => {
    vi.useFakeTimers();
    const harness = renderLifecycle({
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        phpstanAnalyseOnSave: true,
      },
    });
    await act(async () => harness.lifecycle().saveActiveDocument());

    harness.unmount();
    await vi.advanceTimersByTimeAsync(500);

    expect(harness.runPhpstanAnalysisOnSave).not.toHaveBeenCalled();
  });
});

function rejectingLiveSaveCoordinator(
  reason: EditorActiveLiveDocumentSaveRejectionReason,
): EditorActiveLiveDocumentSaveAdmissionPort {
  return {
    admit: vi.fn(() => ({ reason, status: "rejected" as const })),
    publish: vi.fn(),
  };
}

function fallbackLiveSaveCoordinator(): EditorActiveLiveDocumentSaveAdmissionPort {
  return {
    admit: vi.fn(() => ({ status: "fallback" as const })),
    publish: vi.fn(),
  };
}

function exactLiveSaveAdmission(
  exactDocument: EditorDocument,
  options: {
    acceptPreparedContent?: (content: string) => boolean;
  } = {},
): {
  coordinator: EditorActiveLiveDocumentSaveAdmissionPort;
  prepareIssuedWrite: ReturnType<typeof vi.fn>;
  retire: () => void;
} {
  let retired = false;
  const prepareIssuedWrite = vi.fn(
    (_target: unknown, expectedDocument: EditorDocument, savedDocument: EditorDocument) =>
      !retired &&
      expectedDocument === exactDocument &&
      (options.acceptPreparedContent?.(savedDocument.content) ?? true),
  );
  const saveStore: ActiveDocumentSaveStorePort = {
    current: () => (retired ? null : exactDocument),
    acknowledgeIssuedWrite: () => !retired,
    prepareIssuedWrite,
    reconcileUnchangedPreparedContent: () => (retired ? null : exactDocument),
    updateRevision: () => undefined,
    updateRevisionForIssuedWrite: () => undefined,
  };

  return {
    coordinator: {
      admit: vi.fn((input) => ({
        saveStore,
        settle: () => undefined,
        status: "admitted" as const,
        target: input.target,
      })),
      publish: vi.fn(),
    },
    prepareIssuedWrite,
    retire: () => {
      retired = true;
    },
  };
}
