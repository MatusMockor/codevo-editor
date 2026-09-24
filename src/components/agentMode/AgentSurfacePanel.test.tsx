// @vitest-environment jsdom

import { FitAddon } from "@xterm/addon-fit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentGitHistoryGateway } from "../../application/useAgentGitHistory";
import type { Commit } from "../../domain/git";
import type { AgentSurfaceFileTreeSurface } from "../../application/useAgentSurfaceFileTree";
import {
  initialAgentWorkbenchLayout,
  type AgentSurfaceKind,
  type AgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import { waitForReact } from "../../test/reactTestLifecycle";
import { WorkbenchShellFrame } from "../WorkbenchShellFrame";
import {
  WORKBENCH_FRAME_EDITOR_SLOT_ATTRIBUTE,
  WORKBENCH_FRAME_EDITOR_YIELD_SELECTOR,
  workbenchShellPlacement,
  type WorkbenchShellPlacement,
} from "../workbenchShellPlacement";
import {
  WorkbenchFrameEditorStateContext,
  type WorkbenchFrameEditorState,
} from "../workbenchFrameEditorReport";
import { readAgentModeStyles } from "./agentModeCssTestSupport";
import {
  WithRightPanelContext,
  rightPanelTestContext,
} from "./rightPanel/agentRightPanelTestSupport";
import { AGENT_SURFACE_HOTKEYS, agentSurfaceForHotkey } from "./agentSurfaceHotkeys";
import {
  AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE,
  AgentSurfacePanel,
  type AgentSurfacePanelProps,
} from "./AgentSurfacePanel";
import {
  SURFACE_FILES_THREAD_DESCRIPTION,
  SURFACE_FILES_PROJECT_DESCRIPTION,
  SURFACE_FOREIGN_ROOT_TERMINAL_REASON,
  SURFACE_NO_PROJECT_REASON,
  SURFACE_UNTRUSTED_GIT_REASON,
  SURFACE_UNTRUSTED_TERMINAL_REASON,
  SURFACE_WORKTREE_GONE_REASON,
} from "./agentSurfacePolicy";
import {
  SURFACE_FIXTURE_WORKTREE,
  surfaceRepositoryScope,
  surfaceThreadView,
} from "./agentSurfaceTestFixtures";
import { fakeTerminalGateway, installResizeObserver } from "./agentSurfaceTerminalTestSupport";

vi.mock("@xterm/xterm", async () =>
  (await import("./agentSurfaceTerminalTestSupport")).xtermMockModule(),
);
vi.mock("@xterm/addon-fit", async () =>
  (await import("./agentSurfaceTerminalTestSupport")).fitAddonMockModule(),
);

function open(
  openSurfaces: ReadonlyArray<AgentSurfaceKind>,
  activeSurface: AgentSurfaceKind | null,
): AgentSurfacePanelProps["layout"] {
  return { openSurfaces, activeSurface };
}

describe("agentSurfaceForHotkey", () => {
  it("maps the card letters case-insensitively and rejects anything else", () => {
    expect(agentSurfaceForHotkey("f")).toBe("files");
    expect(agentSurfaceForHotkey("D")).toBe("diff");
    expect(agentSurfaceForHotkey("t")).toBe("terminal");
    expect(agentSurfaceForHotkey("x")).toBeNull();
    expect(agentSurfaceForHotkey("Enter")).toBeNull();
    expect(agentSurfaceForHotkey("")).toBeNull();
  });
});

describe("AgentSurfacePanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    installResizeObserver();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it.each([open([], null), open(["diff"], "diff")])(
    "keeps the surface header draggable while its controls remain interactive: %j",
    (layout) => {
      render({ layout, layoutControls: <button type="button">Toggle panel</button> });
      const header = host.querySelector("[data-agent-surface-head]");
      expect(header?.getAttribute("data-tauri-drag-region")).toBe("deep");
      expect(
        header?.querySelector(".agent-session__spacer")?.closest("[data-tauri-drag-region]"),
      ).toBe(header);
      for (const button of header?.querySelectorAll("button") ?? []) {
        expect(button.hasAttribute("data-tauri-drag-region")).toBe(false);
        expect(button.querySelector("[data-tauri-drag-region]")).toBeNull();
      }
      expect(
        host.querySelector(".agent-surface__body")?.closest("[data-tauri-drag-region]"),
      ).toBeNull();
    },
  );

  it("shows the chooser with the catalog cards, key hints and no tabs", () => {
    const onOpenSurface = vi.fn();
    render({ onOpenSurface });

    expect(host.querySelector(".agent-surface-empty__title")?.textContent).toBe("Open a surface");
    expect(host.querySelectorAll(".agent-surface-card")).toHaveLength(7);
    expect(host.querySelector("[data-surface]")?.getAttribute("data-surface")).toBe("empty");
    expect(host.querySelector('[role="tab"]')).toBeNull();
    expect(host.querySelector('[aria-label="Add panel surface"]')).not.toBeNull();
    expect(
      Array.from(host.querySelectorAll(".agent-surface-card__key")).map((key) => key.textContent),
    ).toEqual([
      AGENT_SURFACE_HOTKEYS.terminal,
      AGENT_SURFACE_HOTKEYS.files,
      AGENT_SURFACE_HOTKEYS.diff,
      AGENT_SURFACE_HOTKEYS.git,
      AGENT_SURFACE_HOTKEYS.scripts,
      AGENT_SURFACE_HOTKEYS.pullRequest,
      AGENT_SURFACE_HOTKEYS.history,
    ]);
    expect(
      host.querySelector('[aria-label="Open Diff surface"]')?.getAttribute("aria-keyshortcuts"),
    ).toBe("D");
    click('[aria-label="Open Diff surface"]');
    expect(onOpenSurface).toHaveBeenCalledWith("diff");
  });

  it("focuses the chooser and opens a surface from its hint letter", () => {
    const onOpenSurface = vi.fn();
    render({ onOpenSurface, thread: null });
    const chooser = host.querySelector<HTMLElement>('[role="group"][aria-label="Open a surface"]');
    expect(chooser).not.toBeNull();
    expect(document.activeElement).toBe(chooser);

    keydown(chooser, "f");
    expect(onOpenSurface).toHaveBeenCalledWith("files");

    keydown(chooser, "d");
    keydown(chooser, "t");
    expect(onOpenSurface).toHaveBeenCalledTimes(3);

    render({ onOpenSurface });
    keydown(host.querySelector<HTMLElement>('[role="group"]'), "T");
    expect(onOpenSurface).toHaveBeenLastCalledWith("terminal");
    keydown(host.querySelector<HTMLElement>('[role="group"]'), "d", { metaKey: true });
    expect(onOpenSurface).toHaveBeenCalledTimes(4);
  });

  it("tells the Files card what it opens with and without a thread", () => {
    render({ thread: null });
    expect(filesCardDescription()).toBe(SURFACE_FILES_PROJECT_DESCRIPTION);

    render({ thread: surfaceThreadView() });
    expect(filesCardDescription()).toBe(SURFACE_FILES_THREAD_DESCRIPTION);
  });

  it("disables cards with reasons: no thread, worktree gone, untrusted terminal", () => {
    render({ thread: null, scope: { kind: "none" } });
    expect(reasons()).toEqual(Array(5).fill(SURFACE_NO_PROJECT_REASON));
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Open Files surface"]')?.disabled,
    ).toBe(false);

    render({ thread: surfaceThreadView({ worktreeMissing: true }) });
    expect(reasons()).toEqual(Array(7).fill(SURFACE_WORKTREE_GONE_REASON));

    const onTrustWorkspace = vi.fn();
    render({ workspaceTrusted: false, onTrustWorkspace });
    expect(reasons()).toEqual([
      SURFACE_UNTRUSTED_TERMINAL_REASON,
      SURFACE_UNTRUSTED_GIT_REASON,
      SURFACE_UNTRUSTED_GIT_REASON,
      SURFACE_UNTRUSTED_GIT_REASON,
    ]);
    expect(host.querySelector('[aria-label="Trust the workspace"]')).toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Open Terminal surface"]')?.disabled,
    ).toBe(true);
    expect(onTrustWorkspace).not.toHaveBeenCalled();
  });

  it("fills the Files surface with the tree while no document is open and hides the toggle", () => {
    render({ layout: open(["files"], "files") });

    const aside = host.querySelector("aside.agent-surface");
    expect(aside?.getAttribute("data-surface")).toBe("files");
    expect(aside?.getAttribute("data-tree")).toBe("visible");
    expect(host.querySelector("[data-agent-surface-tree]")).not.toBeNull();
    expect(host.querySelector('input[aria-label="Search workspace files"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Toggle file tree"]')).toBeNull();
    const slot = host.querySelector(
      `.agent-surface__editor-slot[${AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE}]`,
    );
    expect(slot).not.toBeNull();
    expect(slot?.childElementCount).toBe(0);
    expect(host.querySelector(".monaco-editor")).toBeNull();
    expect(host.querySelector(".agent-surface__head .agent-surface__editor-tabs")).not.toBeNull();
  });

  it("offers the tree toggle only while a document is open and toggles the tree", () => {
    render({ layout: open(["files"], "files") }, "documents");

    const aside = host.querySelector("aside.agent-surface");
    expect(aside?.getAttribute("data-tree")).toBe("visible");
    expect(host.querySelector("[data-agent-surface-tree]")).not.toBeNull();

    click('[aria-label="Toggle file tree"]');
    expect(aside?.getAttribute("data-tree")).toBe("hidden");
    expect(host.querySelector("[data-agent-surface-tree]")).toBeNull();
    expect(host.querySelector(`[${AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE}]`)).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Toggle file tree"]')?.getAttribute("aria-pressed"),
    ).toBe("false");

    click('[aria-label="Toggle file tree"]');
    expect(aside?.getAttribute("data-tree")).toBe("visible");
  });

  it("brings a hidden tree back as soon as the last document closes", () => {
    render({ layout: open(["files"], "files") }, "documents");
    click('[aria-label="Toggle file tree"]');
    expect(host.querySelector("aside.agent-surface")?.getAttribute("data-tree")).toBe("hidden");

    render({ layout: open(["files"], "files") }, "empty");
    const aside = host.querySelector("aside.agent-surface");
    expect(aside?.getAttribute("data-tree")).toBe("visible");
    expect(host.querySelector("[data-agent-surface-tree]")).not.toBeNull();
    expect(host.querySelector('input[aria-label="Search workspace files"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Toggle file tree"]')).toBeNull();

    render({ layout: open(["files"], "files") }, "documents");
    expect(host.querySelector("aside.agent-surface")?.getAttribute("data-tree")).toBe("hidden");
    expect(host.querySelector('[aria-label="Toggle file tree"]')).not.toBeNull();
  });

  it("keeps the editor slot for a Files surface without a thread tree", () => {
    render({ layout: open(["files"], "files"), fileTree: null, thread: null }, "empty");

    const aside = host.querySelector("aside.agent-surface");
    expect(aside?.getAttribute("data-tree")).toBe("hidden");
    expect(host.querySelector("[data-agent-surface-tree]")).toBeNull();
    expect(host.querySelector(`[${AGENT_SURFACE_EDITOR_SLOT_ATTRIBUTE}]`)).not.toBeNull();
  });

  it("reports the tree hidden when the Files surface has no tree or is not active", () => {
    render({ layout: open(["files"], "files"), fileTree: null, thread: null });
    const aside = host.querySelector("aside.agent-surface");
    expect(aside?.getAttribute("data-tree")).toBe("hidden");
    expect(host.querySelector('[aria-label="Toggle file tree"]')).toBeNull();
    expect(host.querySelector("[data-agent-surface-tree]")).toBeNull();
    const files = host.querySelector(".agent-surface__files");
    expect(files?.childElementCount).toBe(1);
    expect(files?.firstElementChild?.className).toBe("cv-files__preview");
    expect(files?.querySelector(".cv-files__preview > .agent-surface__editor-slot")).not.toBeNull();

    render({ layout: open(["files", "diff"], "diff") });
    expect(host.querySelector("aside.agent-surface")?.getAttribute("data-tree")).toBe("hidden");
    expect(host.querySelector('[aria-label="Toggle file tree"]')).toBeNull();
    expect(host.querySelector("[data-agent-surface-tree]")).toBeNull();
    expect(host.querySelector(".agent-surface__editor-tabs")).toBeNull();

    render({ layout: open(["files"], "files"), hidden: true });
    expect(host.querySelector(".agent-surface__editor-tabs")).toBeNull();
  });

  it("renders one tab per open surface with its close glyph and the add button", () => {
    const onActivateSurface = vi.fn();
    const onCloseSurfaceTab = vi.fn();
    render({
      layout: open(["files", "diff"], "files"),
      onActivateSurface,
      onCloseSurfaceTab,
    });

    expect(tabLabels()).toEqual(["Files", "Diff"]);
    expect(activeTab()).toBe("Files");
    expect(
      host.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("aria-controls"),
    ).toBe("agent-surface-panel-files");
    expect(host.querySelectorAll(".cv-tab__close")).toHaveLength(2);
    expect(cssRule(agentModeCss, ".workbench-frame {")).toContain(
      "--agent-surface-focus-gutter: 4px",
    );

    click('[role="tab"][title="Diff"]');
    expect(onActivateSurface).toHaveBeenCalledWith("diff");
    click('[role="tab"][title="Diff"] .cv-tab__close');
    expect(onCloseSurfaceTab).toHaveBeenCalledWith("diff");
    expect(host.querySelector('[aria-label="Add panel surface"]')).not.toBeNull();
  });

  it("never renders an add button, whichever surfaces are open", () => {
    render({ layout: open(["files", "diff", "terminal"], "terminal") });
    expect(host.querySelector('[aria-label="Add surface"]')).toBeNull();
    expect(tabLabels()).toEqual(["Files", "Diff", "Terminal"]);

    render({ layout: open(["files"], null) });
    expect(host.querySelector('[aria-label="Add surface"]')).toBeNull();
    expect(tabLabels()).toEqual(["Files"]);
    expect(activeTab()).toBeNull();
    expect(host.querySelector(".agent-surface-empty")).not.toBeNull();
    expect(host.querySelector('[data-surface-panel="files"]')?.hasAttribute("hidden")).toBe(true);
  });

  it("keeps inactive surfaces mounted but hidden and unmounts a closed tab", async () => {
    const gateway = fakeTerminalGateway();
    const props = defaultProps();
    const terminal = { ...props.terminal!, terminalGateway: gateway };
    render({ layout: open(["diff", "terminal"], "terminal"), terminal });
    await waitForReact(() =>
      expect(host.querySelector('[role="tab"][title="Terminal 1"]')).not.toBeNull(),
    );
    expect(host.querySelector('[role="tablist"][aria-label="Terminal sessions"]')).toBeNull();
    expect(host.querySelector('[role="toolbar"][aria-label="Terminal actions"]')).not.toBeNull();
    await waitForReact(() => expect(gateway.start).toHaveBeenCalledTimes(1));
    await waitForReact(() => expect(host.querySelector(".cv-diff")).not.toBeNull());
    expect(host.querySelector('[data-surface-panel="diff"]')?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector('[data-surface-panel="terminal"]')?.hasAttribute("hidden")).toBe(
      false,
    );

    render({ layout: open(["diff", "terminal"], "diff"), terminal });
    expect(host.querySelector('[data-surface-panel="terminal"]')?.hasAttribute("hidden")).toBe(
      true,
    );
    expect(host.querySelector("[data-agent-surface-terminal]")).not.toBeNull();
    expect(gateway.stop).not.toHaveBeenCalled();
    expect(gateway.start).toHaveBeenCalledTimes(1);

    render({ layout: open(["diff"], "diff"), terminal });
    expect(host.querySelector("[data-agent-surface-terminal]")).toBeNull();
    await waitForReact(() => expect(gateway.stop).toHaveBeenCalledWith(1));
    expect(host.querySelector(".cv-diff")).not.toBeNull();
  });

  it("loads history only while active and discards a result after switching away", async () => {
    let settle!: (commits: Commit[]) => void;
    const pending = new Promise<Commit[]>((resolve) => {
      settle = resolve;
    });
    const gateway: AgentGitHistoryGateway = {
      getRepoStatus: vi.fn(async () => ({ gitAvailable: true, isRepository: true })),
      getBranches: vi.fn(async () => ({ current: "main", local: ["main"], remotes: {} })),
      getCommitLog: vi.fn().mockReturnValueOnce(pending).mockResolvedValue([]),
      getCommitDetails: vi.fn(),
      getCommitFiles: vi.fn(),
      getCommitDiff: vi.fn(),
    };
    const history: NonNullable<AgentSurfacePanelProps["history"]> = {
      scope: {
        kind: "available",
        target: { rootPath: SURFACE_FIXTURE_WORKTREE, ownerKey: "history-owner" },
      },
      gateway,
      monacoTheme: "calm-dark",
    };
    render({ layout: open(["files", "history"], "files"), history });
    await act(async () => Promise.resolve());
    expect(gateway.getRepoStatus).not.toHaveBeenCalled();
    expect(host.querySelector('[aria-label="Git history"]')).toBeNull();

    render({ layout: open(["files", "history"], "history"), history });
    await waitForReact(() => expect(gateway.getCommitLog).toHaveBeenCalledTimes(1));
    expect(gateway.getRepoStatus).toHaveBeenCalledWith(SURFACE_FIXTURE_WORKTREE);
    expect(host.querySelector('[aria-label="Git history"]')).not.toBeNull();

    render({ layout: open(["files", "history"], "files"), history });
    expect(host.querySelector('[aria-label="Git history"]')).toBeNull();
    await act(async () =>
      settle([
        {
          hash: "stale",
          abbrevHash: "stale",
          subject: "Stale hidden result",
          authorName: "Contributor",
          authorEmail: "",
          date: "2026-09-07",
          labels: [],
          parents: [],
        },
      ]),
    );
    expect(host.textContent).not.toContain("Stale hidden result");

    render({ layout: open(["files", "history"], "history"), history });
    await waitForReact(() =>
      expect(host.textContent).toContain("No commits in this repository yet."),
    );
    expect(gateway.getCommitLog).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("Stale hidden result");
    render({ layout: open(["files", "history"], "history"), hidden: true, history });
    expect(host.querySelector('[aria-label="Git history"]')).toBeNull();
  });

  it("keeps an active terminal visible while inactive tabs close and hides it without stopping", async () => {
    const gateway = fakeTerminalGateway();
    const props = defaultProps();
    const terminal = { ...props.terminal!, terminalGateway: gateway };
    render({ layout: open(["files", "diff", "terminal"], "terminal"), terminal });
    await waitForReact(() => expect(gateway.start).toHaveBeenCalledTimes(1));
    await waitForReact(() => expect(gateway.acknowledgeStart).toHaveBeenCalledTimes(1));
    const panel = host.querySelector<HTMLElement>(".terminal-panel");
    const fitResults = vi.mocked(FitAddon).mock.results;
    const fit = fitResults[fitResults.length - 1]?.value.fit as ReturnType<typeof vi.fn>;
    const initialFitCalls = fit.mock.calls.length;
    expect(panel?.hidden).toBe(false);

    render({ layout: open(["diff", "terminal"], "terminal"), terminal });
    expect(host.querySelector(".terminal-panel")).toBe(panel);
    expect(panel?.hidden).toBe(false);
    await waitForReact(() => expect(fit).toHaveBeenCalledTimes(initialFitCalls + 1));
    render({ layout: open(["terminal"], "terminal"), terminal });
    expect(host.querySelector(".terminal-panel")).toBe(panel);
    expect(panel?.hidden).toBe(false);
    await waitForReact(() => expect(fit).toHaveBeenCalledTimes(initialFitCalls + 2));
    expect(gateway.start).toHaveBeenCalledTimes(1);
    expect(gateway.stop).not.toHaveBeenCalled();

    render({ hidden: true, layout: open(["terminal"], "terminal"), terminal });
    expect(panel?.hidden).toBe(true);
    await act(async () => Promise.resolve());
    expect(fit).toHaveBeenCalledTimes(initialFitCalls + 2);
    render({ layout: open(["terminal"], "terminal"), terminal });
    expect(host.querySelector(".terminal-panel")).toBe(panel);
    expect(panel?.hidden).toBe(false);
    await waitForReact(() => expect(fit).toHaveBeenCalledTimes(initialFitCalls + 3));
    expect(gateway.start).toHaveBeenCalledTimes(1);
    expect(gateway.stop).not.toHaveBeenCalled();
  });

  it("explains a blocked open tab instead of mounting its surface", async () => {
    render({ layout: open(["diff", "terminal"], "terminal"), workspaceRoot: "/workspace/other" });
    await act(async () => Promise.resolve());
    expect(host.querySelector("[data-agent-surface-terminal]")).toBeNull();
    expect(host.querySelector('[data-surface-panel="terminal"] .cv-rp-note')?.textContent).toBe(
      SURFACE_FOREIGN_ROOT_TERMINAL_REASON,
    );

    render({ layout: open(["diff"], "diff"), thread: null, scope: { kind: "none" } });
    expect(host.querySelector('[data-surface-panel="diff"] .cv-rp-note')?.textContent).toBe(
      SURFACE_NO_PROJECT_REASON,
    );
  });

  it("wires the layout controls slot and resize handle without an overall close button", () => {
    render({
      layout: open(["files"], "files"),
      layoutControls: <button data-layout-control type="button" />,
    });

    expect(host.querySelector(".cv-topbar__trailing [data-layout-control]")).not.toBeNull();
    expect(host.querySelector('[role="separator"][aria-orientation="vertical"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Close panel"]')).toBeNull();
    expect(host.querySelector('[role="tab"][title="Files"] .cv-tab__close')).not.toBeNull();
  });

  it("resizes from the rendered width within the same bound as a pointer drag", () => {
    const onResizeWidth = vi.fn();
    const restore = frameOfWidth(1400, 584);
    render({
      layout: { ...open(["diff"], "diff"), rightPanelWidth: 700, rail: "expanded", railWidth: 256 },
      onResizeWidth,
    });

    const separator = resizeSeparator();
    expect(separator.tabIndex).toBe(0);
    expect(separator.getAttribute("aria-valuenow")).toBe("584");
    expect(separator.getAttribute("aria-valuemin")).toBe("360");
    expect(separator.getAttribute("aria-valuemax")).toBe("584");

    keydown(separator, "ArrowLeft");
    keyup(separator, "ArrowLeft");
    keydown(separator, "ArrowRight");
    keyup(separator, "ArrowRight");
    keydown(separator, "Home");
    keyup(separator, "Home");
    keydown(separator, "End");
    keyup(separator, "End");
    keydown(separator, "ArrowUp");
    keyup(separator, "ArrowUp");

    expect(onResizeWidth.mock.calls.map(([width]) => width)).toEqual([584, 568, 360, 584]);
    restore();
  });

  it("previews every held key immediately and persists the width once on release or blur", () => {
    const onResizeWidth = vi.fn();
    const restore = frameOfWidth(1400, 584);
    render({
      layout: { ...open(["diff"], "diff"), rightPanelWidth: 700, rail: "expanded", railWidth: 256 },
      onResizeWidth,
    });
    const separator = resizeSeparator();

    keydown(separator, "ArrowRight");
    keydown(separator, "ArrowRight");
    keydown(separator, "ArrowRight");

    expect(onResizeWidth).not.toHaveBeenCalled();
    expect(host.style.getPropertyValue("--agent-right-panel-width")).toBe("536px");
    expect(separator.getAttribute("aria-valuenow")).toBe("536");

    keyup(separator, "ArrowRight");
    expect(onResizeWidth.mock.calls).toEqual([[536]]);
    expect(host.style.getPropertyValue("--agent-right-panel-width")).toBe("");

    keydown(separator, "ArrowRight");
    act(() => separator.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(onResizeWidth.mock.calls).toEqual([[536], [568]]);
    expect(host.style.getPropertyValue("--agent-right-panel-width")).toBe("");
    restore();
  });

  it("drops an unreleased preview without persisting it when the panel unmounts", () => {
    const onResizeWidth = vi.fn();
    const restore = frameOfWidth(1400, 584);
    render({
      layout: { ...open(["diff"], "diff"), rightPanelWidth: 700, rail: "expanded", railWidth: 256 },
      onResizeWidth,
    });

    keydown(resizeSeparator(), "ArrowRight");
    act(() => root.render(null));

    expect(onResizeWidth).not.toHaveBeenCalled();
    expect(host.style.getPropertyValue("--agent-right-panel-width")).toBe("");
    restore();
  });

  it("takes the separator out of the tab order while the panel is maximized", () => {
    const onResizeWidth = vi.fn();
    render({
      layout: { ...open(["diff"], "diff"), rightPanelWidth: 600, rightPanelMaximized: true },
      onResizeWidth,
    });
    const separator = resizeSeparator();

    expect(separator.tabIndex).toBe(-1);
    expect(separator.getAttribute("aria-disabled")).toBe("true");
    keydown(separator, "ArrowLeft");
    keyup(separator, "ArrowLeft");
    expect(onResizeWidth).not.toHaveBeenCalled();

    render({ layout: { ...open(["diff"], "diff"), rightPanelWidth: 600 }, onResizeWidth });
    expect(resizeSeparator().tabIndex).toBe(0);
    expect(resizeSeparator().hasAttribute("aria-disabled")).toBe(false);
  });

  it("clears the traffic lights and hosts the sidebar reveal only when maximized", () => {
    render({
      layout: { ...open(["diff"], "diff"), rightPanelMaximized: true },
      leadingControls: <button aria-label="Expand sidebar" type="button" />,
    });

    const header = host.querySelector("[data-agent-surface-head]");
    expect(header?.className).toContain("cv-topbar--panel");
    expect(header?.className).toContain("cv-topbar--window-edge");
    expect(
      header?.querySelector('.cv-topbar__leading button[aria-label="Expand sidebar"]'),
    ).not.toBeNull();

    render({ layout: open(["diff"], "diff") });
    expect(host.querySelector("[data-agent-surface-head]")?.className).not.toContain(
      "cv-topbar--window-edge",
    );
  });

  it("keeps the tablist owning only tabs and pairs each tab with its panel", () => {
    render({ layout: open(["files", "diff"], "files") });

    const tablist = host.querySelector('[role="tablist"][aria-label="Panel surfaces"]');
    expect(tablist).not.toBeNull();
    expect(Array.from(tablist?.children ?? []).map((child) => child.getAttribute("role"))).toEqual([
      "tab",
      "tab",
    ]);
    expect(host.querySelector('[role="tab"][title="Diff"]')?.getAttribute("aria-controls")).toBe(
      "agent-surface-panel-diff",
    );
    expect(host.querySelector("#agent-surface-panel-diff")?.getAttribute("role")).toBe("tabpanel");
    expect(host.querySelector('[role="tab"]')?.closest('[role="tablist"]')).toBe(tablist);
  });

  it("rolls the tab stop and moves between tabs with the arrow, Home and End keys", () => {
    const onActivateSurface = vi.fn();
    render({ layout: open(["files", "diff", "terminal"], "diff"), onActivateSurface });

    expect(
      Array.from(host.querySelectorAll('[aria-label="Panel surfaces"] [role="tab"]')).map((tab) =>
        tab.getAttribute("tabindex"),
      ),
    ).toEqual(["-1", "0", "-1"]);

    keydown(host.querySelector<HTMLElement>('[role="tab"][title="Diff"]'), "ArrowRight");
    expect(onActivateSurface).toHaveBeenLastCalledWith("terminal");

    keydown(host.querySelector<HTMLElement>('[role="tab"][title="Diff"]'), "ArrowLeft");
    expect(onActivateSurface).toHaveBeenLastCalledWith("files");

    keydown(host.querySelector<HTMLElement>('[role="tab"][title="Diff"]'), "Home");
    expect(onActivateSurface).toHaveBeenLastCalledWith("files");

    keydown(host.querySelector<HTMLElement>('[role="tab"][title="Diff"]'), "End");
    expect(onActivateSurface).toHaveBeenLastCalledWith("terminal");

    expect(onActivateSurface).toHaveBeenCalledTimes(4);
  });

  it("wraps the arrow keys around the tab strip and focuses the tab it activates", () => {
    render({ layout: open(["files", "diff"], "files") });
    const files = host.querySelector<HTMLElement>('[role="tab"][title="Files"]');
    files?.focus();

    keydown(files, "ArrowLeft");
    expect(document.activeElement?.getAttribute("title")).toBe("Diff");
  });

  it("focuses the chooser only when it was explicitly requested", () => {
    render({ chooserAutoFocus: false });
    expect(document.activeElement).not.toBe(
      host.querySelector('[role="group"][aria-label="Open a surface"]'),
    );

    render({ chooserAutoFocus: true });
    expect(document.activeElement).toBe(
      host.querySelector('[role="group"][aria-label="Open a surface"]'),
    );
  });

  it("never focuses the chooser of a hidden panel and reports no tree", () => {
    render({ hidden: true, chooserAutoFocus: true });
    expect(document.activeElement).not.toBe(
      host.querySelector('[role="group"][aria-label="Open a surface"]'),
    );

    render({ hidden: true, layout: open(["files"], "files") });
    expect(host.querySelector("[data-surface]")?.getAttribute("data-tree")).toBe("hidden");
  });

  it("shows terminal sessions as strip tabs and closes the surface with the last session", async () => {
    const onCloseSurfaceTab = vi.fn();
    const gateway = fakeTerminalGateway();
    const props = defaultProps();
    render({
      layout: open(["diff", "terminal"], "terminal"),
      terminal: { ...props.terminal!, terminalGateway: gateway },
      onCloseSurfaceTab,
    });
    await waitForReact(() =>
      expect(host.querySelector('[role="tab"][title="Terminal 1"]')).not.toBeNull(),
    );
    click('[role="tab"][title="Terminal 1"] .cv-tab__close');
    expect(onCloseSurfaceTab).toHaveBeenCalledWith("terminal");

    click('[aria-label="New terminal"]');
    await waitForReact(() => expect(tabLabels()).toEqual(["Diff", "Terminal 1", "Terminal 2"]));
  });

  it("renders the agents slot for the agents surface", () => {
    render({
      layout: open(["agents"], "agents"),
      agentsPanel: <p data-testid="agents-slot">agents</p>,
    });
    expect(host.querySelector('[data-testid="agents-slot"]')).not.toBeNull();
  });

  function tabLabels(): string[] {
    return Array.from(host.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent ?? "");
  }

  function activeTab(): string | null {
    return host.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null;
  }

  function filesCardDescription(): string {
    return (
      host.querySelector('[aria-label="Open Files surface"] .agent-surface-card__description')
        ?.textContent ?? ""
    );
  }

  function reasons(): string[] {
    return Array.from(host.querySelectorAll(".agent-surface-card__reason")).map(
      (element) => element.firstChild?.textContent ?? "",
    );
  }

  function render(
    overrides: Partial<AgentSurfacePanelProps> = {},
    editorState: WorkbenchFrameEditorState = "empty",
  ): void {
    act(() =>
      root.render(
        <WorkbenchFrameEditorStateContext.Provider value={editorState}>
          <WithRightPanelContext value={rightPanelTestContext()}>
            <AgentSurfacePanel {...defaultProps()} {...overrides} />
          </WithRightPanelContext>
        </WorkbenchFrameEditorStateContext.Provider>,
      ),
    );
  }

  function click(selector: string): void {
    const element = host.querySelector<HTMLElement>(selector);
    expect(element, `Missing element ${selector}`).not.toBeNull();
    act(() => element?.click());
  }

  function keyup(element: HTMLElement, key: string): void {
    act(() => {
      element.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
    });
  }

  function resizeSeparator(): HTMLElement {
    const element = host.querySelector<HTMLElement>(
      '[role="separator"][aria-label="Resize right panel"]',
    );
    expect(element).not.toBeNull();
    return element as HTMLElement;
  }

  function frameOfWidth(frameWidth: number, renderedPanelWidth: number): () => void {
    host.classList.add("editor-workbench");
    Object.defineProperty(host, "clientWidth", { configurable: true, value: frameWidth });
    const measure = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const width = this.classList.contains("agent-surface") ? renderedPanelWidth : 0;
        return new DOMRect(0, 0, width, 0);
      });
    return () => measure.mockRestore();
  }

  function keydown(element: HTMLElement | null, key: string, init: KeyboardEventInit = {}): void {
    expect(element).not.toBeNull();
    act(() => {
      element?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
    });
  }
});

