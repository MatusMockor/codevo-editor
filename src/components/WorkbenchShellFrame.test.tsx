// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
  initialAgentWorkbenchLayout,
} from "../domain/agentWorkbenchLayout";
import { AgentThreadContextMenu } from "./agentMode/AgentThreadContextMenu";
import { agentThreadContextMenu } from "./agentMode/agentThreadContextMenuModel";
import { WorkbenchShellFrame } from "./WorkbenchShellFrame";
import { workbenchShellPlacement, type WorkbenchShellPlacement } from "./workbenchShellPlacement";

const CLAMPED_RIGHT_PANEL_WIDTH_AT_1280 = 464;

describe("workbenchShellPlacement", () => {
  it("collapses the right and bottom panel tracks when they are closed", () => {
    expect(placement(null)).toMatchObject({ rightPanelWidth: 0, bottomPanelHeight: 0 });
    expect(placement("files")).toMatchObject({ rightPanelWidth: 540 });
    expect(placement("files", true)).toMatchObject({ bottomPanelHeight: 280 });
    expect(emptyOpenPanelPlacement()).toMatchObject({
      rightPanelWidth: DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
      rightPanelHidden: false,
    });
  });

  it("has no editor layer or layout mode in the placement", () => {
    const value = placement("files");

    expect("editorHidden" in value).toBe(false);
    expect("layout" in value).toBe(false);
  });
});

describe("workbenchShellPlacement maximized", () => {
  it("reports the maximized panel only for an open agent panel", () => {
    expect(placement("files", false, true).rightPanelMaximized).toBe(true);
    expect(placement("files", false, false).rightPanelMaximized).toBe(false);
    expect(placement(null, false, true).rightPanelMaximized).toBe(false);
    expect(
      workbenchShellPlacement({
        bottomPanelVisible: false,
        layout: { ...initialAgentWorkbenchLayout, rightPanel: "open", rightPanelMaximized: true },
      }),
    ).toMatchObject({ rightPanelMaximized: true });
  });

  it("fills the maximized panel with the surface", () => {
    expect(placement("files", true, true)).toMatchObject({
      rightPanelMaximized: true,
      rightPanelWidth: DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
      bottomPanelHeight: 280,
    });
  });
});

