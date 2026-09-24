// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResponsivePanelRestore } from "../../domain/agentWorkbenchResponsiveLayout";
import { click, mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import { WorkbenchFrameResponsiveContext } from "../workbenchFrameResponsiveContext";
import { useResponsivePanelToggle } from "./useResponsivePanelToggle";

let ui: MountedUi | null = null;

afterEach(() => {
  ui?.unmount();
  ui = null;
});

interface Handlers {
  readonly toggleMaximized: () => void;
  readonly toggleRail: () => void;
  readonly toggleRightPanel: () => void;
}

function Probe({
  handlers,
  rightPanelMaximized,
}: {
  readonly handlers: Handlers;
  readonly rightPanelMaximized: boolean;
}) {
  const panel = useResponsivePanelToggle({ ...handlers, rightPanelMaximized });
  return (
    <button data-restore={panel.restore} onClick={panel.toggle} type="button">
      toggle
    </button>
  );
}

function run(restore: ResponsivePanelRestore, rightPanelMaximized: boolean) {
  const calls: string[] = [];
  const handlers: Handlers = {
    toggleMaximized: vi.fn(() => calls.push("toggleMaximized")),
    toggleRail: vi.fn(() => calls.push("toggleRail")),
    toggleRightPanel: vi.fn(() => calls.push("toggleRightPanel")),
  };
  ui = mountUi();
  ui.render(
    <WorkbenchFrameResponsiveContext.Provider value={restore}>
      <Probe handlers={handlers} rightPanelMaximized={rightPanelMaximized} />
    </WorkbenchFrameResponsiveContext.Provider>,
  );
  const button = document.querySelector("button");
  expect(button?.getAttribute("data-restore")).toBe(restore);
  click(button as Element);
  ui.unmount();
  ui = null;
  return calls;
}

describe("useResponsivePanelToggle", () => {
  it("toggles the plain maximized state in the docked layout", () => {
    expect(run("none", false)).toEqual(["toggleMaximized"]);
    expect(run("none", true)).toEqual(["toggleMaximized"]);
  });

  it("restores the rail in a narrow window and un-maximizes first", () => {
    expect(run("collapseRail", false)).toEqual(["toggleRail"]);
    expect(run("collapseRail", true)).toEqual(["toggleMaximized", "toggleRail"]);
  });

  it("closes the panel in the narrowest window and un-maximizes first", () => {
    expect(run("closePanel", false)).toEqual(["toggleRightPanel"]);
    expect(run("closePanel", true)).toEqual(["toggleMaximized", "toggleRightPanel"]);
  });
});
