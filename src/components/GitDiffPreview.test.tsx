// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffHunk, GitFileDiff } from "../domain/git";
import { GitDiffPreview } from "./GitDiffPreview";

const gitDiffPreviewMocks = vi.hoisted(() => ({
  diffEditorMounted: vi.fn(),
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: () => {
    gitDiffPreviewMocks.diffEditorMounted();
    return <div data-testid="diff-editor" />;
  },
}));

describe("GitDiffPreview", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    gitDiffPreviewMocks.diffEditorMounted.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a README-style markdown diff through the plain DOM fallback", async () => {
    await renderPreview(readmeDiff());

    expect(host.querySelector('[data-testid="plain-git-diff"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="diff-editor"]')).toBeNull();
    expect(gitDiffPreviewMocks.diffEditorMounted).not.toHaveBeenCalled();
    expect(host.textContent).toContain("@@ -1 +1,3 @@");
    expect(host.textContent).toContain("# Project");
    expect(host.textContent).toContain("Updated docs");
  });

  it("coerces malformed null diff content to empty strings", async () => {
    await renderPreview({
      ...readmeDiff(),
      modifiedContent: null as unknown as string,
      originalContent: null as unknown as string,
    });

    expect(host.querySelector('[data-testid="plain-git-diff"]')).not.toBeNull();
    expect(host.textContent).toContain("No differences.");
  });

  it("renders a nonblank metadata diff for a rename with unchanged content", async () => {
    await renderPreview(renamedWithoutTextChangesDiff());

    expect(host.querySelector('[data-testid="plain-git-diff"]')).not.toBeNull();
    expect(host.textContent).toContain("@@ Git file metadata @@");
    expect(host.textContent).toContain(
      "Renamed: src/OldName.ts -> src/NewName.ts",
    );
    expect(host.textContent).not.toContain("No differences.");
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

  it("scrolls plain changed rows when navigating changes", async () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    await renderPreview(diff());

    await act(async () => {
      queryButtonByTitle("Next change")?.click();
    });

    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "center", inline: "nearest" }),
    );
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

    expect(loadFileHunks).toHaveBeenCalledWith("src/example.ts", false);
    const checkboxes = hunkCheckboxes();
    expect(checkboxes).toHaveLength(2);

    await act(async () => {
      checkboxes[1].click();
    });

    expect(onStageHunk).toHaveBeenCalledWith("src/example.ts", 1);
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

    expect(onStageHunk).toHaveBeenCalledWith("src/example.ts", 0);
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

    expect(onStageHunk).toHaveBeenCalledWith("src/example.ts", 2);
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

    expect(onUnstageHunk).toHaveBeenCalledWith("src/example.ts", 1);
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

    expect(onStageHunk).toHaveBeenCalledWith("src/example.ts", 0);
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

    expect(onStageHunk).toHaveBeenCalledWith("src/example.ts", 0);
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
    expect(host.textContent).toContain("const value = 2;");

    await renderPreview(null, {
      loadFileHunks,
      onStageHunk: vi.fn(),
      onUnstageHunk: vi.fn(),
    });

    expect(hunkCheckboxes()).toHaveLength(0);
    expect(host.textContent).toContain("Select a changed file to preview diff.");
    expect(host.textContent).not.toContain("const value = 2;");
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

    expect(loadFileHunks).toHaveBeenCalledWith("src/example.ts", true);
    const checkboxes = hunkCheckboxes();
    expect(checkboxes).toHaveLength(1);

    await act(async () => {
      checkboxes[0].click();
    });

    expect(onUnstageHunk).toHaveBeenCalledWith("src/example.ts", 0);
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

  it("renders the plain diff when loadFileHunks rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const loadFileHunks = vi.fn(() =>
      Promise.reject(new Error("get_git_file_hunks failed")),
    );

    await renderPreview(diff(), {
      loadFileHunks,
      onStageHunk: vi.fn(),
      onUnstageHunk: vi.fn(),
    });

    expect(host.querySelector('[data-testid="plain-git-diff"]')).not.toBeNull();
    expect(hunkCheckboxes()).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledWith(
      "Loading git file hunks failed",
      expect.any(Error),
    );
  });

  it("renders the plain diff when loadFileHunks resolves malformed hunk data", async () => {
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

    expect(host.querySelector('[data-testid="plain-git-diff"]')).not.toBeNull();
    expect(hunkCheckboxes()).toHaveLength(1);
    expect(host.textContent).toContain("+1");
    expect(host.textContent).toContain("-1");
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
