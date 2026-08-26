import { describe, expect, it } from "vitest";
import {
  AGENT_SURFACE_KINDS,
  DEFAULT_AGENT_BOTTOM_PANEL_HEIGHT,
  DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
  MAX_AGENT_BOTTOM_PANEL_HEIGHT,
  MAX_AGENT_OPEN_SURFACES,
  MAX_AGENT_RIGHT_PANEL_WIDTH,
  MIN_AGENT_BOTTOM_PANEL_HEIGHT,
  MIN_AGENT_RIGHT_PANEL_WIDTH,
  agentWorkbenchLayoutReducer,
  agentWorkbenchLayoutSnapshotsEqual,
  agentWorkbenchLayoutsEqual,
  initialAgentWorkbenchLayout,
  parseAgentWorkbenchLayout,
  serializeAgentWorkbenchLayout,
  type AgentSurfaceKind,
  type AgentWorkbenchLayout,
  type AgentWorkbenchLayoutAction,
} from "./agentWorkbenchLayout";

const ACTIONS: ReadonlyArray<AgentWorkbenchLayoutAction> = [
  ...AGENT_SURFACE_KINDS.map((surface) => ({ kind: "openSurface", surface }) as const),
  ...AGENT_SURFACE_KINDS.map((surface) => ({ kind: "activateSurface", surface }) as const),
  ...AGENT_SURFACE_KINDS.map((surface) => ({ kind: "closeSurfaceTab", surface }) as const),
  { kind: "showSurfaceChooser" },
  { kind: "toggleRightPanel" },
  { kind: "toggleMaximized" },
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

function open(
  openSurfaces: ReadonlyArray<AgentSurfaceKind>,
  activeSurface: AgentSurfaceKind | null,
  overrides: Partial<AgentWorkbenchLayout> = {},
): AgentWorkbenchLayout {
  return layoutOf({ rightPanel: "open", openSurfaces, activeSurface, ...overrides });
}

const EXPANDED = layoutOf({ layout: "editor-expanded" });

function orderedSubsets(): ReadonlyArray<ReadonlyArray<AgentSurfaceKind>> {
  const subsets: AgentSurfaceKind[][] = [[]];
  const extend = (prefix: AgentSurfaceKind[]): void => {
    for (const surface of AGENT_SURFACE_KINDS) {
      if (prefix.includes(surface)) continue;
      const next = [...prefix, surface];
      subsets.push(next);
      extend(next);
    }
  };
  extend([]);
  return subsets;
}

function everyReachableState(): ReadonlyArray<AgentWorkbenchLayout> {
  const states: AgentWorkbenchLayout[] = [];
  for (const bottomPanel of [false, true]) {
    for (const openSurfaces of orderedSubsets()) {
      for (const activeSurface of [null, ...openSurfaces]) {
        states.push(
          layoutOf({ layout: "editor-expanded", bottomPanel, openSurfaces, activeSurface }),
        );
        states.push(layoutOf({ rightPanel: "closed", bottomPanel, openSurfaces, activeSurface }));
        for (const rightPanelMaximized of activeSurface === null ? [false] : [false, true]) {
          states.push(open(openSurfaces, activeSurface, { bottomPanel, rightPanelMaximized }));
        }
      }
    }
  }
  return states;
}

function expectConsistent(state: AgentWorkbenchLayout): void {
  expect(new Set(state.openSurfaces).size).toBe(state.openSurfaces.length);
  expect(state.openSurfaces.length).toBeLessThanOrEqual(MAX_AGENT_OPEN_SURFACES);
  if (state.activeSurface !== null) {
    expect(state.openSurfaces).toContain(state.activeSurface);
  }
  if (state.rightPanelMaximized) {
    expect(state.rightPanel).toBe("open");
    expect(state.activeSurface).not.toBeNull();
  }
  if (state.layout === "editor-expanded") {
    expect(state.rightPanel).toBe("closed");
  }
  if (state.rightPanel === "closed") {
    expect(state.rightPanelMaximized).toBe(false);
  }
  expect(state.rightPanelWidth).toBeGreaterThanOrEqual(MIN_AGENT_RIGHT_PANEL_WIDTH);
  expect(state.rightPanelWidth).toBeLessThanOrEqual(MAX_AGENT_RIGHT_PANEL_WIDTH);
  expect(state.bottomPanelHeight).toBeGreaterThanOrEqual(MIN_AGENT_BOTTOM_PANEL_HEIGHT);
  expect(state.bottomPanelHeight).toBeLessThanOrEqual(MAX_AGENT_BOTTOM_PANEL_HEIGHT);
}

describe("agentWorkbenchLayoutReducer", () => {
  it("keeps every invariant for every action from every reachable state", () => {
    const states = everyReachableState();
    expect(states.length).toBeGreaterThan(100);
    for (const state of states) {
      expectConsistent(state);
      for (const action of ACTIONS) {
        expectConsistent(agentWorkbenchLayoutReducer(state, action));
      }
    }
  });

  it("never mutates the input state", () => {
    for (const state of everyReachableState()) {
      const frozen = Object.freeze({
        ...state,
        openSurfaces: Object.freeze([...state.openSurfaces]),
      });
      for (const action of ACTIONS) {
        agentWorkbenchLayoutReducer(frozen, action);
      }
      expect(frozen).toEqual(state);
    }
  });

  it("returns the same reference for no-op actions", () => {
    const filesOnly = open(["files"], "files");
    expect(agentWorkbenchLayoutReducer(filesOnly, { kind: "openSurface", surface: "files" })).toBe(
      filesOnly,
    );
    expect(
      agentWorkbenchLayoutReducer(filesOnly, { kind: "activateSurface", surface: "files" }),
    ).toBe(filesOnly);
    expect(
      agentWorkbenchLayoutReducer(filesOnly, { kind: "activateSurface", surface: "diff" }),
    ).toBe(filesOnly);
    expect(
      agentWorkbenchLayoutReducer(filesOnly, { kind: "closeSurfaceTab", surface: "diff" }),
    ).toBe(filesOnly);
    expect(agentWorkbenchLayoutReducer(filesOnly, { kind: "collapseEditor" })).toBe(filesOnly);
    expect(agentWorkbenchLayoutReducer(EXPANDED, { kind: "expandEditor" })).toBe(EXPANDED);
    const chooser = open([], null);
    expect(agentWorkbenchLayoutReducer(chooser, { kind: "showSurfaceChooser" })).toBe(chooser);
  });

  describe("openSurface", () => {
    it("opens the panel with a single tab from the closed panel", () => {
      expect(
        agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
          kind: "openSurface",
          surface: "diff",
        }),
      ).toEqual(open(["diff"], "diff"));
    });

    it("appends a tab in opening order and activates it", () => {
      const withFiles = open(["files"], "files");
      const withDiff = agentWorkbenchLayoutReducer(withFiles, {
        kind: "openSurface",
        surface: "diff",
      });
      expect(withDiff).toEqual(open(["files", "diff"], "diff"));
      expect(
        agentWorkbenchLayoutReducer(withDiff, { kind: "openSurface", surface: "terminal" }),
      ).toEqual(open(["files", "diff", "terminal"], "terminal"));
    });

    it("activates an already open tab without duplicating it", () => {
      const state = open(["files", "diff"], "diff");
      expect(agentWorkbenchLayoutReducer(state, { kind: "openSurface", surface: "files" })).toEqual(
        open(["files", "diff"], "files"),
      );
    });

    it("opens from the chooser while keeping the other tabs", () => {
      const chooser = open(["files"], null);
      expect(
        agentWorkbenchLayoutReducer(chooser, { kind: "openSurface", surface: "terminal" }),
      ).toEqual(open(["files", "terminal"], "terminal"));
    });

    it("returns to the agent layout from the expanded editor", () => {
      expect(
        agentWorkbenchLayoutReducer(EXPANDED, { kind: "openSurface", surface: "files" }),
      ).toEqual(open(["files"], "files"));
    });

    it("keeps the maximized panel maximized", () => {
      const maximized = open(["files"], "files", { rightPanelMaximized: true });
      expect(
        agentWorkbenchLayoutReducer(maximized, { kind: "openSurface", surface: "diff" }),
      ).toEqual(open(["files", "diff"], "diff", { rightPanelMaximized: true }));
    });
  });

  describe("activateSurface", () => {
    it("switches between open tabs and ignores surfaces that are not open", () => {
      const state = open(["files", "diff"], "files");
      expect(
        agentWorkbenchLayoutReducer(state, { kind: "activateSurface", surface: "diff" }),
      ).toEqual(open(["files", "diff"], "diff"));
      expect(
        agentWorkbenchLayoutReducer(state, { kind: "activateSurface", surface: "terminal" }),
      ).toBe(state);
      expect(
        agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
          kind: "activateSurface",
          surface: "files",
        }),
      ).toBe(initialAgentWorkbenchLayout);
    });

    it("leaves the chooser for an open tab", () => {
      expect(
        agentWorkbenchLayoutReducer(open(["files"], null), {
          kind: "activateSurface",
          surface: "files",
        }),
      ).toEqual(open(["files"], "files"));
    });
  });

  describe("closeSurfaceTab", () => {
    it("closes an inactive tab and keeps the active one", () => {
      expect(
        agentWorkbenchLayoutReducer(open(["files", "diff", "terminal"], "terminal"), {
          kind: "closeSurfaceTab",
          surface: "files",
        }),
      ).toEqual(open(["diff", "terminal"], "terminal"));
    });

    it("activates the right neighbour, then the left one", () => {
      const state = open(["files", "diff", "terminal"], "diff");
      const closedDiff = agentWorkbenchLayoutReducer(state, {
        kind: "closeSurfaceTab",
        surface: "diff",
      });
      expect(closedDiff).toEqual(open(["files", "terminal"], "terminal"));
      expect(
        agentWorkbenchLayoutReducer(closedDiff, { kind: "closeSurfaceTab", surface: "terminal" }),
      ).toEqual(open(["files"], "files"));
    });

    it("shows the chooser when the last tab closes and keeps the panel open", () => {
      expect(
        agentWorkbenchLayoutReducer(open(["files"], "files"), {
          kind: "closeSurfaceTab",
          surface: "files",
        }),
      ).toEqual(open([], null));
      expect(
        agentWorkbenchLayoutReducer(open(["files"], "files", { rightPanelMaximized: true }), {
          kind: "closeSurfaceTab",
          surface: "files",
        }),
      ).toEqual(open([], null));
    });

    it("closes a tab while the chooser is shown", () => {
      expect(
        agentWorkbenchLayoutReducer(open(["files", "diff"], null), {
          kind: "closeSurfaceTab",
          surface: "diff",
        }),
      ).toEqual(open(["files"], null));
    });
  });

  describe("showSurfaceChooser", () => {
    it("keeps the open tabs and deactivates them", () => {
      expect(
        agentWorkbenchLayoutReducer(open(["files", "diff"], "diff"), {
          kind: "showSurfaceChooser",
        }),
      ).toEqual(open(["files", "diff"], null));
    });

    it("leaves the maximized panel because the chooser has no active surface", () => {
      expect(
        agentWorkbenchLayoutReducer(open(["files"], "files", { rightPanelMaximized: true }), {
          kind: "showSurfaceChooser",
        }),
      ).toEqual(open(["files"], null));
    });

    it("opens an empty panel from the closed panel and from the expanded editor", () => {
      expect(
        agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, { kind: "showSurfaceChooser" }),
      ).toEqual(open([], null));
      expect(agentWorkbenchLayoutReducer(EXPANDED, { kind: "showSurfaceChooser" })).toEqual(
        open([], null),
      );
    });
  });

  describe("toggleRightPanel", () => {
    it("opens the chooser from the closed panel", () => {
      expect(
        agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, { kind: "toggleRightPanel" }),
      ).toEqual(open([], null));
    });

    it("keeps every tab when the panel closes and drops only the maximized state", () => {
      expect(
        agentWorkbenchLayoutReducer(
          open(["files", "diff"], "diff", { rightPanelMaximized: true, bottomPanel: true }),
          { kind: "toggleRightPanel" },
        ),
      ).toEqual(
        layoutOf({
          bottomPanel: true,
          openSurfaces: ["files", "diff"],
          activeSurface: "diff",
        }),
      );
      expect(agentWorkbenchLayoutReducer(open([], null), { kind: "toggleRightPanel" })).toEqual(
        initialAgentWorkbenchLayout,
      );
    });

    it("restores the tabs and the active tab when the panel reopens", () => {
      const closed = layoutOf({ openSurfaces: ["files", "diff"], activeSurface: "diff" });
      expect(agentWorkbenchLayoutReducer(closed, { kind: "toggleRightPanel" })).toEqual(
        open(["files", "diff"], "diff"),
      );
    });

    it("activates the first tab when the panel reopens without an active tab", () => {
      const closed = layoutOf({ openSurfaces: ["files", "diff"], activeSurface: null });
      expect(agentWorkbenchLayoutReducer(closed, { kind: "toggleRightPanel" })).toEqual(
        open(["files", "diff"], "files"),
      );
    });

    it("collapses the expanded editor onto the chooser", () => {
      expect(agentWorkbenchLayoutReducer(EXPANDED, { kind: "toggleRightPanel" })).toEqual(
        open([], null),
      );
    });
  });

  describe("toggleMaximized", () => {
    it("flips the maximized flag of an open panel", () => {
      const state = open(["files"], "files");
      const maximized = agentWorkbenchLayoutReducer(state, { kind: "toggleMaximized" });
      expect(maximized).toEqual(open(["files"], "files", { rightPanelMaximized: true }));
      expect(agentWorkbenchLayoutReducer(maximized, { kind: "toggleMaximized" })).toEqual(state);
    });

    it("refuses to maximize the chooser because it has no active surface", () => {
      expect(
        agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, { kind: "toggleMaximized" }),
      ).toBe(initialAgentWorkbenchLayout);
      expect(agentWorkbenchLayoutReducer(EXPANDED, { kind: "toggleMaximized" })).toBe(EXPANDED);
      expect(agentWorkbenchLayoutReducer(open([], null), { kind: "toggleMaximized" })).toEqual(
        open([], null),
      );
    });

    it("reopens a closed panel maximized on its active tab", () => {
      const closed = layoutOf({ openSurfaces: ["files", "diff"], activeSurface: "diff" });
      expect(agentWorkbenchLayoutReducer(closed, { kind: "toggleMaximized" })).toEqual(
        open(["files", "diff"], "diff", { rightPanelMaximized: true }),
      );
    });

    it("un-maximizes when the last tab closes", () => {
      const maximized = open(["files"], "files", { rightPanelMaximized: true });
      expect(
        agentWorkbenchLayoutReducer(maximized, { kind: "closeSurfaceTab", surface: "files" }),
      ).toEqual(open([], null));
    });
  });

  describe("editor expansion", () => {
    it("expands from every panel state keeping the tabs and collapses back onto them", () => {
      for (const state of everyReachableState()) {
        const expanded = agentWorkbenchLayoutReducer(state, { kind: "expandEditor" });
        expect(expanded).toEqual(
          layoutOf({
            layout: "editor-expanded",
            openSurfaces: state.openSurfaces,
            activeSurface: state.activeSurface,
            bottomPanel: state.bottomPanel,
            rightPanelWidth: state.rightPanelWidth,
            bottomPanelHeight: state.bottomPanelHeight,
          }),
        );
        expect(agentWorkbenchLayoutReducer(expanded, { kind: "collapseEditor" })).toEqual(
          open(state.openSurfaces, state.activeSurface ?? state.openSurfaces[0] ?? null, {
            bottomPanel: state.bottomPanel,
            rightPanelWidth: state.rightPanelWidth,
            bottomPanelHeight: state.bottomPanelHeight,
          }),
        );
      }
    });

    it("toggles the expanded editor in both directions and keeps the tab", () => {
      const expanded = agentWorkbenchLayoutReducer(open(["diff"], "diff"), {
        kind: "toggleEditorExpanded",
      });
      expect(expanded.layout).toBe("editor-expanded");
      expect(expanded.openSurfaces).toEqual(["diff"]);
      expect(agentWorkbenchLayoutReducer(expanded, { kind: "toggleEditorExpanded" })).toEqual(
        open(["diff"], "diff"),
      );
    });
  });

  it("drives the bottom panel independently of the layout", () => {
    const state = open(["files"], "files", { rightPanelMaximized: true });
    const shown = agentWorkbenchLayoutReducer(state, { kind: "showBottomPanel" });
    expect(shown).toEqual({ ...state, bottomPanel: true });
    expect(agentWorkbenchLayoutReducer(shown, { kind: "showBottomPanel" })).toBe(shown);
    expect(agentWorkbenchLayoutReducer(shown, { kind: "toggleBottomPanel" })).toEqual(state);
    expect(agentWorkbenchLayoutReducer(shown, { kind: "hideBottomPanel" })).toEqual(state);
    expect(agentWorkbenchLayoutReducer(state, { kind: "hideBottomPanel" })).toBe(state);
  });

  it("clamps resize actions and falls back to the defaults for non-finite sizes", () => {
    const state = initialAgentWorkbenchLayout;
    expect(
      agentWorkbenchLayoutReducer(state, { kind: "resizeRightPanel", width: 10 }).rightPanelWidth,
    ).toBe(MIN_AGENT_RIGHT_PANEL_WIDTH);
    expect(
      agentWorkbenchLayoutReducer(state, { kind: "resizeRightPanel", width: 5000 }).rightPanelWidth,
    ).toBe(MAX_AGENT_RIGHT_PANEL_WIDTH);
    expect(
      agentWorkbenchLayoutReducer(state, { kind: "resizeRightPanel", width: 600.4 })
        .rightPanelWidth,
    ).toBe(600);
    expect(
      agentWorkbenchLayoutReducer(state, { kind: "resizeBottomPanel", height: 10 })
        .bottomPanelHeight,
    ).toBe(MIN_AGENT_BOTTOM_PANEL_HEIGHT);
    expect(
      agentWorkbenchLayoutReducer(state, { kind: "resizeBottomPanel", height: 5000 })
        .bottomPanelHeight,
    ).toBe(MAX_AGENT_BOTTOM_PANEL_HEIGHT);
    expect(
      agentWorkbenchLayoutReducer(state, { kind: "resizeRightPanel", width: Number.NaN }),
    ).toBe(state);
    expect(
      agentWorkbenchLayoutReducer(
        { ...state, bottomPanelHeight: 400 },
        { kind: "resizeBottomPanel", height: Number.POSITIVE_INFINITY },
      ).bottomPanelHeight,
    ).toBe(DEFAULT_AGENT_BOTTOM_PANEL_HEIGHT);
  });

  it("rejects an unsupported action", () => {
    expect(() =>
      agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
        kind: "teleport",
      } as unknown as AgentWorkbenchLayoutAction),
    ).toThrow(TypeError);
  });
});

