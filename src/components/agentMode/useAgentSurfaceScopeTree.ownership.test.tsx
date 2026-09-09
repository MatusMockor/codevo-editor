// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useAgentSurfaceScopeTree } from "./useAgentSurfaceScopeTree";
import type { AgentSurfaceFileTreeProps } from "./AgentSurfaceFileTree";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import { surfaceRepositoryScope } from "./agentSurfaceTestFixtures";
import type { AgentProjectWorkspaceActivation } from "./useAgentProjectWorkspaceSync";

describe("file tree selected-project action ownership", () => {
  let host: HTMLDivElement;
  let root: Root;
  let current: AgentSurfaceFileTreeProps | null;
  const open = vi.fn();
  const preview = vi.fn();
  const search = vi.fn();
  const read = vi.fn(async () => []);
  const chrome = chromeFixture({
    fileTree: {
      files: { readDirectory: read },
      fileChanges: null,
      activePath: "/a/index.ts",
      revealActivePathSignal: 0,
      onOpenFile: open,
      onPreviewFile: preview,
      onSearchFiles: search,
    },
  });
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    current = null;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function Harness({
    path,
    activation,
  }: {
    readonly path: string;
    readonly activation: AgentProjectWorkspaceActivation;
  }) {
    current = useAgentSurfaceScopeTree({
      chrome: {
        ...chrome,
        workspaceActivation: { state: activation, select: () => undefined, retry: () => undefined },
      },
      filesOpen: true,
      scope: surfaceRepositoryScope(path),
      thread: null,
      threadRootPath: null,
      onSwitchScope: null,
      onTrustScope: () => undefined,
    });
    return null;
  }
  async function render(
    path: string,
    activation: AgentProjectWorkspaceActivation = { kind: "ready", rootPath: path },
  ) {
    await act(async () => root.render(<Harness path={path} activation={activation} />));
  }
  function tree() {
    if (current === null) throw new Error("Missing tree");
    return current;
  }
  it("rejects retained file actions after A to B to A", async () => {
    await render("/a");
    const stale = tree();
    await render("/b");
    expect(tree().activePath).toBeNull();
    await render("/a");
    const file = { name: "index.ts", path: "/a/index.ts", kind: "file" as const };
    act(() => {
      stale.onOpenFile(file);
      stale.onPreviewFile(file);
      stale.searchFiles?.open();
    });
    expect(open).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    act(() => tree().onOpenFile(file));
    expect(open).toHaveBeenCalledExactlyOnceWith(file);
  });
  it("does not read or search the old workspace while activation is pending", async () => {
    await render("/b", { kind: "pending", rootPath: "/b" });
    expect(read).not.toHaveBeenCalled();
    expect(tree().tree.rootPath).toBeNull();
    expect(tree().searchFiles).toBeNull();
    expect(tree().activePath).toBeNull();
    await render("/b");
    expect(read).toHaveBeenCalledWith("/b");
  });
});
