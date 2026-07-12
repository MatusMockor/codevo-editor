// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePrefetchCache } from "../domain/filePrefetchCache";
import type { WorkspaceFileGateway } from "../domain/workspace";
import {
  useWorkbenchFileOperations,
  type WorkbenchFileOperations,
  type WorkbenchFileOperationsDependencies,
} from "./useWorkbenchFileOperations";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";

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
    invalidateBladeComponentNamesForPath: vi.fn(),
    invalidateBladeViewDataEntriesForPath: vi.fn(),
    invalidateNeonConfigForPath: vi.fn(),
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
});