describe("parseAgentWorkbenchLayout", () => {
  it("returns the initial layout for non-record values", () => {
    for (const value of [null, undefined, 1, "agent", [], true]) {
      expect(parseAgentWorkbenchLayout(value)).toEqual(initialAgentWorkbenchLayout);
    }
  });

  it("returns the initial layout for an entirely invalid record", () => {
    expect(
      parseAgentWorkbenchLayout({
        layout: "browser",
        rightPanel: "sideways",
        openSurfaces: "files",
        activeSurface: "preview",
        rightPanelMaximized: "yes",
        bottomPanel: "yes",
        rightPanelWidth: "wide",
        bottomPanelHeight: "tall",
      }),
    ).toEqual(initialAgentWorkbenchLayout);
  });

  it("restores a valid persisted layout", () => {
    const persisted = open(["files", "diff"], "diff", {
      rightPanelMaximized: true,
      rail: "expanded",
      bottomPanel: true,
      rightPanelWidth: 640,
      bottomPanelHeight: 320,
    });
    expect(parseAgentWorkbenchLayout(serializeAgentWorkbenchLayout(persisted))).toEqual(persisted);
  });

  it("migrates the previous single-surface shape into one tab", () => {
    expect(
      parseAgentWorkbenchLayout({ layout: "agent", rightPanel: "open", rightSurface: "diff" }),
    ).toEqual(open(["diff"], "diff"));
    expect(
      parseAgentWorkbenchLayout({ layout: "agent", rightPanel: "open", rightSurface: null }),
    ).toEqual(open([], null));
    expect(
      parseAgentWorkbenchLayout({ layout: "agent", rightSurface: "files", lastSurface: "diff" }),
    ).toEqual(open(["files"], "files"));
  });

  it("ignores the legacy surface when the new shape is present", () => {
    expect(
      parseAgentWorkbenchLayout({
        layout: "agent",
        openSurfaces: ["terminal"],
        activeSurface: "terminal",
        rightSurface: "diff",
      }),
    ).toEqual(open(["terminal"], "terminal"));
    expect(
      parseAgentWorkbenchLayout({ layout: "agent", openSurfaces: [], rightSurface: "diff" }),
    ).toEqual(initialAgentWorkbenchLayout);
  });

  it("drops unknown, duplicate and surplus open surfaces fail-closed", () => {
    expect(
      parseAgentWorkbenchLayout({
        layout: "agent",
        openSurfaces: ["diff", "preview", "diff", 7, "files", "terminal", "files"],
        activeSurface: "files",
      }),
    ).toEqual(open(["diff", "files", "terminal"], "files"));
    expect(parseAgentWorkbenchLayout({ layout: "agent", openSurfaces: { 0: "files" } })).toEqual(
      initialAgentWorkbenchLayout,
    );
  });

  it("clears an active surface that is not among the open tabs", () => {
    expect(
      parseAgentWorkbenchLayout({
        layout: "agent",
        openSurfaces: ["files"],
        activeSurface: "diff",
      }),
    ).toEqual(open(["files"], null));
    expect(
      parseAgentWorkbenchLayout({ layout: "agent", openSurfaces: ["files"], activeSurface: 3 }),
    ).toEqual(open(["files"], null));
    expect(parseAgentWorkbenchLayout({ layout: "agent", activeSurface: "files" })).toEqual(
      initialAgentWorkbenchLayout,
    );
  });

  it("keeps a closed panel with its tabs and rejects unknown panel states", () => {
    expect(
      parseAgentWorkbenchLayout({
        layout: "agent",
        rightPanel: "closed",
        openSurfaces: ["files"],
        activeSurface: "files",
      }),
    ).toEqual(layoutOf({ openSurfaces: ["files"], activeSurface: "files" }));
    expect(
      parseAgentWorkbenchLayout({
        layout: "agent",
        rightPanel: "closed",
        rightPanelMaximized: true,
      }),
    ).toEqual(initialAgentWorkbenchLayout);
    expect(
      parseAgentWorkbenchLayout({ layout: "agent", openSurfaces: ["diff"], activeSurface: "diff" }),
    ).toEqual(open(["diff"], "diff"));
    expect(parseAgentWorkbenchLayout({ layout: "agent", rightPanel: "open" })).toEqual(
      open([], null),
    );
    expect(parseAgentWorkbenchLayout({ layout: "agent", rightPanel: "ajar" })).toEqual(
      initialAgentWorkbenchLayout,
    );
    expect(
      parseAgentWorkbenchLayout({ layout: "agent", rightPanel: "open", rightPanelMaximized: 1 }),
    ).toEqual(open([], null));
  });

  it("closes the panel persisted alongside the expanded layout but keeps its tabs", () => {
    expect(
      parseAgentWorkbenchLayout({
        layout: "editor-expanded",
        rightPanel: "open",
        openSurfaces: ["files"],
        activeSurface: "files",
        rightPanelMaximized: true,
        bottomPanel: true,
        rightPanelWidth: 700,
      }),
    ).toEqual(
      layoutOf({
        layout: "editor-expanded",
        openSurfaces: ["files"],
        activeSurface: "files",
        bottomPanel: true,
        rightPanelWidth: 700,
      }),
    );
  });

  it("clamps out-of-bounds persisted sizes", () => {
    expect(
      parseAgentWorkbenchLayout({ layout: "agent", rightPanelWidth: 1, bottomPanelHeight: 9999 }),
    ).toMatchObject({
      rightPanelWidth: MIN_AGENT_RIGHT_PANEL_WIDTH,
      bottomPanelHeight: MAX_AGENT_BOTTOM_PANEL_HEIGHT,
    });
    expect(
      parseAgentWorkbenchLayout({ layout: "agent", rightPanelWidth: Number.NaN }),
    ).toMatchObject({ rightPanelWidth: DEFAULT_AGENT_RIGHT_PANEL_WIDTH });
  });

  it("never throws and always yields a consistent state for adversarial values", () => {
    const values: unknown[] = [
      { openSurfaces: new Array(10_000).fill("files"), activeSurface: "files" },
      { openSurfaces: [null, undefined, {}, [], "FILES"], rightPanel: "open" },
      { layout: ["agent"], rightPanelMaximized: "true" },
      Object.create(null),
      { __proto__: { openSurfaces: ["diff"] } },
    ];
    for (const value of values) {
      const parsed = parseAgentWorkbenchLayout(value);
      expectConsistent(parsed);
    }
  });
});

