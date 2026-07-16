import { describe, expect, it, vi } from "vitest";
import type { EditorConfigFile } from "../domain/editorConfig";
import { createInitialEditorGroupsState } from "../domain/editorGroups";
import { initialIndexProgress } from "../domain/indexProgress";
import { emptyLanguageServerCapabilities } from "../domain/languageServerRuntime";
import { createNavigationHistory } from "../domain/navigation";
import { defaultWorkspaceSettings } from "../domain/settings";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { OwnerResolvingDocumentSaveService } from "./ownerResolvingDocumentSaveService";
import {
  loadWorkbenchEditorConfigFile,
  ownerDocumentSavePipelineContextFor,
} from "./useWorkbenchController";
import type { CachedWorkspaceWorkbenchState } from "./useWorkspaceStateCache";
import { WorkbenchOwnerDocumentSaveAdapters } from "./workbenchOwnerDocumentSaveAdapters";

const activeOwner = createWorkspaceRuntimeOwner("active", "/active");
const inactiveOwner = createWorkspaceRuntimeOwner("inactive", "/inactive");

function running(rootPath: string, sessionId: number) {
  return {
    capabilities: emptyLanguageServerCapabilities(),
    kind: "running" as const,
    rootPath,
    sessionId,
  };
}

describe("useWorkbenchController owner save-adapter context", () => {
  it("uses inactive owner PHP/runtime state when active state is opposite", () => {
    const settings = { ...defaultWorkspaceSettings(), formatOnSave: true };
    const inactivePhp = running(inactiveOwner.executionRoot, 41);
    const activeTypeScript = running(activeOwner.executionRoot, 42);

    const context = ownerDocumentSavePipelineContextFor(
      inactiveOwner,
      settings,
      { [activeOwner.ownerKey]: false, [inactiveOwner.ownerKey]: true },
      { [inactiveOwner.ownerKey]: inactivePhp },
      { [activeOwner.ownerKey]: activeTypeScript },
    );

    expect(context).toEqual(expect.objectContaining({
      canUseLanguageServerDocument: false,
      hasPhpWorkspace: true,
      javaScriptTypeScriptRuntimeStatus: null,
      owner: inactiveOwner,
      phpRuntimeStatus: inactivePhp,
      settings,
    }));
  });

  it("does not borrow active PHP/runtime state for a non-PHP inactive owner", () => {
    const settings = {
      ...defaultWorkspaceSettings(),
      formatOnSave: false,
      optimizeImportsOnSave: false,
    };
    const activePhp = running(activeOwner.executionRoot, 51);
    const inactiveTypeScript = running(inactiveOwner.executionRoot, 52);

    const context = ownerDocumentSavePipelineContextFor(
      inactiveOwner,
      settings,
      { [activeOwner.ownerKey]: true, [inactiveOwner.ownerKey]: false },
      { [activeOwner.ownerKey]: activePhp },
      { [inactiveOwner.ownerKey]: inactiveTypeScript },
    );

    expect(context).toEqual(expect.objectContaining({
      canUseLanguageServerDocument: false,
      hasPhpWorkspace: false,
      javaScriptTypeScriptRuntimeStatus: inactiveTypeScript,
      owner: inactiveOwner,
      phpRuntimeStatus: null,
      settings,
    }));
  });

  it("allows server transformations only for the synchronized owner", () => {
    const settings = defaultWorkspaceSettings();
    const context = ownerDocumentSavePipelineContextFor(
      activeOwner,
      settings,
      {},
      {},
      {},
      activeOwner,
    );

    expect(context.canUseLanguageServerDocument).toBe(true);
  });
});

