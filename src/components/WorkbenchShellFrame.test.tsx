// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
  initialAgentWorkbenchLayout,
} from "../domain/agentWorkbenchLayout";
import { WorkbenchShellFrame } from "./WorkbenchShellFrame";
import { useWorkbenchFrameTreeReport } from "./workbenchFrameTreeReport";
import {
  workbenchFrameTreeState,
  workbenchShellPlacement,
  type WorkbenchShellPlacement,
} from "./workbenchShellPlacement";

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

  it("keeps the right panel track while an open panel shows no surface", () => {
    render(emptyOpenPanelPlacement());
    const frame = host.querySelector<HTMLElement>(".editor-workbench");

    expect(frame?.style.getPropertyValue("--agent-right-panel-committed")).toBe(
      `${DEFAULT_AGENT_RIGHT_PANEL_WIDTH}px`,
    );
    expect(host.querySelector('[data-slot="editor"]')?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector(".workbench-frame")?.getAttribute("data-tree")).toBe("hidden");
  });

  it("publishes the committed panel sizes on the workbench the drag handles write to", () => {
    render(placement("agent", "diff", true));
    const frame = host.querySelector<HTMLElement>(".editor-workbench");

    expect(frame?.style.getPropertyValue("--agent-right-panel-committed")).toBe("540px");
    expect(frame?.style.getPropertyValue("--agent-bottom-panel-committed")).toBe("280px");
    expect(host.querySelector('[data-slot="bottom"]')?.textContent).toBe("bottom");
    expect(host.querySelector(".editor-workbench > #chrome")).not.toBeNull();
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
});

function TreeReporter({ visible }: { readonly visible: boolean }) {
  useWorkbenchFrameTreeReport(visible);
  return <div data-slot="agent">agent</div>;
}

function emptyOpenPanelPlacement(bottomPanelVisible = false): WorkbenchShellPlacement {
  return workbenchShellPlacement({
    bottomPanelVisible,
    effectiveLayout: "agent",
    layout: { ...initialAgentWorkbenchLayout, rightPanel: "open", rightSurface: null },
  });
}

function placement(
  effectiveLayout: "agent" | "editor-expanded",
  rightSurface: "files" | "diff" | "terminal" | null,
  bottomPanelVisible = false,
): WorkbenchShellPlacement {
  return workbenchShellPlacement({
    bottomPanelVisible,
    effectiveLayout,
    layout: {
      ...initialAgentWorkbenchLayout,
      rightPanel: rightSurface === null ? "closed" : "open",
      rightSurface,
    },
  });
}
