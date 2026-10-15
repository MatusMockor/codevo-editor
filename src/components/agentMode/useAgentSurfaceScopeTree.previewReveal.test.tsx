// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentSurfaceFileTreeProps } from "./AgentSurfaceFileTree";
import {
  SURFACE_FIXTURE_ROOT,
  SURFACE_FIXTURE_WORKTREE,
  surfaceRepositoryScope,
  surfaceThreadView,
} from "./agentSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import { PREVIEW_REVEAL_DELAY_MS } from "./useDeferredPreviewReveal";
import { useAgentSurfaceScopeTree } from "./useAgentSurfaceScopeTree";

const FILE = {
  name: "orders.ts",
  path: `${SURFACE_FIXTURE_WORKTREE}/orders.ts`,
  kind: "file" as const,
};
const FIRST_THREAD = surfaceThreadView();
const SECOND_THREAD = surfaceThreadView({
  thread: { ...FIRST_THREAD.thread, threadId: "agt-2" },
});

describe("Files preview reveal double-click window", () => {
  let host: HTMLDivElement;
  let root: Root;
  let current: AgentSurfaceFileTreeProps | null;
  const open = vi.fn();
  const preview = vi.fn(async () => true);
  const revealEditor = vi.fn();
  const chrome = chromeFixture({
    fileTree: {
      files: { readDirectory: async () => [] },
      fileChanges: null,
      activePath: null,
      revealActivePathSignal: 0,
      onOpenFile: open,
      onPreviewFile: preview,
      revealEditor,
    },
  });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    vi.clearAllMocks();
    preview.mockImplementation(async () => true);
    current = null;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  function Harness({ thread }: { readonly thread: AgentThreadView }) {
    current = useAgentSurfaceScopeTree({
      chrome,
      filesOpen: true,
      scope: surfaceRepositoryScope(SURFACE_FIXTURE_ROOT),
      thread,
      threadRootPath: SURFACE_FIXTURE_WORKTREE,
      onSwitchScope: null,
      onTrustScope: () => undefined,
    });
    return null;
  }

  async function render(thread: AgentThreadView = FIRST_THREAD): Promise<void> {
    await act(async () => root.render(<Harness thread={thread} />));
  }

  function tree(): AgentSurfaceFileTreeProps {
    expect(current).not.toBeNull();
    return current as AgentSurfaceFileTreeProps;
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("previews at once but reveals the editor only after the double-click window", async () => {
    await render();

    act(() => tree().onPreviewFile(FILE));
    await advance(PREVIEW_REVEAL_DELAY_MS - 1);

    expect(preview).toHaveBeenCalledExactlyOnceWith(FILE);
    expect(revealEditor).not.toHaveBeenCalled();
    await advance(1);
    expect(revealEditor).toHaveBeenCalledOnce();
  });

  it("lets an open inside the window replace the pending reveal", async () => {
    await render();

    act(() => tree().onPreviewFile(FILE));
    await advance(PREVIEW_REVEAL_DELAY_MS / 2);
    act(() => tree().onOpenFile(FILE));
    await advance(PREVIEW_REVEAL_DELAY_MS * 2);

    expect(open).toHaveBeenCalledExactlyOnceWith(FILE);
    expect(revealEditor).not.toHaveBeenCalled();
  });

  it("drops the pending reveal when the thread changes inside the window", async () => {
    await render();

    act(() => tree().onPreviewFile(FILE));
    await render(SECOND_THREAD);
    await advance(PREVIEW_REVEAL_DELAY_MS * 2);

    expect(revealEditor).not.toHaveBeenCalled();
  });

  it("drops the pending reveal on unmount", async () => {
    await render();

    act(() => tree().onPreviewFile(FILE));
    act(() => root.render(<></>));
    await advance(PREVIEW_REVEAL_DELAY_MS * 2);

    expect(revealEditor).not.toHaveBeenCalled();
  });

  it("never reveals a preview that did not open", async () => {
    preview.mockImplementation(async () => false);
    await render();

    act(() => tree().onPreviewFile(FILE));
    await advance(PREVIEW_REVEAL_DELAY_MS * 2);

    expect(revealEditor).not.toHaveBeenCalled();
  });
});