describe("WorkbenchShellFrame", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_280 });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders the agent and bottom slots without editor or chrome slots", () => {
    render(placement(null));

    expect(host.querySelector(".editor-workbench")?.getAttribute("data-layout")).toBe("agent");
    expect(host.querySelector(".workbench-frame")?.getAttribute("data-layout")).toBe("agent");
    expect(host.querySelector(".workbench-frame")?.hasAttribute("data-editor")).toBe(false);
    expect(host.querySelector('[data-slot="agent"]')?.textContent).toBe("agent");
    expect(host.querySelector('[data-slot="bottom"]')?.textContent).toBe("bottom");
    expect(host.querySelector('[data-slot="editor"]')).toBeNull();
    expect(host.querySelector('[data-slot="chrome"]')).toBeNull();
  });

  it("stamps the maximized panel on the frame and restores the docked panel", () => {
    render(placement("files", false, true));
    const frame = host.querySelector(".workbench-frame");
    expect(frame?.getAttribute("data-right-panel")).toBe("maximized");

    render(placement("diff", false, true));
    expect(frame?.getAttribute("data-right-panel")).toBe("maximized");

    render(placement("files"));
    expect(frame?.getAttribute("data-right-panel")).toBe("docked");
  });

  it("overlays the panel on narrow windows without remounting the agent or setting maximize", () => {
    render(placement("files"));
    const frame = host.querySelector(".workbench-frame");
    const agent = host.querySelector('[data-slot="agent"]');
    for (const width of [1000, 900, 720]) {
      act(() => {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
        window.dispatchEvent(new Event("resize"));
      });
      expect(frame?.getAttribute("data-right-panel")).toBe("overlay");
      expect(host.querySelector('[data-slot="agent"]')).toBe(agent);
    }
    render(placement("files", false, true));
    expect(frame?.getAttribute("data-right-panel")).toBe("maximized");
    render(placement("files"));
    expect(frame?.getAttribute("data-right-panel")).toBe("overlay");
    act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
      window.dispatchEvent(new Event("resize"));
    });
    expect(frame?.getAttribute("data-right-panel")).toBe("docked");
    expect(host.querySelector('[data-slot="agent"]')).toBe(agent);
  });

  it("stamps the rail state on the frame so the bottom panel track follows the rail", () => {
    render(placement(null, true));
    const frame = host.querySelector(".workbench-frame");
    expect(frame?.getAttribute("data-rail")).toBe("expanded");

    render({ ...placement("diff", true, true), rail: "collapsed" });
    expect(frame?.getAttribute("data-rail")).toBe("collapsed");
    expect(frame?.getAttribute("data-right-panel")).toBe("maximized");
  });

  it("publishes the persisted rail width the rail handle writes to", () => {
    render({ ...placement("diff", true), railWidth: 384 });
    const frame = host.querySelector<HTMLElement>(".editor-workbench");

    expect(frame?.style.getPropertyValue("--agent-rail-committed")).toBe("384px");

    render({ ...placement("diff", true), railWidth: 208 });
    expect(frame?.style.getPropertyValue("--agent-rail-committed")).toBe("208px");
  });

  it("keeps the right panel track while an open panel shows no surface", () => {
    render(emptyOpenPanelPlacement());
    const frame = host.querySelector<HTMLElement>(".editor-workbench");

    expect(frame?.style.getPropertyValue("--agent-right-panel-committed")).toBe(
      `${CLAMPED_RIGHT_PANEL_WIDTH_AT_1280}px`,
    );
    expect(CLAMPED_RIGHT_PANEL_WIDTH_AT_1280).toBeLessThan(DEFAULT_AGENT_RIGHT_PANEL_WIDTH);
  });

  it("publishes the committed panel sizes on the workbench the drag handles write to", () => {
    render(placement("diff", true));
    const frame = host.querySelector<HTMLElement>(".editor-workbench");

    expect(frame?.style.getPropertyValue("--agent-right-panel-committed")).toBe("464px");
    expect(frame?.style.getPropertyValue("--agent-bottom-panel-committed")).toBe("280px");
    expect(frame?.style.getPropertyValue("--agent-rail-committed")).toBe("256px");
    expect(host.querySelector('[data-slot="bottom"]')?.textContent).toBe("bottom");
  });

  it("does not stamp an agent appearance variant", () => {
    render(placement("files"));

    expect(host.querySelector(".workbench-frame")?.hasAttribute("data-agent-variant")).toBe(false);
  });

  it("keeps every slot the agent renders a direct child of the frame grid", () => {
    render(placement("files"), <AgentSlots />);
    const frame = host.querySelector(".workbench-frame");

    expect(frame).not.toBeNull();
    expect(host.querySelector('[data-slot="agent"]')?.parentElement).toBe(frame);
    expect(host.querySelector('[data-slot="surface"]')?.parentElement).toBe(frame);
    expect(host.querySelector('[data-slot="bottom"]')?.parentElement).toBe(frame);
  });

  it("renders the thread menu as a root-token foundation menu outside the frame", () => {
    render(placement(null), <RowMenuHost />);

    const menu = document.querySelector('.cv-menu[role="menu"][aria-label="Thread actions"]');
    expect(menu).not.toBeNull();
    expect(menu?.closest(".workbench-frame")).toBeNull();
    expect(host.querySelector(".agent-row-menu")).toBeNull();
  });

  function render(placementValue: WorkbenchShellPlacement, agent?: ReactNode): void {
    act(() =>
      root.render(
        <WorkbenchShellFrame
          agent={agent ?? <div data-slot="agent">agent</div>}
          bottom={<span>bottom</span>}
          placement={placementValue}
        />,
      ),
    );
  }
});

