// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitFileDiff } from "../domain/git";
import { GitDiffPreview } from "./GitDiffPreview";

interface FakeMonaco {
  editor: {
    setTheme: ReturnType<typeof vi.fn>;
  };
  languages: {
    register: ReturnType<typeof vi.fn>;
    getLanguages: ReturnType<typeof vi.fn>;
    setLanguageConfiguration: ReturnType<typeof vi.fn>;
  };
}

const gitDiffPreviewMocks = vi.hoisted(() => ({
  diffEditor: {
    updateOptions: vi.fn(),
    goToDiff: vi.fn() as unknown,
    getLineChanges: vi.fn() as unknown,
    getModifiedEditor: vi.fn() as unknown,
  },
  monaco: null as FakeMonaco | null,
  props: null as
    | {
        beforeMount?: (monaco: unknown) => void;
        loading?: unknown;
        onMount?: (editor: { updateOptions: ReturnType<typeof vi.fn> }) => void;
        options?: Record<string, unknown>;
        theme?: unknown;
      }
    | null,
}));

vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");

  return {
    DiffEditor: function DiffEditorMock(props: {
      beforeMount?: (monaco: unknown) => void;
      loading?: unknown;
      onMount?: (editor: { updateOptions: ReturnType<typeof vi.fn> }) => void;
      options?: Record<string, unknown>;
      theme?: unknown;
    }) {
      React.useEffect(() => {
        if (!gitDiffPreviewMocks.monaco) {
          throw new Error("GitDiffPreview test Monaco mock was not prepared.");
        }

        gitDiffPreviewMocks.props = props;
        props.beforeMount?.(gitDiffPreviewMocks.monaco);
        props.onMount?.(gitDiffPreviewMocks.diffEditor);
      }, [props]);

      return React.createElement("div", { "data-testid": "diff-editor" });
    },
  };
});

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
    gitDiffPreviewMocks.monaco = null;
    gitDiffPreviewMocks.props = null;
    gitDiffPreviewMocks.diffEditor.updateOptions.mockReset();
    gitDiffPreviewMocks.diffEditor.goToDiff = vi.fn();
    gitDiffPreviewMocks.diffEditor.getLineChanges = vi.fn();
    gitDiffPreviewMocks.diffEditor.getModifiedEditor = vi.fn();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("applies a synchronous dark fallback theme in beforeMount before Shiki loads", async () => {
    gitDiffPreviewMocks.monaco = createMonaco();

    await act(async () => {
      root.render(
        <GitDiffPreview
          diff={diff()}
          isLoading={false}
          monacoTheme="calm-dark"
          onClose={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    const beforeMount = gitDiffPreviewMocks.props?.beforeMount;
    expect(beforeMount).toBeTypeOf("function");
    expect(gitDiffPreviewMocks.monaco?.editor.setTheme).toHaveBeenCalledWith(
      "vs-dark",
    );
  });

  it("applies the light fallback theme for light app themes", async () => {
    gitDiffPreviewMocks.monaco = createMonaco();

    await act(async () => {
      root.render(
        <GitDiffPreview
          diff={diff()}
          isLoading={false}
          monacoTheme="catppuccin-latte"
          onClose={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    expect(gitDiffPreviewMocks.monaco?.editor.setTheme).toHaveBeenCalledWith(
      "vs",
    );
  });

  it("renders a dark loading placeholder instead of the default white Monaco loading box", async () => {
    gitDiffPreviewMocks.monaco = createMonaco();

    await act(async () => {
      root.render(
        <GitDiffPreview
          diff={diff()}
          isLoading={false}
          monacoTheme="calm-dark"
          onClose={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    const loading = gitDiffPreviewMocks.props?.loading;
    expect(loading).not.toBeNull();
    expect(loading).toBeDefined();
  });

  it("preserves the provided editor font family in Monaco diff options", async () => {
    gitDiffPreviewMocks.monaco = createMonaco();

    await act(async () => {
      root.render(
        <GitDiffPreview
          diff={diff()}
          editorFontFamily="Consolas, monospace"
          editorFontLigatures={true}
          editorFontSize={18}
          isLoading={false}
          monacoTheme="calm-dark"
          onClose={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    expect(gitDiffPreviewMocks.props?.options).toEqual(
      expect.objectContaining({
        fontFamily: "Consolas, monospace",
        fontLigatures: '"liga" on, "calt" on',
        fontSize: 18,
      }),
    );

    expect(gitDiffPreviewMocks.diffEditor.updateOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        fontFamily: "Consolas, monospace",
        fontLigatures: '"liga" on, "calt" on',
        fontSize: 18,
      }),
    );
  });

  it("renders next/previous change and revert toolbar buttons", async () => {
    gitDiffPreviewMocks.monaco = createMonaco();

    await act(async () => {
      root.render(
        <GitDiffPreview
          diff={diff()}
          isLoading={false}
          monacoTheme="calm-dark"
          onClose={vi.fn()}
          onRevertFile={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    expect(queryButtonByTitle("Next change")).not.toBeNull();
    expect(queryButtonByTitle("Previous change")).not.toBeNull();
    expect(queryButtonByTitle("Revert file")).not.toBeNull();
  });

  it("jumps to the next change via the diff editor goToDiff API", async () => {
    gitDiffPreviewMocks.monaco = createMonaco();
    const goToDiff = vi.fn();
    gitDiffPreviewMocks.diffEditor.goToDiff = goToDiff;

    await act(async () => {
      root.render(
        <GitDiffPreview
          diff={diff()}
          isLoading={false}
          monacoTheme="calm-dark"
          onClose={vi.fn()}
          onRevertFile={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      queryButtonByTitle("Next change")?.click();
    });

    expect(goToDiff).toHaveBeenCalledWith("next");
  });

  it("jumps to the previous change via the diff editor goToDiff API", async () => {
    gitDiffPreviewMocks.monaco = createMonaco();
    const goToDiff = vi.fn();
    gitDiffPreviewMocks.diffEditor.goToDiff = goToDiff;

    await act(async () => {
      root.render(
        <GitDiffPreview
          diff={diff()}
          isLoading={false}
          monacoTheme="calm-dark"
          onClose={vi.fn()}
          onRevertFile={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      queryButtonByTitle("Previous change")?.click();
    });

    expect(goToDiff).toHaveBeenCalledWith("previous");
  });

  it("falls back to getLineChanges navigation when goToDiff is unavailable", async () => {
    gitDiffPreviewMocks.monaco = createMonaco();
    const setPosition = vi.fn();
    const revealLineInCenter = vi.fn();
    const getPosition = vi.fn(() => ({ lineNumber: 1, column: 1 }));
    gitDiffPreviewMocks.diffEditor.goToDiff = undefined;
    gitDiffPreviewMocks.diffEditor.getLineChanges = vi.fn(() => [
      { modifiedStartLineNumber: 5, modifiedEndLineNumber: 5 },
      { modifiedStartLineNumber: 12, modifiedEndLineNumber: 14 },
    ]);
    gitDiffPreviewMocks.diffEditor.getModifiedEditor = vi.fn(() => ({
      getPosition,
      setPosition,
      revealLineInCenter,
      focus: vi.fn(),
    }));

    await act(async () => {
      root.render(
        <GitDiffPreview
          diff={diff()}
          isLoading={false}
          monacoTheme="calm-dark"
          onClose={vi.fn()}
          onRevertFile={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      queryButtonByTitle("Next change")?.click();
    });

    expect(setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ lineNumber: 5 }),
    );
    expect(revealLineInCenter).toHaveBeenCalledWith(5);
  });

  it("invokes the revert callback with the diff change", async () => {
    gitDiffPreviewMocks.monaco = createMonaco();
    const onRevertFile = vi.fn();
    const current = diff();

    await act(async () => {
      root.render(
        <GitDiffPreview
          diff={current}
          isLoading={false}
          monacoTheme="calm-dark"
          onClose={vi.fn()}
          onRevertFile={onRevertFile}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      queryButtonByTitle("Revert file")?.click();
    });

    expect(onRevertFile).toHaveBeenCalledWith(current.change);
  });
});

function queryButtonByTitle(title: string): HTMLButtonElement | null {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  );
  return buttons.find((button) => button.title === title) ?? null;
}

function createMonaco(): FakeMonaco {
  return {
    editor: {
      setTheme: vi.fn(),
    },
    languages: {
      register: vi.fn(),
      getLanguages: vi.fn(() => []),
      setLanguageConfiguration: vi.fn(),
    },
  };
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
