import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  workbenchBottomPanelHostProps,
  type BottomPanelHostInput,
} from "./workbenchBottomPanelHostPresenter";

describe("workbenchBottomPanelHostProps", () => {
  it("maps the workbench, routes and gateways onto the BottomPanel props", () => {
    const input = createInput();

    const props = workbenchBottomPanelHostProps(input);

    expect(props.activeView).toBe("terminal");
    expect(props.artisanRoutes).toBe(input.artisanRoutes.filteredRoutes);
    expect(props.hasPhpWorkspace).toBe(true);
    expect(props.terminalOwnerKey).toBe("workspace-1");
    expect(props.terminalShellIntegrationEnabled).toBe(true);
    expect(props.workspaceRoot).toBe("/workspace");
    expect(props.gitHistoryGateway).toBe(input.gateways.gitHistoryGateway);
    expect(props.onResizeStart).toBe(input.onResizeStart);
    expect(props.search).toBe(input.search);
    expect(props.onOpenCommitFileDiff).toBe(input.onOpenCommitFileDiff);
  });

  it("clears routes and results and hides the panel on close", () => {
    const input = createInput();

    workbenchBottomPanelHostProps(input).onClose();

    expect(input.artisanRoutes.clear).toHaveBeenCalledTimes(1);
    expect(input.phpTestResults.clear).toHaveBeenCalledTimes(1);
    expect(input.workbench.hideBottomPanel).toHaveBeenCalledTimes(1);
    expect(input.onCloseSearch).not.toHaveBeenCalled();
  });

  it("closes the docked search instead of the panel while the search view is active", () => {
    const input = createInput({ bottomPanelView: "search" });

    workbenchBottomPanelHostProps(input).onClose();

    expect(input.onCloseSearch).toHaveBeenCalledTimes(1);
    expect(input.workbench.hideBottomPanel).not.toHaveBeenCalled();
  });
});

type Workbench = BottomPanelHostInput["workbench"];

function createInput(overrides: Partial<Workbench> = {}): BottomPanelHostInput & {
  readonly artisanRoutes: BottomPanelHostInput["artisanRoutes"] & {
    clear: ReturnType<typeof vi.fn>;
  };
  readonly phpTestResults: BottomPanelHostInput["phpTestResults"] & {
    clear: ReturnType<typeof vi.fn>;
  };
  readonly workbench: Workbench & { hideBottomPanel: ReturnType<typeof vi.fn> };
  readonly onCloseSearch: ReturnType<typeof vi.fn>;
} {
  const workbench = {
    appSettings: { terminalShellIntegrationEnabled: true },
    bottomPanelView: "terminal",
    clearNotices: vi.fn(),
    getLatencySnapshot: vi.fn(() => []),
    hasArtisan: false,
    hideBottomPanel: vi.fn(),
    indexHealthLogs: [],
    indexProgress: { status: "idle" },
    intelligenceMode: "basic",
    notices: [],
    openArtisanController: vi.fn(async () => undefined),
    openProblemNotice: vi.fn(async () => true),
    registerActiveTerminalSession: vi.fn(),
    revealDirectoryInTree: vi.fn(),
    startHardReindex: vi.fn(),
    startIndexScan: vi.fn(),
    startPhpReindex: vi.fn(),
    workspaceDescriptor: { php: { packageName: "app" } },
    workspacePackageDiscovery: null,
    workspaceRoot: "/workspace",
    ...overrides,
  } as unknown as Workbench & { hideBottomPanel: ReturnType<typeof vi.fn> };
  const artisanRoutes = {
    clear: vi.fn(),
    error: null,
    filteredRoutes: [],
    loading: false,
    query: "",
    refresh: vi.fn(),
    setQuery: vi.fn(),
    total: 0,
    unavailable: null,
  } as unknown as BottomPanelHostInput["artisanRoutes"] & { clear: ReturnType<typeof vi.fn> };
  const phpTestResults = { clear: vi.fn() } as unknown as BottomPanelHostInput["phpTestResults"] & {
    clear: ReturnType<typeof vi.fn>;
  };

  return {
    artisanRoutes,
    debugPanel: createElement("div"),
    expressRoutesPanel: undefined,
    frameworkBottomPanels: {} as BottomPanelHostInput["frameworkBottomPanels"],
    gateways: {
      gitHistoryGateway: {} as BottomPanelHostInput["gateways"]["gitHistoryGateway"],
      runtimeObservabilityGateway:
        {} as BottomPanelHostInput["gateways"]["runtimeObservabilityGateway"],
      terminalGateway: {} as BottomPanelHostInput["gateways"]["terminalGateway"],
    },
    jsTestExplorerPanel: {} as BottomPanelHostInput["jsTestExplorerPanel"],
    phpTestPanel: {} as BottomPanelHostInput["phpTestPanel"],
    phpTestResults,
    search: null,
    terminalOwnerKey: "workspace-1",
    terminalTheme: {} as BottomPanelHostInput["terminalTheme"],
    workbench,
    workspaceTrusted: true,
    onCloseSearch: vi.fn<() => void>(),
    onOpenCommitFileDiff: vi.fn(),
    onResizeStart: vi.fn(),
    onSelectView: vi.fn(),
    onTrustWorkspace: vi.fn(),
  };
}
