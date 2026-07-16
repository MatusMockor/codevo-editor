// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DirtyCloseDecision } from "../domain/dirtyClose";
import {
  createInitialEditorGroupsState,
  editorGroupsReducer,
  type EditorGroupsState,
} from "../domain/editorGroups";
import type { EslintDiagnosticsByRoot } from "../domain/eslintDiagnostics";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import type { PhpstanDiagnosticsByRoot } from "../domain/phpstanDiagnostics";
import type {
  EditorDocument,
  ImageTab,
  WorkspaceFileRevision,
} from "../domain/workspace";
import { createLegacyWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { legacyDocumentSaveIdentity } from "./documentSaveIdentity";
import type { RunWithDocumentSaveExclusion } from "./documentSaveCoordinator";
import type { DocumentSaveResult } from "./documentSaveService";
import {
  useWorkbenchEditorGroupCloseLifecycle,
  type WorkbenchEditorGroupCloseLifecycle,
  type WorkbenchEditorGroupCloseLifecycleDependencies,
} from "./useWorkbenchEditorGroupCloseLifecycle";

const ROOT = "/workspace";

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

function document(
  path: string,
  content = "saved",
  savedContent = content,
): EditorDocument {
  return {
    content,
    language: "php",
    name: path.split("/").pop() ?? path,
    path,
    savedContent,
  };
}

function stateWithPaths(paths: readonly string[]): EditorGroupsState {
  return createInitialEditorGroupsState("editor-main", {
    activePath: paths[0] ?? null,
    openPaths: [...paths],
    previewPath: null,
  });
}

function splitState(path: string): EditorGroupsState {
  return editorGroupsReducer(stateWithPaths([path]), {
    type: "split-group",
    direction: "right",
    newGroupId: "editor-side",
  });
}

function splitAliasState(first: string, second: string): EditorGroupsState {
  let state = splitState(first);
  state = editorGroupsReducer(state, {
    type: "open-tab",
    groupId: "editor-side",
    path: second,
  });
  state = editorGroupsReducer(state, {
    type: "close-tab",
    groupId: "editor-side",
    path: first,
  });
  return editorGroupsReducer(state, {
    type: "activate-group",
    groupId: "editor-main",
  });
}

interface DeferredDecision {
  readonly promise: Promise<DirtyCloseDecision>;
  readonly resolve: (decision: DirtyCloseDecision) => void;
}

function deferredDecision(): DeferredDecision {
  let resolve!: (decision: DirtyCloseDecision) => void;
  const promise = new Promise<DirtyCloseDecision>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

interface Harness {
  activeDocumentRef: { current: EditorDocument | null };
  closeTextDocument: ReturnType<typeof vi.fn>;
  currentWorkspaceRootRef: { current: string | null };
  decideDirtyClose: ReturnType<typeof vi.fn>;
  documentsRef: { current: Record<string, EditorDocument> };
  editorGroupsRef: { current: EditorGroupsState };
  eslintDiagnostics: () => EslintDiagnosticsByRoot;
  imageTabsRef: { current: Record<string, ImageTab> };
  lifecycle: WorkbenchEditorGroupCloseLifecycle;
  openPathsRef: { current: string[] };
  phpstanDiagnostics: () => PhpstanDiagnosticsByRoot;
  saveDocument: ReturnType<typeof vi.fn>;
  runWithIssuedWriteDrain: RunWithDocumentSaveExclusion &
    ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderLifecycle(
  state: EditorGroupsState,
  documents: Record<string, EditorDocument>,
  overrides: Partial<WorkbenchEditorGroupCloseLifecycleDependencies> = {},
): Harness {
  const container = globalThis.document.createElement("div");
  const root = createRoot(container);
  const currentWorkspaceRootRef = { current: ROOT as string | null };
  const editorGroupsRef = { current: state };
  const activeGroup = state.groups[state.activeGroupId];
  const openPathsRef = { current: activeGroup?.openPaths ?? [] };
  const previewPathRef = { current: activeGroup?.previewPath ?? null };
  const documentsRef = { current: documents };
  const activeDocumentRef = {
    current: activeGroup?.activePath
      ? documents[activeGroup.activePath] ?? null
      : null,
  };
  const imageTabsRef: { current: Record<string, ImageTab> } = { current: {} };
  const markdownPreviewTabsRef: {
    current: Record<string, MarkdownPreviewTab>;
  } = { current: {} };
  const closeTextDocument = vi.fn();
  const closeTextSurface = vi.fn();
  const decideDirtyClose = vi.fn(async () => "discard" as const);
  const saveDocument = vi.fn(async (path: string): Promise<DocumentSaveResult> => {
    const live = documentsRef.current[path];
    if (!live) {
      return { status: "stale" };
    }
    const saved = { ...live, savedContent: live.content };
    documentsRef.current = { ...documentsRef.current, [path]: saved };
    activeDocumentRef.current = saved;
    return { status: "saved", document: saved, contentIsCurrent: true };
  });
  const runWithIssuedWriteDrain = vi.fn(async (
    _scope: unknown,
    operation: () => Promise<unknown>,
  ) => operation()) as unknown as RunWithDocumentSaveExclusion &
    ReturnType<typeof vi.fn>;
  let eslintDiagnostics: EslintDiagnosticsByRoot = {
    [ROOT]: Object.fromEntries(
      Object.keys(documents).map((path) => [
        path,
        [{ identifier: "eslint.rule", line: 1 }],
      ]),
    ),
  };
  let phpstanDiagnostics: PhpstanDiagnosticsByRoot = {
    [ROOT]: Object.fromEntries(
      Object.keys(documents).map((path) => [
        path,
        [{ identifier: "phpstan.rule", line: 1 }],
      ]),
    ),
  };

  const dependencies: WorkbenchEditorGroupCloseLifecycleDependencies = {
    workspaceRoot: ROOT,
    currentWorkspaceRootRef,
    editorGroupsRef,
    openPathsRef,
    previewPathRef,
    activeDocumentRef,
    documentsRef,
    imageTabsRef,
    markdownPreviewTabsRef,
    setImageTabs: (update) => {
      imageTabsRef.current = typeof update === "function"
        ? update(imageTabsRef.current)
        : update;
    },
    setMarkdownPreviewTabs: (update) => {
      markdownPreviewTabsRef.current = typeof update === "function"
        ? update(markdownPreviewTabsRef.current)
        : update;
    },
    setEslintDiagnosticsByRoot: (update) => {
      eslintDiagnostics = typeof update === "function"
        ? update(eslintDiagnostics)
        : update;
    },
    setPhpstanDiagnosticsByRoot: (update) => {
      phpstanDiagnostics = typeof update === "function"
        ? update(phpstanDiagnostics)
        : update;
    },
    updateEditorGroups: (update) => {
      editorGroupsRef.current = update(editorGroupsRef.current);
    },
    closeTextDocument,
    closeTextSurface,
    saveDocument,
    runWithIssuedWriteDrain,
    resolveDocumentSaveOwnership: (rootPath, path) =>
      legacyDocumentSaveIdentity(rootPath, path),
    resolveWorkspaceRuntimeOwner: (rootPath) =>
      createLegacyWorkspaceRuntimeOwner(rootPath),
    dirtyCloseDecisionPort: { decideDirtyClose },
    hasExternalFileConflict: () => false,
    prompter: { confirm: vi.fn(() => true), prompt: vi.fn() },
    ...overrides,
  };
  let lifecycle: WorkbenchEditorGroupCloseLifecycle | null = null;

  function TestComponent() {
    lifecycle = useWorkbenchEditorGroupCloseLifecycle(dependencies);
    return null;
  }

  act(() => root.render(<TestComponent />));
  if (!lifecycle) {
    throw new Error("Lifecycle not rendered");
  }

  return {
    activeDocumentRef,
    closeTextDocument,
    currentWorkspaceRootRef,
    decideDirtyClose,
    documentsRef,
    editorGroupsRef,
    eslintDiagnostics: () => eslintDiagnostics,
    imageTabsRef,
    lifecycle,
    openPathsRef,
    phpstanDiagnostics: () => phpstanDiagnostics,
    saveDocument,
    runWithIssuedWriteDrain,
    unmount: () => act(() => root.unmount()),
  };
}

describe("useWorkbenchEditorGroupCloseLifecycle", () => {
  it("closes a non-final shared membership immediately", async () => {
    const path = `${ROOT}/shared.php`;
    const harness = renderLifecycle(splitState(path), {
      [path]: document(path, "edited", "saved"),
    });

    await expect(
      harness.lifecycle.closeDocumentInEditorGroup("editor-side", path),
    ).resolves.toBe("closed");

    expect(harness.decideDirtyClose).not.toHaveBeenCalled();
    expect(harness.saveDocument).not.toHaveBeenCalled();
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(harness.editorGroupsRef.current.groups["editor-side"]?.openPaths)
      .toEqual([]);
    harness.unmount();
  });

  it("prompts and saves only final dirty membership when a group also shares a dirty document", async () => {
    const finalPath = `${ROOT}/final.php`;
    const sharedPath = `${ROOT}/shared.php`;
    const initial = stateWithPaths([finalPath, sharedPath]);
    const state = editorGroupsReducer(initial, {
      type: "split-group",
      direction: "right",
      newGroupId: "editor-side",
    });
    state.groups["editor-side"] = {
      activePath: sharedPath,
      openPaths: [sharedPath],
      previewPath: null,
    };
    state.activeGroupId = "editor-main";
    const decideDirtyClose = vi.fn(async () => "save" as const);
    const onDidCloseEditorPaths = vi.fn();
    const harness = renderLifecycle(
      state,
      {
        [finalPath]: document(finalPath, "final edit", "saved"),
        [sharedPath]: document(sharedPath, "shared edit", "saved"),
      },
      {
        dirtyCloseDecisionPort: { decideDirtyClose },
        onDidCloseEditorPaths,
      },
    );

    await expect(harness.lifecycle.closeActiveEditorGroup()).resolves.toBe(
      "closed",
    );

    expect(decideDirtyClose).toHaveBeenCalledWith(expect.objectContaining({
      scope: "group",
      documentNames: ["final.php"],
    }));
    expect(harness.saveDocument).toHaveBeenCalledOnce();
    expect(harness.saveDocument).toHaveBeenCalledWith(finalPath);
    expect(harness.closeTextDocument).toHaveBeenCalledOnce();
    expect(harness.closeTextDocument).toHaveBeenCalledWith(finalPath, {
      skipConfirmation: true,
    });
    expect(harness.editorGroupsRef.current.groups["editor-side"]?.openPaths)
      .toEqual([sharedPath]);
    expect(harness.documentsRef.current[sharedPath]?.savedContent).toBe(
      "saved",
    );
    expect(onDidCloseEditorPaths).toHaveBeenCalledWith([finalPath]);
    harness.unmount();
  });

  it("discards one final dirty tab only after one typed decision", async () => {
    const path = `${ROOT}/dirty.php`;
    const harness = renderLifecycle(stateWithPaths([path]), {
      [path]: document(path, "edited", "saved"),
    });

    await expect(harness.lifecycle.closeDocument(path)).resolves.toBe("closed");

    expect(harness.decideDirtyClose).toHaveBeenCalledOnce();
    expect(harness.decideDirtyClose).toHaveBeenCalledWith(expect.objectContaining({
      scope: "tab",
      documentNames: ["dirty.php"],
    }));
    expect(harness.saveDocument).not.toHaveBeenCalled();
    expect(harness.closeTextDocument).toHaveBeenCalledWith(path, {
      skipConfirmation: true,
    });
    expect(harness.eslintDiagnostics()[ROOT]?.[path]).toBeUndefined();
    expect(harness.phpstanDiagnostics()[ROOT]?.[path]).toBeUndefined();
    harness.unmount();
  });

  it("cancels without mutating state or diagnostics", async () => {
    const path = `${ROOT}/dirty.php`;
    const state = stateWithPaths([path]);
    const decideDirtyClose = vi.fn(async () => "cancel" as const);
    const onDidCloseEditorPaths = vi.fn();
    const harness = renderLifecycle(
      state,
      { [path]: document(path, "edited", "saved") },
      {
        dirtyCloseDecisionPort: { decideDirtyClose },
        onDidCloseEditorPaths,
      },
    );
    const eslint = harness.eslintDiagnostics();
    const phpstan = harness.phpstanDiagnostics();

    await expect(harness.lifecycle.closeDocument(path)).resolves.toBe(
      "cancelled",
    );

    expect(harness.editorGroupsRef.current).toBe(state);
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(harness.saveDocument).not.toHaveBeenCalled();
    expect(harness.eslintDiagnostics()).toBe(eslint);
    expect(harness.phpstanDiagnostics()).toBe(phpstan);
    expect(onDidCloseEditorPaths).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("saves through the transaction before closing", async () => {
    const path = `${ROOT}/dirty.php`;
    const calls: string[] = [];
    let harness!: Harness;
    const saveDocument = vi.fn(async (): Promise<DocumentSaveResult> => {
      calls.push("save");
      const live = harness.documentsRef.current[path]!;
      const saved = { ...live, savedContent: live.content };
      harness.documentsRef.current = { [path]: saved };
      return { status: "saved", document: saved, contentIsCurrent: true };
    });
    harness = renderLifecycle(
      stateWithPaths([path]),
      { [path]: document(path, "edited", "saved") },
      {
        dirtyCloseDecisionPort: {
          decideDirtyClose: vi.fn(async () => "save" as const),
        },
        saveDocument,
        closeTextDocument: vi.fn(() => calls.push("close")),
      },
    );

    await expect(harness.lifecycle.closeDocument(path)).resolves.toBe("closed");

    expect(calls).toEqual(["save", "close"]);
    expect(saveDocument).toHaveBeenCalledWith(path);
    harness.unmount();
  });

  it("closes against the authoritative live revision after Save", async () => {
    const path = `${ROOT}/dirty-revision.php`;
    let harness!: Harness;
    const savedRevision = revision("2");
    const saveDocument = vi.fn(async (): Promise<DocumentSaveResult> => {
      const live = harness.documentsRef.current[path]!;
      const acknowledged = {
        ...live,
        savedContent: live.content,
        revision: savedRevision,
      };
      harness.documentsRef.current = { [path]: acknowledged };
      return {
        status: "saved",
        document: { ...live, savedContent: live.content },
        contentIsCurrent: true,
      };
    });
    harness = renderLifecycle(
      stateWithPaths([path]),
      {
        [path]: {
          ...document(path, "edited", "saved"),
          revision: revision("1"),
        },
      },
      {
        dirtyCloseDecisionPort: {
          decideDirtyClose: vi.fn(async () => "save" as const),
        },
        saveDocument,
      },
    );

    await expect(harness.lifecycle.closeDocument(path)).resolves.toBe("closed");

    expect(harness.closeTextDocument).toHaveBeenCalledWith(
      path,
      expect.objectContaining({ skipConfirmation: true }),
    );
    harness.unmount();
  });

  it("allows a dirty preview tab to become pinned while Save closes it", async () => {
    const path = `${ROOT}/dirty-preview.php`;
    const previewState = createInitialEditorGroupsState("editor-main", {
      activePath: path,
      openPaths: [],
      previewPath: path,
    });
    let harness!: Harness;
    const saveDocument = vi.fn(async (): Promise<DocumentSaveResult> => {
      const live = harness.documentsRef.current[path]!;
      const saved = { ...live, savedContent: live.content };
      harness.documentsRef.current = { [path]: saved };
      harness.editorGroupsRef.current = editorGroupsReducer(
        harness.editorGroupsRef.current,
        { type: "promote-dirty-tab", path },
      );
      return { status: "saved", document: saved, contentIsCurrent: true };
    });
    harness = renderLifecycle(
      previewState,
      { [path]: document(path, "edited", "saved") },
      {
        dirtyCloseDecisionPort: {
          decideDirtyClose: vi.fn(async () => "save" as const),
        },
        saveDocument,
      },
    );

    await expect(harness.lifecycle.closeDocument(path)).resolves.toBe("closed");

    expect(harness.closeTextDocument).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("blocks Save for an external conflict and leaves diagnostics untouched", async () => {
    const path = `${ROOT}/conflict.php`;
    const saveDocument = vi.fn(async () => ({
      status: "blocked" as const,
      reason: "external" as const,
    }));
    const harness = renderLifecycle(
      stateWithPaths([path]),
      { [path]: document(path) },
      {
        dirtyCloseDecisionPort: {
          decideDirtyClose: vi.fn(async () => "save" as const),
        },
        hasExternalFileConflict: (_root, candidate) => candidate === path,
        saveDocument,
      },
    );
    const eslint = harness.eslintDiagnostics();

    await expect(harness.lifecycle.closeDocument(path)).resolves.toBe("blocked");

    expect(saveDocument).toHaveBeenCalledOnce();
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(harness.eslintDiagnostics()).toBe(eslint);
    harness.unmount();
  });

  it("returns stale when the document changes while a decision is pending", async () => {
    const path = `${ROOT}/dirty.php`;
    const pending = deferredDecision();
    const harness = renderLifecycle(
      stateWithPaths([path]),
      { [path]: document(path, "edited", "saved") },
      {
        dirtyCloseDecisionPort: {
          decideDirtyClose: vi.fn(() => pending.promise),
        },
      },
    );
    const close = harness.lifecycle.closeDocument(path);
    harness.documentsRef.current = {
      [path]: document(path, "newer edit", "saved"),
    };
    pending.resolve("discard");

    await expect(close).resolves.toBe("stale");
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(harness.eslintDiagnostics()[ROOT]?.[path]).toBeDefined();
    harness.unmount();
  });

  it("keeps the whole group when an initially clean tab changes during the decision", async () => {
    const dirtyPath = `${ROOT}/dirty.php`;
    const cleanPath = `${ROOT}/clean.php`;
    const pending = deferredDecision();
    const state = stateWithPaths([dirtyPath, cleanPath]);
    const onDidCloseEditorPaths = vi.fn();
    const harness = renderLifecycle(
      state,
      {
        [dirtyPath]: document(dirtyPath, "edited", "saved"),
        [cleanPath]: document(cleanPath),
      },
      {
        dirtyCloseDecisionPort: {
          decideDirtyClose: vi.fn(() => pending.promise),
        },
        onDidCloseEditorPaths,
      },
    );

    const close = harness.lifecycle.closeActiveEditorGroup();
    harness.documentsRef.current = {
      ...harness.documentsRef.current,
      [cleanPath]: document(cleanPath, "new edit", "saved"),
    };
    pending.resolve("discard");

    await expect(close).resolves.toBe("stale");
    expect(harness.editorGroupsRef.current).toBe(state);
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(onDidCloseEditorPaths).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("returns stale when the captured owner is replaced", async () => {
    const path = `${ROOT}/dirty.php`;
    const pending = deferredDecision();
    let ownerRoot = ROOT;
    const harness = renderLifecycle(
      stateWithPaths([path]),
      { [path]: document(path, "edited", "saved") },
      {
        dirtyCloseDecisionPort: {
          decideDirtyClose: vi.fn(() => pending.promise),
        },
        resolveWorkspaceRuntimeOwner: () =>
          createLegacyWorkspaceRuntimeOwner(ownerRoot),
      },
    );
    const close = harness.lifecycle.closeDocument(path);
    ownerRoot = "/replacement";
    pending.resolve("discard");

    await expect(close).resolves.toBe("stale");
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("saves equivalent canonical aliases once before closing every membership", async () => {
    const first = `${ROOT}/alias-a.php`;
    const second = `${ROOT}/alias-b.php`;
    const decideDirtyClose = vi.fn(async () => "save" as const);
    const onDidCloseEditorPaths = vi.fn();
    const harness = renderLifecycle(
      stateWithPaths([first, second]),
      {
        [first]: document(first, "edited", "saved"),
        [second]: document(second, "edited", "saved"),
      },
      {
        dirtyCloseDecisionPort: { decideDirtyClose },
        onDidCloseEditorPaths,
        resolveDocumentSaveOwnership: () => ({
          canonicalRoot: ROOT,
          workspaceRelativePath: "same.php",
        }),
      },
    );

    await expect(harness.lifecycle.closeActiveEditorGroup()).resolves.toBe(
      "closed",
    );

    expect(decideDirtyClose).toHaveBeenCalledOnce();
    expect(decideDirtyClose).toHaveBeenCalledWith(expect.objectContaining({
      scope: "group",
      documentNames: ["alias-a.php", "alias-b.php"],
    }));
    expect(harness.saveDocument).toHaveBeenCalledOnce();
    expect(harness.saveDocument).toHaveBeenCalledWith(first);
    expect(harness.closeTextDocument).toHaveBeenCalledTimes(2);
    expect(onDidCloseEditorPaths).toHaveBeenCalledOnce();
    expect(onDidCloseEditorPaths).toHaveBeenCalledWith([first, second]);
    harness.unmount();
  });

  it("stales every equivalent alias when one membership changes during Save", async () => {
    const first = `${ROOT}/alias-a.php`;
    const second = `${ROOT}/alias-b.php`;
    const state = stateWithPaths([first, second]);
    let harness!: Harness;
    const saveDocument = vi.fn(async (): Promise<DocumentSaveResult> => {
      const firstSaved = document(first, "edited", "edited");
      harness.documentsRef.current = {
        [first]: firstSaved,
        [second]: document(second, "newer edit", "saved"),
      };
      return {
        status: "saved",
        document: firstSaved,
        contentIsCurrent: true,
      };
    });
    harness = renderLifecycle(
      state,
      {
        [first]: document(first, "edited", "saved"),
        [second]: document(second, "edited", "saved"),
      },
      {
        dirtyCloseDecisionPort: {
          decideDirtyClose: vi.fn(async () => "save" as const),
        },
        resolveDocumentSaveOwnership: () => ({
          canonicalRoot: ROOT,
          workspaceRelativePath: "same.php",
        }),
        saveDocument,
      },
    );

    await expect(harness.lifecycle.closeActiveEditorGroup()).resolves.toBe(
      "stale",
    );

    expect(saveDocument).toHaveBeenCalledOnce();
    expect(saveDocument).toHaveBeenCalledWith(first);
    expect(harness.editorGroupsRef.current).toBe(state);
    expect(harness.editorGroupsRef.current.groups["editor-main"]?.openPaths)
      .toEqual([first, second]);
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("rejects divergent canonical aliases without prompting or saving", async () => {
    const first = `${ROOT}/alias-a.php`;
    const second = `${ROOT}/alias-b.php`;
    const state = stateWithPaths([first, second]);
    const harness = renderLifecycle(
      state,
      {
        [first]: document(first, "first edit", "saved"),
        [second]: document(second, "second edit", "saved"),
      },
      {
        resolveDocumentSaveOwnership: () => ({
          canonicalRoot: ROOT,
          workspaceRelativePath: "same.php",
        }),
      },
    );

    await expect(harness.lifecycle.closeActiveEditorGroup()).resolves.toBe(
      "stale",
    );

    expect(harness.decideDirtyClose).not.toHaveBeenCalled();
    expect(harness.saveDocument).not.toHaveBeenCalled();
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(harness.editorGroupsRef.current).toBe(state);
    expect(harness.editorGroupsRef.current.groups["editor-main"]?.openPaths)
      .toEqual([first, second]);
    harness.unmount();
  });

  it("rejects a dirty alias that diverges from a clean canonical membership", async () => {
    const first = `${ROOT}/alias-a.php`;
    const second = `${ROOT}/alias-b.php`;
    const state = stateWithPaths([first, second]);
    const harness = renderLifecycle(
      state,
      {
        [first]: document(first, "edited", "saved"),
        [second]: document(second, "saved", "saved"),
      },
      {
        resolveDocumentSaveOwnership: () => ({
          canonicalRoot: ROOT,
          workspaceRelativePath: "same.php",
        }),
      },
    );

    await expect(harness.lifecycle.closeActiveEditorGroup()).resolves.toBe(
      "stale",
    );

    expect(harness.decideDirtyClose).not.toHaveBeenCalled();
    expect(harness.saveDocument).not.toHaveBeenCalled();
    expect(harness.editorGroupsRef.current).toBe(state);
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    harness.unmount();
  });

  it.each(["tab", "group"] as const)(
    "rejects a divergent canonical alias outside the %s closing scope",
    async (scope) => {
      const first = `${ROOT}/alias-a.php`;
      const second = `${ROOT}/alias-b.php`;
      const state = splitAliasState(first, second);
      const harness = renderLifecycle(
        state,
        {
          [first]: document(first, "first edit", "saved"),
          [second]: document(second, "second edit", "saved"),
        },
        {
          resolveDocumentSaveOwnership: () => ({
            canonicalRoot: ROOT,
            workspaceRelativePath: "same.php",
          }),
        },
      );

      const close = scope === "tab"
        ? harness.lifecycle.closeDocumentInEditorGroup("editor-main", first)
        : harness.lifecycle.closeActiveEditorGroup();

      await expect(close).resolves.toBe("stale");
      expect(harness.decideDirtyClose).not.toHaveBeenCalled();
      expect(harness.saveDocument).not.toHaveBeenCalled();
      expect(harness.closeTextDocument).not.toHaveBeenCalled();
      expect(harness.editorGroupsRef.current).toBe(state);
      harness.unmount();
    },
  );

  it("stales a tab close before Save when an external canonical alias changes during the decision", async () => {
    const first = `${ROOT}/alias-a.php`;
    const second = `${ROOT}/alias-b.php`;
    const pending = deferredDecision();
    const state = splitAliasState(first, second);
    const harness = renderLifecycle(
      state,
      {
        [first]: document(first, "edited", "saved"),
        [second]: document(second, "edited", "saved"),
      },
      {
        dirtyCloseDecisionPort: {
          decideDirtyClose: vi.fn(() => pending.promise),
        },
        resolveDocumentSaveOwnership: () => ({
          canonicalRoot: ROOT,
          workspaceRelativePath: "same.php",
        }),
      },
    );

    const close = harness.lifecycle.closeDocumentInEditorGroup(
      "editor-main",
      first,
    );
    harness.documentsRef.current = {
      ...harness.documentsRef.current,
      [second]: document(second, "newer external edit", "saved"),
    };
    pending.resolve("save");

    await expect(close).resolves.toBe("stale");
    expect(harness.saveDocument).not.toHaveBeenCalled();
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(harness.editorGroupsRef.current).toBe(state);
    expect(harness.documentsRef.current[second]?.content).toBe(
      "newer external edit",
    );
    harness.unmount();
  });

  it("stales a group close when an external canonical alias changes while Save awaits", async () => {
    const first = `${ROOT}/alias-a.php`;
    const second = `${ROOT}/alias-b.php`;
    const state = splitAliasState(first, second);
    let resolveSave!: (result: DocumentSaveResult) => void;
    const pendingSave = new Promise<DocumentSaveResult>((resolve) => {
      resolveSave = resolve;
    });
    const saveDocument = vi.fn(() => pendingSave);
    const harness = renderLifecycle(
      state,
      {
        [first]: document(first, "edited", "saved"),
        [second]: document(second, "edited", "saved"),
      },
      {
        dirtyCloseDecisionPort: {
          decideDirtyClose: vi.fn(async () => "save" as const),
        },
        resolveDocumentSaveOwnership: () => ({
          canonicalRoot: ROOT,
          workspaceRelativePath: "same.php",
        }),
        saveDocument,
      },
    );

    const close = harness.lifecycle.closeActiveEditorGroup();
    await vi.waitFor(() => expect(saveDocument).toHaveBeenCalledWith(first));
    harness.documentsRef.current = {
      ...harness.documentsRef.current,
      [second]: document(second, "newer external edit", "saved"),
    };
    resolveSave({
      status: "saved",
      document: document(first, "edited", "edited"),
      contentIsCurrent: true,
    });

    await expect(close).resolves.toBe("stale");
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(harness.editorGroupsRef.current).toBe(state);
    expect(harness.documentsRef.current[second]?.content).toBe(
      "newer external edit",
    );
    harness.unmount();
  });

  it("revalidates a successful save against the acknowledged live document", async () => {
    const path = `${ROOT}/dirty.php`;
    let harness!: Harness;
    const saveDocument = vi.fn(async (): Promise<DocumentSaveResult> => {
      const acknowledged = document(path, "edited", "edited");
      harness.documentsRef.current = {
        [path]: document(path, "newer edit", "edited"),
      };
      return {
        status: "saved",
        document: acknowledged,
        contentIsCurrent: true,
      };
    });
    harness = renderLifecycle(
      stateWithPaths([path]),
      { [path]: document(path, "edited", "saved") },
      {
        dirtyCloseDecisionPort: {
          decideDirtyClose: vi.fn(async () => "save" as const),
        },
        saveDocument,
      },
    );

    await expect(harness.lifecycle.closeDocument(path)).resolves.toBe("stale");

    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(harness.documentsRef.current[path]?.content).toBe("newer edit");
    harness.unmount();
  });

  it("drains issued writes before committing Discard", async () => {
    const path = `${ROOT}/dirty.php`;
    let releaseDrain!: () => void;
    const drain = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const runWithIssuedWriteDrain = vi.fn(async (
      _scope: unknown,
      operation: () => Promise<unknown>,
    ) => {
      await drain;
      return operation();
    }) as unknown as RunWithDocumentSaveExclusion & ReturnType<typeof vi.fn>;
    const harness = renderLifecycle(
      stateWithPaths([path]),
      { [path]: document(path, "edited", "saved") },
      { runWithIssuedWriteDrain },
    );

    const close = harness.lifecycle.closeDocument(path);
    await Promise.resolve();
    expect(runWithIssuedWriteDrain).toHaveBeenCalledOnce();
    expect(harness.closeTextDocument).not.toHaveBeenCalled();

    releaseDrain();
    await expect(close).resolves.toBe("closed");
    expect(harness.closeTextDocument).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("keeps a whole group intact when any Save fails", async () => {
    const first = `${ROOT}/a.php`;
    const second = `${ROOT}/b.php`;
    const state = stateWithPaths([first, second]);
    let harness!: Harness;
    const saveDocument = vi.fn(async (path: string): Promise<DocumentSaveResult> => {
      if (path === first) {
        const saved = document(first, "edited", "edited");
        harness.documentsRef.current = {
          ...harness.documentsRef.current,
          [first]: saved,
        };
        return { status: "saved", document: saved, contentIsCurrent: true };
      }
      return { status: "failed", error: new Error("disk full") };
    });
    harness = renderLifecycle(
      state,
      {
        [first]: document(first, "edited", "saved"),
        [second]: document(second, "edited", "saved"),
      },
      {
        dirtyCloseDecisionPort: {
          decideDirtyClose: vi.fn(async () => "save" as const),
        },
        saveDocument,
      },
    );

    await expect(harness.lifecycle.closeActiveEditorGroup()).resolves.toBe(
      "blocked",
    );

    expect(harness.editorGroupsRef.current).toBe(state);
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(harness.eslintDiagnostics()[ROOT]?.[first]).toBeDefined();
    expect(harness.eslintDiagnostics()[ROOT]?.[second]).toBeDefined();
    harness.unmount();
  });

  it("rolls back a whole group when a close side effect throws", async () => {
    const first = `${ROOT}/a.php`;
    const second = `${ROOT}/b.php`;
    const state = stateWithPaths([first, second]);
    const closeTextDocument = vi.fn((path: string) => {
      if (path === second) {
        throw new Error("close failed");
      }
    });
    const harness = renderLifecycle(
      state,
      {
        [first]: document(first),
        [second]: document(second),
      },
      { closeTextDocument },
    );
    const eslint = harness.eslintDiagnostics();
    const phpstan = harness.phpstanDiagnostics();

    await expect(harness.lifecycle.closeActiveEditorGroup()).resolves.toBe(
      "blocked",
    );

    expect(harness.editorGroupsRef.current).toBe(state);
    expect(harness.openPathsRef.current).toEqual([first, second]);
    expect(harness.eslintDiagnostics()).toBe(eslint);
    expect(harness.phpstanDiagnostics()).toBe(phpstan);
    harness.unmount();
  });

  it("closes clean and visual tabs without asking a decision", async () => {
    const cleanPath = `${ROOT}/clean.php`;
    const clean = renderLifecycle(stateWithPaths([cleanPath]), {
      [cleanPath]: document(cleanPath),
    });
    await expect(clean.lifecycle.closeDocument(cleanPath)).resolves.toBe(
      "closed",
    );
    expect(clean.decideDirtyClose).not.toHaveBeenCalled();
    clean.unmount();

    const imagePath = `${ROOT}/logo.png`;
    const image = renderLifecycle(stateWithPaths([imagePath]), {});
    image.imageTabsRef.current = {
      [imagePath]: {
        byteLength: 1,
        dataUrl: "data:image/png;base64,AA==",
        name: "logo.png",
        path: imagePath,
      },
    };
    await expect(image.lifecycle.closeDocument(imagePath)).resolves.toBe(
      "closed",
    );
    expect(image.imageTabsRef.current[imagePath]).toBeUndefined();
    expect(image.closeTextDocument).not.toHaveBeenCalled();
    image.unmount();
  });
});
