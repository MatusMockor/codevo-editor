// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  usePhpOutline,
  type PhpOutline,
  type PhpOutlineDependencies,
} from "./usePhpOutline";
import {
  emptyPhpFileOutline,
  type PhpFileOutline,
  type PhpFileOutlineGateway,
  type PhpFileOutlineNode,
} from "../domain/phpFileOutline";
import { LARGE_SMART_DOCUMENT_CHARACTER_LIMIT } from "../domain/largeDocumentPolicy";
import {
  emptyPhpTree,
  type PhpTree,
  type PhpTreeGateway,
  type PhpTreeNode,
} from "../domain/phpTree";
import type { WorkspaceDescriptor } from "../domain/workspace";

const ROOT = "/workspace";

function treeNode(overrides: Partial<PhpTreeNode> = {}): PhpTreeNode {
  return {
    children: [],
    column: 3,
    fullyQualifiedName: "App\\Foo",
    id: "node-1",
    kind: "class",
    label: "Foo",
    lineNumber: 7,
    path: `${ROOT}/app/Foo.php`,
    relativePath: "app/Foo.php",
    ...overrides,
  };
}

function tree(nodes: PhpTreeNode[]): PhpTree {
  return { nodes };
}

function outlineNode(overrides: Partial<PhpFileOutlineNode> = {}): PhpFileOutlineNode {
  return {
    children: [],
    column: 5,
    fullyQualifiedName: "App\\Foo::bar",
    id: "outline-1",
    kind: "method",
    label: "bar",
    lineNumber: 11,
    path: `${ROOT}/app/Foo.php`,
    relativePath: "app/Foo.php",
    ...overrides,
  };
}

function outline(nodes: PhpFileOutlineNode[]): PhpFileOutline {
  return { nodes };
}

function phpDescriptor(): WorkspaceDescriptor {
  return {
    rootPath: ROOT,
    php: {
      classmapRoots: [],
      hasComposer: false,
      packageName: null,
      packages: [],
      phpPlatformVersion: null,
      phpVersionConstraint: null,
      psr4Roots: [{ namespace: "App\\", paths: ["app"], dev: false }],
    },
    javaScriptTypeScript: null,
  };
}

function createFakePhpTreeGateway(
  overrides: Partial<PhpTreeGateway> = {},
): PhpTreeGateway {
  return {
    getPhpTree: vi.fn(async () => emptyPhpTree()),
    ...overrides,
  };
}

function createFakePhpFileOutlineGateway(
  overrides: Partial<PhpFileOutlineGateway> = {},
): PhpFileOutlineGateway {
  return {
    getPhpFileOutline: vi.fn(async () => emptyPhpFileOutline()),
    parsePhpFileOutline: vi.fn(async () => emptyPhpFileOutline()),
    ...overrides,
  };
}

interface CapturedState {
  phpTree: PhpTree;
  phpTreeExpandedNodeIds: Set<string>;
  phpTreeLoading: boolean;
  phpFileOutlinesByPath: Record<string, PhpFileOutline>;
  phpInheritedFileOutlinesByPath: Record<string, PhpFileOutline>;
  expandedPhpFilePaths: Set<string>;
  loadingPhpFileOutlinePaths: Set<string>;
  loadingInheritedPhpFileOutlinePaths: Set<string>;
  phpFileOutlineExpandedNodeIds: Set<string>;
}

type HarnessOverrides = Partial<
  Pick<
    PhpOutlineDependencies,
    | "workspaceRoot"
    | "workspaceDescriptor"
    | "documents"
    | "workspaceFiles"
    | "phpTreeGateway"
    | "phpFileOutlineGateway"
    | "openFile"
  >
>;

