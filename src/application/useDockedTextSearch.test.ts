// @vitest-environment jsdom

import { act, createElement, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchEditorDrawer } from "../components/editorPanel/WorkbenchEditorDrawer";
import type { WorkbenchBottomPanelView } from "../domain/artisanRoutes";
import type { BottomPanelView } from "../domain/bottomPanel";
import type { GitHistoryGateway } from "../domain/git";
import { initialIndexProgress } from "../domain/indexProgress";
import type { RuntimeObservabilityGateway } from "../domain/runtimeObservability";
import { classicTerminalTheme } from "../domain/editorColorThemes";
import type { TerminalGateway } from "../domain/terminal";
import { workbenchPanelCommands } from "./workbenchPanelCommands";
import { useDockedTextSearchOpen } from "./useDockedTextSearch";

describe("useDockedTextSearchOpen", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("does not reopen an empty Search tab through the panel.toggle command", () => {
    act(() => root.render(createElement(DockedTextSearchHarness)));

    act(() => clickButton(host, "Open docked search"));
    expect(selectedPanelView(host)).toBe("Search");
    expect(host.querySelector('[aria-label="Docked search content"]')).not.toBeNull();

    act(() => clickButton(host, "Close panel views"));
    expect(host.querySelector('section[aria-label="Panel views"]')).toBeNull();

    act(() => clickButton(host, "Run panel.toggle"));

    expect(host.querySelector('section[aria-label="Panel views"]')).not.toBeNull();
    expect(selectedPanelView(host)).toBe("Problems");
    expect(host.querySelector('[aria-label="Problems"]')).not.toBeNull();
  });

  it("restores the visible panel view that search replaced", () => {
    act(() =>
      root.render(
        createElement(DockedTextSearchHarness, {
          initialView: "index",
          initialVisible: true,
        }),
      ),
    );

    act(() => clickButton(host, "Open docked search"));
    act(() => clickButton(host, "Close panel views"));

    expect(host.querySelector('section[aria-label="Panel views"]')).not.toBeNull();
    expect(selectedPanelView(host)).toBe("Index");
  });

  it("keeps remembered panel views isolated by workspace tab", () => {
    act(() =>
      root.render(
        createElement(DockedTextSearchHarness, {
          initialView: "index",
          initialVisible: true,
        }),
      ),
    );

    act(() => clickButton(host, "Open docked search"));
    act(() => clickButton(host, "Switch to workspace B"));
    act(() => clickButton(host, "Open docked search"));
    act(() => clickButton(host, "Close panel views"));
    act(() => clickButton(host, "Return to workspace A search"));
    act(() => clickButton(host, "Close panel views"));

    expect(host.querySelector('section[aria-label="Panel views"]')).not.toBeNull();
    expect(selectedPanelView(host)).toBe("Index");
  });

  it("restores the prior panel when open and close are batched in one tick", () => {
    act(() =>
      root.render(
        createElement(DockedTextSearchHarness, {
          initialView: "index",
          initialVisible: true,
        }),
      ),
    );

    act(() => clickButton(host, "Open and close docked search"));

    expect(host.querySelector('section[aria-label="Panel views"]')).not.toBeNull();
    expect(selectedPanelView(host)).toBe("Index");
    expect(host.querySelector('[aria-label="Docked search content"]')).toBeNull();
  });

  it("does not restore panel state from a replaced owner at the same root", () => {
    act(() =>
      root.render(
        createElement(DockedTextSearchHarness, {
          initialView: "index",
          initialVisible: true,
        }),
      ),
    );

    act(() => clickButton(host, "Open docked search"));
    act(() => clickButton(host, "Replace owner at same root"));
    act(() => clickButton(host, "Close panel views"));
    act(() => clickButton(host, "Run panel.toggle"));

    expect(selectedPanelView(host)).toBe("Problems");
  });
});

