// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { GitChangedFile } from "../domain/git";
import { emptyGitStatus } from "../domain/git";
import { emptyRecentlyClosedTabs } from "../domain/recentlyClosedTabs";
import type { EditorDocument } from "../domain/workspace";
import { nextActiveEditorPathAfterClose } from "../domain/workspace";
import {
  useDocumentCloseLifecycle,
  type DocumentCloseLifecycle,
  type DocumentCloseLifecycleDependencies,
  type DocumentCloseSessionPort,
} from "./useDocumentCloseLifecycle";

const ROOT = "/workspace";

function editorDocument(
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

function changedFile(path: string): GitChangedFile {
  return {
    isStaged: false,
    isUnversioned: false,
    oldPath: null,
    oldRelativePath: null,
    path,
    relativePath: path.replace(`${ROOT}/`, ""),
    status: "modified",
  };
}

function diffPath(change: GitChangedFile): string {
  return `mockor-git-diff:worktree:${change.path}`;
}

type TestDependencies = DocumentCloseLifecycleDependencies & {
  activeDocument: EditorDocument | null;
  activePath: string | null;
  activeDocumentRef: { current: EditorDocument | null };
  documentsRef: { current: Record<string, EditorDocument> };
  openPathsRef: { current: string[] };
  previewPathRef: { current: string | null };
};

interface Harness {
  dependencies: TestDependencies;
  lifecycle: () => DocumentCloseLifecycle;
  rerender: (overrides?: Partial<TestDependencies>) => void;
  unmount: () => void;
}

function renderLifecycle(
  overrides: Partial<TestDependencies> = {},
): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { current: DocumentCloseLifecycle | null } = {
    current: null,
  };
  const defaultDocument = editorDocument(`${ROOT}/src/A.php`);
  const activeDocument =
    "activeDocument" in overrides
      ? (overrides.activeDocument ?? null)
      : defaultDocument;
  const documentsRef = overrides.documentsRef ?? {
    current: activeDocument ? { [activeDocument.path]: activeDocument } : {},
  };
  const openPathsRef = overrides.openPathsRef ?? {
    current: activeDocument ? [activeDocument.path] : [],
  };
  const previewPathRef = overrides.previewPathRef ?? { current: null };
  const activeDocumentRef = overrides.activeDocumentRef ?? {
    current: activeDocument,
  };
  const currentWorkspaceRootRef = overrides.currentWorkspaceRootRef ?? {
    current: ROOT,
  };
  const recentlyClosedTabsRef = overrides.recentlyClosedTabsRef ?? {
    current: emptyRecentlyClosedTabs(),
  };
  const documentTabSession: DocumentCloseSessionPort =
    overrides.documentTabSession ??
    {
      getActivePath: vi.fn(() => activeDocumentRef.current?.path ?? null),
      getDocument: vi.fn((path: string) => documentsRef.current[path] ?? null),
      removeDocument: vi.fn((path: string) => {
        const removedDocument = documentsRef.current[path] ?? null;
        const activePath = activeDocumentRef.current?.path ?? null;

        if (!removedDocument) {
          return {
            closedActiveDocument: false,
            nextActivePath: activePath,
            removedDocument: null,
          };
        }

        const closedActiveDocument = activePath === path;
        const nextActivePath = closedActiveDocument
          ? nextActiveEditorPathAfterClose(
              path,
              openPathsRef.current,
              previewPathRef.current,
            )
          : activePath;
        const nextDocuments = { ...documentsRef.current };
        delete nextDocuments[path];
        documentsRef.current = nextDocuments;
        openPathsRef.current = openPathsRef.current.filter(
          (openPath) => openPath !== path,
        );
        if (previewPathRef.current === path) {
          previewPathRef.current = null;
        }
        if (closedActiveDocument) {
          activeDocumentRef.current = nextActivePath
            ? (nextDocuments[nextActivePath] ?? null)
            : null;
        }

        return { closedActiveDocument, nextActivePath, removedDocument };
      }),
    };

  const dependencies: TestDependencies = {
    workspaceRoot: ROOT,
    activeDocument,
    activePath: activeDocument?.path ?? null,
    gitStatus: emptyGitStatus(),
    selectedGitChange: null,
    gitDiffLoading: false,
    documentTabSession,
    currentWorkspaceRootRef,
    activeDocumentRef,
    documentsRef,
    openPathsRef,
    previewPathRef,
    externallyRemovedDocumentRootByPathRef: { current: {} },
    gitDiffRequestTokenRef: { current: 0 },
    selectedGitChangeRef: { current: null },
    recentlyClosedTabsRef,
    setGitDiffLoading: vi.fn(),
    setSelectedGitChange: vi.fn(),
    setGitDiffPreview: vi.fn(),
    setMessage: vi.fn(),
    prompter: { confirm: vi.fn(() => true), prompt: vi.fn() },
    invalidateDocumentSave: vi.fn(),
    syncClosedDocument: vi.fn(async () => undefined),
    syncClosedJavaScriptTypeScriptDocument: vi.fn(async () => undefined),
    clearPhpLocalDiagnosticsForPath: vi.fn(),
    clearLanguageServerDiagnosticsForPath: vi.fn(),
    hasExternalFileConflict: vi.fn(() => false),
    clearExternalFileConflict: vi.fn(),
    loadGitDiffDocument: vi.fn(),
    closeGitDiffPreview: vi.fn(),
    closeEmptyWorkbenchSurface: vi.fn(),
    isGitDiffDocumentPath: (path) => path.startsWith("mockor-git-diff:"),
    gitChangeForDiffDocumentPath: () => null,
    recentlyClosedDocumentViewState: () => undefined,
    openRecentlyClosedDocument: vi.fn(async () => true),
    restoreRecentlyClosedDocumentViewState: vi.fn(),
    onRecentlyClosedTabsChange: vi.fn(),
    ...overrides,
  };

  function TestComponent() {
    captured.current = useDocumentCloseLifecycle(dependencies);
    return null;
  }

  const rerender = (
    nextOverrides: Partial<TestDependencies> = {},
  ) => {
    Object.assign(dependencies, nextOverrides);
    act(() => root.render(<TestComponent />));
  };
  rerender();

  return {
    dependencies,
    lifecycle: () => {
      if (!captured.current) {
        throw new Error("lifecycle not mounted");
      }
      return captured.current;
    },
    rerender,
    unmount: () => act(() => root.unmount()),
  };
}

