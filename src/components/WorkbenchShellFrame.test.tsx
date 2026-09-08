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
import { AgentThreadRowMenu } from "./agentMode/AgentThreadRowMenu";
import { WorkbenchShellFrame } from "./WorkbenchShellFrame";
import {
  useWorkbenchFrameEditorReport,
  useWorkbenchFrameEditorState,
} from "./workbenchFrameEditorReport";
import { useWorkbenchFrameTreeReport } from "./workbenchFrameTreeReport";
import {
  workbenchFrameTreeState,
  workbenchShellPlacement,
  type WorkbenchShellPlacement,
} from "./workbenchShellPlacement";

const CLAMPED_RIGHT_PANEL_WIDTH_AT_1280 = 464;

describe("workbenchShellPlacement", () => {
  it("hides the editor in the agent layout unless the Files surface is open", () => {
    expect(placement("agent", null).editorHidden).toBe(true);
    expect(placement("agent", "diff").editorHidden).toBe(true);
    expect(placement("agent", "terminal").editorHidden).toBe(true);
    expect(placement("agent", "files").editorHidden).toBe(false);
    expect(placement("editor-expanded", null).editorHidden).toBe(false);
    expect(emptyOpenPanelPlacement().editorHidden).toBe(true);
  });

  it("collapses the right and bottom panel tracks when they are closed", () => {
    expect(placement("agent", null)).toMatchObject({ rightPanelWidth: 0, bottomPanelHeight: 0 });
    expect(placement("agent", "files")).toMatchObject({ rightPanelWidth: 540 });
    expect(placement("agent", "files", true)).toMatchObject({ bottomPanelHeight: 280 });
    expect(placement("editor-expanded", "files", true)).toMatchObject({
      rightPanelWidth: 0,
      bottomPanelHeight: 0,
    });
    expect(emptyOpenPanelPlacement()).toMatchObject({
      rightPanelWidth: DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
      editorHidden: true,
    });
  });
});

describe("workbenchShellPlacement maximized", () => {
  it("reports the maximized panel only for an open panel in the agent layout", () => {
    expect(placement("agent", "files", false, true).rightPanelMaximized).toBe(true);
    expect(placement("agent", "files", false, false).rightPanelMaximized).toBe(false);
    expect(placement("agent", null, false, true).rightPanelMaximized).toBe(false);
    expect(placement("editor-expanded", null, false, true).rightPanelMaximized).toBe(false);
    expect(
      workbenchShellPlacement({
        bottomPanelVisible: false,
        effectiveLayout: "agent",
        layout: { ...initialAgentWorkbenchLayout, rightPanel: "open", rightPanelMaximized: true },
      }),
    ).toMatchObject({ rightPanelMaximized: true, editorHidden: true });
  });

  it("keeps the editor over the Files area while maximized", () => {
    expect(placement("agent", "files", true, true)).toMatchObject({
      editorHidden: false,
      rightPanelMaximized: true,
      rightPanelWidth: DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
      bottomPanelHeight: 280,
    });
    expect(placement("agent", "diff", false, true).editorHidden).toBe(true);
  });
});

