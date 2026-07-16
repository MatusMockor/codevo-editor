// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePrefetchCache } from "../domain/filePrefetchCache";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import type {
  DocumentSaveInvalidationScope,
  RunWithDocumentSaveExclusion,
} from "./documentSaveCoordinator";
import {
  useWorkbenchFileOperations,
  type WorkbenchFileOperations,
  type WorkbenchFileOperationsDependencies,
} from "./useWorkbenchFileOperations";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function createSaveExclusionMock(
  beforeOperation: () => Promise<void> = async () => {},
) {
  const mock = vi.fn(
    async (
      _scope: DocumentSaveInvalidationScope,
      operation: () => Promise<unknown>,
    ) => {
      await beforeOperation();
      return operation();
    },
  );

  return mock as typeof mock & RunWithDocumentSaveExclusion;
}

function workspaceFiles(): WorkspaceFileGateway {
  return {
    applyWorkspaceEdit: vi.fn(),
    createDirectory: vi.fn(),
    createTextFile: vi.fn(),
    deletePath: vi.fn(),
    readDirectory: vi.fn(),
    readTextFile: vi.fn(),
    renamePath: vi.fn(),
    writeTextFile: vi.fn(),
  };
}

function makeDependencies(
  relativePath: string,
  overrides: Partial<WorkbenchFileOperationsDependencies> = {},
): WorkbenchFileOperationsDependencies {
  return {
    workspaceRoot: ROOT,
    activePhpFrameworkProviders: [],
    activePath: null,
    sidebarView: "files",
    languageServerDiagnosticsByPath: {},
    javaScriptTypeScriptDiagnosticsByPath: {},
    phpLocalDiagnosticsByPath: {},
    activeDocumentRef: { current: null },
    currentWorkspaceRootRef: { current: ROOT },
    documentsRef: { current: {} },
    openPathsRef: { current: [] },
    previewPathRef: { current: null },
    filePrefetchCacheRef: { current: new FilePrefetchCache() },
    workspaceFiles: workspaceFiles(),
    workspaceDescriptor: {
      javaScriptTypeScript: null,
      php: {
        classmapRoots: [],
        hasComposer: true,
        packageName: null,
        packages: [],
        phpPlatformVersion: null,
        phpVersionConstraint: null,
        psr4Roots: [{ dev: false, namespace: "App\\", paths: ["app/"] }],
      },
      rootPath: ROOT,
    },
    prompter: { prompt: vi.fn(() => relativePath), confirm: vi.fn() },
    setActivePath: vi.fn(),
    setBookmarks: vi.fn(),
    setDocuments: vi.fn(),
    setEntriesByDirectory: vi.fn(),
    setExpandedDirectories: vi.fn(),
    setManuallyCollapsedDirectories: vi.fn(),
    setMessage: vi.fn(),
    setOpenPaths: vi.fn(),
    setPreviewPath: vi.fn(),
    applyJavaScriptTypeScriptCreateEdits: vi.fn(async () => true),
    applyJavaScriptTypeScriptDeleteEdits: vi.fn(),
    applyJavaScriptTypeScriptRenameEdits: vi.fn(),
    applyPhpRenameEdits: vi.fn(),
    clearLanguageServerDiagnosticsForPath: vi.fn(),
    closeDocument: vi.fn(),
    forgetExternallyRemovedDocumentPath: vi.fn(),
    forgetRecentFile: vi.fn(),
    forgetRecentLocationsForPath: vi.fn(),
    invalidateFrameworkCachesForPath: vi.fn(),
    runWithDocumentSaveExclusion: createSaveExclusionMock(),
    invalidatePhpFrameworkSourcePath: vi.fn(),
    invalidatePhpFrameworkBindingsForFileChange: vi.fn(),
    markExternallyRemovedDocumentPath: vi.fn(),
    notifyJavaScriptTypeScriptFileCreated: vi.fn(),
    notifyJavaScriptTypeScriptFileDeleted: vi.fn(),
    notifyJavaScriptTypeScriptFileRenamed: vi.fn(),
    notifyPhpFileRenamed: vi.fn(),
    openFile: vi.fn(),
    refreshDirectory: vi.fn(),
    refreshGitStatus: vi.fn(),
    remapRecentFile: vi.fn(),
    remapRecentLocations: vi.fn(),
    reportChangedDocuments: vi.fn(),
    reportErrorForActiveWorkspaceRoot: vi.fn(),
    syncClosedDocument: vi.fn(),
    syncClosedJavaScriptTypeScriptDocument: vi.fn(),
    workspacePathBelongsToRoot: vi.fn(() => true),
    ...overrides,
  };
}