describe("agent surface styles", () => {
  it("sets the panel and its head on the shared rail tone with no rule between them", () => {
    const surface = cssRule(agentModeCss, ".agent-surface {");
    expect(surface).toContain("background: var(--cv-canvas)");
    expect(surface).toContain("box-shadow: var(--cv-edge-start-divider)");
    expect(surface).not.toContain("border");

    const head = cssRule(agentModeCss, ".agent-surface__head {");
    expect(head).not.toContain("border");
    expect(head).not.toContain("background");
  });

  it("drops the legacy surface chips and keeps the editor tabs raised", () => {
    expect(agentModeCss).not.toContain(".agent-surface__tabitem");
    expect(cssRule(agentModeCss, ".agent-surface__editor-tabs {")).not.toContain("border");
    const editorTab = cssRule(agentModeCss, ".agent-surface__editor-tabs .editor-tab {");
    expect(editorTab).toContain("height: 28px");
    expect(editorTab).toContain("border-radius: var(--agent-radius-sm)");
    expect(cssRule(agentModeCss, ".agent-surface__editor-tabs .editor-tab.active {")).toContain(
      "background: var(--codevo-raised)",
    );

    expect(
      cssRule(agentModeCss, ".agent-surface__head .cv-topbar__title > .agent-iconbutton {"),
    ).toContain("width: 26px");
  });

  it("drops the files subhead and gives the tree a tools row on the shared rail tone", () => {
    expect(agentModeCss).not.toContain(".agent-surface__subhead");

    const tree = cssRule(agentModeCss, ".agent-surface-tree {");
    expect(tree).toContain("width: var(--agent-surface-tree-width)");
    expect(tree).toContain("background: var(--codevo-canvas)");
    expect(tree).not.toContain("border");

    expect(agentModeCss).not.toContain(".agent-surface-tree__tools");
    expect(agentModeCss).not.toContain(".agent-surface-tree__search");
    expect(cssRule(agentModeCss, ".agent-surface__editor-slot {")).toContain(
      "background: var(--codevo-canvas)",
    );
  });

  it("keeps the change list on the shared rail tone and lifts the open row", () => {
    expect(cssRule(agentModeCss, ".agent-surface-diff__list {")).toContain(
      "background: var(--codevo-canvas)",
    );
    const row = cssRule(agentModeCss, ".agent-surface-diff__list .agent-files__row {");
    expect(row).toContain("min-height: calc(28px * var(--codevo-fs-scale))");
    expect(row).toContain("border-radius: 7px");
    const selected = cssRule(
      agentModeCss,
      ".agent-surface-diff__list .agent-files__row--selected,",
    );
    expect(selected).toContain("background: var(--codevo-raised)");
    expect(selected).toContain("box-shadow: var(--codevo-shadow-card)");
    expect(
      cssRule(agentModeCss, ".agent-surface-diff__list .agent-files__status--added,"),
    ).toContain("background: var(--codevo-ok-soft)");
    expect(
      cssRule(agentModeCss, ".agent-surface-diff__list .agent-files__status--deleted,"),
    ).toContain("background: var(--codevo-danger-soft)");

    const preview = cssRule(agentModeCss, ".agent-surface-diff__preview {");
    expect(preview).toContain("background: var(--codevo-canvas)");
    expect(preview).toContain("border-radius: var(--agent-radius-md)");
    const terminal = cssRule(agentModeCss, ".agent-surface-terminal {");
    expect(terminal).toContain("background: var(--codevo-canvas)");
    expect(terminal).toContain("border-radius: var(--agent-radius-md)");
  });

  it("sizes the thread changes cue at the meta size with no underline rule", () => {
    const cue = cssRule(agentModeCss, ".agent-session__changes-cue {");
    expect(cue).toContain("font-size: var(--agent-fs-sm)");
    expect(cue).toContain("color: var(--agent-text-muted)");
    expect(cssRule(agentModeCss, ".agent-session__changes-cue .agent-linkbutton {")).toContain(
      "border-bottom: 0",
    );
  });
});

