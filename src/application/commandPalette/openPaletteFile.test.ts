import { describe, expect, it } from "vitest";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
  type AgentWorkbenchLayout,
  type AgentWorkbenchLayoutAction,
  type AgentWorkbenchLayoutMode,
} from "../../domain/agentWorkbenchLayout";
import type { QuickOpenLocation } from "../../domain/quickOpenQuery";
import type { FileSearchResult } from "../../domain/workspace";
import { openPaletteFile, type PaletteFileOpenPort } from "./openPaletteFile";

const ORDERS: FileSearchResult = {
  name: "orders.ts",
  path: "/u/orders-api/src/orders.ts",
  relativePath: "src/orders.ts",
};

interface WorkbenchState {
  layout: AgentWorkbenchLayout;
  agentModeActive: boolean;
  effectiveLayout: AgentWorkbenchLayoutMode;
  readonly opened: { result: FileSearchResult; location: QuickOpenLocation | undefined }[];
  readonly actions: AgentWorkbenchLayoutAction[];
}

function workbench(
  initial: Partial<Pick<WorkbenchState, "layout" | "agentModeActive" | "effectiveLayout">>,
  openOutcome: boolean,
  duringOpen: (state: WorkbenchState) => void = () => undefined,
): { readonly state: WorkbenchState; current(): PaletteFileOpenPort } {
  const state: WorkbenchState = {
    layout: initialAgentWorkbenchLayout,
    agentModeActive: true,
    effectiveLayout: "agent",
    opened: [],
    actions: [],
    ...initial,
  };
  return {
    state,
    current: () => ({
      agentModeActive: state.agentModeActive,
      agentWorkbench: {
        layout: state.layout,
        effectiveLayout: state.effectiveLayout,
        persistedBottomPanel: false,
        dispatch: (action) => {
          state.actions.push(action);
          state.layout = agentWorkbenchLayoutReducer(state.layout, action);
        },
      },
      openSearchResult: async (result, location) => {
        state.opened.push({ result, location });
        duringOpen(state);
        return openOutcome;
      },
    }),
  };
}

describe("openPaletteFile", () => {
  it("reveals the Files surface in agent mode when the right panel is closed", async () => {
    const bench = workbench({}, true);

    await openPaletteFile(bench.current, ORDERS);

    expect(bench.state.opened).toEqual([{ result: ORDERS, location: undefined }]);
    expect(bench.state.layout.rightPanel).toBe("open");
    expect(bench.state.layout.activeSurface).toBe("files");
  });

  it("switches an open right panel from another surface to Files and keeps the location", async () => {
    const bench = workbench(
      {
        layout: {
          ...initialAgentWorkbenchLayout,
          rightPanel: "open",
          openSurfaces: ["diff"],
          activeSurface: "diff",
        },
      },
      true,
    );
    const location = { line: 12, column: 3 };

    await openPaletteFile(bench.current, ORDERS, location);

    expect(bench.state.opened).toEqual([{ result: ORDERS, location }]);
    expect(bench.state.layout.openSurfaces).toEqual(["diff", "files"]);
    expect(bench.state.layout.activeSurface).toBe("files");
  });

  it("does not reveal anything when the open fails or goes stale", async () => {
    const bench = workbench({}, false);

    await openPaletteFile(bench.current, ORDERS);

    expect(bench.state.actions).toEqual([]);
    expect(bench.state.layout.rightPanel).toBe("closed");
  });

  it("leaves the layout alone in editor mode and in the expanded editor", async () => {
    const editorMode = workbench(
      { agentModeActive: false, effectiveLayout: "editor-expanded" },
      true,
    );
    const expanded = workbench({ effectiveLayout: "editor-expanded" }, true);

    await openPaletteFile(editorMode.current, ORDERS);
    await openPaletteFile(expanded.current, ORDERS);

    expect(editorMode.state.opened).toHaveLength(1);
    expect(expanded.state.opened).toHaveLength(1);
    expect(editorMode.state.actions).toEqual([]);
    expect(expanded.state.actions).toEqual([]);
  });

  it("reads the mode after the open settles, not before", async () => {
    const bench = workbench(
      { agentModeActive: false, effectiveLayout: "editor-expanded" },
      true,
      (state) => {
        state.agentModeActive = true;
        state.effectiveLayout = "agent";
      },
    );

    await openPaletteFile(bench.current, ORDERS);

    expect(bench.state.layout.activeSurface).toBe("files");
  });
});
