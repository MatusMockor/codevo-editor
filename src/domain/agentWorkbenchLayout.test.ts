import { describe, expect, it } from "vitest";
import {
  AGENT_SURFACE_KINDS,
  DEFAULT_AGENT_BOTTOM_PANEL_HEIGHT,
  DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
  MAX_AGENT_BOTTOM_PANEL_HEIGHT,
  MAX_AGENT_RIGHT_PANEL_WIDTH,
  MIN_AGENT_BOTTOM_PANEL_HEIGHT,
  MIN_AGENT_RIGHT_PANEL_WIDTH,
  agentWorkbenchLayoutReducer,
  agentWorkbenchLayoutsEqual,
  initialAgentWorkbenchLayout,
  parseAgentWorkbenchLayout,
  serializeAgentWorkbenchLayout,
  type AgentSurfaceKind,
  type AgentWorkbenchLayout,
  type AgentWorkbenchLayoutAction,
} from "./agentWorkbenchLayout";

const ACTIONS: ReadonlyArray<AgentWorkbenchLayoutAction> = [
  { kind: "openSurface", surface: "files" },
  { kind: "openSurface", surface: "diff" },
  { kind: "openSurface", surface: "terminal" },
  { kind: "closeSurface" },
  { kind: "toggleRightPanel" },
  { kind: "toggleBottomPanel" },
  { kind: "showBottomPanel" },
  { kind: "hideBottomPanel" },
  { kind: "expandEditor" },
  { kind: "collapseEditor" },
  { kind: "toggleEditorExpanded" },
  { kind: "resizeRightPanel", width: 700 },
  { kind: "resizeBottomPanel", height: 400 },
];

function layoutOf(overrides: Partial<AgentWorkbenchLayout>): AgentWorkbenchLayout {
  return { ...initialAgentWorkbenchLayout, ...overrides };
}

function everyReachableState(): ReadonlyArray<AgentWorkbenchLayout> {
  const surfaces: ReadonlyArray<AgentSurfaceKind | null> = [null, ...AGENT_SURFACE_KINDS];
  return ["agent", "editor-expanded"].flatMap((layout) =>
    surfaces.flatMap((rightSurface) =>
      AGENT_SURFACE_KINDS.flatMap((lastSurface) =>
        [false, true].map((bottomPanel) =>
          layoutOf({
            layout: layout as AgentWorkbenchLayout["layout"],
            rightSurface: layout === "editor-expanded" ? null : rightSurface,
            lastSurface,
            bottomPanel,
          }),
        ),
      ),
    ),
  );
}