function tree(): AgentSurfaceFileTreeSurface {
  return {
    rootPath: SURFACE_FIXTURE_WORKTREE,
    entriesByDirectory: { [SURFACE_FIXTURE_WORKTREE]: [] },
    expandedDirectories: new Set(),
    loadingDirectories: new Set(),
    failedDirectories: new Set(),
    truncatedDirectories: new Set(),
    rootError: null,
    toggleDirectory: () => undefined,
    retryDirectory: () => undefined,
    refresh: () => undefined,
  };
}

function defaultProps(): AgentSurfacePanelProps {
  const thread = surfaceThreadView();
  return {
    layout: open([], null),
    thread,
    scope: surfaceRepositoryScope(),
    workspaceRoot: "/workspace/app",
    workspaceTrusted: true,
    layoutControls: null,
    hidden: false,
    chooserAutoFocus: true,
    fileTree: {
      source: "thread",
      tree: tree(),
      unavailable: null,
      activePath: null,
      revealActivePathSignal: 0,
      searchFiles: null,
      onOpenFile: () => undefined,
      onPreviewFile: () => undefined,
    },
    remoteMonacoTheme: "calm-dark",
    terminal: {
      workspaceId: "ws-1",
      workspaceRoot: "/workspace/app",
      workspaceTrusted: true,
      terminalGateway: fakeTerminalGateway(),
      terminalTheme: terminalThemeStub(),
      profileId: null,
      profileLabel: null,
      shellIntegrationEnabled: false,
    },
    onOpenSurface: () => undefined,
    onActivateSurface: () => undefined,
    onCloseSurfaceTab: () => undefined,
  };
}

