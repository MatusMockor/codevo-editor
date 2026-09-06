// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSurfaceFileTreeSurface } from "../../application/useAgentSurfaceFileTree";
import {
  AgentSurfaceFileTree,
  SURFACE_TREE_GONE_MESSAGE,
  SURFACE_TREE_SEARCH_LABEL,
  type AgentSurfaceFileTreeProps,
} from "./AgentSurfaceFileTree";
import { SURFACE_FIXTURE_WORKTREE } from "./agentSurfaceTestFixtures";
import { installResizeObserver } from "./agentSurfaceTerminalTestSupport";

describe("AgentSurfaceFileTree", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    installResizeObserver();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders a tools row with Refresh and Search files instead of a files subhead", () => {
    const open = vi.fn();
    render({ searchFiles: { shortcut: "Cmd+P", open } });

    expect(host.querySelector(".agent-surface__subhead")).toBeNull();
    expect(host.querySelector(".agent-microlabel")).toBeNull();
    expect(host.querySelector("header")).toBeNull();
    const tools = host.querySelector(".agent-surface-tree__tools");
    expect(tools?.previousElementSibling).toBeNull();
    expect(tools?.querySelector('[aria-label="Refresh workspace files"]')).not.toBeNull();

    const search = host.querySelector<HTMLButtonElement>(".agent-surface-tree__search");
    expect(search?.textContent).toBe(SURFACE_TREE_SEARCH_LABEL);
    expect(search?.getAttribute("aria-keyshortcuts")).toBe("Meta+P");
    expect(search?.title).toBe("Search files (⌘P)");
    expect(search?.disabled).toBe(false);

    act(() => search?.click());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("disables the search button without a quick-open capability", () => {
    render({ searchFiles: null });

    const search = host.querySelector<HTMLButtonElement>(".agent-surface-tree__search");
    expect(search?.disabled).toBe(true);
    expect(search?.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(search?.title).toBe(SURFACE_TREE_SEARCH_LABEL);
  });

  it("refreshes through the surface and disables refresh once the checkout is gone", () => {
    const refresh = vi.fn();
    render({ tree: { ...tree(), refresh } });
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Refresh workspace files"]');
    act(() => button?.click());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      host.querySelector("[data-agent-surface-tree] .agent-surface-tree__viewport"),
    ).not.toBeNull();

    render({ tree: { ...tree(), rootPath: null, refresh } });
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Refresh workspace files"]')?.disabled,
    ).toBe(true);
    expect(host.querySelector(".agent-note--warning")?.textContent).toBe(SURFACE_TREE_GONE_MESSAGE);
    expect(host.querySelector(".agent-surface-tree__viewport")).toBeNull();
  });

  it("reports a truncated folder listing", () => {
    render({ tree: { ...tree(), truncatedDirectories: new Set([SURFACE_FIXTURE_WORKTREE]) } });
    expect(host.querySelector(".agent-note--warning")?.textContent).toContain(
      "Folders show at most",
    );
  });

  function render(overrides: Partial<AgentSurfaceFileTreeProps> = {}): void {
    act(() => root.render(<AgentSurfaceFileTree {...defaultProps()} {...overrides} />));
  }
});

function tree(): AgentSurfaceFileTreeSurface {
  return {
    rootPath: SURFACE_FIXTURE_WORKTREE,
    entriesByDirectory: { [SURFACE_FIXTURE_WORKTREE]: [] },
    expandedDirectories: new Set(),
    loadingDirectories: new Set(),
    failedDirectories: new Set(),
    truncatedDirectories: new Set(),
    rootError: null,
    toggleDirectory: () => undefined,
    retryDirectory: () => undefined,
    refresh: () => undefined,
  };
}

function defaultProps(): AgentSurfaceFileTreeProps {
  return {
    tree: tree(),
    activePath: null,
    revealActivePathSignal: 0,
    searchFiles: { shortcut: "Cmd+P", open: () => undefined },
    onOpenFile: () => undefined,
    onPreviewFile: () => undefined,
  };
}
