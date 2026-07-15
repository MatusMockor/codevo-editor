// @vitest-environment jsdom

import { act, useEffect } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffHunk, GitFileDiff } from "../domain/git";
import { GitDiffPreview } from "./GitDiffPreview";

const gitDiffPreviewMocks = vi.hoisted(() => ({
  diffEditorProps: [] as Array<Record<string, unknown>>,
  diffEditorMounted: vi.fn(),
  focus: vi.fn(),
  modifiedReveal: vi.fn(),
  modelLifecycles: [] as Array<{
    disposed: boolean;
    modifiedPath: string;
    originalPath: string;
  }>,
  originalReveal: vi.fn(),
  setPosition: vi.fn(),
  setupShikiTokenization: vi.fn(async (..._args: unknown[]) => {}),
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: function DiffEditorMock(props: Record<string, unknown>) {
    gitDiffPreviewMocks.diffEditorProps.push(props);
    gitDiffPreviewMocks.diffEditorMounted();

    useEffect(() => {
      const lifecycle = {
        disposed: false,
        modifiedPath: String(props.modifiedModelPath),
        originalPath: String(props.originalModelPath),
      };
      gitDiffPreviewMocks.modelLifecycles.push(lifecycle);

      return () => {
        lifecycle.disposed = true;
      };
    }, []);

    return <div data-testid="diff-editor" />;
  },
}));

vi.mock("../infrastructure/shikiHighlighter", () => ({
  applyImmediateFallbackTheme: vi.fn(),
  setupShikiTokenization: gitDiffPreviewMocks.setupShikiTokenization,
}));

