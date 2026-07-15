// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePrefetchCache } from "../domain/filePrefetchCache";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import type { DocumentSaveInvalidationScope } from "./documentSaveCoordinator";
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
    invalidateAndWaitForDocumentSaves: vi.fn(),
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

describe("useWorkbenchFileOperations save invalidation", () => {
  it("awaits file-save invalidation before renaming the active file", async () => {
    const document = {
      content: "content",
      language: "plaintext",
      name: "Old.txt",
      path: `${ROOT}/Old.txt`,
      savedContent: "content",
    };
    const invalidation = createDeferred<void>();
    const invalidateAndWaitForDocumentSaves = vi.fn(
      (_scope: DocumentSaveInvalidationScope) => invalidation.promise,
    );
    const dependencies = makeDependencies("", {
      activeDocumentRef: { current: document },
      invalidateAndWaitForDocumentSaves,
      prompter: { prompt: vi.fn(() => "New.txt"), confirm: vi.fn() },
    });
    const operations = renderHook(dependencies);

    let renamePromise!: Promise<void>;
    act(() => {
      renamePromise = operations().renameActiveDocument();
    });
    await vi.waitFor(() => {
      expect(invalidateAndWaitForDocumentSaves.mock.calls).toEqual([
        [{ kind: "file", path: document.path, rootPath: ROOT }],
      ]);
    });
    expect(dependencies.workspaceFiles.renamePath).not.toHaveBeenCalled();

    await act(async () => {
      invalidation.resolve();
      await renamePromise;
    });

    expect(dependencies.workspaceFiles.renamePath).toHaveBeenCalledWith(
      document.path,
      `${ROOT}/New.txt`,
    );
  });

  it("awaits directory-save invalidation before renaming a directory", async () => {
    const oldPath = `${ROOT}/src`;
    const invalidation = createDeferred<void>();
    const invalidateAndWaitForDocumentSaves = vi.fn(
      (_scope: DocumentSaveInvalidationScope) => invalidation.promise,
    );
    const dependencies = makeDependencies("", {
      applyJavaScriptTypeScriptRenameEdits: vi.fn(async () => true),
      invalidateAndWaitForDocumentSaves,
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
      expect(invalidateAndWaitForDocumentSaves.mock.calls).toEqual([
        [{ kind: "directory", path: oldPath, rootPath: ROOT }],
      ]);
    });
    expect(dependencies.workspaceFiles.renamePath).not.toHaveBeenCalled();

    await act(async () => {
      invalidation.resolve();
      await renamePromise;
    });

    expect(dependencies.workspaceFiles.renamePath).toHaveBeenCalledWith(
      oldPath,
      `${ROOT}/source`,
    );
  });

  it("awaits file-save invalidation before deleting the active file", async () => {
    const document = {
      content: "content",
      language: "plaintext",
      name: "Deleted.txt",
      path: `${ROOT}/Deleted.txt`,
      savedContent: "content",
    };
    const invalidation = createDeferred<void>();
    const invalidateAndWaitForDocumentSaves = vi.fn(
      (_scope: DocumentSaveInvalidationScope) => invalidation.promise,
    );
    const dependencies = makeDependencies("", {
      activeDocumentRef: { current: document },
      applyJavaScriptTypeScriptDeleteEdits: vi.fn(async () => true),
      invalidateAndWaitForDocumentSaves,
      prompter: { prompt: vi.fn(), confirm: vi.fn(() => true) },
    });
    const operations = renderHook(dependencies);

    let deletePromise!: Promise<void>;
    act(() => {
      deletePromise = operations().deleteActiveDocument();
    });
    await vi.waitFor(() => {
      expect(invalidateAndWaitForDocumentSaves.mock.calls).toEqual([
        [{ kind: "file", path: document.path, rootPath: ROOT }],
      ]);
    });
    expect(dependencies.workspaceFiles.deletePath).not.toHaveBeenCalled();

    await act(async () => {
      invalidation.resolve();
      await deletePromise;
    });

    expect(dependencies.workspaceFiles.deletePath).toHaveBeenCalledWith(
      document.path,
    );
  });

  it("does not invalidate saves when rename or delete is declined or a no-op", async () => {
    const document = {
      content: "content",
      language: "plaintext",
      name: "Current.txt",
      path: `${ROOT}/Current.txt`,
      savedContent: "content",
    };
    const invalidateAndWaitForDocumentSaves = vi.fn();
    const dependencies = makeDependencies("", {
      activeDocumentRef: { current: document },
      invalidateAndWaitForDocumentSaves,
      prompter: {
        prompt: vi.fn(() => document.name),
        confirm: vi.fn(() => false),
      },
    });
    const operations = renderHook(dependencies);

    await act(async () => operations().renameActiveDocument());
    await act(async () => operations().deleteActiveDocument());

    expect(invalidateAndWaitForDocumentSaves).not.toHaveBeenCalled();
    expect(dependencies.workspaceFiles.renamePath).not.toHaveBeenCalled();
    expect(dependencies.workspaceFiles.deletePath).not.toHaveBeenCalled();
  });
});

describe("useWorkbenchFileOperations framework cache invalidation", () => {
  it("invalidates the current and previous paths on rename", () => {
    const previousPath = `${ROOT}/Old.php`;
    const path = `${ROOT}/New.php`;
    const invalidateFrameworkCachesForPath = vi.fn();
    const dependencies = makeDependencies("", {
      invalidateFrameworkCachesForPath,
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