interface Harness {
  outline: () => PhpOutline;
  state: () => CapturedState;
  ref: { current: string | null };
  reportError: ReturnType<typeof vi.fn>;
  setMessage: ReturnType<typeof vi.fn>;
  openFile: ReturnType<typeof vi.fn>;
  setEditorRevealTarget: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderPhpOutline(overrides: HarnessOverrides = {}): Harness {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: {
    outline: PhpOutline | null;
    state: CapturedState | null;
  } = { outline: null, state: null };

  const ref: { current: string | null } = { current: ROOT };
  const reportError = vi.fn();
  const setMessage = vi.fn();
  const openFile = vi.fn(async () => true);
  const setEditorRevealTarget = vi.fn();

  function HarnessComponent() {
    const [phpTree, setPhpTree] = useState<PhpTree>(emptyPhpTree);
    const [phpTreeExpandedNodeIds, setPhpTreeExpandedNodeIds] = useState<
      Set<string>
    >(new Set());
    const [phpTreeLoading, setPhpTreeLoading] = useState(false);
    const [phpFileOutlinesByPath, setPhpFileOutlinesByPath] = useState<
      Record<string, PhpFileOutline>
    >({});
    const [
      phpInheritedFileOutlinesByPath,
      setPhpInheritedFileOutlinesByPath,
    ] = useState<Record<string, PhpFileOutline>>({});
    const [expandedPhpFilePaths, setExpandedPhpFilePaths] = useState<Set<string>>(
      new Set(),
    );
    const [loadingPhpFileOutlinePaths, setLoadingPhpFileOutlinePaths] = useState<
      Set<string>
    >(new Set());
    const [
      loadingInheritedPhpFileOutlinePaths,
      setLoadingInheritedPhpFileOutlinePaths,
    ] = useState<Set<string>>(new Set());
    const [phpFileOutlineExpandedNodeIds, setPhpFileOutlineExpandedNodeIds] =
      useState<Set<string>>(new Set());

    captured.outline = usePhpOutline({
      workspaceRoot: ROOT,
      workspaceDescriptor: null,
      currentWorkspaceRootRef: ref,
      documents: {},
      workspaceFiles: { readTextFile: async () => "" },
      phpTreeGateway: createFakePhpTreeGateway(),
      phpFileOutlineGateway: createFakePhpFileOutlineGateway(),
      reportError,
      setMessage,
      openFile,
      setEditorRevealTarget,
      setPhpTree,
      setPhpTreeExpandedNodeIds,
      setPhpTreeLoading,
      phpFileOutlinesByPath,
      setPhpFileOutlinesByPath,
      setPhpInheritedFileOutlinesByPath,
      expandedPhpFilePaths,
      setExpandedPhpFilePaths,
      loadingPhpFileOutlinePaths,
      setLoadingPhpFileOutlinePaths,
      setLoadingInheritedPhpFileOutlinePaths,
      setPhpFileOutlineExpandedNodeIds,
      ...overrides,
    });

    captured.state = {
      phpTree,
      phpTreeExpandedNodeIds,
      phpTreeLoading,
      phpFileOutlinesByPath,
      phpInheritedFileOutlinesByPath,
      expandedPhpFilePaths,
      loadingPhpFileOutlinePaths,
      loadingInheritedPhpFileOutlinePaths,
      phpFileOutlineExpandedNodeIds,
    };

    return null;
  }

  act(() => {
    root.render(<HarnessComponent />);
  });

  return {
    outline: () => {
      if (!captured.outline) {
        throw new Error("outline not mounted");
      }
      return captured.outline;
    },
    state: () => {
      if (!captured.state) {
        throw new Error("state not mounted");
      }
      return captured.state;
    },
    ref,
    reportError,
    setMessage,
    openFile,
    setEditorRevealTarget,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("usePhpOutline", () => {
  it("refreshes and publishes the project PHP tree", async () => {
    const loaded = tree([treeNode()]);
    const getPhpTree = vi.fn(async () => loaded);
    const harness = renderPhpOutline({
      phpTreeGateway: createFakePhpTreeGateway({ getPhpTree }),
    });

    await act(async () => {
      await harness.outline().refreshPhpTree();
    });

    expect(getPhpTree).toHaveBeenCalledWith(ROOT);
    expect(harness.state().phpTree).toBe(loaded);
    expect(harness.state().phpTreeLoading).toBe(false);
    expect(harness.setMessage).toHaveBeenCalledWith(null);
    harness.unmount();
  });

  it("clears the tree when there is no workspace root", async () => {
    const getPhpTree = vi.fn(async () => tree([treeNode()]));
    const harness = renderPhpOutline({
      workspaceRoot: null,
      phpTreeGateway: createFakePhpTreeGateway({ getPhpTree }),
    });

    await act(async () => {
      await harness.outline().refreshPhpTree();
    });

    expect(getPhpTree).not.toHaveBeenCalled();
    expect(harness.state().phpTree.nodes).toEqual([]);
    expect(harness.state().phpTreeLoading).toBe(false);
    harness.unmount();
  });

  it("reports an error and clears the tree when the gateway rejects", async () => {
    const getPhpTree = vi.fn(async () => {
      throw new Error("boom");
    });
    const harness = renderPhpOutline({
      phpTreeGateway: createFakePhpTreeGateway({ getPhpTree }),
    });

    await act(async () => {
      await harness.outline().refreshPhpTree();
    });

    expect(harness.reportError).toHaveBeenCalledWith(
      "PHP Tree",
      expect.any(Error),
    );
    expect(harness.state().phpTree.nodes).toEqual([]);
    expect(harness.state().phpTreeLoading).toBe(false);
    harness.unmount();
  });

  it("drops a stale tree when the workspace root changed mid-load", async () => {
    const loaded = tree([treeNode()]);
    const harness = renderPhpOutline({
      phpTreeGateway: createFakePhpTreeGateway({
        getPhpTree: vi.fn(async () => {
          harness.ref.current = "/other";
          return loaded;
        }),
      }),
    });

    await act(async () => {
      await harness.outline().refreshPhpTree();
    });

    // Stale result is dropped: the tree stays empty and the finally guard also
    // returns early, so the loading flag is intentionally left set.
    expect(harness.state().phpTree.nodes).toEqual([]);
    expect(harness.state().phpTreeLoading).toBe(true);
    harness.unmount();
  });

  it("toggles a PHP tree node id on and off", () => {
    const harness = renderPhpOutline();

    act(() => {
      harness.outline().togglePhpTreeNode("node-1");
    });
    expect(harness.state().phpTreeExpandedNodeIds.has("node-1")).toBe(true);

    act(() => {
      harness.outline().togglePhpTreeNode("node-1");
    });
    expect(harness.state().phpTreeExpandedNodeIds.has("node-1")).toBe(false);
    harness.unmount();
  });

  it("opens a PHP tree node and reveals its position", async () => {
    const harness = renderPhpOutline();
    const node = treeNode({ path: `${ROOT}/app/Bar.php`, lineNumber: 9, column: 4 });

    await act(async () => {
      await harness.outline().openPhpTreeNode(node);
    });

    expect(harness.openFile).toHaveBeenCalledWith({
      kind: "file",
      name: "Bar.php",
      path: `${ROOT}/app/Bar.php`,
    });
    expect(harness.setEditorRevealTarget).toHaveBeenCalledWith({
      path: `${ROOT}/app/Bar.php`,
      position: { column: 4, lineNumber: 9 },
    });
    harness.unmount();
  });

  it("does not open a tree node without a path", async () => {
    const harness = renderPhpOutline();

    await act(async () => {
      await harness.outline().openPhpTreeNode(treeNode({ path: null }));
    });

    expect(harness.openFile).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("skips reveal when the tree node file fails to open", async () => {
    const harness = renderPhpOutline({ openFile: vi.fn(async () => false) });

    await act(async () => {
      await harness.outline().openPhpTreeNode(treeNode());
    });

    expect(harness.setEditorRevealTarget).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("live-parses the active PHP file and stores its outline", async () => {
    const path = `${ROOT}/app/Foo.php`;
    const parsed = outline([outlineNode()]);
    const parsePhpFileOutline = vi.fn(async () => parsed);
    const getPhpFileOutline = vi.fn(async () => emptyPhpFileOutline());
    const harness = renderPhpOutline({
      workspaceFiles: { readTextFile: async () => "<?php class Foo {}" },
      phpFileOutlineGateway: createFakePhpFileOutlineGateway({
        parsePhpFileOutline,
        getPhpFileOutline,
      }),
    });

    await act(async () => {
      await harness.outline().loadPhpFileOutline(path);
    });

    expect(parsePhpFileOutline).toHaveBeenCalledWith(path, "<?php class Foo {}");
    expect(getPhpFileOutline).not.toHaveBeenCalled();
    expect(harness.state().phpFileOutlinesByPath[path]).toBe(parsed);
    expect(harness.state().loadingPhpFileOutlinePaths.has(path)).toBe(false);
    harness.unmount();
  });

  it("skips live parsing huge active PHP files", async () => {
    const path = `${ROOT}/vendor/nesbot/carbon/src/Carbon/CarbonInterface.php`;
    const parsePhpFileOutline = vi.fn(async () => outline([outlineNode()]));
    const harness = renderPhpOutline({
      workspaceFiles: {
        readTextFile: async () =>
          "x".repeat(LARGE_SMART_DOCUMENT_CHARACTER_LIMIT + 1),
      },
      phpFileOutlineGateway: createFakePhpFileOutlineGateway({
        parsePhpFileOutline,
      }),
    });

    await act(async () => {
      await harness.outline().loadPhpFileOutline(path);
    });

    expect(parsePhpFileOutline).not.toHaveBeenCalled();
    expect(harness.state().phpFileOutlinesByPath[path]).toEqual(
      emptyPhpFileOutline(),
    );
    expect(harness.state().loadingPhpFileOutlinePaths.has(path)).toBe(false);
    harness.unmount();
  });

  it("serves non-PHP outlines from the index gateway", async () => {
    const path = `${ROOT}/config/app.json`;
    const served = outline([outlineNode({ kind: "container", label: "app" })]);
    const parsePhpFileOutline = vi.fn(async () => emptyPhpFileOutline());
    const getPhpFileOutline = vi.fn(async () => served);
    const harness = renderPhpOutline({
      phpFileOutlineGateway: createFakePhpFileOutlineGateway({
        parsePhpFileOutline,
        getPhpFileOutline,
      }),
    });

    await act(async () => {
      await harness.outline().loadPhpFileOutline(path);
    });

    expect(getPhpFileOutline).toHaveBeenCalledWith(ROOT, path);
    expect(parsePhpFileOutline).not.toHaveBeenCalled();
    expect(harness.state().phpFileOutlinesByPath[path]).toBe(served);
    harness.unmount();
  });

  it("stores an empty outline when there is no workspace root", async () => {
    const path = `${ROOT}/app/Foo.php`;
    const harness = renderPhpOutline({ workspaceRoot: null });

    await act(async () => {
      await harness.outline().loadPhpFileOutline(path);
    });

    expect(harness.state().phpFileOutlinesByPath[path]).toEqual(
      emptyPhpFileOutline(),
    );
    harness.unmount();
  });

  it("drops a stale outline when the root changed mid-parse", async () => {
    const path = `${ROOT}/app/Foo.php`;
    const harness = renderPhpOutline({
      workspaceFiles: { readTextFile: async () => "<?php class Foo {}" },
      phpFileOutlineGateway: createFakePhpFileOutlineGateway({
        parsePhpFileOutline: vi.fn(async () => {
          harness.ref.current = "/other";
          return outline([outlineNode()]);
        }),
      }),
    });

    await act(async () => {
      await harness.outline().loadPhpFileOutline(path);
    });

    // Stale result dropped: no outline stored and the loading entry stays set
    // (finally guard returns early).
    expect(harness.state().phpFileOutlinesByPath[path]).toBeUndefined();
    expect(harness.state().loadingPhpFileOutlinePaths.has(path)).toBe(true);
    harness.unmount();
  });

  it("re-parses an already-loaded outline with the latest source", async () => {
    const path = `${ROOT}/app/Foo.php`;
    const first = outline([outlineNode({ id: "v1" })]);
    const second = outline([outlineNode({ id: "v2" })]);
    const parsePhpFileOutline = vi
      .fn<PhpFileOutlineGateway["parsePhpFileOutline"]>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const harness = renderPhpOutline({
      workspaceFiles: { readTextFile: async () => "<?php class Foo {}" },
      phpFileOutlineGateway: createFakePhpFileOutlineGateway({
        parsePhpFileOutline,
      }),
    });

    await act(async () => {
      await harness.outline().loadPhpFileOutline(path);
    });
    expect(harness.state().phpFileOutlinesByPath[path]).toBe(first);

    await act(async () => {
      await harness.outline().loadPhpFileOutline(path);
    });
    expect(harness.state().phpFileOutlinesByPath[path]).toBe(second);
    harness.unmount();
  });

  it("resolves the parent class file and stores its inherited outline", async () => {
    const childPath = `${ROOT}/app/Child.php`;
    const parentPath = `${ROOT}/app/ParentClass.php`;
    const childSource =
      "<?php\nnamespace App;\nclass Child extends ParentClass {}\n";
    const parentSource = "<?php\nnamespace App;\nclass ParentClass {}\n";
    const inherited = outline([outlineNode({ label: "inheritedBar" })]);
    const parsePhpFileOutline = vi.fn(async () => inherited);
    const harness = renderPhpOutline({
      workspaceDescriptor: phpDescriptor(),
      workspaceFiles: {
        readTextFile: async (p: string) =>
          p === childPath ? childSource : parentSource,
      },
      phpFileOutlineGateway: createFakePhpFileOutlineGateway({
        parsePhpFileOutline,
      }),
    });

    await act(async () => {
      await harness.outline().loadInheritedPhpFileOutline(childPath);
    });

    expect(parsePhpFileOutline).toHaveBeenCalledWith(parentPath, parentSource);
    expect(harness.state().phpInheritedFileOutlinesByPath[childPath]).toBe(
      inherited,
    );
    expect(
      harness.state().loadingInheritedPhpFileOutlinePaths.has(childPath),
    ).toBe(false);
    harness.unmount();
  });

  it("stores an empty inherited outline without a PHP descriptor", async () => {
    const childPath = `${ROOT}/app/Child.php`;
    const harness = renderPhpOutline({ workspaceDescriptor: null });

    await act(async () => {
      await harness.outline().loadInheritedPhpFileOutline(childPath);
    });

    expect(harness.state().phpInheritedFileOutlinesByPath[childPath]).toEqual(
      emptyPhpFileOutline(),
    );
    harness.unmount();
  });

  it("stores an empty inherited outline when the class has no parent", async () => {
    const childPath = `${ROOT}/app/Orphan.php`;
    const harness = renderPhpOutline({
      workspaceDescriptor: phpDescriptor(),
      workspaceFiles: {
        readTextFile: async () => "<?php\nnamespace App;\nclass Orphan {}\n",
      },
    });

    await act(async () => {
      await harness.outline().loadInheritedPhpFileOutline(childPath);
    });

    expect(harness.state().phpInheritedFileOutlinesByPath[childPath]).toEqual(
      emptyPhpFileOutline(),
    );
    harness.unmount();
  });

  it("expands a PHP file row and lazily loads its outline", async () => {
    const path = `${ROOT}/app/Foo.php`;
    const parsed = outline([outlineNode()]);
    const harness = renderPhpOutline({
      workspaceFiles: { readTextFile: async () => "<?php class Foo {}" },
      phpFileOutlineGateway: createFakePhpFileOutlineGateway({
        parsePhpFileOutline: vi.fn(async () => parsed),
      }),
    });

    act(() => {
      harness.outline().togglePhpFileOutline(path);
    });
    expect(harness.state().expandedPhpFilePaths.has(path)).toBe(true);

    await flushMicrotasks();
    expect(harness.state().phpFileOutlinesByPath[path]).toBe(parsed);
    harness.unmount();
  });

  it("collapses an expanded PHP file row without reloading", async () => {
    const path = `${ROOT}/app/Foo.php`;
    const parsePhpFileOutline = vi.fn(async () => outline([outlineNode()]));
    const harness = renderPhpOutline({
      workspaceFiles: { readTextFile: async () => "<?php class Foo {}" },
      phpFileOutlineGateway: createFakePhpFileOutlineGateway({
        parsePhpFileOutline,
      }),
    });

    act(() => {
      harness.outline().togglePhpFileOutline(path);
    });
    await flushMicrotasks();
    expect(parsePhpFileOutline).toHaveBeenCalledTimes(1);

    act(() => {
      harness.outline().togglePhpFileOutline(path);
    });
    expect(harness.state().expandedPhpFilePaths.has(path)).toBe(false);
    expect(parsePhpFileOutline).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("toggles an outline node id on and off", () => {
    const harness = renderPhpOutline();

    act(() => {
      harness.outline().togglePhpFileOutlineNode("outline-1");
    });
    expect(harness.state().phpFileOutlineExpandedNodeIds.has("outline-1")).toBe(
      true,
    );

    act(() => {
      harness.outline().togglePhpFileOutlineNode("outline-1");
    });
    expect(harness.state().phpFileOutlineExpandedNodeIds.has("outline-1")).toBe(
      false,
    );
    harness.unmount();
  });

  it("opens an outline node and reveals its position", async () => {
    const harness = renderPhpOutline();
    const node = outlineNode({
      path: `${ROOT}/app/Foo.php`,
      lineNumber: 21,
      column: 6,
    });

    await act(async () => {
      await harness.outline().openPhpFileOutlineNode(node);
    });

    expect(harness.openFile).toHaveBeenCalledWith({
      kind: "file",
      name: "Foo.php",
      path: `${ROOT}/app/Foo.php`,
    });
    expect(harness.setEditorRevealTarget).toHaveBeenCalledWith({
      path: `${ROOT}/app/Foo.php`,
      position: { column: 6, lineNumber: 21 },
    });
    harness.unmount();
  });
});