describe("GitDiffPreview", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    gitDiffPreviewMocks.setupShikiTokenization.mockImplementation(
      async (..._args: unknown[]) => {},
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    gitDiffPreviewMocks.diffEditorProps.length = 0;
    gitDiffPreviewMocks.diffEditorMounted.mockReset();
    gitDiffPreviewMocks.focus.mockReset();
    gitDiffPreviewMocks.modifiedReveal.mockReset();
    gitDiffPreviewMocks.modelLifecycles.length = 0;
    gitDiffPreviewMocks.originalReveal.mockReset();
    gitDiffPreviewMocks.setPosition.mockReset();
    gitDiffPreviewMocks.setupShikiTokenization.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a README-style markdown diff through Monaco side-by-side", async () => {
    await renderPreview(readmeDiff());

    expect(host.querySelector('[data-testid="diff-editor"]')).not.toBeNull();
    expect(gitDiffPreviewMocks.diffEditorMounted).toHaveBeenCalled();
    expect(lastDiffEditorProps()).toMatchObject({
      language: "markdown",
      modified: "# Project\n\nUpdated docs\n",
      original: "# Project\n",
      theme: "calm-dark",
    });
    expect(lastDiffEditorProps().options).toMatchObject({
      diffAlgorithm: "advanced",
      readOnly: true,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
    });
  });

  it("coerces malformed null diff content to empty strings", async () => {
    await renderPreview({
      ...readmeDiff(),
      modifiedContent: null as unknown as string,
      originalContent: null as unknown as string,
    });

    expect(host.querySelector('[data-testid="diff-editor"]')).toBeNull();
    expect(host.textContent).toContain("No differences");
  });

  it("renders a nonblank metadata diff for a rename with unchanged content", async () => {
    await renderPreview(renamedWithoutTextChangesDiff());

    expect(host.querySelector('[data-testid="diff-editor"]')).toBeNull();
    expect(host.textContent).toContain("File metadata changed");
    expect(host.textContent).toContain(
      "Renamed: src/OldName.ts -> src/NewName.ts",
    );
  });

  it("uses stable model URIs scoped by surface, side, and absolute path", async () => {
    await renderPreview(diff());

    expect(lastDiffEditorProps().originalModelPath).toMatch(
      /^codevo-git-diff:\/\/\/worktree\/original\//,
    );
    expect(lastDiffEditorProps().modifiedModelPath).toMatch(
      /^codevo-git-diff:\/\/\/worktree\/modified\//,
    );
    expect(lastDiffEditorProps().originalModelPath).toContain(
      encodeURIComponent("/workspace/src/example.ts"),
    );

    await renderPreview({
      ...diff(),
      change: { ...diff().change, isStaged: true },
    });

    expect(lastDiffEditorProps().originalModelPath).toContain("/staged/original/");
    expect(lastDiffEditorProps().modifiedModelPath).toContain("/staged/modified/");
  });

  it("disposes prior Monaco models when model paths change without losing hunk UI", async () => {
    const loadFileHunks = vi.fn(async () => [
      { header: "@@ -1 +1 @@", index: 0, lines: ["-a", "+A"], isStaged: false },
    ]);
    await renderPreview(diff(), { loadFileHunks });
    const firstLifecycle = gitDiffPreviewMocks.modelLifecycles[0];

    expect(firstLifecycle?.disposed).toBe(false);
    expect(hunkCheckboxes()).toHaveLength(1);

    await renderPreview({
      ...diff(),
      change: {
        ...diff().change,
        path: "/workspace/src/other.ts",
        relativePath: "src/other.ts",
      },
    }, { loadFileHunks });

    expect(firstLifecycle?.disposed).toBe(true);
    expect(gitDiffPreviewMocks.modelLifecycles).toHaveLength(2);
    expect(gitDiffPreviewMocks.modelLifecycles[1]?.disposed).toBe(false);
    expect(gitDiffPreviewMocks.modelLifecycles[1]?.modifiedPath).toContain(
      encodeURIComponent("/workspace/src/other.ts"),
    );
    expect(hunkCheckboxes()).toHaveLength(1);
  });

  it("prevents stale Shiki setup from overwriting a newer theme", async () => {
    const monaco = {};
    await renderPreview(diff());
    beforeMount()(monaco);
    const staleGuard = themeGuard(0);

    expect(staleGuard()).toBe(true);

    await renderPreview(diff(), { monacoTheme: "calm-light" });

    expect(gitDiffPreviewMocks.setupShikiTokenization).toHaveBeenCalledTimes(2);
    expect(staleGuard()).toBe(false);
    expect(themeGuard(1)()).toBe(true);
  });

  it("renders next/previous change and revert toolbar buttons", async () => {
    const onRevertFile = vi.fn();
    const current = diff();
    await renderPreview(current, { onRevertFile });

    expect(queryButtonByTitle("Next change")).not.toBeNull();
    expect(queryButtonByTitle("Previous change")).not.toBeNull();
    expect(queryButtonByTitle("Revert file")).not.toBeNull();

    await act(async () => {
      queryButtonByTitle("Revert file")?.click();
    });

    expect(onRevertFile).toHaveBeenCalledWith(current.change);
  });

  it("navigates Monaco logical line changes instead of individual rows", async () => {
    await renderPreview(diff());
    await mountDiffEditor([
      lineChange(2, 2),
      lineChange(20, 24),
    ]);

    await act(async () => {
      queryButtonByTitle("Next change")?.click();
    });

    expect(gitDiffPreviewMocks.originalReveal).toHaveBeenCalledWith(20);
    expect(gitDiffPreviewMocks.modifiedReveal).toHaveBeenCalledWith(24);
    expect(gitDiffPreviewMocks.setPosition).toHaveBeenCalledWith({
      column: 1,
      lineNumber: 24,
    });
    expect(gitDiffPreviewMocks.focus).toHaveBeenCalledTimes(1);
  });

  it("renders a stage checkbox per worktree hunk and stages the clicked hunk", async () => {
    const loadFileHunks = vi.fn(async () => [
      { header: "@@ -1 +1 @@", index: 0, lines: ["-a", "+A"], isStaged: false },
      { header: "@@ -5 +5 @@", index: 1, lines: ["-e", "+E"], isStaged: false },
    ]);
    const onStageHunk = vi.fn();

    await renderPreview(diff(), {
      loadFileHunks,
      onStageHunk,
      onUnstageHunk: vi.fn(),
    });

    expect(loadFileHunks).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "src/example.ts" }),
      false,
    );
    const checkboxes = hunkCheckboxes();
    expect(checkboxes).toHaveLength(2);

    await act(async () => {
      checkboxes[1].click();
    });

    expect(onStageHunk).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "src/example.ts" }),
      1,
    );
  });

  it("stages the first of several worktree hunks", async () => {
    const loadFileHunks = vi.fn(async () => threeHunks(false));
    const onStageHunk = vi.fn();

    await renderPreview(diff(), {
      loadFileHunks,
      onStageHunk,
      onUnstageHunk: vi.fn(),
    });

    const checkboxes = hunkCheckboxes();
    expect(checkboxes).toHaveLength(3);

    await act(async () => {
      checkboxes[0].click();
    });

    expect(onStageHunk).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "src/example.ts" }),
      0,
    );
  });

  it("stages the last of several worktree hunks", async () => {
    const loadFileHunks = vi.fn(async () => threeHunks(false));
    const onStageHunk = vi.fn();

    await renderPreview(diff(), {
      loadFileHunks,
      onStageHunk,
      onUnstageHunk: vi.fn(),
    });

    const checkboxes = hunkCheckboxes();
    expect(checkboxes).toHaveLength(3);

    await act(async () => {
      checkboxes[2].click();
    });

    expect(onStageHunk).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "src/example.ts" }),
      2,
    );
  });

  it("unstages the middle of several staged hunks", async () => {
    const loadFileHunks = vi.fn(async () => threeHunks(true));
    const onUnstageHunk = vi.fn();

    await renderPreview(
      { ...diff(), change: { ...diff().change, isStaged: true } },
      {
        loadFileHunks,
        onStageHunk: vi.fn(),
        onUnstageHunk,
      },
    );

    const checkboxes = hunkCheckboxes();
    expect(checkboxes).toHaveLength(3);

    await act(async () => {
      checkboxes[1].click();
    });

    expect(onUnstageHunk).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "src/example.ts" }),
      1,
    );
  });

  it("renders only additions for a pure-add hunk and stages it", async () => {
    const loadFileHunks = vi.fn(async () => [
      {
        header: "@@ -3,0 +4,2 @@",
        index: 0,
        lines: ["+added one", "+added two"],
        isStaged: false,
      },
    ]);
    const onStageHunk = vi.fn();

    await renderPreview(diff(), {
      loadFileHunks,
      onStageHunk,
      onUnstageHunk: vi.fn(),
    });

    const hunk = document.querySelector(".git-diff-hunk");
    expect(hunk?.textContent).toContain("+2");
    expect(hunk?.querySelector(".git-diff-hunk-removed")).toBeNull();

    await act(async () => {
      hunkCheckboxes()[0].click();
    });

    expect(onStageHunk).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "src/example.ts" }),
      0,
    );
  });

  it("renders only deletions for a pure-delete hunk and stages it", async () => {
    const loadFileHunks = vi.fn(async () => [
      {
        header: "@@ -4,2 +3,0 @@",
        index: 0,
        lines: ["-gone one", "-gone two"],
        isStaged: false,
      },
    ]);
    const onStageHunk = vi.fn();

    await renderPreview(diff(), {
      loadFileHunks,
      onStageHunk,
      onUnstageHunk: vi.fn(),
    });

    const hunk = document.querySelector(".git-diff-hunk");
    expect(hunk?.textContent).toContain("-2");
    expect(hunk?.querySelector(".git-diff-hunk-added")).toBeNull();

    await act(async () => {
      hunkCheckboxes()[0].click();
    });

    expect(onStageHunk).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "src/example.ts" }),
      0,
    );
  });

  it("does not render the hunk list for a deleted (binary-like absent diff) change", async () => {
    const loadFileHunks = vi.fn(async () => []);

    await renderPreview(
      { ...diff(), change: { ...diff().change, status: "deleted" } },
      {
        loadFileHunks,
        onStageHunk: vi.fn(),
        onUnstageHunk: vi.fn(),
      },
    );

    // A deleted file with no parseable text hunks must keep the hunk list empty
    // rather than rendering a phantom toggle that cannot map to a hunk index.
    expect(hunkCheckboxes()).toHaveLength(0);
  });

  it("clears loaded hunks and diff rows when rerendered without a diff", async () => {
    const loadFileHunks = vi.fn(async () => [
      { header: "@@ -1 +1 @@", index: 0, lines: ["-a", "+A"], isStaged: false },
    ]);

    await renderPreview(diff(), {
      loadFileHunks,
      onStageHunk: vi.fn(),
      onUnstageHunk: vi.fn(),
    });

    expect(hunkCheckboxes()).toHaveLength(1);
    expect(lastDiffEditorProps().modified).toBe("const value = 2;\n");

    await renderPreview(null, {
      loadFileHunks,
      onStageHunk: vi.fn(),
      onUnstageHunk: vi.fn(),
    });

    expect(hunkCheckboxes()).toHaveLength(0);
    expect(host.textContent).toContain("Select a changed file to preview diff.");
    expect(host.querySelector('[data-testid="diff-editor"]')).toBeNull();
  });

  it("unstages the clicked hunk when the change is staged", async () => {
    const loadFileHunks = vi.fn(async () => [
      { header: "@@ -1 +1 @@", index: 0, lines: ["-a", "+A"], isStaged: true },
    ]);
    const onUnstageHunk = vi.fn();

    await renderPreview(
      { ...diff(), change: { ...diff().change, isStaged: true } },
      {
        loadFileHunks,
        onStageHunk: vi.fn(),
        onUnstageHunk,
      },
    );

    expect(loadFileHunks).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "src/example.ts", isStaged: true }),
      true,
    );
    const checkboxes = hunkCheckboxes();
    expect(checkboxes).toHaveLength(1);

    await act(async () => {
      checkboxes[0].click();
    });

    expect(onUnstageHunk).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "src/example.ts", isStaged: true }),
      0,
    );
  });

  it("does not render the hunk list for untracked changes", async () => {
    const loadFileHunks = vi.fn(async () => []);

    await renderPreview(
      {
        ...diff(),
        change: { ...diff().change, status: "untracked", isUnversioned: true },
      },
      {
        loadFileHunks,
        onStageHunk: vi.fn(),
        onUnstageHunk: vi.fn(),
      },
    );

    expect(loadFileHunks).not.toHaveBeenCalled();
    expect(hunkCheckboxes()).toHaveLength(0);
  });

  it("disables hunk checkboxes while a git operation is running", async () => {
    const loadFileHunks = vi.fn(async () => [
      { header: "@@ -1 +1 @@", index: 0, lines: ["-a", "+A"], isStaged: false },
    ]);
    const onStageHunk = vi.fn();

    await renderPreview(diff(), {
      gitOperationLoading: true,
      loadFileHunks,
      onStageHunk,
      onUnstageHunk: vi.fn(),
    });

    const checkboxes = hunkCheckboxes();
    expect(checkboxes).toHaveLength(1);
    expect(checkboxes[0].disabled).toBe(true);

    await act(async () => {
      checkboxes[0].click();
    });

    expect(onStageHunk).not.toHaveBeenCalled();
  });

  it("keeps the Monaco diff when loadFileHunks rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const loadFileHunks = vi.fn(() =>
      Promise.reject(new Error("get_git_file_hunks failed")),
    );

    await renderPreview(diff(), {
      loadFileHunks,
      onStageHunk: vi.fn(),
      onUnstageHunk: vi.fn(),
    });

    expect(host.querySelector('[data-testid="diff-editor"]')).not.toBeNull();
    expect(hunkCheckboxes()).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledWith(
      "Loading git file hunks failed",
      expect.any(Error),
    );
  });

  it("keeps the Monaco diff when loadFileHunks resolves malformed hunk data", async () => {
    const loadFileHunks = vi.fn(
      () =>
        Promise.resolve([
          null,
          {
            header: "@@ -1 +1 @@",
            index: 0,
            lines: ["-a", null, "+A"],
            isStaged: false,
          },
          {
            header: "@@ -9 +9 @@",
            index: "bad",
            lines: ["+x"],
            isStaged: false,
          },
          {
            header: "@@ -20 +20 @@",
            index: 2,
            lines: null,
            isStaged: false,
          },
        ]) as unknown as Promise<GitDiffHunk[]>,
    );

    await renderPreview(diff(), {
      loadFileHunks,
      onStageHunk: vi.fn(),
      onUnstageHunk: vi.fn(),
    });

    expect(host.querySelector('[data-testid="diff-editor"]')).not.toBeNull();
    expect(hunkCheckboxes()).toHaveLength(1);
    expect(host.textContent).toContain("+1");
    expect(host.textContent).toContain("-1");
  });

  it("uses a safe fallback for binary payloads", async () => {
    await renderPreview({
      ...diff(),
      modifiedContent: "binary\0payload",
    });

    expect(host.querySelector('[data-testid="diff-editor"]')).toBeNull();
    expect(host.textContent).toContain("Binary diff");
    expect(host.textContent).toContain("cannot be previewed");
  });

  it("uses a safe fallback for conservatively large payloads", async () => {
    await renderPreview({
      ...diff(),
      modifiedContent: "x".repeat(2_000_001),
    });

    expect(host.querySelector('[data-testid="diff-editor"]')).toBeNull();
    expect(host.textContent).toContain("Large diff");
    expect(host.textContent).toContain("too large");
  });

  it("uses the backend binary marker without receiving binary content", async () => {
    await renderPreview({
      ...diff(),
      modifiedContent: "",
      originalContent: "",
      previewUnavailableReason: "binary",
    });

    expect(host.querySelector('[data-testid="diff-editor"]')).toBeNull();
    expect(host.textContent).toContain("Binary diff");
    expect(host.textContent).toContain("cannot be previewed");
  });

  it("uses the backend large marker without receiving a large IPC payload", async () => {
    const loadFileHunks = vi.fn(async () => [
      { header: "@@ -1 +1 @@", index: 0, isStaged: false, lines: ["-a", "+b"] },
    ]);
    await renderPreview({
      ...diff(),
      modifiedContent: "",
      originalContent: "",
      previewUnavailableReason: "large",
    }, {
      loadFileHunks,
    });

    expect(host.querySelector('[data-testid="diff-editor"]')).toBeNull();
    expect(host.textContent).toContain("Large diff");
    expect(host.textContent).toContain("too large");
    expect(loadFileHunks).not.toHaveBeenCalled();
  });

  async function renderPreview(
    current: GitFileDiff | null,
    overrides: Partial<ComponentProps<typeof GitDiffPreview>> = {},
  ): Promise<void> {
    await act(async () => {
      root.render(
        <GitDiffPreview
          diff={current}
          isLoading={false}
          monacoTheme="calm-dark"
          onClose={vi.fn()}
          {...overrides}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }
});

function hunkCheckboxes(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '.git-diff-hunk input[type="checkbox"]',
    ),
  );
}