describe("agentWorkbenchLayoutReducer", () => {
  it("keeps every state valid for every action", () => {
    everyReachableState().forEach((state) => {
      ACTIONS.forEach((action) => {
        const next = agentWorkbenchLayoutReducer(state, action);

        expect(next.rightPanelWidth).toBeGreaterThanOrEqual(MIN_AGENT_RIGHT_PANEL_WIDTH);
        expect(next.rightPanelWidth).toBeLessThanOrEqual(MAX_AGENT_RIGHT_PANEL_WIDTH);
        expect(next.bottomPanelHeight).toBeGreaterThanOrEqual(MIN_AGENT_BOTTOM_PANEL_HEIGHT);
        expect(next.bottomPanelHeight).toBeLessThanOrEqual(MAX_AGENT_BOTTOM_PANEL_HEIGHT);
        expect(AGENT_SURFACE_KINDS).toContain(next.lastSurface);

        if (next.layout === "editor-expanded") {
          expect(next.rightSurface).toBeNull();
        }
      });
    });
  });

  it("never mutates the input state", () => {
    everyReachableState().forEach((state) => {
      ACTIONS.forEach((action) => {
        const snapshot = { ...state };
        agentWorkbenchLayoutReducer(state, action);
        expect(state).toEqual(snapshot);
      });
    });
  });

  it("opens a surface into the agent layout and remembers it", () => {
    AGENT_SURFACE_KINDS.forEach((surface) => {
      const next = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
        kind: "openSurface",
        surface,
      });

      expect(next.layout).toBe("agent");
      expect(next.rightSurface).toBe(surface);
      expect(next.lastSurface).toBe(surface);
    });
  });

  it("replaces the open surface instead of stacking surfaces", () => {
    const files = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "openSurface",
      surface: "files",
    });
    const diff = agentWorkbenchLayoutReducer(files, { kind: "openSurface", surface: "diff" });

    expect(diff.rightSurface).toBe("diff");
    expect(diff.lastSurface).toBe("diff");
  });

  it("returns to the agent layout when a surface is opened while expanded", () => {
    const expanded = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "expandEditor",
    });
    const next = agentWorkbenchLayoutReducer(expanded, {
      kind: "openSurface",
      surface: "terminal",
    });

    expect(next.layout).toBe("agent");
    expect(next.rightSurface).toBe("terminal");
  });

  it("toggles the right panel closed and reopens the remembered surface", () => {
    const diff = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "openSurface",
      surface: "diff",
    });
    const closed = agentWorkbenchLayoutReducer(diff, { kind: "toggleRightPanel" });

    expect(closed.rightSurface).toBeNull();
    expect(closed.lastSurface).toBe("diff");

    const reopened = agentWorkbenchLayoutReducer(closed, { kind: "toggleRightPanel" });
    expect(reopened.rightSurface).toBe("diff");
  });

  it("opens the default files surface when nothing was opened yet", () => {
    const next = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "toggleRightPanel",
    });

    expect(next.rightSurface).toBe("files");
  });

  it("collapses back to the agent layout when the right panel is toggled while expanded", () => {
    const expanded = agentWorkbenchLayoutReducer(
      layoutOf({ rightSurface: "diff", lastSurface: "diff" }),
      { kind: "expandEditor" },
    );
    const next = agentWorkbenchLayoutReducer(expanded, { kind: "toggleRightPanel" });

    expect(next.layout).toBe("agent");
    expect(next.rightSurface).toBe("diff");
  });

  it("expands from every surface and restores it on collapse", () => {
    AGENT_SURFACE_KINDS.forEach((surface) => {
      const open = layoutOf({ rightSurface: surface, lastSurface: surface });
      const expanded = agentWorkbenchLayoutReducer(open, { kind: "expandEditor" });

      expect(expanded.layout).toBe("editor-expanded");
      expect(expanded.rightSurface).toBeNull();
      expect(expanded.lastSurface).toBe(surface);

      const collapsed = agentWorkbenchLayoutReducer(expanded, { kind: "collapseEditor" });
      expect(collapsed.layout).toBe("agent");
      expect(collapsed.rightSurface).toBe(surface);
    });
  });

  it("expands with no open surface and collapses to the files surface", () => {
    const expanded = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "expandEditor",
    });
    const collapsed = agentWorkbenchLayoutReducer(expanded, { kind: "collapseEditor" });

    expect(collapsed.rightSurface).toBe("files");
  });

  it("toggles the expanded editor in both directions", () => {
    const expanded = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "toggleEditorExpanded",
    });
    expect(expanded.layout).toBe("editor-expanded");

    const collapsed = agentWorkbenchLayoutReducer(expanded, { kind: "toggleEditorExpanded" });
    expect(collapsed.layout).toBe("agent");
  });

  it("keeps expand and collapse idempotent", () => {
    const expanded = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "expandEditor",
    });

    expect(agentWorkbenchLayoutReducer(expanded, { kind: "expandEditor" })).toBe(expanded);
    expect(
      agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, { kind: "collapseEditor" }),
    ).toBe(initialAgentWorkbenchLayout);
  });

  it("drives the bottom panel independently of the layout", () => {
    const shown = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "toggleBottomPanel",
    });
    expect(shown.bottomPanel).toBe(true);
    expect(shown.layout).toBe("agent");

    expect(agentWorkbenchLayoutReducer(shown, { kind: "showBottomPanel" })).toBe(shown);
    expect(agentWorkbenchLayoutReducer(shown, { kind: "hideBottomPanel" }).bottomPanel).toBe(false);
    expect(agentWorkbenchLayoutReducer(shown, { kind: "toggleBottomPanel" }).bottomPanel).toBe(
      false,
    );

    const expanded = agentWorkbenchLayoutReducer(shown, { kind: "expandEditor" });
    expect(expanded.bottomPanel).toBe(true);
  });

  it("clamps resize actions", () => {
    const narrow = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "resizeRightPanel",
      width: 10,
    });
    const wide = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "resizeRightPanel",
      width: 100_000,
    });
    const short = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "resizeBottomPanel",
      height: -5,
    });
    const tall = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "resizeBottomPanel",
      height: 100_000,
    });

    expect(narrow.rightPanelWidth).toBe(MIN_AGENT_RIGHT_PANEL_WIDTH);
    expect(wide.rightPanelWidth).toBe(MAX_AGENT_RIGHT_PANEL_WIDTH);
    expect(short.bottomPanelHeight).toBe(MIN_AGENT_BOTTOM_PANEL_HEIGHT);
    expect(tall.bottomPanelHeight).toBe(MAX_AGENT_BOTTOM_PANEL_HEIGHT);
  });

  it("falls back to the defaults for non-finite sizes", () => {
    const width = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "resizeRightPanel",
      width: Number.NaN,
    });
    const height = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "resizeBottomPanel",
      height: Number.POSITIVE_INFINITY,
    });

    expect(width.rightPanelWidth).toBe(DEFAULT_AGENT_RIGHT_PANEL_WIDTH);
    expect(height.bottomPanelHeight).toBe(DEFAULT_AGENT_BOTTOM_PANEL_HEIGHT);
  });

  it("rejects an unsupported action", () => {
    expect(() =>
      agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
        kind: "browserSurface",
      } as unknown as AgentWorkbenchLayoutAction),
    ).toThrow(TypeError);
  });
});

