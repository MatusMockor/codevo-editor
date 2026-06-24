// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhpTree, PhpTreeNode, PhpTreeNodeKind } from "../domain/phpTree";
import { PhpTreePanel } from "./PhpTreePanel";

describe("PhpTreePanel", () => {
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

  it("renders the empty placeholder when there is no workspace", async () => {
    await renderPanel({ rootPath: null });

    expect(host.textContent).toContain("No workspace");
  });

  it("renders only the top level until a node is expanded", async () => {
    await renderPanel({
      tree: tree([
        node("ns", "App", "namespace", [
          node("class", "User", "class", [node("method", "save", "method")]),
        ]),
      ]),
    });

    expect(host.textContent).toContain("App");
    // Children of the collapsed namespace node stay hidden.
    expect(host.textContent).not.toContain("User");
    expect(host.textContent).not.toContain("save");
  });

  it("renders nested children for expanded nodes", async () => {
    await renderPanel({
      expandedNodeIds: new Set(["ns", "class"]),
      tree: tree([
        node("ns", "App", "namespace", [
          node("class", "User", "class", [node("method", "save", "method")]),
        ]),
      ]),
    });

    expect(host.textContent).toContain("App");
    expect(host.textContent).toContain("User");
    expect(host.textContent).toContain("save");
  });

  it("toggles a node when its row is clicked", async () => {
    const onToggleNode = vi.fn();
    await renderPanel({
      onToggleNode,
      tree: tree([
        node("ns", "App", "namespace", [node("class", "User", "class")]),
      ]),
    });

    act(() => {
      host.querySelector<HTMLButtonElement>(".php-tree-row")?.click();
    });

    expect(onToggleNode).toHaveBeenCalledWith("ns");
  });

  it("opens a leaf node when its row is clicked", async () => {
    const onOpenNode = vi.fn();
    const leaf = node("class", "User", "class");
    await renderPanel({
      onOpenNode,
      tree: tree([leaf]),
    });

    act(() => {
      host.querySelector<HTMLButtonElement>(".php-tree-row")?.click();
    });

    expect(onOpenNode).toHaveBeenCalledWith(leaf);
  });

  it("does not re-render when the parent re-renders with identical props", async () => {
    // The panel reads `expandedNodeIds.has(...)` for every rendered row, so a
    // spy on `.has` counts how often the (memoized) tree subtree renders.
    const expandedNodeIds = new Set(["ns"]);
    const hasSpy = vi.spyOn(expandedNodeIds, "has");
    const stableProps: React.ComponentProps<typeof PhpTreePanel> = {
      activePath: null,
      expandedNodeIds,
      isLoading: false,
      onOpenNode: vi.fn(),
      onToggleNode: vi.fn(),
      rootPath: "/workspace",
      tree: tree([
        node("ns", "App", "namespace", [node("class", "User", "class")]),
      ]),
    };

    let forceParentRender: (value: number) => void = () => undefined;

    function Parent() {
      const [, setTick] = useState(0);
      forceParentRender = setTick;
      return <PhpTreePanel {...stableProps} />;
    }

    await act(async () => {
      root.render(<Parent />);
      await Promise.resolve();
    });

    const callsAfterMount = hasSpy.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    await act(async () => {
      forceParentRender(1);
      await Promise.resolve();
    });

    // React.memo prevents the panel from re-rendering when every prop is
    // referentially unchanged, so the rows never read `expandedNodeIds` again.
    expect(hasSpy.mock.calls.length).toBe(callsAfterMount);

    hasSpy.mockRestore();
  });

  async function renderPanel(
    props: Partial<React.ComponentProps<typeof PhpTreePanel>> = {},
  ) {
    await act(async () => {
      root.render(
        <PhpTreePanel
          activePath={props.activePath ?? null}
          expandedNodeIds={props.expandedNodeIds ?? new Set()}
          isLoading={props.isLoading ?? false}
          onOpenNode={props.onOpenNode ?? vi.fn()}
          onToggleNode={props.onToggleNode ?? vi.fn()}
          rootPath={"rootPath" in props ? props.rootPath! : "/workspace"}
          tree={props.tree ?? tree([])}
        />,
      );
      await Promise.resolve();
    });
  }
});

function tree(nodes: PhpTreeNode[]): PhpTree {
  return { nodes };
}

function node(
  id: string,
  label: string,
  kind: PhpTreeNodeKind,
  children: PhpTreeNode[] = [],
): PhpTreeNode {
  return {
    children,
    column: null,
    fullyQualifiedName: label,
    id,
    kind,
    label,
    lineNumber: null,
    path: children.length === 0 ? `/workspace/${id}.php` : null,
    relativePath: children.length === 0 ? `${id}.php` : null,
  };
}