function lastDiffEditorProps(): Record<string, unknown> & {
  modifiedModelPath: string;
  options: Record<string, unknown>;
  originalModelPath: string;
} {
  const props =
    gitDiffPreviewMocks.diffEditorProps[
      gitDiffPreviewMocks.diffEditorProps.length - 1
    ];
  if (!props) {
    throw new Error("DiffEditor was not rendered");
  }

  return props as ReturnType<typeof lastDiffEditorProps>;
}

function beforeMount(): (monaco: object) => void {
  return lastDiffEditorProps().beforeMount as (monaco: object) => void;
}

function themeGuard(callIndex: number): () => boolean {
  const options = gitDiffPreviewMocks.setupShikiTokenization.mock.calls[
    callIndex
  ]?.[2] as { shouldApply?: unknown } | undefined;
  const shouldApply = options?.shouldApply;
  if (typeof shouldApply !== "function") {
    throw new Error("Expected a theme cancellation guard");
  }

  return shouldApply as () => boolean;
}

async function mountDiffEditor(changes: Array<Record<string, number>>): Promise<void> {
  const listeners: Array<() => void> = [];
  const editor = {
    getLineChanges: () => changes,
    getModifiedEditor: () => ({
      focus: gitDiffPreviewMocks.focus,
      revealLineInCenter: gitDiffPreviewMocks.modifiedReveal,
      setPosition: gitDiffPreviewMocks.setPosition,
    }),
    getOriginalEditor: () => ({
      revealLineInCenter: gitDiffPreviewMocks.originalReveal,
    }),
    onDidUpdateDiff: (listener: () => void) => {
      listeners.push(listener);
      return { dispose: vi.fn() };
    },
  };
  const onMount = lastDiffEditorProps().onMount as ((value: typeof editor) => void) | undefined;

  await act(async () => {
    onMount?.(editor);
  });
}

