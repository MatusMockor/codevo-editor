// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSurfaceFileTreeSurface } from "../../application/useAgentSurfaceFileTree";
import {
  AgentSurfaceFileTree,
  SURFACE_TREE_GONE_MESSAGE,
  SURFACE_TREE_NO_PROJECT_MESSAGE,
  SURFACE_TREE_PROJECT_GONE_MESSAGE,
  SURFACE_TREE_SEARCH_LABEL,
  SURFACE_TREE_UNTRUSTED_MESSAGE,
  type AgentSurfaceFileTreeProps,
} from "./AgentSurfaceFileTree";
import { agentSurfaceForeignRootMessage } from "./agentSurfacePolicy";
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

  it("labels a project tree and explains why it is unavailable without loading rows", () => {
    render({
      source: "project",
      tree: { ...tree(), rootPath: null },
      unavailable: { kind: "noProject" },
    });
    expect(host.querySelector("section")?.getAttribute("aria-label")).toBe("Project files");
    expect(host.querySelector("[data-agent-surface-tree-unavailable]")?.textContent).toBe(
      SURFACE_TREE_NO_PROJECT_MESSAGE,
    );
    expect(host.querySelector(".agent-surface-tree__viewport")).toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Refresh workspace files"]')?.disabled,
    ).toBe(true);

    const onTrust = vi.fn();
    render({
      source: "project",
      tree: { ...tree(), rootPath: null },
      unavailable: { kind: "untrusted", onTrust },
    });
    const note = host.querySelector("[data-agent-surface-tree-unavailable]");
    expect(note?.textContent).toBe(SURFACE_TREE_UNTRUSTED_MESSAGE);
    expect(note?.querySelector('[aria-label="Trust the project"]')).toBeNull();
    expect(onTrust).not.toHaveBeenCalled();

    render({
      source: "project",
      tree: { ...tree(), rootPath: null },
      unavailable: { kind: "untrusted", onTrust: null },
    });
    expect(host.querySelector('[aria-label="Trust the project"]')).toBeNull();
  });

  it("explains a foreign-root scope with a switch affordance only when one is reachable", () => {
    const onSwitch = vi.fn();
    render({
      source: "project",
      tree: { ...tree(), rootPath: null },
      unavailable: { kind: "foreignRoot", label: "other", onSwitch },
    });
    const note = host.querySelector("[data-agent-surface-tree-unavailable]");
    expect(note?.textContent).toBe(`${agentSurfaceForeignRootMessage("other")}Switch`);
    expect(host.querySelector(".agent-surface-tree__viewport")).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Switch to other"]')?.click());
    expect(onSwitch).toHaveBeenCalledTimes(1);

    render({
      source: "project",
      tree: { ...tree(), rootPath: null },
      unavailable: { kind: "foreignRoot", label: "other", onSwitch: null },
    });
    expect(host.querySelector("[data-agent-surface-tree-unavailable]")?.textContent).toBe(
      agentSurfaceForeignRootMessage("other"),
    );
    expect(host.querySelector('[aria-label="Switch to other"]')).toBeNull();
  });

  it("words the missing-root fallback by source", () => {
    render({ source: "project", tree: { ...tree(), rootPath: null }, unavailable: null });
    expect(host.querySelector("[data-agent-surface-tree-unavailable]")?.textContent).toBe(
      SURFACE_TREE_PROJECT_GONE_MESSAGE,
    );
    render({ source: "thread", tree: { ...tree(), rootPath: null }, unavailable: null });
    expect(host.querySelector("[data-agent-surface-tree-unavailable]")?.textContent).toBe(
      SURFACE_TREE_GONE_MESSAGE,
    );
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
    source: "thread",
    tree: tree(),
    unavailable: null,
    activePath: null,
    revealActivePathSignal: 0,
    searchFiles: { shortcut: "Cmd+P", open: () => undefined },
    onOpenFile: () => undefined,
    onPreviewFile: () => undefined,
  };
}
