// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyGitStatus, type GitChangedFile } from "../../domain/git";
import type { AgentSurfaceProjectDiffState } from "./AgentSurfaceProjectDiff";
import { useAgentProjectDiffChrome } from "./useAgentProjectDiffChrome";

const change: GitChangedFile = {
  path: "/a/file.ts",
  relativePath: "file.ts",
  status: "modified",
  isStaged: false,
  isUnversioned: false,
  oldPath: null,
  oldRelativePath: null,
};

describe("project diff callback authority", () => {
  let root: ReturnType<typeof createRoot>;
  let current: AgentSurfaceProjectDiffState | null;
  let rootPath: string;
  let ownerId: string;
  let mounted: boolean;
  const preview = vi.fn(async () => undefined);
  function Harness() {
    current = useAgentProjectDiffChrome({
      workspaceRoot: rootPath,
      workspaceIdentityDescriptor: { workspaceId: ownerId },
      gitStatus: emptyGitStatus(rootPath),
      previewGitChange: preview,
    });
    return null;
  }
  function render() {
    act(() => root.render(<Harness />));
  }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    root = createRoot(document.createElement("div"));
    rootPath = "/a";
    ownerId = "a";
    mounted = true;
    preview.mockClear();
    render();
  });
  afterEach(() => {
    if (mounted) act(() => root.unmount());
  });

  it("allows the current owned repository and rejects foreign file/root paths", () => {
    current?.onPreviewChange(change, "/a");
    current?.onPreviewChange({ ...change, path: "/b/file.ts" }, "/a");
    current?.onPreviewChange(change, "/b");
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("rejects retained callbacks across A to B to A", () => {
    const retained = current;
    rootPath = "/b";
    render();
    rootPath = "/a";
    render();
    retained?.onPreviewChange(change, "/a");
    expect(preview).not.toHaveBeenCalled();
    current?.onPreviewChange(change, "/a");
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("rejects retained callbacks after same-path owner replacement or unmount", () => {
    const retained = current;
    ownerId = "replacement";
    render();
    retained?.onPreviewChange(change, "/a");
    const latest = current;
    act(() => root.unmount());
    mounted = false;
    latest?.onPreviewChange(change, "/a");
    expect(preview).not.toHaveBeenCalled();
  });
});
