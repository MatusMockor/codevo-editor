// @vitest-environment jsdom

import { act, StrictMode, useEffect, useLayoutEffect, useRef } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffHunk, GitFileDiff } from "../domain/git";
import { GitDiffPreview } from "./GitDiffPreview";

interface MockTextModel {
  attach(): void;
  detach(): void;
  dispose(): void;
  isDisposed(): boolean;
}

interface MockModelLifecycle {
  disposed: boolean;
  events: string[];
  modifiedPath: string;
  originalPath: string;
}

const gitDiffPreviewMocks = vi.hoisted(() => ({
  diffEditorProps: [] as Array<Record<string, unknown>>,
  diffEditorMounted: vi.fn(),
  diffListeners: [] as Array<() => void>,
  focus: vi.fn(),
  hunkWidgetLayouts: [] as Array<{ column: number; lineNumber: number } | null>,
  hunkWidgets: [] as Array<{
    getDomNode(): HTMLElement;
    getPosition(): { position: { column: number; lineNumber: number } } | null;
  }>,
  modifiedReveal: vi.fn(),
  modelLifecycles: [] as MockModelLifecycle[],
  modelRegistry: new Map<string, MockTextModel>(),
  originalReveal: vi.fn(),
  setPosition: vi.fn(),
  setupShikiTokenization: vi.fn(async (..._args: unknown[]) => {}),
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: function DiffEditorMock(props: Record<string, unknown>) {
    gitDiffPreviewMocks.diffEditorProps.push(props);
    gitDiffPreviewMocks.diffEditorMounted();
    const lifecycleRef = useRef<MockModelLifecycle | null>(null);

    useLayoutEffect(() => {
      const events: string[] = [];
      let attached = true;
      const acquireModel = (path: string, side: string): MockTextModel => {
        const existing = gitDiffPreviewMocks.modelRegistry.get(path);
        if (existing) {
          existing.attach();
          return existing;
        }

        let disposed = false;
        let attachmentCount = 0;
        const model: MockTextModel = {
          attach: () => {
            attachmentCount += 1;
          },
          detach: () => {
            attachmentCount -= 1;
          },
          dispose: () => {
            if (attachmentCount > 0) {
              throw new Error(
                "TextModel got disposed before DiffEditorWidget model got reset",
              );
            }

            events.push(`${side}-dispose`);
            disposed = true;
            gitDiffPreviewMocks.modelRegistry.delete(path);
          },
          isDisposed: () => disposed,
        };
        gitDiffPreviewMocks.modelRegistry.set(path, model);
        model.attach();
        return model;
      };
      const lifecycle = {
        disposed: false,
        events,
        modifiedPath: String(props.modifiedModelPath),
        originalPath: String(props.originalModelPath),
      };
      lifecycleRef.current = lifecycle;
      const originalModel = acquireModel(lifecycle.originalPath, "original");
      const modifiedModel = acquireModel(lifecycle.modifiedPath, "modified");
      const modifiedEditor = {
        addContentWidget: (widget: typeof gitDiffPreviewMocks.hunkWidgets[number]) => {
          gitDiffPreviewMocks.hunkWidgets.push(widget);
          document.body.append(widget.getDomNode());
        },
        getModel: () => ({ getLineCount: () => 100 }),
        layoutContentWidget: (widget: typeof gitDiffPreviewMocks.hunkWidgets[number]) => {
          gitDiffPreviewMocks.hunkWidgetLayouts.push(widget.getPosition()?.position ?? null);
        },
        removeContentWidget: (widget: typeof gitDiffPreviewMocks.hunkWidgets[number]) => {
          const index = gitDiffPreviewMocks.hunkWidgets.indexOf(widget);
          if (index >= 0) {
            gitDiffPreviewMocks.hunkWidgets.splice(index, 1);
          }
          widget.getDomNode().remove();
        },
      };
      const editor = {
        getLineChanges: () => [],
        getModifiedEditor: () => modifiedEditor,
        getModel: () => attached
          ? { modified: modifiedModel, original: originalModel }
          : null,
        onDidUpdateDiff: (listener: () => void) => {
          gitDiffPreviewMocks.diffListeners.push(listener);
          return { dispose: vi.fn() };
        },
        setModel: (next: unknown) => {
          if (next !== null) {
            return;
          }

          events.push("reset");
          attached = false;
          originalModel.detach();
          modifiedModel.detach();
        },
      };
      gitDiffPreviewMocks.modelLifecycles.push(lifecycle);
      const onMount = props.onMount as ((editor: unknown, monaco: object) => void) | undefined;
      onMount?.(editor, {});

      return undefined;
    }, []);

    useEffect(() => {
      const lifecycle = lifecycleRef.current;
      return () => {
        lifecycle?.events.push("editor-dispose");
        if (!props.keepCurrentOriginalModel || !props.keepCurrentModifiedModel) {
          throw new Error("DiffEditor wrapper retained model ownership");
        }

        if (!lifecycle?.events.includes("reset")) {
          throw new Error("DiffEditorWidget model was not reset before disposal");
        }

        if (lifecycle) {
          lifecycle.disposed = true;
        }
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
    gitDiffPreviewMocks.diffListeners.length = 0;
    gitDiffPreviewMocks.focus.mockReset();
    gitDiffPreviewMocks.hunkWidgetLayouts.length = 0;
    gitDiffPreviewMocks.hunkWidgets.length = 0;
    gitDiffPreviewMocks.modifiedReveal.mockReset();
    gitDiffPreviewMocks.modelLifecycles.length = 0;
    gitDiffPreviewMocks.modelRegistry.clear();
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

  it("isolates model URIs for concurrent previews of the same path", async () => {
    await renderConcurrentPreviews(true);
    const firstLifecycle = gitDiffPreviewMocks.modelLifecycles[0];
    const secondLifecycle = gitDiffPreviewMocks.modelLifecycles[1];

    expect(firstLifecycle?.originalPath).not.toBe(secondLifecycle?.originalPath);
    expect(firstLifecycle?.modifiedPath).not.toBe(secondLifecycle?.modifiedPath);
    expect(gitDiffPreviewMocks.modelRegistry.size).toBe(4);

    await renderConcurrentPreviews(false);

    expect(firstLifecycle?.disposed).toBe(true);
    expect(secondLifecycle?.disposed).toBe(false);
    expect(gitDiffPreviewMocks.modelRegistry.size).toBe(2);
  });

  it("includes commit history identity in model URIs", async () => {
    const firstIdentity = "mockor-git-history-diff:abc123:src/example.ts";
    await renderPreview(diff(), { previewIdentity: firstIdentity });
    const firstPath = gitDiffPreviewMocks.modelLifecycles[0]?.originalPath;

    const secondIdentity = "mockor-git-history-diff:def456:src/example.ts";
    await renderPreview(diff(), { previewIdentity: secondIdentity });
    const secondPath = gitDiffPreviewMocks.modelLifecycles[1]?.originalPath;

    expect(firstPath).toContain(encodeURIComponent(firstIdentity));
    expect(secondPath).toContain(encodeURIComponent(secondIdentity));
    expect(secondPath).not.toBe(firstPath);
  });

  it("disposes prior Monaco models and reanchors hunk widgets on replacement", async () => {
    const loadFileHunks = vi.fn(async () => [
      gitHunk(0, false),
    ]);
    await renderPreview(diff(), { loadFileHunks });
    const firstLifecycle = gitDiffPreviewMocks.modelLifecycles[0];
    const firstWidgetNode = gitDiffPreviewMocks.hunkWidgets[0]?.getDomNode();

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
    expect(firstWidgetNode?.isConnected).toBe(false);
    expect(gitDiffPreviewMocks.hunkWidgets).toHaveLength(1);
    expect(gitDiffPreviewMocks.modelLifecycles).toHaveLength(2);
    expect(gitDiffPreviewMocks.modelLifecycles[1]?.disposed).toBe(false);
    expect(gitDiffPreviewMocks.modelLifecycles[1]?.modifiedPath).toContain(
      encodeURIComponent("/workspace/src/other.ts"),
    );
    expect(hunkCheckboxes()).toHaveLength(1);
  });

  it("cannot stage the newly selected file through a stale widget while hunks load", async () => {
    const secondLoad = createDeferred<GitDiffHunk[]>();
    const loadFileHunks = vi.fn((change: GitFileDiff["change"]) => {
      if (change.path === "/workspace-a/src/example.ts") {
        return Promise.resolve([gitHunk(0, false)]);
      }

      return secondLoad.promise;
    });
    const onStageHunk = vi.fn();
    const first = {
      ...diff(),
      change: {
        ...diff().change,
        path: "/workspace-a/src/example.ts",
      },
    };
    const second = {
      ...diff(),
      change: {
        ...diff().change,
        path: "/workspace-b/src/example.ts",
      },
    };

    await renderPreview(first, {
      loadFileHunks,
      onStageHunk,
      previewIdentity: "mockor-git-diff:worktree:/workspace-a/src/example.ts",
    });
    const staleCheckbox = hunkCheckboxes()[0];
    expect(staleCheckbox).toBeDefined();

    await renderPreview(second, {
      loadFileHunks,
      onStageHunk,
      previewIdentity: "mockor-git-diff:worktree:/workspace-b/src/example.ts",
    });

    expect(hunkCheckboxes()).toHaveLength(0);
    expect(staleCheckbox.isConnected).toBe(false);
    await act(async () => {
      staleCheckbox.click();
    });
    expect(onStageHunk).not.toHaveBeenCalled();

    await act(async () => {
      secondLoad.resolve([gitHunk(0, false)]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hunkCheckboxes()).toHaveLength(1);

    await act(async () => {
      hunkCheckboxes()[0].click();
    });
    expect(onStageHunk).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/workspace-b/src/example.ts" }),
      0,
      "@@ -1 +1 @@\n-before\n+after",
    );
  });

  it("resets the diff widget before disposing replaced worktree models", async () => {
    await renderPreview(diff());
    const worktreeLifecycle = gitDiffPreviewMocks.modelLifecycles[0];

    await renderPreview({
      ...diff(),
      change: { ...diff().change, isStaged: true },
    });

    expect(worktreeLifecycle?.events).toEqual([
      "reset",
      "original-dispose",
      "modified-dispose",
      "editor-dispose",
    ]);
    expect(worktreeLifecycle?.disposed).toBe(true);
    expect(gitDiffPreviewMocks.modelLifecycles[1]?.disposed).toBe(false);
    expect(lastDiffEditorProps()).toMatchObject({
      keepCurrentModifiedModel: true,
      keepCurrentOriginalModel: true,
    });
  });

  it("reacquires private models across repeated worktree and staged switches", async () => {
    await renderPreview(diff());
    const firstWorktree = gitDiffPreviewMocks.modelLifecycles[0];

    await renderPreview({
      ...diff(),
      change: { ...diff().change, isStaged: true },
    });
    const staged = gitDiffPreviewMocks.modelLifecycles[1];

    await renderPreview(diff());
    const secondWorktree = gitDiffPreviewMocks.modelLifecycles[2];

    expect(firstWorktree?.disposed).toBe(true);
    expect(staged?.disposed).toBe(true);
    expect(secondWorktree?.disposed).toBe(false);
    expect(secondWorktree?.originalPath).toBe(firstWorktree?.originalPath);
    expect(secondWorktree?.modifiedPath).toBe(firstWorktree?.modifiedPath);
    expect(gitDiffPreviewMocks.modelRegistry.size).toBe(2);
  });

  it("keeps reset-before-dispose ordering through StrictMode unmounts", async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <GitDiffPreview
            diff={diff()}
            isLoading={false}
            monacoTheme="calm-dark"
            onClose={vi.fn()}
          />
        </StrictMode>,
      );
      await Promise.resolve();
    });

    act(() => root.unmount());

    expect(gitDiffPreviewMocks.modelLifecycles.length).toBeGreaterThanOrEqual(2);
    expect(gitDiffPreviewMocks.modelRegistry.size).toBe(0);
    for (const lifecycle of gitDiffPreviewMocks.modelLifecycles) {
      expect(lifecycle.disposed).toBe(true);
      expect(lifecycle.events.indexOf("reset")).toBeLessThan(
        lifecycle.events.indexOf("original-dispose"),
      );
      expect(lifecycle.events.indexOf("modified-dispose")).toBeLessThan(
        lifecycle.events.indexOf("editor-dispose"),
      );
    }
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

  it("removes destructive revert actions from a staged preview", async () => {
    const onRevertFile = vi.fn();
    const onRevertHunk = vi.fn();
    await renderPreview(
      { ...diff(), change: { ...diff().change, isStaged: true } },
      {
        loadFileHunks: vi.fn(async () => [gitHunk(0, true)]),
        onRevertFile,
        onRevertHunk,
        onUnstageHunk: vi.fn(),
      },
    );

    expect(queryButtonByTitle("Revert file")).toBeNull();
    expect(hunkRevertButtons()).toHaveLength(0);
    expect(hunkCheckboxes()[0]?.getAttribute("aria-label")).toBe(
      "Unstage hunk 1",
    );
  });

  it("disables file and hunk revert when the editor document is dirty", async () => {
    const onRevertFile = vi.fn();
    const onRevertHunk = vi.fn();
    await renderPreview(diff(), {
      canRevertChange: false,
      loadFileHunks: vi.fn(async () => [gitHunk(0, false)]),
      onRevertFile,
      onRevertHunk,
      onStageHunk: vi.fn(),
    });

    const fileButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Revert file"]',
    );
    const hunkButton = hunkRevertButtons()[0];
    const stageCheckbox = hunkCheckboxes()[0];
    expect(fileButton?.disabled).toBe(true);
    expect(fileButton?.title).toBe("Save or discard editor changes first");
    expect(hunkButton?.disabled).toBe(true);
    expect(hunkButton?.title).toBe("Save or discard editor changes first");
    expect(stageCheckbox?.disabled).toBe(false);
    expect(stageCheckbox?.getAttribute("aria-label")).toBe("Stage hunk 1");

    await act(async () => {
      fileButton?.click();
      hunkButton?.click();
    });
    expect(onRevertFile).not.toHaveBeenCalled();
    expect(onRevertHunk).not.toHaveBeenCalled();
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
      gitHunk(0, false),
      gitHunk(1, false),
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
    expect(checkboxes[0].getAttribute("aria-label")).toBe("Stage hunk 1");
    expect(checkboxes[0].title).toBe("Stage hunk 1");
    expect(gitDiffPreviewMocks.hunkWidgets.map((widget) => widget.getPosition()?.position)).toEqual([
      { column: 1, lineNumber: 1 },
      { column: 1, lineNumber: 5 },
    ]);

    await act(async () => {
      gitDiffPreviewMocks.diffListeners[0]?.();
    });
    expect(gitDiffPreviewMocks.hunkWidgetLayouts).toEqual([
      { column: 1, lineNumber: 1 },
      { column: 1, lineNumber: 5 },
    ]);

    await act(async () => {
      checkboxes[1].click();
    });

    expect(onStageHunk).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "src/example.ts" }),
      1,
      "@@ -5 +5 @@\n-before\n+after",
    );
  });

  it("reverts the selected worktree hunk with its verified identity", async () => {
    const onRevertHunk = vi.fn();
    await renderPreview(diff(), {
      loadFileHunks: vi.fn(async () => threeHunks(false)),
      onRevertHunk,
      onStageHunk: vi.fn(),
    });

    const buttons = hunkRevertButtons();
    expect(buttons).toHaveLength(3);
    expect(buttons[1]?.getAttribute("aria-label")).toBe("Revert hunk 2");

    await act(async () => {
      buttons[1]?.click();
    });

    expect(onRevertHunk).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "src/example.ts" }),
      1,
      "@@ -5 +5 @@\n-before\n+after",
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
      "@@ -1 +1 @@\n-before\n+after",
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
      "@@ -9 +9 @@\n-before\n+after",
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
      "@@ -5 +5 @@\n-before\n+after",
    );
  });

  it("anchors a pure-add hunk to its modified start and stages it", async () => {
    const added = {
      ...gitHunk(0, false, {
        modifiedCount: 2,
        modifiedStart: 4,
        originalCount: 0,
        originalStart: 3,
      }),
      header: "@@ -3,0 +4,2 @@",
      identity: "@@ -3,0 +4,2 @@\n+added one\n+added two",
      lines: ["+added one", "+added two"],
    };
    const loadFileHunks = vi.fn(async () => [added]);
    const onStageHunk = vi.fn();

    await renderPreview(diff(), {
      loadFileHunks,
      onStageHunk,
      onUnstageHunk: vi.fn(),
    });

    expect(gitDiffPreviewMocks.hunkWidgets[0]?.getPosition()?.position).toEqual({
      column: 1,
      lineNumber: 4,
    });

    await act(async () => {
      hunkCheckboxes()[0].click();
    });

    expect(onStageHunk).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "src/example.ts" }),
      0,
      "@@ -3,0 +4,2 @@\n+added one\n+added two",
    );
  });

  it("anchors a pure-delete hunk to its modified insertion point and stages it", async () => {
    const deleted = {
      ...gitHunk(0, false, {
        modifiedCount: 0,
        modifiedStart: 3,
        originalCount: 2,
        originalStart: 4,
      }),
      header: "@@ -4,2 +3,0 @@",
      identity: "@@ -4,2 +3,0 @@\n-gone one\n-gone two",
      lines: ["-gone one", "-gone two"],
    };
    const loadFileHunks = vi.fn(async () => [deleted]);
    const onStageHunk = vi.fn();

    await renderPreview(diff(), {
      loadFileHunks,
      onStageHunk,
      onUnstageHunk: vi.fn(),
    });

    expect(gitDiffPreviewMocks.hunkWidgets[0]?.getPosition()?.position).toEqual({
      column: 1,
      lineNumber: 3,
    });

    await act(async () => {
      hunkCheckboxes()[0].click();
    });

    expect(onStageHunk).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "src/example.ts" }),
      0,
      "@@ -4,2 +3,0 @@\n-gone one\n-gone two",
    );
  });

  it("does not render hunk widgets for a deleted (binary-like absent diff) change", async () => {
    const loadFileHunks = vi.fn(async () => []);

    await renderPreview(
      { ...diff(), change: { ...diff().change, status: "deleted" } },
      {
        loadFileHunks,
        onStageHunk: vi.fn(),
        onUnstageHunk: vi.fn(),
      },
    );

    // A deleted file with no parseable text hunks must keep the widget set empty
    // rather than rendering a phantom toggle that cannot map to a hunk index.
    expect(hunkCheckboxes()).toHaveLength(0);
  });

  it("clears loaded hunks and diff rows when rerendered without a diff", async () => {
    const loadFileHunks = vi.fn(async () => [
      gitHunk(0, false),
    ]);

    await renderPreview(diff(), {
      loadFileHunks,
      onStageHunk: vi.fn(),
      onUnstageHunk: vi.fn(),
    });

    expect(hunkCheckboxes()).toHaveLength(1);
    const widgetNode = gitDiffPreviewMocks.hunkWidgets[0]?.getDomNode();
    expect(lastDiffEditorProps().modified).toBe("const value = 2;\n");

    await renderPreview(null, {
      loadFileHunks,
      onStageHunk: vi.fn(),
      onUnstageHunk: vi.fn(),
    });

    expect(hunkCheckboxes()).toHaveLength(0);
    expect(gitDiffPreviewMocks.hunkWidgets).toHaveLength(0);
    expect(widgetNode?.isConnected).toBe(false);
    expect(host.textContent).toContain("Select a changed file to preview diff.");
    expect(host.querySelector('[data-testid="diff-editor"]')).toBeNull();
  });

  it("unstages the clicked hunk when the change is staged", async () => {
    const loadFileHunks = vi.fn(async () => [
      gitHunk(0, true),
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
      "@@ -1 +1 @@\n-before\n+after",
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
      gitHunk(0, false),
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
            identity: "@@ -1 +1 @@\n-a\n+A",
            index: 0,
            lines: ["-a", null, "+A"],
            isStaged: false,
            modifiedCount: 1,
            modifiedStart: 1,
            originalCount: 1,
            originalStart: 1,
          },
          {
            header: "@@ -9 +9 @@",
            identity: "",
            index: 1,
            lines: ["-x", "+y"],
            isStaged: false,
            modifiedCount: 1,
            modifiedStart: 9,
            originalCount: 1,
            originalStart: 9,
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
    expect(hunkCheckboxes()[0].getAttribute("aria-label")).toBe("Stage hunk 1");
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
      gitHunk(0, false),
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

  async function renderConcurrentPreviews(showFirst: boolean): Promise<void> {
    await act(async () => {
      root.render(
        <>
          {showFirst ? (
            <GitDiffPreview
              diff={diff()}
              isLoading={false}
              key="first"
              monacoTheme="calm-dark"
              onClose={vi.fn()}
              previewIdentity="worktree:src/example.ts"
            />
          ) : null}
          <GitDiffPreview
            diff={diff()}
            isLoading={false}
            key="second"
            monacoTheme="calm-dark"
            onClose={vi.fn()}
            previewIdentity="worktree:src/example.ts"
          />
        </>,
      );
      await Promise.resolve();
    });
  }

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

function hunkRevertButtons(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '.git-diff-hunk button[aria-label^="Revert hunk"]',
    ),
  );
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function gitHunk(
  index: number,
  isStaged: boolean,
  ranges: Partial<Pick<GitDiffHunk, "modifiedCount" | "modifiedStart" | "originalCount" | "originalStart">> = {},
): GitDiffHunk {
  const line = index * 4 + 1;
  return {
    header: `@@ -${line} +${line} @@`,
    identity: `@@ -${line} +${line} @@\n-before\n+after`,
    index,
    isStaged,
    lines: ["-before", "+after"],
    modifiedCount: 1,
    modifiedStart: line,
    originalCount: 1,
    originalStart: line,
    ...ranges,
  };
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
  return [gitHunk(0, isStaged), gitHunk(1, isStaged), gitHunk(2, isStaged)];
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