describe("useDocumentCloseLifecycle", () => {
  it("does not invalidate a pending save when close is declined", () => {
    const dirty = editorDocument(`${ROOT}/src/Dirty.php`, "edited", "saved");
    const harness = renderLifecycle({
      activeDocument: dirty,
      activePath: dirty.path,
      activeDocumentRef: { current: dirty },
      documentsRef: { current: { [dirty.path]: dirty } },
      openPathsRef: { current: [dirty.path] },
      prompter: { confirm: vi.fn(() => false), prompt: vi.fn() },
    });

    act(() => harness.lifecycle().closeDocument(dirty.path));

    expect(harness.dependencies.invalidateDocumentSave).not.toHaveBeenCalled();
    expect(harness.dependencies.syncClosedDocument).not.toHaveBeenCalled();
    expect(
      harness.dependencies.documentTabSession.removeDocument,
    ).not.toHaveBeenCalled();
    expect(harness.dependencies.documentsRef.current[dirty.path]).toBe(dirty);
    harness.unmount();
  });

  it("runs confirmation, invalidation, recent, cleanup, then removal", () => {
    const change = changedFile(`${ROOT}/src/Ordered.php`);
    const path = diffPath(change);
    const dirty = editorDocument(path, "edited", "saved");
    const confirm = vi.fn(() => true);
    const harness = renderLifecycle({
      activeDocument: dirty,
      activePath: path,
      activeDocumentRef: { current: dirty },
      documentsRef: { current: { [path]: dirty } },
      openPathsRef: { current: [path] },
      gitStatus: { ...emptyGitStatus(), changes: [change] },
      prompter: { confirm, prompt: vi.fn() },
    });

    act(() => harness.lifecycle().closeDocument(path));

    const callOrder = [
      confirm,
      harness.dependencies.invalidateDocumentSave,
      harness.dependencies.onRecentlyClosedTabsChange,
      harness.dependencies.syncClosedDocument,
      harness.dependencies.clearPhpLocalDiagnosticsForPath,
      harness.dependencies.setGitDiffLoading,
      harness.dependencies.documentTabSession.removeDocument,
    ].map((mock) => vi.mocked(mock).mock.invocationCallOrder[0]);
    expect(callOrder).toEqual([...callOrder].sort((left, right) => left - right));
    expect(
      harness.dependencies.documentTabSession.removeDocument,
    ).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it("invalidates synchronously before LSP close and live ref mutation", () => {
    const active = editorDocument(`${ROOT}/src/Active.php`);
    const syncClosedDocument = vi.fn(async () => undefined);
    const documentsRef = { current: { [active.path]: active } };
    const activeDocumentRef = { current: active };
    const invalidateDocumentSave = vi.fn(() => {
      expect(syncClosedDocument).not.toHaveBeenCalled();
      expect(documentsRef.current[active.path]).toBe(active);
      expect(activeDocumentRef.current).toBe(active);
    });
    const harness = renderLifecycle({
      activeDocument: active,
      activePath: active.path,
      activeDocumentRef,
      documentsRef,
      openPathsRef: { current: [active.path] },
      invalidateDocumentSave,
      syncClosedDocument,
    });

    act(() => harness.lifecycle().closeDocument(active.path));

    expect(invalidateDocumentSave).toHaveBeenCalledWith(ROOT, active.path);
    expect(invalidateDocumentSave.mock.invocationCallOrder[0]).toBeLessThan(
      syncClosedDocument.mock.invocationCallOrder[0],
    );
    expect(invalidateDocumentSave.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(harness.dependencies.documentTabSession.removeDocument).mock
        .invocationCallOrder[0],
    );
    expect(
      harness.dependencies.documentTabSession.removeDocument,
    ).toHaveBeenCalledOnce();
    expect(documentsRef.current[active.path]).toBeUndefined();
    expect(activeDocumentRef.current).toBeNull();
    harness.unmount();
  });

  it.each([
    {
      conflict: false,
      content: "edited",
      expected: "Discard changes?",
    },
    {
      conflict: true,
      content: "saved",
      expected: "Close file with an unresolved external conflict?",
    },
  ])(
    "uses the $expected close confirmation",
    ({ conflict, content, expected }) => {
      const active = editorDocument(`${ROOT}/src/Prompt.php`, content, "saved");
      const confirm = vi.fn(() => false);
      const harness = renderLifecycle({
        activeDocument: active,
        activePath: active.path,
        activeDocumentRef: { current: active },
        documentsRef: { current: { [active.path]: active } },
        openPathsRef: { current: [active.path] },
        hasExternalFileConflict: vi.fn(() => conflict),
        prompter: { confirm, prompt: vi.fn() },
      });

      act(() => harness.lifecycle().closeDocument(active.path));

      expect(confirm).toHaveBeenCalledWith(expected);
      harness.unmount();
    },
  );

  it("clears a closed git diff and reselects the neighboring diff", () => {
    const firstChange = changedFile(`${ROOT}/src/First.php`);
    const secondChange = changedFile(`${ROOT}/src/Second.php`);
    const firstPath = diffPath(firstChange);
    const secondPath = diffPath(secondChange);
    const first = { ...editorDocument(firstPath), readOnly: true };
    const second = { ...editorDocument(secondPath), readOnly: true };
    const harness = renderLifecycle({
      activeDocument: first,
      activePath: firstPath,
      activeDocumentRef: { current: first },
      documentsRef: { current: { [firstPath]: first, [secondPath]: second } },
      openPathsRef: { current: [firstPath, secondPath] },
      previewPathRef: { current: firstPath },
      gitStatus: {
        ...emptyGitStatus(),
        changes: [firstChange, secondChange],
      },
      selectedGitChange: firstChange,
      selectedGitChangeRef: { current: firstChange },
      gitChangeForDiffDocumentPath: (path, changes) =>
        changes.find((change) => diffPath(change) === path) ?? null,
    });

    act(() => harness.lifecycle().closeDocument(firstPath));

    expect(harness.dependencies.setSelectedGitChange).toHaveBeenCalledWith(
      null,
    );
    expect(harness.dependencies.loadGitDiffDocument).toHaveBeenCalledWith(
      secondPath,
      secondChange,
    );
    expect(harness.dependencies.activeDocumentRef.current).toBe(second);
    expect(harness.dependencies.openPathsRef.current).toEqual([secondPath]);
    harness.unmount();
  });

  it("closes the live active document for Cmd+W before rerender", () => {
    const first = editorDocument(`${ROOT}/src/First.php`);
    const second = editorDocument(`${ROOT}/src/Second.php`);
    const harness = renderLifecycle({
      activeDocument: first,
      activePath: first.path,
      activeDocumentRef: { current: first },
      documentsRef: { current: { [first.path]: first } },
      openPathsRef: { current: [first.path] },
    });
    harness.dependencies.documentsRef.current = {
      [first.path]: first,
      [second.path]: second,
    };
    harness.dependencies.openPathsRef.current = [first.path, second.path];
    harness.dependencies.activeDocumentRef.current = second;

    act(() => harness.lifecycle().closeActiveSurface());

    expect(
      harness.dependencies.documentTabSession.getActivePath,
    ).toHaveBeenCalled();
    expect(harness.dependencies.invalidateDocumentSave).toHaveBeenCalledWith(
      ROOT,
      second.path,
    );
    expect(harness.dependencies.syncClosedDocument).toHaveBeenCalledWith(
      second,
    );
    expect(harness.dependencies.activeDocumentRef.current).toBe(first);
    harness.unmount();
  });

  it("drops a reopen result after the workspace root switches", async () => {
    let resolveOpen!: (opened: boolean) => void;
    const openRecentlyClosedDocument = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const active = editorDocument(`${ROOT}/src/Reopen.php`);
    const harness = renderLifecycle({
      activeDocument: active,
      activePath: active.path,
      activeDocumentRef: { current: active },
      documentsRef: { current: { [active.path]: active } },
      openPathsRef: { current: [active.path] },
      recentlyClosedDocumentViewState: () => ({ line: 12, column: 4 }),
      openRecentlyClosedDocument,
    });
    act(() => harness.lifecycle().closeDocument(active.path));
    harness.rerender();
    expect(harness.lifecycle().canReopenClosedDocument).toBe(true);

    let reopening!: Promise<void>;
    act(() => {
      reopening = harness.lifecycle().reopenClosedDocument();
    });
    harness.dependencies.currentWorkspaceRootRef.current = "/other";
    await act(async () => {
      resolveOpen(true);
      await reopening;
    });

    expect(
      harness.dependencies.restoreRecentlyClosedDocumentViewState,
    ).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("skips a failed reopen and tries the next closed document", async () => {
    const available = editorDocument(`${ROOT}/src/Available.php`);
    const missing = editorDocument(`${ROOT}/src/Missing.php`);
    const openRecentlyClosedDocument = vi.fn(
      async (_root: string, path: string) => path === available.path,
    );
    const harness = renderLifecycle({ openRecentlyClosedDocument });

    harness.dependencies.documentsRef.current = { [available.path]: available };
    harness.dependencies.openPathsRef.current = [available.path];
    harness.dependencies.activeDocumentRef.current = available;
    act(() => harness.lifecycle().closeDocument(available.path));
    harness.dependencies.documentsRef.current = { [missing.path]: missing };
    harness.dependencies.openPathsRef.current = [missing.path];
    harness.dependencies.activeDocumentRef.current = missing;
    act(() => harness.lifecycle().closeDocument(missing.path));

    await act(async () => harness.lifecycle().reopenClosedDocument());

    expect(openRecentlyClosedDocument.mock.calls).toEqual([
      [ROOT, missing.path],
      [ROOT, available.path],
    ]);
    harness.unmount();
  });
});
