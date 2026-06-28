// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitFileDiff, GitFileHistoryEntry } from "../domain/git";
import { FileHistoryPanel } from "./FileHistoryPanel";

vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");

  return {
    DiffEditor: function DiffEditorMock() {
      return React.createElement("div", { "data-testid": "diff-editor" });
    },
  };
});

vi.mock("../infrastructure/shikiHighlighter", () => ({
  applyImmediateFallbackTheme: vi.fn(),
  setupShikiTokenization: vi.fn(async () => {}),
}));

describe("FileHistoryPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("renders nothing while closed", async () => {
    await renderPanel({ isOpen: false });

    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("lists commits for the active file", async () => {
    await renderPanel();

    const rows = commitRows();

    expect(rows).toHaveLength(2);
    expect(host.textContent).toContain("src/User.php");
    expect(rows[0].textContent).toContain("Add user model");
    expect(rows[0].textContent).toContain("1a2b3c4");
    expect(rows[0].textContent).toContain("Alice");
    expect(rows[1].textContent).toContain("Refactor user model");
  });

  it("shows an empty state when there are no commits", async () => {
    await renderPanel({ commits: [] });

    expect(host.textContent).toContain("No commits for this file");
  });

  it("requests the commit diff when a commit is clicked", async () => {
    const onSelectCommit = vi.fn();
    await renderPanel({ onSelectCommit });

    await act(async () => {
      commitRows()[1].click();
      await Promise.resolve();
    });

    expect(onSelectCommit).toHaveBeenCalledWith("f0e1d2c");
  });

  it("prompts to select a commit before any diff is loaded", async () => {
    await renderPanel({ diff: null, selectedSha: null });

    expect(host.textContent).toContain("Select a commit to preview its changes.");
    expect(host.querySelector('[data-testid="diff-editor"]')).toBeNull();
  });

  it("renders the diff editor for the selected commit", async () => {
    await renderPanel({ diff: diff(), selectedSha: "1a2b3c4" });

    expect(host.querySelector('[data-testid="diff-editor"]')).not.toBeNull();
  });

  function commitRows(): HTMLButtonElement[] {
    return Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
  }

  async function renderPanel(
    overrides: Partial<{
      commits: GitFileHistoryEntry[];
      commitsLoading: boolean;
      diff: GitFileDiff | null;
      diffLoading: boolean;
      isOpen: boolean;
      onClose: () => void;
      onSelectCommit: (sha: string) => void;
      relativePath: string | null;
      selectedSha: string | null;
    }> = {},
  ) {
    await act(async () => {
      root.render(
        <FileHistoryPanel
          commits={overrides.commits ?? defaultCommits()}
          commitsLoading={overrides.commitsLoading ?? false}
          diff={overrides.diff ?? null}
          diffLoading={overrides.diffLoading ?? false}
          isOpen={overrides.isOpen ?? true}
          monacoTheme="calm-dark"
          onClose={overrides.onClose ?? vi.fn()}
          onSelectCommit={overrides.onSelectCommit ?? vi.fn()}
          relativePath={
            overrides.relativePath === undefined
              ? "src/User.php"
              : overrides.relativePath
          }
          selectedSha={
            overrides.selectedSha === undefined ? null : overrides.selectedSha
          }
        />,
      );
      await Promise.resolve();
    });
  }
});

function defaultCommits(): GitFileHistoryEntry[] {
  return [
    {
      author: "Alice",
      sha: "1a2b3c4",
      subject: "Add user model",
      timestamp: 1700000000,
    },
    {
      author: "Bob",
      sha: "f0e1d2c",
      subject: "Refactor user model",
      timestamp: 1700100000,
    },
  ];
}

function diff(): GitFileDiff {
  return {
    change: {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/workspace/src/User.php",
      relativePath: "src/User.php",
      status: "modified",
    },
    language: "php",
    modifiedContent: "<?php changed",
    originalContent: "<?php",
  };
}