let mountedRoot: Root | null = null;

function renderHook(dependencies: WorkbenchFileOperationsDependencies) {
  const container = document.createElement("div");
  mountedRoot = createRoot(container);
  const captured: { operations: WorkbenchFileOperations | null } = {
    operations: null,
  };

  function Harness() {
    captured.operations = useWorkbenchFileOperations(dependencies);
    return null;
  }

  act(() => {
    mountedRoot?.render(<Harness />);
  });

  return () => {
    if (!captured.operations) {
      throw new Error("hook not mounted");
    }

    return captured.operations;
  };
}

afterEach(() => {
  if (mountedRoot) {
    act(() => mountedRoot?.unmount());
  }
  mountedRoot = null;
  vi.clearAllMocks();
});

describe("useWorkbenchFileOperations createFile", () => {
  it("creates a covered PHP file with its generated class skeleton", async () => {
    const dependencies = makeDependencies("app/Services/Greeter.php");
    const operations = renderHook(dependencies);

    await act(async () => operations().createFile());

    expect(dependencies.workspaceFiles.createTextFile).toHaveBeenCalledWith(
      `${ROOT}/app/Services/Greeter.php`,
    );
    expect(dependencies.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
      `${ROOT}/app/Services/Greeter.php`,
      `<?php

namespace App\\Services;

class Greeter
{
}
`,
    );
  });

  it("uses new-file skeletons from the active framework provider", async () => {
    const dependencies = makeDependencies("app/Models/Order.php", {
      activePhpFrameworkProviders: [phpLaravelFrameworkProvider],
    });
    const operations = renderHook(dependencies);

    await act(async () => operations().createFile());

    expect(dependencies.workspaceFiles.writeTextFile).toHaveBeenCalledWith(
      `${ROOT}/app/Models/Order.php`,
      `<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Order extends Model
{
}
`,
    );
  });

  it("keeps creating a non-PHP file through the empty-file path", async () => {
    const dependencies = makeDependencies("app/notes.txt");
    const operations = renderHook(dependencies);

    await act(async () => operations().createFile());

    expect(dependencies.workspaceFiles.createTextFile).toHaveBeenCalledWith(
      `${ROOT}/app/notes.txt`,
    );
    expect(dependencies.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
  });

  it.each(["other/Greeter.php", "app/kebab-case.php"])(
    "falls back to empty-file creation for %s",
    async (relativePath) => {
      const dependencies = makeDependencies(relativePath);
      const operations = renderHook(dependencies);

      await act(async () => operations().createFile());

      expect(dependencies.workspaceFiles.createTextFile).toHaveBeenCalledWith(
        `${ROOT}/${relativePath}`,
      );
      expect(dependencies.workspaceFiles.writeTextFile).not.toHaveBeenCalled();
    },
  );
});

describe("useWorkbenchFileOperations close intent", () => {
  it("does not record a deleted document as recently closed", async () => {
    const document = {
      content: "content",
      language: "php",
      name: "Deleted.php",
      path: `${ROOT}/Deleted.php`,
      savedContent: "content",
    };
    const closeDocument = vi.fn();
    const dependencies = makeDependencies("", {
      activeDocumentRef: { current: document },
      applyJavaScriptTypeScriptDeleteEdits: vi.fn(async () => true),
      closeDocument,
      prompter: { prompt: vi.fn(), confirm: vi.fn(() => true) },
    });
    const operations = renderHook(dependencies);

    await act(async () => operations().deleteActiveDocument());

    expect(closeDocument).toHaveBeenCalledWith(document.path, {
      recordRecentlyClosed: false,
      skipConfirmation: true,
    });
  });

  it("does not record an externally removed document as recently closed", () => {
    const path = `${ROOT}/Removed.php`;
    const closeDocument = vi.fn();
    const dependencies = makeDependencies("", { closeDocument });
    const operations = renderHook(dependencies);

    act(() =>
      operations().handleWorkspaceFileChange({
        fileKind: "file",
        kind: "deleted",
        path,
        previousPath: null,
        relativePath: "Removed.php",
        rootPath: ROOT,
      }),
    );

    expect(closeDocument).toHaveBeenCalledWith(path, {
      recordRecentlyClosed: false,
    });
  });

  it("prompts once and force-closes a dirty document after deleting it", async () => {
    const document = {
      content: "edited",
      language: "php",
      name: "Deleted.php",
      path: `${ROOT}/Deleted.php`,
      savedContent: "saved",
    };
    const documentsRef = { current: { [document.path]: document } };
    const openPathsRef = { current: [document.path] };
    const activeDocumentRef: { current: EditorDocument | null } = {
      current: document,
    };
    const confirm = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const closeDocument = vi.fn(
      (
        path: string,
        options?: {
          recordRecentlyClosed?: boolean;
          skipConfirmation?: boolean;
        },
      ) => {
        const liveDocument = documentsRef.current[path];
        if (
          liveDocument &&
          liveDocument.content !== liveDocument.savedContent &&
          options?.skipConfirmation !== true &&
          !confirm("Discard changes?")
        ) {
          return;
        }

        const nextDocuments = { ...documentsRef.current };
        delete nextDocuments[path];
        documentsRef.current = nextDocuments;
        openPathsRef.current = openPathsRef.current.filter(
          (openPath) => openPath !== path,
        );
        if (activeDocumentRef.current?.path === path) {
          activeDocumentRef.current = null;
        }
      },
    );
    const dependencies = makeDependencies("", {
      activeDocumentRef,
      applyJavaScriptTypeScriptDeleteEdits: vi.fn(async () => true),
      closeDocument,
      documentsRef,
      openPathsRef,
      prompter: { prompt: vi.fn(), confirm },
    });
    const operations = renderHook(dependencies);

    await act(async () => operations().deleteActiveDocument());

    expect(confirm).toHaveBeenCalledOnce();
    expect(dependencies.workspaceFiles.deletePath).toHaveBeenCalledWith(
      document.path,
    );
    expect(closeDocument).toHaveBeenCalledWith(document.path, {
      recordRecentlyClosed: false,
      skipConfirmation: true,
    });
    expect(documentsRef.current[document.path]).toBeUndefined();
    expect(openPathsRef.current).not.toContain(document.path);
    expect(activeDocumentRef.current).toBeNull();
  });
});

describe("useWorkbenchFileOperations save exclusion", () => {
  const canonicalOwnership = (
    rootPath = ROOT,
    path = `${ROOT}/src/Owned.txt`,
  ) => ({
    canonicalRoot: "/real/workspace",
    workspaceRelativePath: path.slice(rootPath.length + 1),
  });

  it("uses canonical ownership for active file rename exclusion", async () => {
    const document = {
      content: "content",
      language: "plaintext",
      name: "Owned.txt",
      path: `${ROOT}/src/Owned.txt`,
      savedContent: "content",
    };
    const runWithDocumentSaveExclusion = createSaveExclusionMock();
    const operations = renderHook(makeDependencies("", {
      activeDocumentRef: { current: document },
      resolveDocumentSaveOwnership: canonicalOwnership,
      runWithDocumentSaveExclusion,
      prompter: { prompt: vi.fn(() => "Renamed.txt"), confirm: vi.fn() },
    }));

    await act(async () => operations().renameActiveDocument());

    expect(runWithDocumentSaveExclusion.mock.calls[0]?.[0]).toEqual({
      kind: "file",
      ...canonicalOwnership(),
    });
  });

  it("uses canonical ownership for directory rename exclusion", async () => {
    const runWithDocumentSaveExclusion = createSaveExclusionMock();
    const operations = renderHook(makeDependencies("", {
      applyJavaScriptTypeScriptRenameEdits: vi.fn(async () => true),
      resolveDocumentSaveOwnership: canonicalOwnership,
      runWithDocumentSaveExclusion,
      prompter: { prompt: vi.fn(() => "renamed"), confirm: vi.fn() },
    }));

    await act(async () => operations().renameEntry({
      kind: "directory",
      name: "src",
      path: `${ROOT}/src`,
    }));

    expect(runWithDocumentSaveExclusion.mock.calls[0]?.[0]).toEqual({
      kind: "directory",
      ...canonicalOwnership(ROOT, `${ROOT}/src`),
    });
  });

  it("uses canonical ownership for active file delete exclusion", async () => {
    const document = {
      content: "content",
      language: "plaintext",
      name: "Owned.txt",
      path: `${ROOT}/src/Owned.txt`,
      savedContent: "content",
    };
    const runWithDocumentSaveExclusion = createSaveExclusionMock();
    const operations = renderHook(makeDependencies("", {
      activeDocumentRef: { current: document },
      applyJavaScriptTypeScriptDeleteEdits: vi.fn(async () => true),
      resolveDocumentSaveOwnership: canonicalOwnership,
      runWithDocumentSaveExclusion,
      prompter: { prompt: vi.fn(), confirm: vi.fn(() => true) },
    }));

    await act(async () => operations().deleteActiveDocument());

    expect(runWithDocumentSaveExclusion.mock.calls[0]?.[0]).toEqual({
      kind: "file",
      ...canonicalOwnership(),
    });
  });

  it("fails closed before destructive work when ownership is rejected", async () => {
    const document = {
      content: "content",
      language: "plaintext",
      name: "Owned.txt",
      path: `${ROOT}/src/Owned.txt`,
      savedContent: "content",
    };
    const dependencies = makeDependencies("", {
      activeDocumentRef: { current: document },
      applyJavaScriptTypeScriptDeleteEdits: vi.fn(async () => true),
      resolveDocumentSaveOwnership: () => null,
      prompter: { prompt: vi.fn(), confirm: vi.fn(() => true) },
    });
    const operations = renderHook(dependencies);

    await act(async () => operations().deleteActiveDocument());

    expect(dependencies.runWithDocumentSaveExclusion).not.toHaveBeenCalled();
    expect(
      dependencies.applyJavaScriptTypeScriptDeleteEdits,
    ).not.toHaveBeenCalled();
    expect(dependencies.workspaceFiles.deletePath).not.toHaveBeenCalled();
  });

  it("runs active file rename with the exact file-save scope", async () => {
    const document = {
      content: "content",
      language: "plaintext",
      name: "Old.txt",
      path: `${ROOT}/Old.txt`,
      savedContent: "content",
    };
    const exclusion = createDeferred<void>();
    const runWithDocumentSaveExclusion = createSaveExclusionMock(
      () => exclusion.promise,
    );
    const dependencies = makeDependencies("", {
      activeDocumentRef: { current: document },
      runWithDocumentSaveExclusion,
      prompter: { prompt: vi.fn(() => "New.txt"), confirm: vi.fn() },
    });
    const operations = renderHook(dependencies);

    let renamePromise!: Promise<void>;
    act(() => {
      renamePromise = operations().renameActiveDocument();
    });
    await vi.waitFor(() => {
      expect(runWithDocumentSaveExclusion).toHaveBeenCalledOnce();
      expect(runWithDocumentSaveExclusion.mock.calls[0]?.[0]).toEqual({
        kind: "file",
        path: document.path,
        rootPath: ROOT,
      });
      expect(runWithDocumentSaveExclusion.mock.calls[0]?.[1]).toEqual(
        expect.any(Function),
      );
    });
    expect(dependencies.workspaceFiles.renamePath).not.toHaveBeenCalled();

    await act(async () => {
      exclusion.resolve();
      await renamePromise;
    });

    expect(dependencies.workspaceFiles.renamePath).toHaveBeenCalledWith(
      document.path,
      `${ROOT}/New.txt`,
    );
  });

  it("holds active file rename exclusion through operation completion", async () => {
    const document = {
      content: "content",
      language: "plaintext",
      name: "Old.txt",
      path: `${ROOT}/Old.txt`,
      savedContent: "content",
    };
    const refresh = createDeferred<void>();
    let excluded = false;
    const runWithDocumentSaveExclusion: RunWithDocumentSaveExclusion = async <
      T,
    >(
      _scope: DocumentSaveInvalidationScope,
      operation: () => Promise<T>,
    ) => {
      excluded = true;
      try {
        return await operation();
      } finally {
        excluded = false;
      }
    };
    const dependencies = makeDependencies("", {
      activeDocumentRef: { current: document },
      refreshDirectory: vi.fn(() => refresh.promise),
      runWithDocumentSaveExclusion,
      prompter: { prompt: vi.fn(() => "New.txt"), confirm: vi.fn() },
    });
    const operations = renderHook(dependencies);

    let renamePromise!: Promise<void>;
    act(() => {
      renamePromise = operations().renameActiveDocument();
    });
    await vi.waitFor(() => {
      expect(dependencies.workspaceFiles.renamePath).toHaveBeenCalledOnce();
      expect(dependencies.refreshDirectory).toHaveBeenCalledOnce();
    });

    expect(excluded).toBe(true);
    expect(dependencies.setMessage).not.toHaveBeenCalled();

    await act(async () => {
      refresh.resolve();
      await renamePromise;
    });

    expect(excluded).toBe(false);
    expect(dependencies.setMessage).toHaveBeenCalledWith("Renamed Old.txt");
  });

  it("aborts active file rename when the workspace changes while entering save exclusion", async () => {
    const document = {
      content: "content",
      language: "plaintext",
      name: "Old.txt",
      path: `${ROOT}/Old.txt`,
      savedContent: "content",
    };
    const currentWorkspaceRootRef = { current: ROOT };
    const exclusion = createDeferred<void>();
    const runWithDocumentSaveExclusion = createSaveExclusionMock(
      () => exclusion.promise,
    );
    const dependencies = makeDependencies("", {
      activeDocumentRef: { current: document },
      currentWorkspaceRootRef,
      runWithDocumentSaveExclusion,
      prompter: { prompt: vi.fn(() => "New.txt"), confirm: vi.fn() },
    });
    const operations = renderHook(dependencies);

    let renamePromise!: Promise<void>;
    act(() => {
      renamePromise = operations().renameActiveDocument();
    });
    await vi.waitFor(() => {
      expect(runWithDocumentSaveExclusion).toHaveBeenCalledOnce();
    });

    currentWorkspaceRootRef.current = "/other-workspace";
    await act(async () => {
      exclusion.resolve();
      await renamePromise;
    });

    expect(dependencies.workspaceFiles.renamePath).not.toHaveBeenCalled();
  });

  it("runs directory rename with the exact directory-save scope", async () => {
    const oldPath = `${ROOT}/src`;
    const exclusion = createDeferred<void>();
    const runWithDocumentSaveExclusion = createSaveExclusionMock(
      () => exclusion.promise,
    );
    const dependencies = makeDependencies("", {
      applyJavaScriptTypeScriptRenameEdits: vi.fn(async () => true),
      runWithDocumentSaveExclusion,
      prompter: { prompt: vi.fn(() => "source"), confirm: vi.fn() },
    });
    const operations = renderHook(dependencies);

    let renamePromise!: Promise<void>;
    act(() => {
      renamePromise = operations().renameEntry({
        kind: "directory",
        name: "src",
        path: oldPath,
      });
    });
    await vi.waitFor(() => {
      expect(runWithDocumentSaveExclusion).toHaveBeenCalledOnce();
      expect(runWithDocumentSaveExclusion.mock.calls[0]?.[0]).toEqual({
        kind: "directory",
        path: oldPath,
        rootPath: ROOT,
      });
      expect(runWithDocumentSaveExclusion.mock.calls[0]?.[1]).toEqual(
        expect.any(Function),
      );
    });
    expect(dependencies.workspaceFiles.renamePath).not.toHaveBeenCalled();

    await act(async () => {
      exclusion.resolve();
      await renamePromise;
    });

    expect(dependencies.workspaceFiles.renamePath).toHaveBeenCalledWith(
      oldPath,
      `${ROOT}/source`,
    );
  });

  it("aborts directory rename when the workspace changes while entering save exclusion", async () => {
    const oldPath = `${ROOT}/src`;
    const currentWorkspaceRootRef = { current: ROOT };
    const exclusion = createDeferred<void>();
    const runWithDocumentSaveExclusion = createSaveExclusionMock(
      () => exclusion.promise,
    );
    const dependencies = makeDependencies("", {
      applyJavaScriptTypeScriptRenameEdits: vi.fn(async () => true),
      currentWorkspaceRootRef,
      runWithDocumentSaveExclusion,
      prompter: { prompt: vi.fn(() => "source"), confirm: vi.fn() },
    });
    const operations = renderHook(dependencies);

    let renamePromise!: Promise<void>;
    act(() => {
      renamePromise = operations().renameEntry({
        kind: "directory",
        name: "src",
        path: oldPath,
      });
    });
    await vi.waitFor(() => {
      expect(runWithDocumentSaveExclusion).toHaveBeenCalledOnce();
    });

    currentWorkspaceRootRef.current = "/other-workspace";
    await act(async () => {
      exclusion.resolve();
      await renamePromise;
    });

    expect(dependencies.workspaceFiles.renamePath).not.toHaveBeenCalled();
  });

  it("runs active file delete with the exact file-save scope", async () => {
    const document = {
      content: "content",
      language: "plaintext",
      name: "Deleted.txt",
      path: `${ROOT}/Deleted.txt`,
      savedContent: "content",
    };
    const exclusion = createDeferred<void>();
    const runWithDocumentSaveExclusion = createSaveExclusionMock(
      () => exclusion.promise,
    );
    const dependencies = makeDependencies("", {
      activeDocumentRef: { current: document },
      applyJavaScriptTypeScriptDeleteEdits: vi.fn(async () => true),
      runWithDocumentSaveExclusion,
      prompter: { prompt: vi.fn(), confirm: vi.fn(() => true) },
    });
    const operations = renderHook(dependencies);

    let deletePromise!: Promise<void>;
    act(() => {
      deletePromise = operations().deleteActiveDocument();
    });
    await vi.waitFor(() => {
      expect(runWithDocumentSaveExclusion).toHaveBeenCalledOnce();
      expect(runWithDocumentSaveExclusion.mock.calls[0]?.[0]).toEqual({
        kind: "file",
        path: document.path,
        rootPath: ROOT,
      });
      expect(runWithDocumentSaveExclusion.mock.calls[0]?.[1]).toEqual(
        expect.any(Function),
      );
    });
    expect(dependencies.workspaceFiles.deletePath).not.toHaveBeenCalled();

    await act(async () => {
      exclusion.resolve();
      await deletePromise;
    });

    expect(dependencies.workspaceFiles.deletePath).toHaveBeenCalledWith(
      document.path,
    );
  });

  it("aborts active file delete when the workspace changes while entering save exclusion", async () => {
    const document = {
      content: "content",
      language: "plaintext",
      name: "Deleted.txt",
      path: `${ROOT}/Deleted.txt`,
      savedContent: "content",
    };
    const currentWorkspaceRootRef = { current: ROOT };
    const exclusion = createDeferred<void>();
    const runWithDocumentSaveExclusion = createSaveExclusionMock(
      () => exclusion.promise,
    );
    const dependencies = makeDependencies("", {
      activeDocumentRef: { current: document },
      applyJavaScriptTypeScriptDeleteEdits: vi.fn(async () => true),
      currentWorkspaceRootRef,
      runWithDocumentSaveExclusion,
      prompter: { prompt: vi.fn(), confirm: vi.fn(() => true) },
    });
    const operations = renderHook(dependencies);

    let deletePromise!: Promise<void>;
    act(() => {
      deletePromise = operations().deleteActiveDocument();
    });
    await vi.waitFor(() => {
      expect(runWithDocumentSaveExclusion).toHaveBeenCalledOnce();
    });

    currentWorkspaceRootRef.current = "/other-workspace";
    await act(async () => {
      exclusion.resolve();
      await deletePromise;
    });

    expect(dependencies.workspaceFiles.deletePath).not.toHaveBeenCalled();
  });

  it("does not request save exclusion when rename or delete is declined or a no-op", async () => {
    const document = {
      content: "content",
      language: "plaintext",
      name: "Current.txt",
      path: `${ROOT}/Current.txt`,
      savedContent: "content",
    };
    const runWithDocumentSaveExclusion = createSaveExclusionMock();
    const dependencies = makeDependencies("", {
      activeDocumentRef: { current: document },
      runWithDocumentSaveExclusion,
      prompter: {
        prompt: vi.fn(() => document.name),
        confirm: vi.fn(() => false),
      },
    });
    const operations = renderHook(dependencies);

    await act(async () => operations().renameActiveDocument());
    await act(async () => operations().deleteActiveDocument());

    expect(runWithDocumentSaveExclusion).not.toHaveBeenCalled();
    expect(dependencies.workspaceFiles.renamePath).not.toHaveBeenCalled();
    expect(dependencies.workspaceFiles.deletePath).not.toHaveBeenCalled();
  });
});

describe("useWorkbenchFileOperations external modification refresh", () => {
  it.each([
    ["PHP", "php", `${ROOT}/Changed.php`],
    ["JavaScript", "javascript", `${ROOT}/Changed.js`],
  ] as const)(
    "reports the exact clean %s document replaced from disk",
    async (_label, language, path) => {
      const sibling: EditorDocument = {
        content: "unchanged",
        language: "typescript",
        name: "Sibling.ts",
        path: `${ROOT}/Sibling.ts`,
        savedContent: "unchanged",
      };
      const changed: EditorDocument = {
        content: "before",
        language,
        name: path.slice(path.lastIndexOf("/") + 1),
        path,
        savedContent: "before",
      };
      const documentsRef = {
        current: { [changed.path]: changed, [sibling.path]: sibling },
      };
      const activeDocumentRef = { current: changed as EditorDocument | null };
      const gateway = workspaceFiles();
      vi.mocked(gateway.readTextFile).mockResolvedValue("after");
      const reportedDocuments: EditorDocument[] = [];
      const reportChangedDocuments = vi.fn((paths: readonly string[]) => {
        paths.forEach((reportedPath) => {
          reportedDocuments.push(documentsRef.current[reportedPath]);
        });
      });
      const setDocuments: WorkbenchFileOperationsDependencies["setDocuments"] =
        (update) => {
          documentsRef.current =
            typeof update === "function"
              ? update(documentsRef.current)
              : update;
          activeDocumentRef.current = documentsRef.current[path] ?? null;
        };
      const dependencies = makeDependencies("", {
        activeDocumentRef,
        documentsRef,
        reportChangedDocuments,
        setDocuments,
        workspaceFiles: gateway,
      });
      const operations = renderHook(dependencies);

      act(() =>
        operations().handleWorkspaceFileChange({
          fileKind: "file",
          kind: "modified",
          path,
          previousPath: null,
          relativePath: changed.name,
          rootPath: ROOT,
        }),
      );

      await vi.waitFor(() => {
        expect(reportChangedDocuments).toHaveBeenCalledWith([path]);
      });
      expect(reportChangedDocuments).toHaveBeenCalledOnce();
      expect(documentsRef.current[path]).toMatchObject({
        content: "after",
        savedContent: "after",
      });
      expect(documentsRef.current[sibling.path]).toBe(sibling);
      expect(activeDocumentRef.current).toBe(documentsRef.current[path]);
      expect(reportedDocuments).toEqual([documentsRef.current[path]]);
    },
  );
});

describe("useWorkbenchFileOperations framework cache invalidation", () => {
  it("invalidates the current and previous paths on rename", () => {
    const previousPath = `${ROOT}/Old.php`;
    const path = `${ROOT}/New.php`;
    const invalidateFrameworkCachesForPath = vi.fn();
    const invalidatePhpTraitHostClassNames = vi.fn();
    const dependencies = makeDependencies("", {
      invalidateFrameworkCachesForPath,
      invalidatePhpTraitHostClassNames,
    });
    const operations = renderHook(dependencies);

    act(() =>
      operations().handleWorkspaceFileChange({
        fileKind: "file",
        kind: "renamed",
        path,
        previousPath,
        relativePath: "New.php",
        rootPath: ROOT,
      }),
    );

    expect(invalidateFrameworkCachesForPath.mock.calls).toEqual([
      [ROOT, path],
      [ROOT, previousPath],
    ]);
    expect(
      dependencies.invalidatePhpFrameworkSourcePath,
    ).toHaveBeenNthCalledWith(1, ROOT, path);
    expect(
      dependencies.invalidatePhpFrameworkSourcePath,
    ).toHaveBeenNthCalledWith(2, ROOT, previousPath);
    expect(invalidatePhpTraitHostClassNames).toHaveBeenCalledOnce();
    expect(invalidatePhpTraitHostClassNames).toHaveBeenCalledWith(ROOT);
  });

  it("does not invalidate paths from a non-active root", () => {
    const invalidateFrameworkCachesForPath = vi.fn();
    const dependencies = makeDependencies("", {
      invalidateFrameworkCachesForPath,
    });
    const operations = renderHook(dependencies);

    act(() =>
      operations().handleWorkspaceFileChange({
        fileKind: "file",
        kind: "modified",
        path: "/other/Changed.php",
        previousPath: null,
        relativePath: "Changed.php",
        rootPath: "/other",
      }),
    );

    expect(invalidateFrameworkCachesForPath).not.toHaveBeenCalled();
    expect(
      dependencies.invalidatePhpFrameworkSourcePath,
    ).not.toHaveBeenCalled();
  });
});
