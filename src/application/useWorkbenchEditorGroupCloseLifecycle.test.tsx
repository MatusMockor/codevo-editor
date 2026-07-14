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
  closeTextDocument: ReturnType<typeof vi.fn>;
  editorGroupsRef: { current: EditorGroupsState };
  imageTabsRef: { current: Record<string, ImageTab> };
  lifecycle: () => WorkbenchEditorGroupCloseLifecycle;
  openPathsRef: { current: string[] };
  prompter: {
    confirm: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
  };
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
  const prompter = {
    confirm: vi.fn(() => true),
    prompt: vi.fn(),
  };
  let eslintDiagnostics: EslintDiagnosticsByRoot = {};
  let phpstanDiagnostics: PhpstanDiagnosticsByRoot = {};

  const dependencies: WorkbenchEditorGroupCloseLifecycleDependencies = {
    workspaceRoot: ROOT,
    currentWorkspaceRootRef: { current: ROOT },
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
    setEslintDiagnosticsByRoot: (update) => {
      eslintDiagnostics =
        typeof update === "function" ? update(eslintDiagnostics) : update;
    },
    setPhpstanDiagnosticsByRoot: (update) => {
      phpstanDiagnostics =
        typeof update === "function" ? update(phpstanDiagnostics) : update;
    },
    updateEditorGroups: (update) => {
      editorGroupsRef.current = update(editorGroupsRef.current);
    },
    closeTextDocument,
    closeTextSurface: vi.fn(),
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
    closeTextDocument,
    editorGroupsRef,
    imageTabsRef,
    lifecycle: () => {
      if (!captured.lifecycle) {
        throw new Error("Lifecycle not rendered");
      }
      return captured.lifecycle;
    },
    openPathsRef,
    prompter,
    unmount: () => root.unmount(),
  };
}

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

    harness.unmount();
  });
});
