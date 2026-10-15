import { describe, expect, it } from "vitest";
import {
  initialAgentWorkbenchLayout,
  type AgentWorkbenchLayout,
  type AgentWorkbenchLayoutMode,
} from "../../domain/agentWorkbenchLayout";
import type { QuickOpenLocation } from "../../domain/quickOpenQuery";
import type { FileSearchResult } from "../../domain/workspace";
import type { AgentWorkbenchCommand } from "../useAgentWorkbenchLayout";
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
  readonly commands: AgentWorkbenchCommand[];
}

function workbench(initial: Partial<Pick<WorkbenchState, "agentModeActive" | "effectiveLayout">>): {
  readonly state: WorkbenchState;
  current(): PaletteFileOpenPort;
} {
  const state: WorkbenchState = {
    layout: initialAgentWorkbenchLayout,
    agentModeActive: true,
    effectiveLayout: "agent",
    opened: [],
    commands: [],
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
        dispatch: (command) => {
          state.commands.push(command);
        },
      },
      openSearchResult: async (result, location) => {
        state.opened.push({ result, location });
        return true;
      },
    }),
  };
}

describe("openPaletteFile", () => {
  it("reveals the file in the Files viewer in agent mode without opening the editor", async () => {
    const bench = workbench({});

    await openPaletteFile(bench.current, ORDERS);

    expect(bench.state.opened).toEqual([]);
    expect(bench.state.commands).toEqual([
      { kind: "revealFile", path: "/u/orders-api/src/orders.ts", line: null },
    ]);
  });

  it("carries the quick open line into the viewer reveal", async () => {
    const bench = workbench({});

    await openPaletteFile(bench.current, ORDERS, { line: 12, column: 3 });

    expect(bench.state.commands).toEqual([
      { kind: "revealFile", path: "/u/orders-api/src/orders.ts", line: 12 },
    ]);
  });

  it("opens the search result in the editor-only fallback and leaves the layout alone", async () => {
    const editorMode = workbench({ agentModeActive: false, effectiveLayout: "editor-only" });
    const fallback = workbench({ effectiveLayout: "editor-only" });

    await openPaletteFile(editorMode.current, ORDERS);
    await openPaletteFile(fallback.current, ORDERS);

    expect(editorMode.state.opened).toHaveLength(1);
    expect(fallback.state.opened).toHaveLength(1);
    expect(editorMode.state.commands).toEqual([]);
    expect(fallback.state.commands).toEqual([]);
  });
});