function lineChange(originalStart: number, modifiedStart: number): Record<string, number> {
  return {
    charChanges: 0,
    modifiedEndLineNumber: modifiedStart,
    modifiedStartLineNumber: modifiedStart,
    originalEndLineNumber: originalStart,
    originalStartLineNumber: originalStart,
  };
}

function queryButtonByTitle(title: string): HTMLButtonElement | null {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  );
  return buttons.find((button) => button.title === title) ?? null;
}

function threeHunks(isStaged: boolean): GitDiffHunk[] {
  return [
    { header: "@@ -1 +1 @@", index: 0, lines: ["-a", "+A"], isStaged },
    { header: "@@ -5 +5 @@", index: 1, lines: ["-e", "+E"], isStaged },
    { header: "@@ -9 +9 @@", index: 2, lines: ["-i", "+I"], isStaged },
  ];
}

function diff(): GitFileDiff {
  return {
    change: {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/workspace/src/example.ts",
      relativePath: "src/example.ts",
      status: "modified",
    },
    language: "typescript",
    modifiedContent: "const value = 2;\n",
    originalContent: "const value = 1;\n",
  };
}

function readmeDiff(): GitFileDiff {
  return {
    change: {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/workspace/README.md",
      relativePath: "README.md",
      status: "modified",
    },
    language: "markdown",
    modifiedContent: "# Project\n\nUpdated docs\n",
    originalContent: "# Project\n",
  };
}

function renamedWithoutTextChangesDiff(): GitFileDiff {
  return {
    change: {
      isStaged: false,
      isUnversioned: false,
      oldPath: "/workspace/src/OldName.ts",
      oldRelativePath: "src/OldName.ts",
      path: "/workspace/src/NewName.ts",
      relativePath: "src/NewName.ts",
      status: "renamed",
    },
    language: "typescript",
    modifiedContent: "export const value = 1;\n",
    originalContent: "export const value = 1;\n",
  };
}