describe("WorkbenchShellFrame settings surface", () => {
  let host: HTMLDivElement;
  let root: Root;
  let shellStyles: HTMLStyleElement;
  const settingsSlots: Array<HTMLDivElement | null> = [];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    settingsSlots.length = 0;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1_280 });
    shellStyles = document.createElement("style");
    shellStyles.textContent = readFileSync(
      resolve(import.meta.dirname, "./workbenchShellFrame.css"),
      "utf8",
    );
    document.head.append(shellStyles);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    shellStyles.remove();
  });

  it("keeps the workbench surface untouched by default", () => {
    render("workbench");

    expect(host.querySelector(".workbench-frame")?.hasAttribute("data-surface")).toBe(false);
    expect(host.querySelector('[data-slot="settings"]')).toBeNull();
    expect(host.querySelector('[data-slot="agent"]')?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector('[data-slot="bottom"]')?.hasAttribute("hidden")).toBe(false);
  });

  it("keeps the agent slot mounted across a surface swap", () => {
    render("workbench");

    const agentChild = host.querySelector("#agent-content");

    render("settings");

    expect(host.querySelector("#agent-content")).toBe(agentChild);

    render("workbench");

    expect(host.querySelector("#agent-content")).toBe(agentChild);
  });

  it("hands the settings slot element to the surface owner", () => {
    render("workbench");

    expect(settingsSlots).toEqual([]);

    render("settings");

    expect(settingsSlots[settingsSlots.length - 1]).toBe(
      host.querySelector('[data-slot="settings"]'),
    );

    render("workbench");

    expect(settingsSlots[settingsSlots.length - 1]).toBeNull();
  });

  it("stamps the settings surface over the agent slots and hides the bottom slot", () => {
    render("settings");

    const frame = host.querySelector(".workbench-frame");
    expect(frame?.getAttribute("data-surface")).toBe("settings");
    expect(host.querySelector('[data-slot="settings"]')?.textContent).toBe("settings page");
    expect(display('[data-slot="settings"]')).toBe("grid");
    expect(host.querySelector('[data-slot="agent"]')?.parentElement).toBe(frame);
    expect(display('[data-slot="agent"]')).toBe("none");
    expect(host.querySelector('[data-slot="surface"]')?.parentElement).toBe(frame);
    expect(display('[data-slot="surface"]')).toBe("none");
    expect(host.querySelector('[data-slot="bottom"]')?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector('[data-slot="editor"]')).toBeNull();
  });

  it("hides an agent fallback that carries no slot while the settings surface is shown", () => {
    const fallback = <div role="status">Loading agent workspace…</div>;
    render("workbench", fallback);
    expect(display('[role="status"]')).not.toBe("none");

    render("settings", fallback);
    expect(host.querySelector('[role="status"]')?.parentElement).toBe(
      host.querySelector(".workbench-frame"),
    );
    expect(display('[role="status"]')).toBe("none");
    expect(display('[data-slot="settings"]')).toBe("grid");

    render("workbench", fallback);
    expect(display('[role="status"]')).not.toBe("none");
  });

  function display(selector: string): string {
    const element = host.querySelector(selector);
    expect(element, `Missing ${selector}`).not.toBeNull();
    return element === null ? "" : getComputedStyle(element).display;
  }

  function render(surface: "workbench" | "settings", agent: ReactNode = <AgentSlots />): void {
    act(() =>
      root.render(
        <WorkbenchShellFrame
          agent={agent}
          bottom={<span>bottom</span>}
          placement={placement(null)}
          settings={<div>settings page</div>}
          settingsRef={(element) => {
            settingsSlots.push(element);
          }}
          surface={surface}
        />,
      ),
    );
  }
});

function AgentSlots() {
  return (
    <>
      <div data-slot="agent" id="agent-content">
        agent
      </div>
      <div data-slot="surface">surface</div>
    </>
  );
}

function RowMenuHost() {
  return (
    <div data-slot="agent">
      <AgentThreadContextMenu
        anchor={{ x: 10, y: 10 }}
        nodes={agentThreadContextMenu({
          branch: null,
          pinned: false,
          archived: false,
          running: false,
          snoozed: false,
          settled: false,
          canMarkUnread: true,
          now: 0,
        })}
        onAction={() => undefined}
        onClose={() => undefined}
      />
    </div>
  );
}

function emptyOpenPanelPlacement(bottomPanelVisible = false): WorkbenchShellPlacement {
  return workbenchShellPlacement({
    bottomPanelVisible,
    layout: { ...initialAgentWorkbenchLayout, rightPanel: "open" },
  });
}

function placement(
  rightSurface: "files" | "diff" | "terminal" | null,
  bottomPanelVisible = false,
  maximized = false,
): WorkbenchShellPlacement {
  return workbenchShellPlacement({
    bottomPanelVisible,
    layout: {
      ...initialAgentWorkbenchLayout,
      rightPanel: rightSurface === null ? "closed" : "open",
      activeSurface: rightSurface,
      rightPanelMaximized: maximized,
    },
  });
}
