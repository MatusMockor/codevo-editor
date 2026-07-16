// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePrefetchCache } from "../domain/filePrefetchCache";
import type { LocalHistoryGateway } from "../domain/localHistory";
import { defaultWorkspaceSettings } from "../domain/settings";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
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

function workspaceFiles(
  overrides: Partial<WorkspaceFileGateway> = {},
): WorkspaceFileGateway {
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

function localHistoryGateway(
  overrides: Partial<LocalHistoryGateway> = {},
): LocalHistoryGateway {
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
    current: { [initialDocument.path]: initialDocument } as Record<
      string,
      EditorDocument
    >,
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
    setDocuments: ((
      update: Parameters<DocumentSaveLifecycleDependencies["setDocuments"]>[0],
    ) => {
      documentsRef.current =
        typeof update === "function" ? update(documentsRef.current) : update;
    }) as DocumentSaveLifecycleDependencies["setDocuments"],
    setMessage,
    localHistoryGateway: history,
    workspaceFiles: files,
    formattedContentForSave: vi.fn(
      async (item: EditorDocument) => item.content,
    ),
    optimizedImportsContentForSave: vi.fn(
      (_item: EditorDocument, content: string) => content,
    ),
    organizedImportsContentForSave: vi.fn(
      async (_item: EditorDocument, content: string) => content,
    ),
    resolveEditorConfigForFile: vi.fn(async () => ({})),
    syncSavedDocument,
    syncSavedJavaScriptTypeScriptDocument,
    beginDocumentSelfWrite: () => null,
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
    expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
      otherPath,
      "other",
    );
    expect(harness.activeDocumentRef.current?.path).toBe(PATH);
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

    expect(result).toEqual(
      expect.objectContaining({ status: "conflict", snapshot }),
    );
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
    const firstWrite = deferred<void>();
    const writeTextFile = vi
      .fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue(undefined);
    const resolveDocumentSaveOwnership = vi.fn(() => ({
      canonicalRoot: "/real/workspace",
      workspaceRelativePath: "src/User.php",
    }));
    const harness = renderLifecycle({
      resolveDocumentSaveOwnership,
      workspaceFiles: workspaceFiles({ writeTextFile }),
    });
    const aliasDocument = {
      ...document("alias edited"),
      name: "Alias.php",
      path: aliasPath,
    };
    harness.documentsRef.current = {
      ...harness.documentsRef.current,
      [aliasPath]: aliasDocument,
    };

    const selectedSave = harness.lifecycle().saveDocument(PATH);
    await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledOnce());
    const aliasSave = harness.lifecycle().saveDocument(aliasPath);
    firstWrite.resolve();

    await act(async () => {
      await Promise.all([selectedSave, aliasSave]);
    });

    expect(resolveDocumentSaveOwnership).toHaveBeenCalledTimes(2);
    expect(resolveDocumentSaveOwnership).toHaveBeenNthCalledWith(1, ROOT, PATH);
    expect(resolveDocumentSaveOwnership).toHaveBeenNthCalledWith(
      2,
      ROOT,
      aliasPath,
    );
    expect(writeTextFile).toHaveBeenNthCalledWith(1, PATH, "edited");
    expect(writeTextFile).toHaveBeenNthCalledWith(
      2,
      aliasPath,
      "alias edited",
    );
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

    await expect(
      harness.lifecycle().saveDocument(outsidePath),
    ).resolves.toEqual({ status: "stale" });

    expect(resolveDocumentSaveOwnership).toHaveBeenCalledOnce();
    expect(resolveDocumentSaveOwnership).toHaveBeenCalledWith(
      ROOT,
      outsidePath,
    );
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

    await expect(
      harness.lifecycle().saveDocument(outsidePath),
    ).resolves.toEqual({ status: "stale" });

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
        expect(results[1]).toEqual(
          expect.objectContaining({ status: "conflict", snapshot }),
        );
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
    expect(
      harness.syncSavedJavaScriptTypeScriptDocument,
    ).toHaveBeenCalledWith(
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
      expect(
        harness.syncSavedJavaScriptTypeScriptDocument,
      ).not.toHaveBeenCalled();
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
      expect(
        harness.syncSavedJavaScriptTypeScriptDocument,
      ).toHaveBeenCalledWith(
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
        expect(
          harness.dependencies.formattedContentForSave,
        ).toHaveBeenCalledOnce(),
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
    await vi.waitFor(() =>
      expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledOnce(),
    );
    harness.replaceDocument(document("C2", "saved"));
    harness.workspaceRequestTokenRef.current += 1;

    write.resolve();

    await expect(save).resolves.toEqual({ status: "stale" });
    expect(harness.documentsRef.current[PATH]).toEqual(
      expect.objectContaining({ content: "C2", savedContent: "edited" }),
    );
    expect(invalidatePrefetch).not.toHaveBeenCalled();
    expect(
      harness.localHistoryGateway.recordSnapshot,
    ).not.toHaveBeenCalled();
    expect(harness.syncSavedDocument).not.toHaveBeenCalled();
    expect(
      harness.syncSavedJavaScriptTypeScriptDocument,
    ).not.toHaveBeenCalled();
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
    await vi.waitFor(() =>
      expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledOnce(),
    );
    const operation = vi.fn(async () => {
      events.push("operation");
      return "done";
    });
    const exclusion = harness
      .lifecycle()
      .runWithDocumentSaveExclusion(
        { kind: "file", rootPath: ROOT, path: PATH },
        operation,
      );

    expect(operation).not.toHaveBeenCalled();
    write.resolve();
    await expect(Promise.all([save, exclusion])).resolves.toEqual([
      undefined,
      "done",
    ]);
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
    await vi.waitFor(() =>
      expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledOnce(),
    );

    const drain = harness.lifecycle().runWithIssuedWriteDrain(
      { kind: "workspace", rootPath: ROOT },
      operation,
    );
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
    await vi.waitFor(() =>
      expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledOnce(),
    );
    harness.replaceDocument(document("pending"));
    const pendingSave = harness.lifecycle().saveActiveDocument();
    const operation = vi.fn(async () => undefined);
    const exclusion = harness
      .lifecycle()
      .runWithDocumentSaveExclusion(
        { kind: "workspace", rootPath: ROOT },
        operation,
      );
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
    const resolveDocumentSaveOwnership = vi.fn(() => ({
      canonicalRoot: "/real/workspace",
      workspaceRelativePath: "src/User.php",
    }));
    const harness = renderLifecycle({
      formattedContentForSave: vi.fn(() => formatting.promise),
      resolveDocumentSaveOwnership,
    });

    const save = harness.lifecycle().saveActiveDocument();
    await vi.waitFor(() =>
      expect(
        harness.dependencies.formattedContentForSave,
      ).toHaveBeenCalledOnce(),
    );

    harness.lifecycle().invalidateDocumentSave(aliasRoot, aliasPath);
    formatting.resolve("formatted");
    await save;

    expect(resolveDocumentSaveOwnership).toHaveBeenLastCalledWith(
      aliasRoot,
      aliasPath,
    );
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
      const resolveDocumentSaveOwnership = vi.fn(() => ({
        canonicalRoot: "/real/workspace",
        workspaceRelativePath: "src/User.php",
      }));
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
        expect(
          harness.dependencies.formattedContentForSave,
        ).toHaveBeenCalledOnce(),
      );
      const operation = vi.fn(async () => {
        events.push("operation");
      });
      const scope =
        kind === "file"
          ? { kind, rootPath: aliasRoot, path: aliasPath }
          : { kind, rootPath: aliasRoot };
      const exclusion = harness
        .lifecycle()
        .runWithDocumentSaveExclusion(scope, operation);

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

    expect(harness.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
      PATH,
      "edited",
    );
    harness.unmount();
  });

  it("disposes in-flight work on unmount", async () => {
    const formatting = deferred<string>();
    const harness = renderLifecycle({
      formattedContentForSave: vi.fn(() => formatting.promise),
    });
    const save = harness.lifecycle().saveActiveDocument();
    await vi.waitFor(() =>
      expect(
        harness.dependencies.formattedContentForSave,
      ).toHaveBeenCalledOnce(),
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
