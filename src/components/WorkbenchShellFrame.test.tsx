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
import {
  useWorkbenchFrameEditorReport,
  useWorkbenchFrameEditorState,
} from "./workbenchFrameEditorReport";
import { workbenchShellPlacement, type WorkbenchShellPlacement } from "./workbenchShellPlacement";

const CLAMPED_RIGHT_PANEL_WIDTH_AT_1280 = 464;

describe("workbenchShellPlacement", () => {
  it("hides the editor in the agent layout unless the Editor surface is open", () => {
    expect(placement("agent", null).editorHidden).toBe(true);
    expect(placement("agent", "diff").editorHidden).toBe(true);
    expect(placement("agent", "terminal").editorHidden).toBe(true);
    expect(placement("agent", "files").editorHidden).toBe(true);
    expect(placement("agent", "editor").editorHidden).toBe(false);
    expect(placement("editor-only", null).editorHidden).toBe(false);
    expect(emptyOpenPanelPlacement().editorHidden).toBe(true);
  });

  it("collapses the right and bottom panel tracks when they are closed", () => {
    expect(placement("agent", null)).toMatchObject({ rightPanelWidth: 0, bottomPanelHeight: 0 });
    expect(placement("agent", "editor")).toMatchObject({ rightPanelWidth: 540 });
    expect(placement("agent", "editor", true)).toMatchObject({ bottomPanelHeight: 280 });
    expect(placement("editor-only", "editor", true)).toMatchObject({
      rightPanelWidth: 0,
      bottomPanelHeight: 280,
    });
    expect(emptyOpenPanelPlacement()).toMatchObject({
      rightPanelWidth: DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
      editorHidden: true,
    });
  });
});

