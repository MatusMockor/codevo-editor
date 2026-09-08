// @vitest-environment jsdom

import { act, type PointerEvent as ReactPointerEvent } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AGENT_RAIL_WIDTH,
  MAX_AGENT_RAIL_WIDTH,
  MIN_AGENT_BOTTOM_PANEL_HEIGHT,
  type AgentWorkbenchLayout,
} from "../domain/agentWorkbenchLayout";
import {
  DEFAULT_BOTTOM_PANEL_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  maxAgentBottomPanelHeight,
  maxAgentRightPanelWidth,
  useWorkbenchResizeHandles,
  type AgentPanelResizeCommit,
  type WorkbenchResizeHandles,
} from "./useWorkbenchResizeHandles";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_280 });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useWorkbenchResizeHandles", () => {
  it("exposes the shell CSS variables for the current sizes", () => {
    const harness = renderHandles();

    expect(harness.result().sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(harness.result().bottomPanelHeight).toBe(DEFAULT_BOTTOM_PANEL_HEIGHT);
    expect(harness.result().shellStyle).toEqual({
      "--bottom-panel-height": `${DEFAULT_BOTTOM_PANEL_HEIGHT}px`,
      "--sidebar-width": `${DEFAULT_SIDEBAR_WIDTH}px`,
    });
    harness.unmount();
  });

  it("clamps the sidebar drag to its bounds", () => {
    const harness = renderHandles();

    act(() => harness.result().startSidebarResize(pointerEvent(harness.handle(), 0, 0)));
    act(() => dispatchPointerMove(-5_000, 0));
    expect(harness.result().sidebarWidth).toBe(MIN_SIDEBAR_WIDTH);

    act(() => dispatchPointerMove(5_000, 0));
    expect(harness.result().sidebarWidth).toBe(MAX_SIDEBAR_WIDTH);

    act(() => dispatchPointerUp());
    act(() => dispatchPointerMove(-5_000, 0));
    expect(harness.result().sidebarWidth).toBe(MAX_SIDEBAR_WIDTH);
    harness.unmount();
  });

  it("grows the bottom panel as the pointer moves up", () => {
    const harness = renderHandles();

    act(() => harness.result().startBottomPanelResize(pointerEvent(harness.handle(), 0, 500)));
    act(() => dispatchPointerMove(0, 400));

    expect(harness.result().bottomPanelHeight).toBe(DEFAULT_BOTTOM_PANEL_HEIGHT + 100);
    act(() => dispatchPointerUp());
    harness.unmount();
  });

  it("writes the agent panel width as a CSS variable without committing during the drag", () => {
    const commit = recordingCommit();
    const harness = renderHandles(commit);

    act(() => harness.result().startAgentRightPanelResize(pointerEvent(harness.handle(), 900, 0)));
    act(() => dispatchPointerMove(800, 0));

    expect(harness.frame().style.getPropertyValue("--agent-right-panel-width")).toBe("464px");
    expect(commit.widths).toEqual([]);

    act(() => dispatchPointerUp());

    expect(commit.widths).toEqual([464]);
    expect(harness.frame().style.getPropertyValue("--agent-right-panel-width")).toBe("");
    harness.unmount();
  });

  it("commits the agent bottom panel height once on pointer up", () => {
    const commit = recordingCommit();
    const harness = renderHandles(commit);

    act(() => harness.result().startAgentBottomPanelResize(pointerEvent(harness.handle(), 0, 600)));
    act(() => dispatchPointerMove(0, 560));
    act(() => dispatchPointerMove(0, 520));
    act(() => dispatchPointerUp());

    expect(commit.heights).toEqual([400]);
    harness.unmount();
  });

  it("clamps the agent panel drag to the viewport caps", () => {
    const commit = recordingCommit();
    const harness = renderHandles(commit);

    act(() => harness.result().startAgentRightPanelResize(pointerEvent(harness.handle(), 900, 0)));
    act(() => dispatchPointerMove(-10_000, 0));
    act(() => dispatchPointerUp());

    expect(commit.widths).toEqual([Math.round(maxAgentRightPanelWidth(window.innerWidth))]);

    act(() => harness.result().startAgentBottomPanelResize(pointerEvent(harness.handle(), 0, 600)));
    act(() => dispatchPointerMove(0, 10_000));
    act(() => dispatchPointerUp());

    expect(commit.heights).toEqual([MIN_AGENT_BOTTOM_PANEL_HEIGHT]);
    harness.unmount();
  });

  it("reserves the rail and the composer-sized centre while sizing the right panel", () => {
    expect(maxAgentRightPanelWidth(1_280)).toBe(464);
    expect(maxAgentRightPanelWidth(1_180)).toBe(372);
    expect(maxAgentRightPanelWidth(1_000)).toBe(420);
    expect(maxAgentRightPanelWidth(720)).toBe(420);
  });

  it("sizes the right panel against the persisted rail width, not the default", () => {
    expect(maxAgentRightPanelWidth(1_400, "expanded", MAX_AGENT_RAIL_WIDTH)).toBe(
      MAX_AGENT_RAIL_WIDTH,
    );
    expect(maxAgentRightPanelWidth(1_400, "expanded", DEFAULT_AGENT_RAIL_WIDTH)).toBe(584);
    expect(maxAgentRightPanelWidth(1_400, "collapsed", MAX_AGENT_RAIL_WIDTH)).toBe(792);
  });

  it("previews a widened rail drag at the same width the committed placement uses", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_400 });
    const commit = recordingCommit({ railWidth: MAX_AGENT_RAIL_WIDTH, rightPanelWidth: 540 });
    const harness = renderHandles(commit);

    act(() => harness.result().startAgentRightPanelResize(pointerEvent(harness.handle(), 800, 0)));
    act(() => dispatchPointerMove(400, 0));

    expect(harness.frame().style.getPropertyValue("--agent-right-panel-width")).toBe("420px");
    harness.unmount();
  });

  it.each([
    { viewportWidth: 1_000, expectedWidth: 392 },
    { viewportWidth: 900, expectedWidth: 420 },
  ])(
    "keeps a collapsed-rail panel stable at $viewportWidth pixels",
    ({ expectedWidth, viewportWidth }) => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: viewportWidth });
      const commit = recordingCommit({ rail: "collapsed", rightPanelWidth: 540 });
      const harness = renderHandles(commit);

      act(() =>
        harness.result().startAgentRightPanelResize(pointerEvent(harness.handle(), 800, 0)),
      );
      act(() => dispatchPointerMove(800, 0));

      expect(harness.frame().style.getPropertyValue("--agent-right-panel-width")).toBe(
        `${expectedWidth}px`,
      );
      act(() => dispatchPointerUp());
      expect(commit.widths).toEqual([expectedWidth]);
      harness.unmount();
    },
  );

  it("starts resizing from the rendered overlay width instead of its larger saved width", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    const commit = recordingCommit({ rightPanelWidth: 700 });
    const harness = renderHandles(commit);
    const surface = document.createElement("div");
    surface.dataset.slot = "surface";
    surface.getBoundingClientRect = () => ({ width: 420 }) as DOMRect;
    harness.frame().append(surface);
    act(() => harness.result().startAgentRightPanelResize(pointerEvent(harness.handle(), 500, 0)));
    act(() => dispatchPointerMove(530, 0));
    expect(harness.frame().style.getPropertyValue("--agent-right-panel-width")).toBe("390px");
    act(() => dispatchPointerUp());
    expect(commit.widths).toEqual([390]);
    harness.unmount();
  });

  it("settles the agent drag when the window loses focus", () => {
    const commit = recordingCommit();
    const harness = renderHandles(commit);

    act(() => harness.result().startAgentRightPanelResize(pointerEvent(harness.handle(), 900, 0)));
    act(() => dispatchPointerMove(850, 0));
    act(() => window.dispatchEvent(new Event("blur")));

    expect(commit.widths).toEqual([464]);

    act(() => dispatchPointerMove(700, 0));
    expect(commit.widths).toEqual([464]);
    harness.unmount();
  });

  it("caps the agent bottom panel height at the viewport ratio", () => {
    expect(maxAgentBottomPanelHeight(400)).toBe(300);
    expect(maxAgentBottomPanelHeight(100)).toBe(120);
  });
});