describe("parseAgentWorkbenchLayout", () => {
  it("returns the initial layout for non-record values", () => {
    [null, undefined, 4, "agent", [], true].forEach((value) => {
      expect(parseAgentWorkbenchLayout(value)).toEqual(initialAgentWorkbenchLayout);
    });
  });

  it("returns the initial layout for an entirely invalid record", () => {
    expect(
      parseAgentWorkbenchLayout({
        layout: "browser",
        rightSurface: "preview",
        bottomPanel: "yes",
        rightPanelWidth: "wide",
        bottomPanelHeight: null,
      }),
    ).toEqual(initialAgentWorkbenchLayout);
  });

  it("restores a valid persisted layout", () => {
    expect(
      parseAgentWorkbenchLayout({
        layout: "agent",
        rightSurface: "diff",
        bottomPanel: true,
        rightPanelWidth: 640,
        bottomPanelHeight: 320,
      }),
    ).toEqual({
      layout: "agent",
      rightSurface: "diff",
      lastSurface: "diff",
      bottomPanel: true,
      rightPanelWidth: 640,
      bottomPanelHeight: 320,
    });
  });

  it("clamps out-of-bounds persisted sizes", () => {
    const parsed = parseAgentWorkbenchLayout({
      layout: "agent",
      rightSurface: "files",
      bottomPanel: false,
      rightPanelWidth: 5,
      bottomPanelHeight: 99_999,
    });

    expect(parsed.rightPanelWidth).toBe(MIN_AGENT_RIGHT_PANEL_WIDTH);
    expect(parsed.bottomPanelHeight).toBe(MAX_AGENT_BOTTOM_PANEL_HEIGHT);
  });

  it("drops a surface persisted alongside the expanded layout", () => {
    const parsed = parseAgentWorkbenchLayout({
      layout: "editor-expanded",
      rightSurface: "terminal",
      bottomPanel: false,
      rightPanelWidth: DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
      bottomPanelHeight: DEFAULT_AGENT_BOTTOM_PANEL_HEIGHT,
    });

    expect(parsed.rightSurface).toBeNull();
    expect(parsed.lastSurface).toBe("terminal");
  });

  it("never throws for adversarial values", () => {
    expect(() =>
      parseAgentWorkbenchLayout({
        layout: { toString: () => "agent" },
        rightSurface: ["files"],
        rightPanelWidth: Number.NaN,
        bottomPanelHeight: Number.NEGATIVE_INFINITY,
      }),
    ).not.toThrow();
  });
});

describe("serializeAgentWorkbenchLayout", () => {
  it("omits the remembered surface", () => {
    const state = agentWorkbenchLayoutReducer(
      agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
        kind: "openSurface",
        surface: "diff",
      }),
      { kind: "toggleRightPanel" },
    );

    expect(serializeAgentWorkbenchLayout(state)).toEqual({
      layout: "agent",
      rightSurface: null,
      bottomPanel: false,
      rightPanelWidth: DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
      bottomPanelHeight: DEFAULT_AGENT_BOTTOM_PANEL_HEIGHT,
    });
  });

  it("round-trips through the parser", () => {
    const state = agentWorkbenchLayoutReducer(
      agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
        kind: "openSurface",
        surface: "terminal",
      }),
      { kind: "resizeRightPanel", width: 800 },
    );

    expect(parseAgentWorkbenchLayout(serializeAgentWorkbenchLayout(state))).toEqual(state);
  });
});

describe("agentWorkbenchLayoutsEqual", () => {
  it("compares the remembered surface too", () => {
    expect(
      agentWorkbenchLayoutsEqual(initialAgentWorkbenchLayout, { ...initialAgentWorkbenchLayout }),
    ).toBe(true);
    expect(
      agentWorkbenchLayoutsEqual(initialAgentWorkbenchLayout, layoutOf({ lastSurface: "diff" })),
    ).toBe(false);
    expect(
      agentWorkbenchLayoutsEqual(initialAgentWorkbenchLayout, layoutOf({ bottomPanel: true })),
    ).toBe(false);
  });
});
