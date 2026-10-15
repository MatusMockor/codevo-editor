// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { BottomPanelView } from "../domain/bottomPanel";
import { workbenchPanelPlacement } from "../domain/editorDrawer";
import {
  nextBottomPanelView,
  nextBottomPanelVisibility,
  useAgentLayoutBottomPanel,
  type AgentLayoutBottomPanel,
} from "./useAgentWorkbenchLayoutBottomPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
});

const NON_TERMINAL_VIEWS: ReadonlyArray<BottomPanelView> = [
  "problems",
  "search",
  "history",
  "expressRoutes",
  "packages",
  "index",
  "runtime",
];

describe("agent layout bottom panel policy", () => {
  it("rejects every non-terminal view in the agent layout and accepts them elsewhere", () => {
    const terminal = { view: "terminal", visible: true } as const;
    for (const view of NON_TERMINAL_VIEWS) {
      expect(nextBottomPanelView(terminal, view, true)).toBe(terminal);
      expect(nextBottomPanelView(terminal, view, false)).toEqual({ view, visible: true });
    }
    expect(nextBottomPanelView({ view: "problems", visible: false }, "terminal", true)).toEqual({
      view: "terminal",
      visible: false,
    });
  });

  it("only ever shows the terminal in the agent layout", () => {
    const stale = { view: "problems", visible: false } as const;
    expect(nextBottomPanelVisibility(stale, true, true, false)).toEqual({
      view: "terminal",
      visible: true,
    });
    expect(nextBottomPanelVisibility(stale, true, true, true)).toBe(stale);
    expect(nextBottomPanelVisibility(stale, true, false, false)).toEqual({
      view: "problems",
      visible: true,
    });
  });
});

describe("useAgentLayoutBottomPanel", () => {
  it.each(NON_TERMINAL_VIEWS)(
    "keeps an open terminal visible when %s is requested in the agent layout",
    (view) => {
      const harness = renderBottomPanel(true);
      harness.show("terminal");
      expect(harness.placement()).toEqual({ terminal: true, drawer: null });

      harness.show(view);

      expect(harness.placement()).toEqual({ terminal: true, drawer: null });
      harness.unmount();
    },
  );

  it.each(NON_TERMINAL_VIEWS)(
    "reserves no space and opens no drawer when %s is requested with the panel closed",
    (view) => {
      const harness = renderBottomPanel(true);

      harness.show(view);

      expect(harness.placement()).toEqual({ terminal: false, drawer: null });
      expect(harness.state().bottomPanelVisible).toBe(false);
      harness.unmount();
    },
  );

  it("turns a plain toggle into the terminal in the agent layout", () => {
    const harness = renderBottomPanel(true);

    act(() => harness.state().setBottomPanelVisible((visible) => !visible));

    expect(harness.placement()).toEqual({ terminal: true, drawer: null });
    harness.unmount();
  });

  it("keeps the drawer views working outside the agent layout", () => {
    const harness = renderBottomPanel(false);

    harness.show("search");

    expect(harness.placement()).toEqual({ terminal: false, drawer: "search" });
    harness.unmount();
  });
});

function renderBottomPanel(agentLayout: boolean) {
  let latest: AgentLayoutBottomPanel | null = null;
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  function Harness() {
    const panel = useAgentLayoutBottomPanel();
    panel.agentLayoutRef.current = agentLayout;
    latest = panel;
    return null;
  }
  act(() => root.render(<Harness />));
  const state = (): AgentLayoutBottomPanel => {
    if (latest === null) throw new Error("bottom panel hook is not mounted");
    return latest;
  };
  return {
    state,
    placement: () => workbenchPanelPlacement(state().bottomPanelView, state().bottomPanelVisible),
    show(view: BottomPanelView) {
      act(() => {
        state().setBottomPanelView(view);
        state().setBottomPanelVisible(true);
      });
    },
    unmount: () => act(() => root.unmount()),
  };
}