describe("workbenchFrameTreeState", () => {
  it("shows the tree only in the agent layout with the editor visible and a tree reported", () => {
    expect(workbenchFrameTreeState(placement("agent", "files"), true)).toBe("visible");
    expect(workbenchFrameTreeState(placement("agent", "files"), false)).toBe("hidden");
    expect(workbenchFrameTreeState(placement("agent", "diff"), true)).toBe("hidden");
    expect(workbenchFrameTreeState(placement("editor-expanded", "files"), true)).toBe("hidden");
    expect(workbenchFrameTreeState(emptyOpenPanelPlacement(), true)).toBe("hidden");
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

    render(placement("agent", "files"));
    expect(host.querySelector('[data-slot="editor"]')).toBe(editor);
    expect(host.querySelector("#editor-content")).toBe(editorChild);
    expect(editor?.hasAttribute("hidden")).toBe(false);
    expect(editor?.hasAttribute("aria-hidden")).toBe(false);

    render(placement("editor-expanded", null));
    expect(host.querySelector('[data-slot="editor"]')).toBe(editor);
    expect(host.querySelector("#editor-content")).toBe(editorChild);
    expect(host.querySelector(".workbench-frame")?.getAttribute("data-layout")).toBe(
      "editor-expanded",
    );

    render(placement("agent", null));
    expect(host.querySelector("#editor-content")).toBe(editorChild);
    expect(editor?.hasAttribute("hidden")).toBe(true);
  });

  it("stamps the maximized panel on the frame and restores the docked panel", () => {
    render(placement("agent", "files", false, true));
    const frame = host.querySelector(".workbench-frame");
    expect(frame?.getAttribute("data-right-panel")).toBe("maximized");
    expect(host.querySelector('[data-slot="editor"]')?.hasAttribute("hidden")).toBe(false);

    render(placement("agent", "diff", false, true));
    expect(frame?.getAttribute("data-right-panel")).toBe("maximized");
    expect(host.querySelector('[data-slot="editor"]')?.hasAttribute("hidden")).toBe(true);

    render(placement("agent", "files"));
    expect(frame?.getAttribute("data-right-panel")).toBe("docked");

    render(placement("editor-expanded", null, false, true));
    expect(frame?.getAttribute("data-right-panel")).toBe("docked");
  });

  it("overlays the panel on narrow windows without remounting the editor or setting maximize", () => {
    render(placement("agent", "files"));
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
    render(placement("agent", "files", false, true));
    expect(frame?.getAttribute("data-right-panel")).toBe("maximized");
    render(placement("agent", "files"));
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

    render(placement("editor-expanded", null, true));
    expect(frame?.getAttribute("data-rail")).toBe("expanded");
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
    expect(host.querySelector(".workbench-frame")?.getAttribute("data-tree")).toBe("hidden");
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

  it("stamps a closed agent appearance variant and defaults to current", () => {
    render(placement("agent", "files"));
    expect(host.querySelector(".workbench-frame")?.getAttribute("data-agent-variant")).toBe(
      "current",
    );

    act(() =>
      root.render(
        <WorkbenchShellFrame
          agent={<div data-slot="agent">agent</div>}
          agentVariant="paper"
          bottom={<span>bottom</span>}
          chrome={<div id="chrome" />}
          editor={<div id="editor-content" />}
          placement={placement("agent", "files")}
        />,
      ),
    );
    expect(host.querySelector(".workbench-frame")?.getAttribute("data-agent-variant")).toBe(
      "paper",
    );
  });

  it("keeps the tree column collapsed while the Files surface reports no tree", () => {
    render(placement("agent", "files"), <TreeReporter visible={false} />);

    expect(host.querySelector(".workbench-frame")?.getAttribute("data-tree")).toBe("hidden");
    expect(host.querySelector('[data-slot="editor"]')?.hasAttribute("hidden")).toBe(false);
  });

  it("stamps data-tree from the reporting surface and clears it when the surface unmounts", () => {
    render(placement("agent", "files"));
    const frame = () => host.querySelector(".workbench-frame")?.getAttribute("data-tree");
    expect(frame()).toBe("hidden");

    render(placement("agent", "files"), <TreeReporter visible />);
    expect(frame()).toBe("visible");

    render(placement("agent", "files"), <TreeReporter visible={false} />);
    expect(frame()).toBe("hidden");

    render(placement("agent", "files"), <TreeReporter visible />);
    render(placement("agent", "diff"), <TreeReporter visible />);
    expect(frame()).toBe("hidden");

    render(placement("agent", "files"), <TreeReporter visible />);
    expect(frame()).toBe("visible");
    render(placement("agent", "files"));
    expect(frame()).toBe("hidden");
  });

  it("stamps data-editor from the editor host report and keeps the editor mounted while empty", () => {
    const frame = () => host.querySelector(".workbench-frame")?.getAttribute("data-editor");
    render(placement("agent", "files"));
    expect(frame()).toBe("empty");

    renderEditor(placement("agent", "files"), <EditorReporter empty />);
    const editorSlot = host.querySelector('[data-slot="editor"]');
    expect(frame()).toBe("empty");
    expect(editorSlot?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector("#editor-reporter")).not.toBeNull();

    renderEditor(placement("agent", "files"), <EditorReporter empty={false} />);
    expect(frame()).toBe("documents");
    expect(host.querySelector('[data-slot="editor"]')).toBe(editorSlot);

    renderEditor(
      placement("agent", "files"),
      <>
        <EditorReporter empty />
        <EditorReporter empty={false} />
      </>,
    );
    expect(frame()).toBe("documents");

    renderEditor(placement("agent", "files"), <EditorReporter empty />);
    expect(frame()).toBe("empty");

    render(placement("agent", "files"));
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
          placement={placement("agent", "files")}
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
          placement={placement("agent", "files")}
        />,
      ),
    );
    expect(state()).toBe("documents");
  });

  it("keeps every slot the agent renders a direct child of the frame grid", () => {
    render(placement("agent", "files"), <AgentSlots />);
    const frame = host.querySelector(".workbench-frame");

    expect(frame).not.toBeNull();
    expect(host.querySelector('[data-slot="agent"]')?.parentElement).toBe(frame);
    expect(host.querySelector('[data-slot="surface"]')?.parentElement).toBe(frame);
    expect(host.querySelector('[data-slot="editor"]')?.parentElement).toBe(frame);
    expect(host.querySelector('[data-slot="bottom"]')?.parentElement).toBe(frame);
  });

  it("portals the agent row menu into the frame that scopes the agent tokens", () => {
    render(placement("agent", null), <RowMenuHost />);

    const menu = document.querySelector(".agent-row-menu");
    expect(menu).not.toBeNull();
    expect(menu?.closest(".workbench-frame")).toBe(host.querySelector(".workbench-frame"));
    expect(menu?.parentElement).toBe(host.querySelector(".workbench-frame"));
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
          placement={placement("editor-expanded", null)}
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
      <AgentThreadRowMenu
        archived={false}
        branch={null}
        onClose={() => undefined}
        onCommand={() => undefined}
        onRename={() => undefined}
        pinned={false}
        position={{ x: 10, y: 10 }}
        running={false}
        threadId="agt-1"
      />
    </div>
  );
}

function TreeReporter({ visible }: { readonly visible: boolean }) {
  useWorkbenchFrameTreeReport(visible);
  return <div data-slot="agent">agent</div>;
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
  effectiveLayout: "agent" | "editor-expanded",
  rightSurface: "files" | "diff" | "terminal" | null,
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
