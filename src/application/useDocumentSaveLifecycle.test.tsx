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
    reportErrorForActiveWorkspaceRoot: vi.fn(),
    runEslintAnalysisOnSave: vi.fn(),
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
    expect(
      harness.syncSavedJavaScriptTypeScriptDocument,
    ).toHaveBeenCalledOnce();
    expect(harness.setMessage).toHaveBeenCalledWith("Saved User.php");
    harness.unmount();
  });

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
      harness.unmount();
    },
  );

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
