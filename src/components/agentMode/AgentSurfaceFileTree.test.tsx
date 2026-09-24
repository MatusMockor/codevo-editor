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

  it("renders only the tree: search and refresh live in the Files surface header", () => {
    render({ searchFiles: { shortcut: "Cmd+P" } });

    expect(host.querySelector(".agent-surface__subhead")).toBeNull();
    expect(host.querySelector("header")).toBeNull();
    expect(host.querySelector(".agent-surface-tree__tools")).toBeNull();
    expect(host.querySelector(".agent-surface-tree__search")).toBeNull();
    expect(host.querySelector('[aria-label="Refresh workspace files"]')).toBeNull();
    expect(
      host.querySelector("[data-agent-surface-tree] .agent-surface-tree__viewport"),
    ).not.toBeNull();
  });

  it("drops the viewport once the checkout is gone", () => {
    render({ tree: { ...tree(), rootPath: null } });
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
    searchFiles: { shortcut: "Cmd+P" },
    onOpenFile: () => undefined,
    onPreviewFile: () => undefined,
  };
}