function recordingCommit(
  overrides: Partial<Pick<AgentWorkbenchLayout, "rail" | "railWidth" | "rightPanelWidth">> = {},
): AgentPanelResizeCommit & {
  readonly widths: number[];
  readonly heights: number[];
} {
  const widths: number[] = [];
  const heights: number[] = [];
  return {
    heights,
    layout: {
      bottomPanelHeight: 320,
      rail: overrides.rail ?? "expanded",
      railWidth: overrides.railWidth ?? DEFAULT_AGENT_RAIL_WIDTH,
      rightPanelWidth: overrides.rightPanelWidth ?? 540,
    },
    onResizeBottomPanel: (height) => heights.push(height),
    onResizeRightPanel: (width) => widths.push(width),
    widths,
  };
}

function renderHandles(agentPanels: AgentPanelResizeCommit = recordingCommit()) {
  let latestResult: WorkbenchResizeHandles | null = null;
  const container = document.body.appendChild(document.createElement("div"));
  const frame = document.body.appendChild(document.createElement("div"));
  frame.className = "editor-workbench";
  const handle = frame.appendChild(document.createElement("div"));
  const root = createRoot(container);

  function Harness() {
    latestResult = useWorkbenchResizeHandles(agentPanels);
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    frame: () => frame,
    handle: () => handle,
    result: getResult,
    unmount: () => act(() => root.unmount()),
  };

  function getResult(): WorkbenchResizeHandles {
    if (!latestResult) {
      throw new Error("workbench resize handles hook is not mounted");
    }
    return latestResult;
  }
}

function pointerEvent(currentTarget: HTMLElement, clientX: number, clientY: number) {
  return {
    clientX,
    clientY,
    currentTarget,
    preventDefault: vi.fn(),
  } as unknown as ReactPointerEvent<HTMLElement>;
}

function dispatchPointerMove(clientX: number, clientY: number): void {
  const event = new Event("pointermove") as Event & { clientX: number; clientY: number };
  Object.assign(event, { clientX, clientY });
  window.dispatchEvent(event);
}

function dispatchPointerUp(): void {
  window.dispatchEvent(new Event("pointerup"));
}
