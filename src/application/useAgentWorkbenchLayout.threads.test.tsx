// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentWorkbenchLayoutAction } from "../domain/agentWorkbenchLayout";
import {
  MAX_AGENT_THREAD_LAYOUTS,
  type AgentWorkbenchSessionPersisted,
} from "../domain/agentWorkbenchLayoutThreads";
import {
  useAgentWorkbenchLayout,
  type AgentWorkbenchLayoutPersistencePort,
  type AgentWorkbenchLayoutSurface,
  type UseAgentWorkbenchLayoutOptions,
} from "./useAgentWorkbenchLayout";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useAgentWorkbenchLayout per-thread right panel", () => {
  it("restores each thread's tabs and maximization across A to B to A while width stays per workspace", () => {
    const harness = renderLayout({ workspaceOwnerKey: "workspace-a", hasWorkspace: true });

    harness.bind("thread-a");
    harness.dispatch({ kind: "openSurface", surface: "diff" });
    harness.dispatch({ kind: "maximizeRightPanel" });

    harness.bind("thread-b");
    harness.dispatch({ kind: "toggleMaximized" });
    harness.dispatch({ kind: "openSurface", surface: "terminal" });
    harness.dispatch({ kind: "resizeRightPanel", width: 720 });

    harness.bind("thread-a");
    expect(harness.layout()).toMatchObject({
      rightPanel: "open",
      openSurfaces: ["diff"],
      activeSurface: "diff",
      rightPanelMaximized: true,
      rightPanelWidth: 720,
    });

    harness.bind("thread-b");
    expect(harness.layout()).toMatchObject({
      openSurfaces: ["diff", "terminal"],
      activeSurface: "terminal",
      rightPanelMaximized: false,
      rightPanelWidth: 720,
    });
    harness.unmount();
  });

  it("starts an unknown thread from the selection shown last", () => {
    const harness = renderLayout({ workspaceOwnerKey: "workspace-a", hasWorkspace: true });

    harness.bind("thread-a");
    harness.dispatch({ kind: "openSurface", surface: "git" });
    harness.bind("thread-new");

    expect(harness.layout()).toMatchObject({ openSurfaces: ["git"], activeSurface: "git" });
    harness.unmount();
  });

  it("keeps a revealed file per thread and bumps the sequence on every reveal", () => {
    const harness = renderLayout({ workspaceOwnerKey: "workspace-a", hasWorkspace: true });

    harness.bind("thread-a");
    harness.dispatch({ kind: "revealFile", path: "/repo/a.ts", line: 4 });
    const first = harness.state().fileReveal;
    expect(first).toEqual({ path: "/repo/a.ts", line: 4, sequence: expect.any(Number) });
    expect(harness.layout()).toMatchObject({ openSurfaces: ["files"], activeSurface: "files" });

    harness.dispatch({ kind: "revealFile", path: "/repo/a.ts", line: 4 });
    const second = harness.state().fileReveal;
    expect(second?.sequence).toBeGreaterThan(first?.sequence ?? Number.POSITIVE_INFINITY);

    harness.bind("thread-b");
    expect(harness.state().fileReveal).toBeNull();
    harness.dispatch({ kind: "revealFile", path: "/repo/b.ts" });
    expect(harness.state().fileReveal).toMatchObject({ path: "/repo/b.ts", line: null });

    harness.bind("thread-a");
    expect(harness.state().fileReveal).toEqual(second);
    harness.unmount();
  });

  it("carries the viewer request id with the stored reveal", () => {
    const harness = renderLayout({ workspaceOwnerKey: "workspace-a", hasWorkspace: true });

    harness.bind("thread-a");
    harness.dispatch({ kind: "revealFile", path: "/repo/a.ts", line: 2, request: 9 });

    expect(harness.state().fileReveal).toEqual({
      path: "/repo/a.ts",
      line: 2,
      sequence: expect.any(Number),
      request: 9,
    });
    harness.unmount();
  });

  it("ignores an invalid reveal fail-closed and keeps the previous one", () => {
    const harness = renderLayout({ workspaceOwnerKey: "workspace-a", hasWorkspace: true });

    harness.dispatch({ kind: "revealFile", path: "/repo/a.ts", line: 0 });
    const kept = harness.state().fileReveal;
    expect(kept).toMatchObject({ path: "/repo/a.ts", line: null });
    const layout = harness.layout();

    harness.dispatch({ kind: "revealFile", path: "" });
    harness.dispatch({ kind: "revealFile", path: "x".repeat(5_000) });

    expect(harness.state().fileReveal).toBe(kept);
    expect(harness.layout()).toBe(layout);
    harness.unmount();
  });

  it("treats an oversized thread id as no thread", () => {
    const harness = renderLayout({ workspaceOwnerKey: "workspace-a", hasWorkspace: true });

    harness.bind("t".repeat(300));
    harness.dispatch({ kind: "openSurface", surface: "diff" });
    harness.bind("thread-a");
    harness.dispatch({ kind: "openSurface", surface: "files" });
    harness.bind("t".repeat(300));

    expect(harness.layout().openSurfaces).toEqual(["diff", "files"]);
    harness.unmount();
  });

  it("persists the per-thread layouts and restores them on hydration", async () => {
    const persistence = recordingPersistence();
    const writer = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      persistence,
    });
    writer.bind("thread-a");
    writer.dispatch({ kind: "openSurface", surface: "diff" });
    writer.dispatch({ kind: "revealFile", path: "/repo/a.ts" });
    writer.bind("thread-b");
    writer.dispatch({ kind: "showSurfaceChooser" });
    await writer.settle();
    writer.unmount();

    const stored = persistence.writes[persistence.writes.length - 1]?.layout;
    expect(stored?.threadLayouts).toEqual([
      {
        threadId: "thread-b",
        openSurfaces: ["diff", "files"],
        activeSurface: null,
        rightPanelMaximized: false,
      },
      {
        threadId: "thread-a",
        openSurfaces: ["diff", "files"],
        activeSurface: "files",
        rightPanelMaximized: false,
      },
    ]);
    expect(JSON.stringify(stored)).not.toContain("/repo/a.ts");

    const reader = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      hydration: { ownerKey: "workspace-a", layout: JSON.parse(JSON.stringify(stored)) },
    });
    await reader.settle();
    reader.bind("thread-a");
    expect(reader.layout()).toMatchObject({ activeSurface: "files" });
    expect(reader.state().fileReveal).toBeNull();
    reader.bind("thread-b");
    expect(reader.layout()).toMatchObject({ activeSurface: null });
    reader.unmount();
  });

  it("fails closed on malformed persisted thread layouts", async () => {
    const harness = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      hydration: {
        ownerKey: "workspace-a",
        layout: {
          rightPanel: "open",
          openSurfaces: ["git"],
          activeSurface: "git",
          threadLayouts: [
            null,
            { threadId: "", openSurfaces: ["diff"], activeSurface: "diff" },
            { threadId: "thread-a", openSurfaces: "diff", activeSurface: "diff" },
            {
              threadId: "thread-b",
              openSurfaces: ["editor", "bogus", "terminal"],
              activeSurface: "editor",
              rightPanelMaximized: "yes",
            },
            { threadId: "thread-b", openSurfaces: ["files"], activeSurface: "files" },
          ],
        },
      },
    });
    await harness.settle();

    harness.bind("thread-a");
    expect(harness.layout()).toMatchObject({ openSurfaces: ["git"], activeSurface: "git" });
    harness.bind("thread-b");
    expect(harness.layout()).toMatchObject({
      openSurfaces: ["terminal"],
      activeSurface: "terminal",
      rightPanelMaximized: false,
    });
    harness.unmount();
  });

  it("evicts the least recently used thread layout beyond the bound", async () => {
    const persistence = recordingPersistence();
    const harness = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      persistence,
    });
    for (let index = 0; index <= MAX_AGENT_THREAD_LAYOUTS; index += 1) {
      harness.bind(`thread-${index}`);
      harness.dispatch({ kind: "resizeRightPanel", width: 400 + (index % 2) });
    }
    await harness.settle();

    const stored = persistence.writes[persistence.writes.length - 1]?.layout.threadLayouts ?? [];
    expect(stored).toHaveLength(MAX_AGENT_THREAD_LAYOUTS);
    expect(stored[0]?.threadId).toBe(`thread-${MAX_AGENT_THREAD_LAYOUTS}`);
    expect(stored.some((entry) => entry.threadId === "thread-0")).toBe(false);
    expect(stored.some((entry) => entry.threadId === "thread-1")).toBe(true);
    harness.unmount();
  });

  it("never leaks thread layouts across workspace A to B to A", async () => {
    const harness = renderLayout({ workspaceOwnerKey: "workspace-a", hasWorkspace: true });
    harness.bind("thread-a");
    harness.dispatch({ kind: "openSurface", surface: "diff" });

    harness.rerender({ workspaceOwnerKey: "workspace-b" });
    expect(harness.layout().openSurfaces).toEqual([]);
    harness.dispatch({ kind: "openSurface", surface: "terminal" });

    harness.rerender({
      workspaceOwnerKey: "workspace-a",
      hydration: {
        ownerKey: "workspace-a",
        layout: { openSurfaces: ["git"], activeSurface: "git" },
      },
    });
    await harness.settle();
    expect(harness.layout()).toMatchObject({ openSurfaces: ["git"], activeSurface: "git" });
    harness.unmount();
  });
});