describe("useWorkbenchController inactive owner save wiring", () => {
  it("saves production-shaped workspaceStateCache state without activating it", async () => {
    const path = `${inactiveOwner.executionRoot}/src/Inactive.ts`;
    const inactiveDocument: EditorDocument = {
      content: "export const value = 2;\n",
      language: "typescript",
      name: "Inactive.ts",
      path,
      savedContent: "export const value = 1;\n",
    };
    const activeDocument: EditorDocument = {
      ...inactiveDocument,
      name: "Active.ts",
      path: `${activeOwner.executionRoot}/src/Active.ts`,
    };
    const activeDocumentsRef = { current: { [activeDocument.path]: activeDocument } };
    const inactiveEditorGroups = createInitialEditorGroupsState("editor-main", {
      activePath: path,
      openPaths: [path],
      previewPath: null,
    });
    const cached: CachedWorkspaceWorkbenchState = {
      bookmarks: [],
      bottomPanelView: "problems",
      bottomPanelVisible: false,
      editorSurface: {
        activePath: path,
        documents: { [path]: inactiveDocument },
        editorGroups: inactiveEditorGroups,
        imageTabs: {},
        markdownPreviewTabs: {},
        openPaths: [path],
        previewPath: null,
      },
      entriesByDirectory: {},
      expandedDirectories: new Set(),
      indexHealthLogs: [],
      indexProgress: initialIndexProgress(),
      manuallyCollapsedDirectories: new Set(),
      navigationHistory: createNavigationHistory(),
      recentFiles: [],
      recentLocations: [],
      sidebarView: "files",
      workspaceIdentityDescriptor: {
        workspaceId: inactiveOwner.ownerKey,
        selectedPath: inactiveOwner.executionRoot,
        canonicalRoot: inactiveOwner.executionRoot,
        caseSensitive: true,
        unicodeNormalizationPolicy: "preserved" as const,
        policy: {
          caseSensitive: true as const,
          unicodeNormalization: "none" as const,
        },
      },
    };
    const workspaceStateCacheRef = {
      current: { [inactiveOwner.executionRoot]: cached },
    };
    const currentWorkspaceRootRef = { current: activeOwner.executionRoot };
    const adapters = new WorkbenchOwnerDocumentSaveAdapters({
      currentWorkspaceRootRef,
      documentsRef: activeDocumentsRef,
      editorGroupsRef: {
        current: createInitialEditorGroupsState("editor-main", {
          activePath: activeDocument.path,
          openPaths: [activeDocument.path],
          previewPath: null,
        }),
      },
      setDocuments: vi.fn(),
      workspaceStateCacheRef,
      workspaceIdentityByRootRef: { current: {} },
      resolveDocumentSaveOwnership: (rootPath, documentPath) => ({
        rootPath,
        path: documentPath,
      }),
      resolveWorkspaceRuntimeOwner: (rootPath) => {
        if (rootPath === inactiveOwner.executionRoot) {
          return inactiveOwner;
        }
        if (rootPath === activeOwner.executionRoot) {
          return activeOwner;
        }
        return null;
      },
      hasExternalFileConflict: () => false,
    });
    const writeTextFile = vi.fn<WorkspaceFileGateway["writeTextFile"]>(
      async () => ({ status: "success", revision: null }),
    );
    const service = new OwnerResolvingDocumentSaveService({
      repository: adapters.repository,
      resolvePipeline: () => ({
        workspaceFiles: {
          applyWorkspaceEdit: vi.fn(async () => 0),
          createDirectory: vi.fn(async () => undefined),
          createTextFile: vi.fn(async () => undefined),
          deletePath: vi.fn(async () => undefined),
          readDirectory: vi.fn(async () => []),
          readTextFile: vi.fn(async () => ""),
          renamePath: vi.fn(async () => undefined),
          writeTextFile,
        },
        settings: defaultWorkspaceSettings(),
        invalidatePrefetch: () => undefined,
        captureLocalHistorySnapshot: async () => undefined,
        formattedContentForSave: async (_owner, _root, _settings, item) =>
          item.content,
        optimizedImportsContentForSave: (
          _owner,
          _root,
          _settings,
          _item,
          content,
        ) => content,
        organizedImportsContentForSave: async (
          _owner,
          _root,
          _settings,
          _item,
          content,
        ) => content,
        resolveEditorConfigForFile: async () => ({}),
        syncSavedDocument: async () => undefined,
        syncSavedJavaScriptTypeScriptDocument: async () => undefined,
        hasExternalFileConflict: () => false,
        beginDocumentSelfWrite: () => null,
      }),
    });
    const targets = adapters.capture(inactiveOwner.executionRoot);
    if (!targets?.[0]) {
      throw new Error("Expected an inactive cached save target");
    }

    await expect(service.saveDocument({
      target: targets[0].identity.saveTarget,
      lease: {
        isCurrent: () => true,
        tryBeginWrite: () => ({ granted: true, settle: vi.fn() }),
      },
    })).resolves.toEqual(expect.objectContaining({
      status: "saved",
      contentIsCurrent: true,
    }));

    expect(writeTextFile).toHaveBeenCalledWith(path, inactiveDocument.content);
    expect(currentWorkspaceRootRef.current).toBe(activeOwner.executionRoot);
    expect(activeDocumentsRef.current).toEqual({
      [activeDocument.path]: activeDocument,
    });
    expect(cached.editorSurface.documents[path]).toEqual(
      expect.objectContaining({
        content: inactiveDocument.content,
        savedContent: inactiveDocument.content,
      }),
    );
  });
});

