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
  monaco: null as FakeMonaco | null,
  props: null as
    | {
        beforeMount?: (monaco: unknown) => void;
        loading?: unknown;
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
      theme?: unknown;
    }) {
      React.useEffect(() => {
        if (!gitDiffPreviewMocks.monaco) {
          throw new Error("GitDiffPreview test Monaco mock was not prepared.");
        }

        gitDiffPreviewMocks.props = props;
        props.beforeMount?.(gitDiffPreviewMocks.monaco);
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
});

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