function recordingPersistence(): AgentWorkbenchLayoutPersistencePort & {
  readonly writes: Array<{ ownerKey: string; layout: AgentWorkbenchSessionPersisted }>;
} {
  const writes: Array<{ ownerKey: string; layout: AgentWorkbenchSessionPersisted }> = [];
  return {
    writes,
    write: (ownerKey, layout) => {
      writes.push({ ownerKey, layout });
      return Promise.resolve();
    },
  };
}

function renderLayout(initialOptions: UseAgentWorkbenchLayoutOptions) {
  let options = initialOptions;
  let latest: AgentWorkbenchLayoutSurface | null = null;
  const root = createRoot(document.body.appendChild(document.createElement("div")));

  function Harness() {
    latest = useAgentWorkbenchLayout(options);
    return null;
  }

  act(() => root.render(<Harness />));

  const result = (): AgentWorkbenchLayoutSurface => {
    if (latest === null) throw new Error("agent workbench layout hook is not mounted");
    return latest;
  };

  return {
    state: () => result().agentWorkbench,
    layout: () => result().agentWorkbench.layout,
    bind(threadId: string | null) {
      act(() => result().agentWorkbench.bindThread?.(threadId));
    },
    dispatch(action: AgentWorkbenchLayoutAction) {
      act(() => result().agentWorkbench.dispatch(action));
    },
    rerender(next: Partial<UseAgentWorkbenchLayoutOptions>) {
      options = { ...options, ...next };
      act(() => root.render(<Harness />));
    },
    async settle() {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    unmount: () => act(() => root.unmount()),
  };
}
