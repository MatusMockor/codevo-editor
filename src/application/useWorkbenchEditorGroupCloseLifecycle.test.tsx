// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  createInitialEditorGroupsState,
  editorGroupsReducer,
  type EditorGroupsState,
} from "../domain/editorGroups";
import type { EditorDocument, ImageTab } from "../domain/workspace";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import type { EslintDiagnosticsByRoot } from "../domain/eslintDiagnostics";
import type { PhpstanDiagnosticsByRoot } from "../domain/phpstanDiagnostics";
import {
  useWorkbenchEditorGroupCloseLifecycle,
  type WorkbenchEditorGroupCloseLifecycle,
  type WorkbenchEditorGroupCloseLifecycleDependencies,
} from "./useWorkbenchEditorGroupCloseLifecycle";

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

function splitState(path: string): EditorGroupsState {
  const initial = createInitialEditorGroupsState("editor-main", {
    activePath: path,
    openPaths: [path],
    previewPath: null,
  });
  return editorGroupsReducer(initial, {
    type: "split-group",
    direction: "right",
    newGroupId: "editor-side",
  });
}

interface Harness {
  activeDocumentRef: { current: EditorDocument | null };
  closeTextDocument: ReturnType<typeof vi.fn>;
  closeTextSurface: ReturnType<typeof vi.fn>;
  currentWorkspaceRootRef: { current: string | null };
  editorGroupsRef: { current: EditorGroupsState };
  eslintDiagnostics: () => EslintDiagnosticsByRoot;
  imageTabsRef: { current: Record<string, ImageTab> };
  lifecycle: () => WorkbenchEditorGroupCloseLifecycle;
  openPathsRef: { current: string[] };
  phpstanDiagnostics: () => PhpstanDiagnosticsByRoot;
  prompter: WorkbenchEditorGroupCloseLifecycleDependencies["prompter"];
  setEslintDiagnosticsByRoot: ReturnType<typeof vi.fn>;
  setPhpstanDiagnosticsByRoot: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderLifecycle(
  state: EditorGroupsState,
  documents: Record<string, EditorDocument>,
  overrides: Partial<WorkbenchEditorGroupCloseLifecycleDependencies> = {},
): Harness {
  const container = globalThis.document.createElement("div");
  const root = createRoot(container);
  const captured: { lifecycle: WorkbenchEditorGroupCloseLifecycle | null } = {
    lifecycle: null,
  };
  const currentWorkspaceRootRef = { current: ROOT as string | null };
  const editorGroupsRef = { current: state };
  const activeGroup = state.groups[state.activeGroupId];
  const openPathsRef = { current: activeGroup?.openPaths ?? [] };
  const previewPathRef = { current: activeGroup?.previewPath ?? null };
  const activeDocumentRef = {
    current: activeGroup?.activePath
      ? documents[activeGroup.activePath] ?? null
      : null,
  };
  const documentsRef = { current: documents };
  const imageTabsRef: { current: Record<string, ImageTab> } = { current: {} };
  const markdownPreviewTabsRef: {
    current: Record<string, MarkdownPreviewTab>;
  } = { current: {} };
  const closeTextDocument = vi.fn();
  const closeTextSurface = vi.fn();
  const prompter = {
    confirm: vi.fn(() => true),
    prompt: vi.fn(),
  };
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
  const setEslintDiagnosticsByRoot = vi.fn(
    (update: Parameters<
      WorkbenchEditorGroupCloseLifecycleDependencies["setEslintDiagnosticsByRoot"]
    >[0]) => {
      eslintDiagnostics =
        typeof update === "function" ? update(eslintDiagnostics) : update;
    },
  );
  const setPhpstanDiagnosticsByRoot = vi.fn(
    (update: Parameters<
      WorkbenchEditorGroupCloseLifecycleDependencies["setPhpstanDiagnosticsByRoot"]
    >[0]) => {
      phpstanDiagnostics =
        typeof update === "function" ? update(phpstanDiagnostics) : update;
    },
  );

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
      imageTabsRef.current =
        typeof update === "function" ? update(imageTabsRef.current) : update;
    },
    setMarkdownPreviewTabs: (update) => {
      markdownPreviewTabsRef.current =
        typeof update === "function"
          ? update(markdownPreviewTabsRef.current)
          : update;
    },
    setEslintDiagnosticsByRoot,
    setPhpstanDiagnosticsByRoot,
    updateEditorGroups: (update) => {
      editorGroupsRef.current = update(editorGroupsRef.current);
    },
    closeTextDocument,
    closeTextSurface,
    hasExternalFileConflict: vi.fn(() => false),
    prompter,
    ...overrides,
  };

  function TestComponent() {
    captured.lifecycle = useWorkbenchEditorGroupCloseLifecycle(dependencies);
    return null;
  }

  act(() => {
    root.render(<TestComponent />);
  });

  return {
    activeDocumentRef,
    closeTextDocument,
    closeTextSurface,
    currentWorkspaceRootRef,
    editorGroupsRef,
    eslintDiagnostics: () => eslintDiagnostics,
    imageTabsRef,
    lifecycle: () => {
      if (!captured.lifecycle) {
        throw new Error("Lifecycle not rendered");
      }
      return captured.lifecycle;
    },
    openPathsRef,
    phpstanDiagnostics: () => phpstanDiagnostics,
    prompter: dependencies.prompter,
    setEslintDiagnosticsByRoot,
    setPhpstanDiagnosticsByRoot,
    unmount: () => root.unmount(),
  };
}

