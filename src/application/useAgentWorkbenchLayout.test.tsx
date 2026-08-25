// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initialAgentWorkbenchLayout,
  type AgentWorkbenchLayoutPersisted,
} from "../domain/agentWorkbenchLayout";
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

const diffLayout: AgentWorkbenchLayoutPersisted = {
  layout: "agent",
  rightSurface: "diff",
  bottomPanel: true,
  rightPanelWidth: 700,
  bottomPanelHeight: 320,
};

const terminalLayout: AgentWorkbenchLayoutPersisted = {
  layout: "agent",
  rightSurface: "terminal",
  bottomPanel: false,
  rightPanelWidth: 420,
  bottomPanelHeight: 200,
};

describe("useAgentWorkbenchLayout", () => {
  it("starts in the agent layout for an owned workspace", () => {
    const harness = renderLayout({ workspaceOwnerKey: "workspace-a", hasWorkspace: true });

    expect(harness.result().agentModeActive).toBe(true);
    expect(harness.result().agentWorkbench.effectiveLayout).toBe("agent");
    expect(harness.result().agentWorkbench.layout).toEqual(initialAgentWorkbenchLayout);
    harness.unmount();
  });

  it("forces the expanded editor without a workspace", () => {
    const harness = renderLayout({ workspaceOwnerKey: null, hasWorkspace: false });

    expect(harness.result().agentModeActive).toBe(false);
    expect(harness.result().agentWorkbench.effectiveLayout).toBe("editor-expanded");
    harness.unmount();
  });

  it("forces the expanded editor while the agent layout is unavailable", () => {
    const harness = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      agentLayoutAvailable: false,
    });

    expect(harness.result().agentModeActive).toBe(false);
    expect(harness.result().agentWorkbench.effectiveLayout).toBe("editor-expanded");
    harness.unmount();
  });

  it("ignores dispatches without an owner", () => {
    const harness = renderLayout({ workspaceOwnerKey: null, hasWorkspace: false });

    act(() => harness.result().agentWorkbench.dispatch({ kind: "openSurface", surface: "diff" }));

    expect(harness.result().agentWorkbench.layout).toEqual(initialAgentWorkbenchLayout);
    harness.unmount();
  });

  it("applies reducer actions for the current owner", () => {
    const harness = renderLayout({ workspaceOwnerKey: "workspace-a", hasWorkspace: true });

    act(() => harness.result().agentWorkbench.dispatch({ kind: "openSurface", surface: "diff" }));

    expect(harness.result().agentWorkbench.layout.rightSurface).toBe("diff");

    act(() => harness.result().agentWorkbench.dispatch({ kind: "expandEditor" }));

    expect(harness.result().agentModeActive).toBe(false);
    expect(harness.result().agentWorkbench.effectiveLayout).toBe("editor-expanded");
    harness.unmount();
  });

  it("derives the agent mode flag from the expand and collapse actions", () => {
    const harness = renderLayout({ workspaceOwnerKey: "workspace-a", hasWorkspace: true });

    act(() => harness.result().agentWorkbench.dispatch({ kind: "expandEditor" }));
    expect(harness.result().agentModeActive).toBe(false);

    act(() => harness.result().agentWorkbench.dispatch({ kind: "collapseEditor" }));
    expect(harness.result().agentModeActive).toBe(true);

    act(() => harness.result().agentWorkbench.dispatch({ kind: "toggleEditorExpanded" }));
    expect(harness.result().agentModeActive).toBe(false);

    act(() => harness.result().agentWorkbench.dispatch({ kind: "toggleEditorExpanded" }));
    expect(harness.result().agentModeActive).toBe(true);
    harness.unmount();
  });

  it("hydrates from the owner's persisted layout", async () => {
    const harness = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      hydration: { ownerKey: "workspace-a", layout: diffLayout },
    });

    await harness.settle();

    expect(harness.result().agentWorkbench.layout).toEqual({
      ...diffLayout,
      lastSurface: "diff",
    });
    harness.unmount();
  });

  it("ignores hydration addressed to another owner", async () => {
    const harness = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      hydration: { ownerKey: "workspace-b", layout: diffLayout },
    });

    await harness.settle();

    expect(harness.result().agentWorkbench.layout).toEqual(initialAgentWorkbenchLayout);
    harness.unmount();
  });

  it("fails closed to the defaults for an invalid persisted layout", async () => {
    const harness = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      hydration: { ownerKey: "workspace-a", layout: { layout: "browser", rightSurface: 12 } },
    });

    await harness.settle();

    expect(harness.result().agentWorkbench.layout).toEqual(initialAgentWorkbenchLayout);
    harness.unmount();
  });

  it("never lets a late hydration clobber a dispatch", async () => {
    const harness = renderLayout({ workspaceOwnerKey: "workspace-a", hasWorkspace: true });

    act(() =>
      harness.result().agentWorkbench.dispatch({ kind: "openSurface", surface: "terminal" }),
    );
    harness.rerender({ hydration: { ownerKey: "workspace-a", layout: diffLayout } });
    await harness.settle();

    expect(harness.result().agentWorkbench.layout.rightSurface).toBe("terminal");
    harness.unmount();
  });

  it("restores workspace A and never leaks workspace B across A to B to A", async () => {
    const persistence = recordingPersistence();
    const harness = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      hydration: { ownerKey: "workspace-a", layout: diffLayout },
      persistence,
    });
    await harness.settle();
    expect(harness.result().agentWorkbench.layout.rightSurface).toBe("diff");

    harness.rerender({
      workspaceOwnerKey: "workspace-b",
      hydration: { ownerKey: "workspace-b", layout: terminalLayout },
    });
    await harness.settle();
    expect(harness.result().agentWorkbench.layout.rightSurface).toBe("terminal");
    expect(harness.result().agentWorkbench.layout.rightPanelWidth).toBe(420);

    harness.rerender({
      workspaceOwnerKey: "workspace-a",
      hydration: { ownerKey: "workspace-a", layout: diffLayout },
    });
    await harness.settle();

    expect(harness.result().agentWorkbench.layout.rightSurface).toBe("diff");
    expect(harness.result().agentWorkbench.layout.rightPanelWidth).toBe(700);
    expect(persistence.writes).toEqual([]);
    harness.unmount();
  });

  it("resets to the defaults for an owner without a persisted layout", async () => {
    const harness = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      hydration: { ownerKey: "workspace-a", layout: diffLayout },
    });
    await harness.settle();

    harness.rerender({ workspaceOwnerKey: "workspace-b", hydration: null });
    await harness.settle();

    expect(harness.result().agentWorkbench.layout).toEqual(initialAgentWorkbenchLayout);
    harness.unmount();
  });

  it("persists a changed layout for the owner that changed it", async () => {
    const persistence = recordingPersistence();
    const harness = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      persistence,
    });

    act(() => harness.result().agentWorkbench.dispatch({ kind: "openSurface", surface: "diff" }));
    await harness.settle();

    expect(persistence.writes).toEqual([
      {
        ownerKey: "workspace-a",
        layout: {
          layout: "agent",
          rightSurface: "diff",
          bottomPanel: false,
          rightPanelWidth: initialAgentWorkbenchLayout.rightPanelWidth,
          bottomPanelHeight: initialAgentWorkbenchLayout.bottomPanelHeight,
        },
      },
    ]);
    harness.unmount();
  });

  it("does not write an unchanged snapshot", async () => {
    const persistence = recordingPersistence();
    const harness = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      persistence,
    });

    act(() => harness.result().agentWorkbench.dispatch({ kind: "openSurface", surface: "diff" }));
    await harness.settle();
    act(() => harness.result().agentWorkbench.dispatch({ kind: "openSurface", surface: "diff" }));
    await harness.settle();

    expect(persistence.writes).toHaveLength(1);
    harness.unmount();
  });

  it("does not persist the remembered surface", async () => {
    const persistence = recordingPersistence();
    const harness = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      persistence,
    });

    act(() => harness.result().agentWorkbench.dispatch({ kind: "openSurface", surface: "diff" }));
    act(() => harness.result().agentWorkbench.dispatch({ kind: "toggleRightPanel" }));
    await harness.settle();

    const last = persistence.writes[persistence.writes.length - 1];
    expect(last.layout.rightSurface).toBeNull();
    expect("lastSurface" in last.layout).toBe(false);
    harness.unmount();
  });

  it("drops an in-flight write when the owner changes before it starts", async () => {
    const persistence = recordingPersistence();
    const harness = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      persistence,
    });

    act(() => {
      harness.result().agentWorkbench.dispatch({ kind: "openSurface", surface: "diff" });
      harness.rerenderWithoutAct({ workspaceOwnerKey: "workspace-b" });
    });
    await harness.settle();

    expect(persistence.writes.map((write) => write.ownerKey)).not.toContain("workspace-a");
    harness.unmount();
  });

  it("reports a failed write without losing the layout", async () => {
    const reportError = vi.fn();
    const persistence: AgentWorkbenchLayoutPersistencePort = {
      write: () => Promise.reject(new Error("save failed")),
    };
    const harness = renderLayout({
      workspaceOwnerKey: "workspace-a",
      hasWorkspace: true,
      persistence,
      reportError,
    });

    act(() => harness.result().agentWorkbench.dispatch({ kind: "openSurface", surface: "diff" }));
    await harness.settle();

    expect(reportError).toHaveBeenCalledWith("Agent Layout", expect.any(Error));
    expect(harness.result().agentWorkbench.layout.rightSurface).toBe("diff");
    harness.unmount();
  });

  it("rejects stale callbacks captured before an owner change", () => {
    const harness = renderLayout({ workspaceOwnerKey: "workspace-a", hasWorkspace: true });
    const staleA = harness.result();

    harness.rerender({ workspaceOwnerKey: "workspace-b" });
    act(() => staleA.agentWorkbench.dispatch({ kind: "openSurface", surface: "diff" }));

    expect(harness.result().agentWorkbench.layout).toEqual(initialAgentWorkbenchLayout);
    harness.unmount();
  });
});

function recordingPersistence(): AgentWorkbenchLayoutPersistencePort & {
  readonly writes: Array<{ ownerKey: string; layout: AgentWorkbenchLayoutPersisted }>;
} {
  const writes: Array<{ ownerKey: string; layout: AgentWorkbenchLayoutPersisted }> = [];
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
  let latestResult: AgentWorkbenchLayoutSurface | null = null;
  const root = createRoot(document.body.appendChild(document.createElement("div")));

  function Harness() {
    latestResult = useAgentWorkbenchLayout(options);
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    result: getResult,
    rerender(next: Partial<UseAgentWorkbenchLayoutOptions>) {
      act(() => rerenderWithoutAct(next));
    },
    rerenderWithoutAct,
    async settle() {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    unmount: () => act(() => root.unmount()),
  };

  function rerenderWithoutAct(next: Partial<UseAgentWorkbenchLayoutOptions>) {
    options = { ...options, ...next } as UseAgentWorkbenchLayoutOptions;
    root.render(<Harness />);
  }

  function getResult(): AgentWorkbenchLayoutSurface {
    if (!latestResult) {
      throw new Error("agent workbench layout hook is not mounted");
    }
    return latestResult;
  }
}
