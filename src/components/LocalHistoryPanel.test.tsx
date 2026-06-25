// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LocalHistoryDiff,
  LocalHistoryVersion,
} from "../domain/localHistory";
import { LocalHistoryPanel } from "./LocalHistoryPanel";

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

describe("LocalHistoryPanel", () => {
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

  it("lists versions for the active file", async () => {
    await renderPanel();

    const rows = versionRows();

    expect(rows).toHaveLength(2);
    expect(host.textContent).toContain("src/User.php");
  });

  it("shows an empty state with a save hint when there are no versions", async () => {
    await renderPanel({ versions: [] });

    expect(host.textContent).toContain("No local history for this file yet");
  });

  it("requests a version diff when a version is clicked", async () => {
    const onSelectVersion = vi.fn();
    await renderPanel({ onSelectVersion });

    await act(async () => {
      versionRows()[1].click();
      await Promise.resolve();
    });

    expect(onSelectVersion).toHaveBeenCalledWith("000000000001");
  });

  it("prompts to select a version before any diff is loaded", async () => {
    await renderPanel({ diff: null, selectedVersionId: null });

    expect(host.textContent).toContain(
      "Select a version to compare it with the current file.",
    );
    expect(host.querySelector('[data-testid="diff-editor"]')).toBeNull();
  });

  it("renders the diff editor and a revert button for the selected version", async () => {
    const onRevertVersion = vi.fn();
    await renderPanel({
      diff: diff(),
      onRevertVersion,
      selectedVersionId: "000000000002",
    });

    expect(host.querySelector('[data-testid="diff-editor"]')).not.toBeNull();

    const revert = host.querySelector<HTMLButtonElement>(
      ".local-history-revert",
    );
    expect(revert).not.toBeNull();

    await act(async () => {
      revert?.click();
      await Promise.resolve();
    });

    expect(onRevertVersion).toHaveBeenCalledWith("000000000002");
  });

  function versionRows(): HTMLButtonElement[] {
    return Array.from(
      host.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
  }

  async function renderPanel(
    overrides: Partial<{
      diff: LocalHistoryDiff | null;
      diffLoading: boolean;
      isOpen: boolean;
      onClose: () => void;
      onRevertVersion: (versionId: string) => void;
      onSelectVersion: (versionId: string) => void;
      relativePath: string | null;
      selectedVersionId: string | null;
      versions: LocalHistoryVersion[];
      versionsLoading: boolean;
    }> = {},
  ) {
    await act(async () => {
      root.render(
        <LocalHistoryPanel
          diff={overrides.diff ?? null}
          diffLoading={overrides.diffLoading ?? false}
          isOpen={overrides.isOpen ?? true}
          monacoTheme="calm-dark"
          onClose={overrides.onClose ?? vi.fn()}
          onRevertVersion={overrides.onRevertVersion ?? vi.fn()}
          onSelectVersion={overrides.onSelectVersion ?? vi.fn()}
          relativePath={
            overrides.relativePath === undefined
              ? "src/User.php"
              : overrides.relativePath
          }
          selectedVersionId={
            overrides.selectedVersionId === undefined
              ? null
              : overrides.selectedVersionId
          }
          versions={overrides.versions ?? defaultVersions()}
          versionsLoading={overrides.versionsLoading ?? false}
        />,
      );
      await Promise.resolve();
    });
  }
});

function defaultVersions(): LocalHistoryVersion[] {
  return [
    { id: "000000000002", sizeBytes: 18, timestampMs: 1700100000000 },
    { id: "000000000001", sizeBytes: 12, timestampMs: 1700000000000 },
  ];
}

function diff(): LocalHistoryDiff {
  return {
    language: "php",
    modifiedContent: "<?php // current",
    originalContent: "<?php // previous",
  };
}
