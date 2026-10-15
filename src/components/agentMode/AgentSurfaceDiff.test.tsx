// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForReact } from "../../test/reactTestLifecycle";
import {
  AgentSurfaceDiff,
  SURFACE_DIFF_GONE_MESSAGE,
  SURFACE_DIFF_TRUNCATED_MESSAGE,
  type AgentSurfaceDiffProps,
} from "./AgentSurfaceDiff";
import { surfaceChangedFile, surfaceSummary, surfaceThreadView } from "./agentSurfaceTestFixtures";

describe("AgentSurfaceDiff", () => {
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
  });

  it("requests the change summary once when it is missing", () => {
    const onShowChanges = vi.fn();
    render({ summary: null, onShowChanges });
    render({ summary: null, onShowChanges });
    expect(onShowChanges).toHaveBeenCalledTimes(1);
    expect(onShowChanges).toHaveBeenCalledWith("agt-1");
    expect(host.querySelector(".agent-surface-diff__placeholder")).not.toBeNull();

    render({ summary: surfaceSummary(), onShowChanges });
    expect(onShowChanges).toHaveBeenCalledTimes(1);
  });

  it("lists the changed files, selects one and renders its text diff", async () => {
    const onShowFileDiff = vi.fn();
    const onHideFileDiff = vi.fn();
    const file = surfaceChangedFile("src/parser.ts");
    render({ summary: surfaceSummary({ files: [file] }), onShowFileDiff });

    act(() => host.querySelector<HTMLElement>(".agent-files__path")?.click());
    expect(onShowFileDiff).toHaveBeenCalledWith("agt-1", file);

    render({
      onHideFileDiff,
      summary: surfaceSummary({
        files: [file],
        diff: {
          relativePath: "src/parser.ts",
          loading: false,
          error: null,
          original: { text: "a", truncated: false },
          modified: { text: "b", truncated: true },
          unavailableReason: null,
        },
      }),
    });
    await waitForReact(() => expect(host.querySelector(".cv-diff-hunk")).not.toBeNull());
    expect(host.querySelector(".agent-surface-diff__preview .agent-microlabel")?.textContent).toBe(
      "src/parser.ts",
    );
    expect(host.querySelector(".agent-surface-diff__banner")?.textContent).toBe(
      SURFACE_DIFF_TRUNCATED_MESSAGE,
    );
    expect(host.querySelector('[aria-current="true"]')?.textContent).toContain("src/parser.ts");
    expect(host.querySelector('[aria-label="Revert file"]')).toBeNull();
    expect(host.querySelector('[aria-label="src/parser.ts diff"]')).not.toBeNull();
    expect(host.querySelector(".cv-diff-code--del")?.textContent).toBe("a");
    expect(host.querySelector(".cv-diff-code--add")?.textContent).toBe("b");

    act(() => host.querySelector<HTMLElement>('[aria-label="Close diff"]')?.click());
    expect(onHideFileDiff).toHaveBeenCalledWith("agt-1");
  });

  it("shows the diff error instead of the preview and disables refresh while loading", () => {
    const onRefreshChanges = vi.fn();
    render({
      onRefreshChanges,
      summary: surfaceSummary({
        loading: true,
        diff: {
          relativePath: "src/parser.ts",
          loading: false,
          error: "The file diff could not be read.",
          original: { text: "", truncated: false },
          modified: { text: "", truncated: false },
          unavailableReason: null,
        },
      }),
    });
    expect(host.querySelector(".agent-note--bad")?.textContent).toBe(
      "The file diff could not be read.",
    );
    expect(host.querySelector("[data-agent-text-diff]")).toBeNull();
    const refresh = host.querySelector<HTMLButtonElement>(
      '[aria-label="Refresh changes for agent agt-1"]',
    );
    expect(refresh?.disabled).toBe(true);

    render({ onRefreshChanges, summary: surfaceSummary() });
    act(() =>
      host.querySelector<HTMLElement>('[aria-label="Refresh changes for agent agt-1"]')?.click(),
    );
    expect(onRefreshChanges).toHaveBeenCalledWith("agt-1");
  });

  it("explains binary and oversized files instead of diffing them", () => {
    render({
      summary: surfaceSummary({
        diff: {
          relativePath: "assets/logo.png",
          loading: false,
          error: null,
          original: { text: "", truncated: false },
          modified: { text: "", truncated: false },
          unavailableReason: "binary",
        },
      }),
    });
    expect(host.textContent).toContain("This file is binary and cannot be shown as a text diff.");
    expect(host.querySelector("[data-agent-text-diff]")).toBeNull();
  });

  it("reports a gone checkout and never requests changes for it", () => {
    const onShowChanges = vi.fn();
    render({ onShowChanges, summary: null, thread: surfaceThreadView({ worktreeRemoved: true }) });
    expect(host.querySelector(".agent-note--warning")?.textContent).toBe(SURFACE_DIFF_GONE_MESSAGE);
    expect(onShowChanges).not.toHaveBeenCalled();
    expect(host.querySelector(".agent-surface-diff__body")).toBeNull();
  });

  function render(overrides: Partial<AgentSurfaceDiffProps> = {}): void {
    act(() => root.render(<AgentSurfaceDiff {...defaultProps()} {...overrides} />));
  }
});

function defaultProps(): AgentSurfaceDiffProps {
  return {
    thread: surfaceThreadView(),
    summary: surfaceSummary(),
    onShowChanges: () => undefined,
    onRefreshChanges: () => undefined,
    onShowFileDiff: () => undefined,
    onHideFileDiff: () => undefined,
    onOpenChangedFile: () => undefined,
    onOpenChangedFileDiff: () => undefined,
  };
}