describe("toggleRail", () => {
  it("flips the rail between expanded and collapsed and persists it", () => {
    const collapsed = agentWorkbenchLayoutReducer(initialAgentWorkbenchLayout, {
      kind: "toggleRail",
    });
    expect(collapsed).toEqual({ ...initialAgentWorkbenchLayout, rail: "collapsed" });
    expect(agentWorkbenchLayoutReducer(collapsed, { kind: "toggleRail" })).toEqual(
      initialAgentWorkbenchLayout,
    );
    expect(parseAgentWorkbenchLayout(serializeAgentWorkbenchLayout(collapsed))).toEqual(collapsed);
  });

  it("falls back to the expanded rail for unknown persisted values", () => {
    expect(parseAgentWorkbenchLayout({ layout: "agent", rail: "hidden" }).rail).toBe("expanded");
    expect(parseAgentWorkbenchLayout({ layout: "agent", rail: "collapsed" }).rail).toBe(
      "collapsed",
    );
  });
});

describe("serializeAgentWorkbenchLayout", () => {
  it("persists exactly the layout fields", () => {
    const state = open(["files", "terminal"], "terminal", { rightPanelMaximized: true });
    expect(serializeAgentWorkbenchLayout(state)).toEqual({
      layout: "agent",
      rightPanel: "open",
      openSurfaces: ["files", "terminal"],
      activeSurface: "terminal",
      rightPanelMaximized: true,
      rail: "expanded",
      bottomPanel: false,
      rightPanelWidth: DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
      bottomPanelHeight: DEFAULT_AGENT_BOTTOM_PANEL_HEIGHT,
    });
  });

  it("round-trips every reachable state through the parser", () => {
    for (const state of everyReachableState()) {
      expect(parseAgentWorkbenchLayout(serializeAgentWorkbenchLayout(state))).toEqual(state);
    }
  });

  it("survives JSON serialization", () => {
    const state = open(["diff"], "diff");
    expect(
      parseAgentWorkbenchLayout(JSON.parse(JSON.stringify(serializeAgentWorkbenchLayout(state)))),
    ).toEqual(state);
  });
});

describe("agentWorkbenchLayoutsEqual", () => {
  it("compares tab order, active tab and the maximized flag", () => {
    const state = open(["files", "diff"], "diff");
    expect(agentWorkbenchLayoutsEqual(state, open(["files", "diff"], "diff"))).toBe(true);
    expect(agentWorkbenchLayoutsEqual(state, open(["diff", "files"], "diff"))).toBe(false);
    expect(agentWorkbenchLayoutsEqual(state, open(["files", "diff"], "files"))).toBe(false);
    expect(agentWorkbenchLayoutsEqual(state, open(["files"], "diff"))).toBe(false);
    expect(agentWorkbenchLayoutsEqual(state, { ...state, rightPanelMaximized: true })).toBe(false);
    expect(agentWorkbenchLayoutSnapshotsEqual(state, { ...state, bottomPanelHeight: 300 })).toBe(
      false,
    );
  });
});