function DockedTextSearchHarness({
  initialView = "problems",
  initialVisible = false,
}: {
  initialView?: BottomPanelView;
  initialVisible?: boolean;
}) {
  const [workspaceKey, setWorkspaceKey] = useState("/workspace-a");
  const [bottomPanelView, setBottomPanelView] = useState<BottomPanelView>(initialView);
  const [bottomPanelVisible, setBottomPanelVisible] = useState(initialVisible);
  const [textSearchOpen, setTextSearchOpen] = useState(false);
  const bottomPanelViewRef = useRef(bottomPanelView);
  useLayoutEffect(() => {
    bottomPanelViewRef.current = bottomPanelView;
  }, [bottomPanelView]);
  const setDockedTextSearchOpen = useDockedTextSearchOpen({
    bottomPanelViewRef,
    bottomPanelVisible,
    setBottomPanelView,
    setBottomPanelVisible,
    setTextSearchOpen,
    workspaceKey,
  });
  const panelToggle = workbenchPanelCommands({
    openCommandsPalette: vi.fn(),
    refreshWorkspaceTodos: vi.fn(),
    shortcut: () => "",
    showBottomPanelView: setBottomPanelView,
    toggleBottomPanel: () => setBottomPanelVisible((visible) => !visible),
    toggleTodoPanel: vi.fn(),
  }).find((command) => command.id === "panel.toggle");

  return createElement(
    "div",
    null,
    createElement(
      "button",
      {
        onClick: () => setWorkspaceKey("/workspace-a#owner-generation-2"),
        type: "button",
      },
      "Replace owner at same root",
    ),
    createElement(
      "button",
      { onClick: () => setDockedTextSearchOpen(true), type: "button" },
      "Open docked search",
    ),
    createElement(
      "button",
      {
        onClick: () => {
          setDockedTextSearchOpen(true);
          setDockedTextSearchOpen(false);
        },
        type: "button",
      },
      "Open and close docked search",
    ),
    createElement(
      "button",
      {
        onClick: () => {
          bottomPanelViewRef.current = "problems";
          setWorkspaceKey("/workspace-b");
          setBottomPanelView("problems");
          setBottomPanelVisible(false);
          setTextSearchOpen(false);
        },
        type: "button",
      },
      "Switch to workspace B",
    ),
    createElement(
      "button",
      {
        onClick: () => {
          bottomPanelViewRef.current = "search";
          setWorkspaceKey("/workspace-a");
          setBottomPanelView("search");
          setBottomPanelVisible(true);
          setTextSearchOpen(true);
        },
        type: "button",
      },
      "Return to workspace A search",
    ),
    createElement(
      "button",
      {
        onClick: () =>
          panelToggle?.run({
            activeDocumentDirty: false,
            hasActiveDocument: false,
            hasWorkspace: true,
          }),
        type: "button",
      },
      "Run panel.toggle",
    ),
    bottomPanelVisible
      ? createElement(WorkbenchEditorDrawer, {
          consoleHeader: null,
          frame: DRAWER_FRAME,
          phpTree: null,
          view: bottomPanelView === "terminal" ? "problems" : bottomPanelView,
          panel: {
            activeView: bottomPanelView,
            gitHistoryGateway: {} as GitHistoryGateway,
            indexHealthLogs: [],
            indexProgress: initialIndexProgress(),
            notices: [],
            onClearProblems: vi.fn(),
            onClose: () => setDockedTextSearchOpen(false),
            onHardReindex: vi.fn(),
            onOpenCommitFileDiff: vi.fn(),
            onOpenProblem: vi.fn(async () => true),
            onPhpReindex: vi.fn(),
            onResizeStart: vi.fn(),
            onSelectView: (view: WorkbenchBottomPanelView) => {
              if (view === "routes" || view === "testResults" || view === "phpTree") {
                return;
              }

              setBottomPanelView(view);
            },
            onSoftReindex: vi.fn(),
            onTrustWorkspace: vi.fn(),
            runtimeObservabilityGateway: {} as RuntimeObservabilityGateway,
            search: textSearchOpen
              ? createElement("div", { "aria-label": "Docked search content" })
              : null,
            terminalGateway: terminalGateway(),
            terminalShellIntegrationEnabled: false,
            terminalTheme: classicTerminalTheme("classicDark"),
            workspaceRoot: workspaceKey,
            workspaceTrusted: true,
          },
        })
      : null,
  );
}

const DRAWER_FRAME = { height: 224, onResize: () => undefined };

function clickButton(host: HTMLElement, label: string): void {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent === label ||
      candidate.title === label ||
      candidate.getAttribute("aria-label") === label,
  );

  if (!button) {
    throw new Error(`Missing ${label} button`);
  }

  button.click();
}

function selectedPanelView(host: HTMLElement): string | undefined {
  return host.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? undefined;
}

function terminalGateway(): TerminalGateway {
  return {
    acknowledgeStart: vi.fn(async () => undefined),
    listProfiles: vi.fn(async () => []),
    resize: vi.fn(async () => undefined),
    start: vi.fn(async () => ({
      cols: 80,
      cwd: "/workspace",
      kind: "running" as const,
      rows: 24,
      sessionId: 1,
    })),
    stop: vi.fn(async (sessionId) => ({ kind: "stopped" as const, sessionId })),
    stopAll: vi.fn(async () => undefined),
    stopRoot: vi.fn(async () => undefined),
    subscribeOutput: vi.fn(async () => () => undefined),
    writeInput: vi.fn(async () => undefined),
  };
}