describe("workbenchShellPlacement maximized", () => {
  it("reports the maximized panel for an open agent panel and for the editor-only fallback", () => {
    expect(placement("agent", "editor", false, true).rightPanelMaximized).toBe(true);
    expect(placement("agent", "editor", false, false).rightPanelMaximized).toBe(false);
    expect(placement("agent", null, false, true).rightPanelMaximized).toBe(false);
    expect(placement("editor-only", null).rightPanelMaximized).toBe(true);
    expect(
      workbenchShellPlacement({
        bottomPanelVisible: false,
        effectiveLayout: "agent",
        layout: { ...initialAgentWorkbenchLayout, rightPanel: "open", rightPanelMaximized: true },
      }),
    ).toMatchObject({ rightPanelMaximized: true, editorHidden: true });
  });

  it("keeps the editor over the Editor surface while maximized", () => {
    expect(placement("agent", "editor", true, true)).toMatchObject({
      editorHidden: false,
      rightPanelMaximized: true,
      rightPanelWidth: DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
      bottomPanelHeight: 280,
    });
    expect(placement("agent", "diff", false, true).editorHidden).toBe(true);
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

  it("keeps the editor slot at one DOM position while the layout changes", () => {
    render(placement("agent", null));
    const editor = host.querySelector('[data-slot="editor"]');
    const editorChild = host.querySelector("#editor-content");
    expect(editor?.hasAttribute("hidden")).toBe(true);
    expect(editor?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector(".editor-workbench")?.getAttribute("data-layout")).toBe("agent");

    render(placement("agent", "editor"));
    expect(host.querySelector('[data-slot="editor"]')).toBe(editor);
    expect(host.querySelector("#editor-content")).toBe(editorChild);
    expect(editor?.hasAttribute("hidden")).toBe(false);
    expect(editor?.hasAttribute("aria-hidden")).toBe(false);

    render(placement("editor-only", null));
    expect(host.querySelector('[data-slot="editor"]')).toBe(editor);
    expect(host.querySelector("#editor-content")).toBe(editorChild);
    expect(host.querySelector(".workbench-frame")?.getAttribute("data-layout")).toBe("editor-only");

    render(placement("agent", null));
    expect(host.querySelector("#editor-content")).toBe(editorChild);
    expect(editor?.hasAttribute("hidden")).toBe(true);
  });

  it("stamps the maximized panel on the frame and restores the docked panel", () => {
    render(placement("agent", "editor", false, true));
    const frame = host.querySelector(".workbench-frame");
    expect(frame?.getAttribute("data-right-panel")).toBe("maximized");
    expect(host.querySelector('[data-slot="editor"]')?.hasAttribute("hidden")).toBe(false);

    render(placement("agent", "diff", false, true));
    expect(frame?.getAttribute("data-right-panel")).toBe("maximized");
    expect(host.querySelector('[data-slot="editor"]')?.hasAttribute("hidden")).toBe(true);

    render(placement("agent", "editor"));
    expect(frame?.getAttribute("data-right-panel")).toBe("docked");

    render(placement("editor-only", null));
    expect(frame?.getAttribute("data-right-panel")).toBe("maximized");
  });

  it("overlays the panel on narrow windows without remounting the editor or setting maximize", () => {
    render(placement("agent", "editor"));
    const frame = host.querySelector(".workbench-frame");
    const editor = host.querySelector("#editor-content");
    for (const width of [1000, 900, 720]) {
      act(() => {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
        window.dispatchEvent(new Event("resize"));
      });
      expect(frame?.getAttribute("data-right-panel")).toBe("overlay");
      expect(host.querySelector("#editor-content")).toBe(editor);
      expect(host.querySelector('[data-slot="editor"]')?.hasAttribute("hidden")).toBe(false);
    }
    render(placement("agent", "editor", false, true));
    expect(frame?.getAttribute("data-right-panel")).toBe("maximized");
    render(placement("agent", "editor"));
    expect(frame?.getAttribute("data-right-panel")).toBe("overlay");
    act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
      window.dispatchEvent(new Event("resize"));
    });
    expect(frame?.getAttribute("data-right-panel")).toBe("docked");
    expect(host.querySelector("#editor-content")).toBe(editor);
  });

  it("stamps the rail state on the frame so the bottom panel track follows the rail", () => {
    render(placement("agent", null, true));
    const frame = host.querySelector(".workbench-frame");
    expect(frame?.getAttribute("data-rail")).toBe("expanded");

    render({ ...placement("agent", "diff", true, true), rail: "collapsed" });
    expect(frame?.getAttribute("data-rail")).toBe("collapsed");
    expect(frame?.getAttribute("data-right-panel")).toBe("maximized");

    render(placement("editor-only", null, true));
    expect(frame?.getAttribute("data-rail")).toBe("collapsed");
  });

  it("publishes the persisted rail width the rail handle writes to", () => {
    render({ ...placement("agent", "diff", true), railWidth: 384 });
    const frame = host.querySelector<HTMLElement>(".editor-workbench");

    expect(frame?.style.getPropertyValue("--agent-rail-committed")).toBe("384px");

    render({ ...placement("agent", "diff", true), railWidth: 208 });
    expect(frame?.style.getPropertyValue("--agent-rail-committed")).toBe("208px");
  });

  it("keeps the right panel track while an open panel shows no surface", () => {
    render(emptyOpenPanelPlacement());
    const frame = host.querySelector<HTMLElement>(".editor-workbench");

    expect(frame?.style.getPropertyValue("--agent-right-panel-committed")).toBe(
      `${CLAMPED_RIGHT_PANEL_WIDTH_AT_1280}px`,
    );
    expect(CLAMPED_RIGHT_PANEL_WIDTH_AT_1280).toBeLessThan(DEFAULT_AGENT_RIGHT_PANEL_WIDTH);
    expect(host.querySelector('[data-slot="editor"]')?.hasAttribute("hidden")).toBe(true);
  });

  it("publishes the committed panel sizes on the workbench the drag handles write to", () => {
    render(placement("agent", "diff", true));
    const frame = host.querySelector<HTMLElement>(".editor-workbench");

    expect(frame?.style.getPropertyValue("--agent-right-panel-committed")).toBe("464px");
    expect(frame?.style.getPropertyValue("--agent-bottom-panel-committed")).toBe("280px");
    expect(frame?.style.getPropertyValue("--agent-rail-committed")).toBe("256px");
    expect(host.querySelector('[data-slot="bottom"]')?.textContent).toBe("bottom");
    expect(host.querySelector('.editor-workbench > [data-slot="chrome"] > #chrome')).not.toBeNull();
  });

  it("does not stamp an agent appearance variant", () => {
    render(placement("agent", "editor"));

    expect(host.querySelector(".workbench-frame")?.hasAttribute("data-agent-variant")).toBe(false);
  });

  it("stamps data-editor from the editor host report and keeps the editor mounted while empty", () => {
    const frame = () => host.querySelector(".workbench-frame")?.getAttribute("data-editor");
    render(placement("agent", "editor"));
    expect(frame()).toBe("empty");

    renderEditor(placement("agent", "editor"), <EditorReporter empty />);
    const editorSlot = host.querySelector('[data-slot="editor"]');
    expect(frame()).toBe("empty");
    expect(editorSlot?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector("#editor-reporter")).not.toBeNull();

    renderEditor(placement("agent", "editor"), <EditorReporter empty={false} />);
    expect(frame()).toBe("documents");
    expect(host.querySelector('[data-slot="editor"]')).toBe(editorSlot);

    renderEditor(
      placement("agent", "editor"),
      <>
        <EditorReporter empty />
        <EditorReporter empty={false} />
      </>,
    );
    expect(frame()).toBe("documents");

    renderEditor(placement("agent", "editor"), <EditorReporter empty />);
    expect(frame()).toBe("empty");

    render(placement("agent", "editor"));
    expect(frame()).toBe("empty");
  });

  it("hands the editor state to the agent slot so the surface can keep its tree while empty", () => {
    const state = () => host.querySelector("#editor-state")?.textContent;
    act(() =>
      root.render(
        <WorkbenchShellFrame
          agent={<EditorStateProbe />}
          bottom={<span>bottom</span>}
          chrome={<div id="chrome" />}
          editor={<div id="editor-content" />}
          placement={placement("agent", "editor")}
        />,
      ),
    );
    expect(state()).toBe("empty");

    act(() =>
      root.render(
        <WorkbenchShellFrame
          agent={<EditorStateProbe />}
          bottom={<span>bottom</span>}
          chrome={<div id="chrome" />}
          editor={<EditorReporter empty={false} />}
          placement={placement("agent", "editor")}
        />,
      ),
    );
    expect(state()).toBe("documents");
  });

  it("keeps every slot the agent renders a direct child of the frame grid", () => {
    render(placement("agent", "editor"), <AgentSlots />);
    const frame = host.querySelector(".workbench-frame");

    expect(frame).not.toBeNull();
    expect(host.querySelector('[data-slot="agent"]')?.parentElement).toBe(frame);
    expect(host.querySelector('[data-slot="surface"]')?.parentElement).toBe(frame);
    expect(host.querySelector('[data-slot="editor"]')?.parentElement).toBe(frame);
    expect(host.querySelector('[data-slot="bottom"]')?.parentElement).toBe(frame);
  });

  it("renders the thread menu as a root-token foundation menu outside the frame", () => {
    render(placement("agent", null), <RowMenuHost />);

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
          chrome={<div id="chrome" />}
          editor={<div id="editor-content" />}
          placement={placementValue}
        />,
      ),
    );
  }

  function renderEditor(placementValue: WorkbenchShellPlacement, editor: ReactNode): void {
    act(() =>
      root.render(
        <WorkbenchShellFrame
          agent={<div data-slot="agent">agent</div>}
          bottom={<span>bottom</span>}
          chrome={<div id="chrome" />}
          editor={editor}
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
    expect(host.querySelector('.editor-workbench > [data-slot="chrome"] > #chrome')).not.toBeNull();
    expect(host.querySelector('[data-slot="chrome"]')?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector('[data-slot="agent"]')?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector('[data-slot="bottom"]')?.hasAttribute("hidden")).toBe(false);
  });

  it("keeps the chrome and agent slots mounted across a surface swap", () => {
    render("workbench");

    const chromeChild = host.querySelector("#chrome");
    const agentChild = host.querySelector("#agent-content");

    render("settings");

    expect(host.querySelector("#chrome")).toBe(chromeChild);
    expect(host.querySelector("#agent-content")).toBe(agentChild);

    render("workbench");

    expect(host.querySelector("#chrome")).toBe(chromeChild);
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

  it("stamps the settings surface over the agent slots and hides the editor, bottom and chrome slots", () => {
    render("settings");

    const frame = host.querySelector(".workbench-frame");
    expect(frame?.getAttribute("data-surface")).toBe("settings");
    expect(host.querySelector('[data-slot="settings"]')?.textContent).toBe("settings page");
    expect(display('[data-slot="settings"]')).toBe("grid");
    expect(host.querySelector('[data-slot="chrome"]')?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector('[data-slot="agent"]')?.parentElement).toBe(frame);
    expect(display('[data-slot="agent"]')).toBe("none");
    expect(host.querySelector('[data-slot="surface"]')?.parentElement).toBe(frame);
    expect(display('[data-slot="surface"]')).toBe("none");
    expect(host.querySelector('[data-slot="bottom"]')?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector('[data-slot="editor"]')?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector('[data-slot="editor"]')?.getAttribute("aria-hidden")).toBe("true");
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

  it("keeps the editor mounted while the settings surface is shown", () => {
    render("workbench");

    const editorSlot = host.querySelector('[data-slot="editor"]');
    const editorChild = host.querySelector("#editor-content");

    expect(editorSlot?.hasAttribute("hidden")).toBe(false);

    render("settings");

    expect(host.querySelector('[data-slot="editor"]')).toBe(editorSlot);
    expect(host.querySelector("#editor-content")).toBe(editorChild);
    expect(editorSlot?.hasAttribute("hidden")).toBe(true);

    render("workbench");

    expect(host.querySelector("#editor-content")).toBe(editorChild);
    expect(editorSlot?.hasAttribute("hidden")).toBe(false);
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
          chrome={<div id="chrome" />}
          editor={<div id="editor-content" />}
          placement={placement("editor-only", null)}
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

function EditorReporter({ empty }: { readonly empty: boolean }) {
  useWorkbenchFrameEditorReport(empty);
  return <div id="editor-reporter" />;
}

function EditorStateProbe() {
  const state = useWorkbenchFrameEditorState();
  return (
    <div data-slot="agent" id="editor-state">
      {state}
    </div>
  );
}

function emptyOpenPanelPlacement(bottomPanelVisible = false): WorkbenchShellPlacement {
  return workbenchShellPlacement({
    bottomPanelVisible,
    effectiveLayout: "agent",
    layout: { ...initialAgentWorkbenchLayout, rightPanel: "open" },
  });
}

function placement(
  effectiveLayout: "agent" | "editor-only",
  rightSurface: "files" | "diff" | "terminal" | "editor" | null,
  bottomPanelVisible = false,
  maximized = false,
): WorkbenchShellPlacement {
  return workbenchShellPlacement({
    bottomPanelVisible,
    effectiveLayout,
    layout: {
      ...initialAgentWorkbenchLayout,
      rightPanel: rightSurface === null ? "closed" : "open",
      activeSurface: rightSurface,
      rightPanelMaximized: maximized,
    },
  });
}