function terminalThemeStub(): NonNullable<AgentSurfacePanelProps["terminal"]>["terminalTheme"] {
  return new Proxy({} as NonNullable<AgentSurfacePanelProps["terminal"]>["terminalTheme"], {
    get: () => "#000000",
  });
}

const agentModeCss = readAgentModeStyles();

function cssRule(source: string, selector: string): string {
  const start = source.indexOf(selector);
  expect(start, `Missing CSS selector ${selector}`).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("{", start);
  const end = source.indexOf("}", bodyStart);
  expect(end).toBeGreaterThan(bodyStart);
  return source.slice(bodyStart + 1, end);
}

describe("surface editor slot and the shell frame", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    installResizeObserver();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("keeps the canvas overlay out of a remote pane that persisted the Files surface", () => {
    const placement = renderFrame(
      { openSurfaces: ["files"], activeSurface: "files" },
      { layout: open([], null), remote: true, remoteSurface: null, thread: null },
    );

    expect(placement.editorHidden).toBe(false);
    expect(editorSlot()).toBe("none");
    expect(overlayYields()).toBe(true);
    expect(host.querySelector(".agent-surface-empty__title")?.textContent).toBe("Open a surface");
    expect(frame()?.getAttribute("data-tree")).toBe("hidden");
  });

  it("keeps the canvas overlay out of a remote pane whose Files surface is demoted", () => {
    renderFrame(
      { openSurfaces: ["files"], activeSurface: "files" },
      {
        layout: open(["files"], "files"),
        remote: true,
        remoteSurface: null,
        thread: null,
        unavailable: <p className="agent-note">Server surfaces are unavailable.</p>,
      },
    );

    expect(surface()?.getAttribute("data-surface")).toBe("empty");
    expect(editorSlot()).toBe("none");
    expect(overlayYields()).toBe(true);
  });

  it("keeps the canvas overlay out of an unavailable local scope", () => {
    renderFrame(
      { openSurfaces: ["files"], activeSurface: "files" },
      {
        layout: open(["files"], "files"),
        unavailable: <p className="agent-note">Opening project…</p>,
      },
    );

    expect(editorSlot()).toBe("none");
    expect(overlayYields()).toBe(true);
  });

  it("leaves the local Files surface hosting the editor", () => {
    const placement = renderFrame(
      { openSurfaces: ["files"], activeSurface: "files" },
      { layout: open(["files"], "files") },
    );

    expect(placement.editorHidden).toBe(false);
    expect(editorSlot()).toBe("open");
    expect(overlayYields()).toBe(false);
    expect(frame()?.getAttribute("data-tree")).toBe("visible");
  });

  it("restores the editor slot after a remote pane and back", () => {
    const local = {
      base: { openSurfaces: ["files"], activeSurface: "files" } as const,
      panel: { layout: open(["files"], "files") },
    };
    renderFrame(local.base, local.panel);
    expect(editorSlot()).toBe("open");

    renderFrame(local.base, {
      layout: open([], null),
      remote: true,
      remoteSurface: null,
      thread: null,
    });
    expect(editorSlot()).toBe("none");
    expect(frame()?.getAttribute("data-tree")).toBe("hidden");

    renderFrame(local.base, local.panel);
    expect(editorSlot()).toBe("open");
    expect(overlayYields()).toBe(false);
    expect(frame()?.getAttribute("data-tree")).toBe("visible");
  });

  function renderFrame(
    base: Pick<AgentWorkbenchLayout, "openSurfaces" | "activeSurface">,
    overrides: Partial<AgentSurfacePanelProps>,
  ): WorkbenchShellPlacement {
    const placement = workbenchShellPlacement({
      bottomPanelVisible: false,
      effectiveLayout: "agent",
      layout: { ...initialAgentWorkbenchLayout, rightPanel: "open", ...base },
    });
    act(() =>
      root.render(
        <WorkbenchShellFrame
          agent={
            <div className="agent-surface-host" data-slot="surface">
              <WithRightPanelContext value={rightPanelTestContext()}>
                <AgentSurfacePanel {...defaultProps()} chooserAutoFocus={false} {...overrides} />
              </WithRightPanelContext>
            </div>
          }
          bottom={null}
          chrome={null}
          editor={null}
          placement={placement}
        />,
      ),
    );
    return placement;
  }

  function frame(): HTMLElement | null {
    return host.querySelector<HTMLElement>(".workbench-frame");
  }

  function surface(): HTMLElement | null {
    return host.querySelector<HTMLElement>(".agent-surface");
  }

  function editorSlot(): string | null {
    return surface()?.getAttribute(WORKBENCH_FRAME_EDITOR_SLOT_ATTRIBUTE) ?? null;
  }

  function overlayYields(): boolean {
    return frame()?.matches(WORKBENCH_FRAME_EDITOR_YIELD_SELECTOR) ?? false;
  }
});