describe("useWorkbenchController owner EditorConfig save adapter", () => {
  it("loads and caches uncached EditorConfig for an admitted inactive owner", async () => {
    const cache = {};
    const readTextFile = vi.fn(async () => "root = true\n[*]\nindent_size = 2\n");
    const dependencies = {
      cache: () => cache,
      currentWorkspaceRoot: () => activeOwner.executionRoot,
      readTextFile,
      resolveWorkspaceRuntimeOwner: (rootPath: string) =>
        rootPath === inactiveOwner.executionRoot ? inactiveOwner : activeOwner,
    };
    const request = {
      directory: inactiveOwner.executionRoot,
      owner: inactiveOwner,
      rootPath: inactiveOwner.executionRoot,
    };

    const first = await loadWorkbenchEditorConfigFile(dependencies, request);
    const second = await loadWorkbenchEditorConfigFile(dependencies, request);

    expect(first?.parsed.root).toBe(true);
    expect(first?.parsed.sections[0]?.properties.indent_size).toBe("2");
    expect(second).toBe(first);
    expect(readTextFile).toHaveBeenCalledOnce();
  });

  it("drops a same-path response after its captured owner is replaced", async () => {
    const replacementOwner = createWorkspaceRuntimeOwner(
      "replacement",
      inactiveOwner.executionRoot,
    );
    let currentOwner = inactiveOwner;
    let finishRead!: (content: string) => void;
    const readTextFile = vi.fn(() => new Promise<string>((resolve) => {
      finishRead = resolve;
    }));
    const cache: Record<string, Record<string, EditorConfigFile | null>> = {};
    const request = loadWorkbenchEditorConfigFile({
      cache: () => cache,
      currentWorkspaceRoot: () => activeOwner.executionRoot,
      readTextFile,
      resolveWorkspaceRuntimeOwner: () => currentOwner,
    }, {
      directory: inactiveOwner.executionRoot,
      owner: inactiveOwner,
      rootPath: inactiveOwner.executionRoot,
    });

    currentOwner = replacementOwner;
    finishRead("root = true\n[*]\nindent_size = 8\n");

    await expect(request).resolves.toBeNull();
    expect(Object.values(cache).every((bucket) =>
      Object.keys(bucket).length === 0
    )).toBe(true);
  });

  it("keeps ordinary UI loads fenced to the active root", async () => {
    const readTextFile = vi.fn(async () => "root = true\n");

    await expect(loadWorkbenchEditorConfigFile({
      cache: () => ({}),
      currentWorkspaceRoot: () => activeOwner.executionRoot,
      readTextFile,
      resolveWorkspaceRuntimeOwner: () => inactiveOwner,
    }, {
      directory: inactiveOwner.executionRoot,
      rootPath: inactiveOwner.executionRoot,
    })).resolves.toBeNull();
    expect(readTextFile).not.toHaveBeenCalled();
  });
});