const textClosePaths = [
  {
    name: "ordinary tab close",
    close: (harness: Harness, path: string) =>
      harness.lifecycle().closeDocument(path),
    expectAccepted: (harness: Harness, path: string) => {
      expect(harness.closeTextDocument).toHaveBeenCalledOnce();
      expect(harness.closeTextDocument).toHaveBeenCalledWith(path, {
        skipConfirmation: true,
      });
      expect(harness.closeTextSurface).not.toHaveBeenCalled();
    },
  },
  {
    name: "active surface close",
    close: (harness: Harness) => harness.lifecycle().closeActiveSurface(),
    expectAccepted: (harness: Harness) => {
      expect(harness.closeTextDocument).not.toHaveBeenCalled();
      expect(harness.closeTextSurface).toHaveBeenCalledOnce();
      expect(harness.closeTextSurface).toHaveBeenCalledWith({
        skipConfirmation: true,
      });
    },
  },
];

describe("useWorkbenchEditorGroupCloseLifecycle", () => {
  it("removes split group membership without closing the shared document", () => {
    const path = `${ROOT}/shared.php`;
    const harness = renderLifecycle(splitState(path), {
      [path]: editorDocument(path),
    });

    act(() => {
      harness.lifecycle().closeDocumentInEditorGroup("editor-side", path);
    });

    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(harness.prompter.confirm).not.toHaveBeenCalled();
    expect(
      harness.editorGroupsRef.current.groups["editor-side"]?.openPaths,
    ).toEqual([]);
    expect(
      harness.editorGroupsRef.current.groups["editor-main"]?.openPaths,
    ).toEqual([path]);

    harness.unmount();
  });

  it("closes image tabs locally without closing a text document", () => {
    const path = `${ROOT}/logo.png`;
    const state = createInitialEditorGroupsState("editor-main", {
      activePath: path,
      openPaths: [path],
      previewPath: null,
    });
    const harness = renderLifecycle(state, {});
    harness.imageTabsRef.current = {
      [path]: {
        byteLength: 12,
        dataUrl: "data:image/png;base64,AA==",
        name: "logo.png",
        path,
      },
    };

    act(() => {
      harness.lifecycle().closeDocument(path);
    });

    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(harness.imageTabsRef.current[path]).toBeUndefined();
    expect(harness.openPathsRef.current).toEqual([]);
    expect(
      harness.editorGroupsRef.current.groups["editor-main"]?.activePath,
    ).toBeNull();

    harness.unmount();
  });

  it.each(textClosePaths)(
    "clears diagnostics once after an accepted $name",
    ({ close, expectAccepted }) => {
      const path = `${ROOT}/dirty.php`;
      const state = createInitialEditorGroupsState("editor-main", {
        activePath: path,
        openPaths: [path],
        previewPath: null,
      });
      const harness = renderLifecycle(state, {
        [path]: editorDocument(path, "edited", "saved"),
      });

      act(() => close(harness, path));

      expect(harness.prompter.confirm).toHaveBeenCalledOnce();
      expectAccepted(harness, path);
      expect(harness.setEslintDiagnosticsByRoot).toHaveBeenCalledOnce();
      expect(harness.setPhpstanDiagnosticsByRoot).toHaveBeenCalledOnce();
      expect(harness.eslintDiagnostics()[ROOT]?.[path]).toBeUndefined();
      expect(harness.phpstanDiagnostics()[ROOT]?.[path]).toBeUndefined();

      harness.unmount();
    },
  );

  it.each(
    textClosePaths.flatMap((closePath) => [
      {
        ...closePath,
        attention: "dirty",
        document: (path: string) => editorDocument(path, "edited", "saved"),
        expectedPrompt: "Discard changes?",
        hasExternalFileConflict: vi.fn(() => false),
      },
      {
        ...closePath,
        attention: "conflict",
        document: (path: string) => editorDocument(path),
        expectedPrompt: "Close file with an unresolved external conflict?",
        hasExternalFileConflict: vi.fn(() => true),
      },
    ]),
  )(
    "does not clear diagnostics or mutate state when a $attention $name is declined",
    ({ close, document, expectedPrompt, hasExternalFileConflict }) => {
      const path = `${ROOT}/attention.php`;
      const state = createInitialEditorGroupsState("editor-main", {
        activePath: path,
        openPaths: [path],
        previewPath: null,
      });
      const harness = renderLifecycle(
        state,
        { [path]: document(path) },
        {
          hasExternalFileConflict,
          prompter: { confirm: vi.fn(() => false), prompt: vi.fn() },
        },
      );
      const editorGroups = harness.editorGroupsRef.current;
      const activeDocument = harness.activeDocumentRef.current;
      const openPaths = harness.openPathsRef.current;
      const eslintDiagnostics = harness.eslintDiagnostics();
      const phpstanDiagnostics = harness.phpstanDiagnostics();

      act(() => close(harness, path));

      expect(harness.prompter.confirm).toHaveBeenCalledOnce();
      expect(harness.prompter.confirm).toHaveBeenCalledWith(expectedPrompt);
      expect(harness.closeTextDocument).not.toHaveBeenCalled();
      expect(harness.closeTextSurface).not.toHaveBeenCalled();
      expect(harness.setEslintDiagnosticsByRoot).not.toHaveBeenCalled();
      expect(harness.setPhpstanDiagnosticsByRoot).not.toHaveBeenCalled();
      expect(harness.editorGroupsRef.current).toBe(editorGroups);
      expect(harness.activeDocumentRef.current).toBe(activeDocument);
      expect(harness.openPathsRef.current).toBe(openPaths);
      expect(harness.eslintDiagnostics()).toBe(eslintDiagnostics);
      expect(harness.phpstanDiagnostics()).toBe(phpstanDiagnostics);

      harness.unmount();
    },
  );

  it.each(textClosePaths)(
    "uses a same-tick live root switch when preflighting a conflict-only $name",
    ({ close }) => {
      const nextRoot = "/next-workspace";
      const path = `${nextRoot}/conflict.php`;
      const state = createInitialEditorGroupsState("editor-main", {
        activePath: path,
        openPaths: [path],
        previewPath: null,
      });
      const hasExternalFileConflict = vi.fn(
        (rootPath: string | null, conflictPath: string) =>
          rootPath === nextRoot && conflictPath === path,
      );
      const harness = renderLifecycle(
        state,
        { [path]: editorDocument(path) },
        {
          hasExternalFileConflict,
          prompter: { confirm: vi.fn(() => false), prompt: vi.fn() },
        },
      );
      const editorGroups = harness.editorGroupsRef.current;
      const activeDocument = harness.activeDocumentRef.current;
      const openPaths = harness.openPathsRef.current;
      const eslintDiagnostics = harness.eslintDiagnostics();
      const phpstanDiagnostics = harness.phpstanDiagnostics();

      act(() => {
        harness.currentWorkspaceRootRef.current = nextRoot;
        close(harness, path);
      });

      expect(hasExternalFileConflict).toHaveBeenCalledOnce();
      expect(hasExternalFileConflict).toHaveBeenCalledWith(nextRoot, path);
      expect(harness.prompter.confirm).toHaveBeenCalledOnce();
      expect(harness.prompter.confirm).toHaveBeenCalledWith(
        "Close file with an unresolved external conflict?",
      );
      expect(harness.closeTextDocument).not.toHaveBeenCalled();
      expect(harness.closeTextSurface).not.toHaveBeenCalled();
      expect(harness.setEslintDiagnosticsByRoot).not.toHaveBeenCalled();
      expect(harness.setPhpstanDiagnosticsByRoot).not.toHaveBeenCalled();
      expect(harness.editorGroupsRef.current).toBe(editorGroups);
      expect(harness.activeDocumentRef.current).toBe(activeDocument);
      expect(harness.openPathsRef.current).toBe(openPaths);
      expect(harness.eslintDiagnostics()).toBe(eslintDiagnostics);
      expect(harness.phpstanDiagnostics()).toBe(phpstanDiagnostics);

      harness.unmount();
    },
  );

  it("prompts once before final dirty membership close", () => {
    const path = `${ROOT}/dirty.php`;
    const state = createInitialEditorGroupsState("editor-main", {
      activePath: path,
      openPaths: [path],
      previewPath: null,
    });
    const harness = renderLifecycle(state, {
      [path]: editorDocument(path, "edited", "saved"),
    });

    act(() => {
      harness.lifecycle().closeActiveEditorGroup();
    });

    expect(harness.prompter.confirm).toHaveBeenCalledTimes(1);
    expect(harness.closeTextDocument).toHaveBeenCalledWith(path, {
      skipConfirmation: true,
    });
    expect(harness.setEslintDiagnosticsByRoot).toHaveBeenCalledOnce();
    expect(harness.setPhpstanDiagnosticsByRoot).toHaveBeenCalledOnce();
    expect(harness.eslintDiagnostics()[ROOT]?.[path]).toBeUndefined();
    expect(harness.phpstanDiagnostics()[ROOT]?.[path]).toBeUndefined();

    harness.unmount();
  });

  it("keeps active state and diagnostics when final dirty membership close is declined", () => {
    const activePath = `${ROOT}/active.php`;
    const closingPath = `${ROOT}/dirty.php`;
    const state = splitState(activePath);
    state.activeGroupId = "editor-main";
    state.groups["editor-side"] = {
      activePath: closingPath,
      openPaths: [closingPath],
      previewPath: null,
    };
    const harness = renderLifecycle(
      state,
      {
        [activePath]: editorDocument(activePath),
        [closingPath]: editorDocument(closingPath, "edited", "saved"),
      },
      { prompter: { confirm: vi.fn(() => false), prompt: vi.fn() } },
    );
    const eslintDiagnostics = harness.eslintDiagnostics();
    const phpstanDiagnostics = harness.phpstanDiagnostics();

    act(() => {
      harness
        .lifecycle()
        .closeDocumentInEditorGroup("editor-side", closingPath);
    });

    expect(harness.prompter.confirm).toHaveBeenCalledWith("Discard changes?");
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(harness.editorGroupsRef.current.activeGroupId).toBe("editor-main");
    expect(
      harness.editorGroupsRef.current.groups["editor-main"]?.activePath,
    ).toBe(activePath);
    expect(
      harness.editorGroupsRef.current.groups["editor-side"]?.activePath,
    ).toBe(closingPath);
    expect(harness.activeDocumentRef.current?.path).toBe(activePath);
    expect(harness.openPathsRef.current).toEqual([activePath]);
    expect(harness.eslintDiagnostics()).toBe(eslintDiagnostics);
    expect(harness.phpstanDiagnostics()).toBe(phpstanDiagnostics);

    harness.unmount();
  });

  it("keeps active state and diagnostics when final conflict membership close is declined", () => {
    const activePath = `${ROOT}/active.php`;
    const closingPath = `${ROOT}/conflict.php`;
    const state = splitState(activePath);
    state.activeGroupId = "editor-main";
    state.groups["editor-side"] = {
      activePath: closingPath,
      openPaths: [closingPath],
      previewPath: null,
    };
    const harness = renderLifecycle(
      state,
      {
        [activePath]: editorDocument(activePath),
        [closingPath]: editorDocument(closingPath),
      },
      {
        hasExternalFileConflict: vi.fn(
          (_rootPath, path) => path === closingPath,
        ),
        prompter: { confirm: vi.fn(() => false), prompt: vi.fn() },
      },
    );
    const eslintDiagnostics = harness.eslintDiagnostics();
    const phpstanDiagnostics = harness.phpstanDiagnostics();

    act(() => {
      harness
        .lifecycle()
        .closeDocumentInEditorGroup("editor-side", closingPath);
    });

    expect(harness.prompter.confirm).toHaveBeenCalledWith(
      "Close file with an unresolved external conflict?",
    );
    expect(harness.closeTextDocument).not.toHaveBeenCalled();
    expect(harness.editorGroupsRef.current.activeGroupId).toBe("editor-main");
    expect(
      harness.editorGroupsRef.current.groups["editor-main"]?.activePath,
    ).toBe(activePath);
    expect(
      harness.editorGroupsRef.current.groups["editor-side"]?.activePath,
    ).toBe(closingPath);
    expect(harness.activeDocumentRef.current?.path).toBe(activePath);
    expect(harness.openPathsRef.current).toEqual([activePath]);
    expect(harness.eslintDiagnostics()).toBe(eslintDiagnostics);
    expect(harness.phpstanDiagnostics()).toBe(phpstanDiagnostics);

    harness.unmount();
  });
});
