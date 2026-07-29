// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialIndexProgress } from "./domain/indexProgress";
import type { EditorDocument } from "./domain/workspace";
import { buildJsTestExplorerTree, type JsTestExplorerTestNode } from "./domain/jsTestExplorerTree";
import type { TestGutterTarget } from "./domain/testGutterTargets";
import { createEmptyDebugWatches } from "./test/debugWatchMocks";
import { workbenchComposition } from "./workbenchComposition";

const mocks = vi.hoisted(() => ({
  artisanClear: vi.fn(),
  bottomPanelProps: null as Record<string, unknown> | null,
  hideBottomPanel: vi.fn(),
  ideProgress: { busy: true, state: "active", text: "Working" },
  jsExplorerRefresh: vi.fn(async () => undefined),
  jsExplorerRun: vi.fn(async () => undefined),
  jsCoverageClear: vi.fn(),
  jsCoverageRun: vi.fn(async () => true),
  jsCoverageState: {
    error: null as string | null,
    isRunning: false,
    report: null as unknown,
    unavailable: null as string | null,
  },
  jsExplorerState: {
    error: null as string | null,
    isLoading: false,
    isRunning: false,
    problemSnapshot: null as unknown,
    result: null,
    tree: null as unknown,
    truncated: false,
    unavailable: null as string | null,
  },
  editorSurfaceProps: [] as Record<string, unknown>[],
  renderEditorAreaContent: false,
  expressPanelOptions: null as Record<string, unknown> | null,
  packageDiscoveryState: {
    authority: "complete",
    authorityDirectories: [],
    incompleteDirectories: [],
    loaded: true,
    ownerKey: "workspace-1\u0000/workspace",
    packageJsonDirs: [],
    packageManifests: [],
    packages: [],
    pnpmWorkspaceYaml: undefined,
    rootPackageJson: {},
    unscopedAuthorityUncertain: false,
  },
  expressPanelProps: {
    error: null,
    hasJavaScriptTypeScriptWorkspace: false,
    loading: false,
    onOpenRoute: vi.fn(),
    onQueryChange: vi.fn(),
    onRefresh: vi.fn(),
    query: "",
    routes: [],
    truncated: false,
    workspacePackageDiscovery: null as unknown,
  },
  packagePanelOptions: null as Record<string, unknown> | null,
  packagePanelProps: {
    error: null,
    manager: "pnpm",
    onOpenDependency: vi.fn(),
    onQueryChange: vi.fn(),
    query: "",
    tree: [],
  },
  openDebugLocation: vi.fn(),
  openGitBranchPanel: vi.fn(),
  phpClear: vi.fn(),
  runCommand: vi.fn(),
  setPaletteOpen: vi.fn(),
  showBottomPanelView: vi.fn(),
  workbenchOverrides: {} as Record<string, unknown>,
}));

vi.mock("./application/useWorkbenchController", () => ({
  useWorkbenchController: () => createWorkbench(),
}));

vi.mock("./application/useWorkspacePackageGraph", () => ({
  useWorkspacePackageGraph: () => mocks.packageDiscoveryState,
}));

vi.mock("./application/useArtisanRoutes", () => ({
  useArtisanRoutes: () => ({
    clear: mocks.artisanClear,
    error: null,
    filteredRoutes: [],
    loading: false,
    query: "",
    refresh: vi.fn(),
    setQuery: vi.fn(),
    total: 0,
    unavailable: null,
  }),
}));

vi.mock("./application/usePhpTestResults", () => ({
  usePhpTestResults: () => ({
    clear: mocks.phpClear,
    error: null,
    filter: null,
    isRunning: false,
    result: null,
    run: vi.fn(),
    runCase: vi.fn(),
    unavailable: null,
  }),
}));

vi.mock("./application/useJsTestExplorer", () => ({
  useJsTestExplorer: () => ({
    ...mocks.jsExplorerState,
    canCancelTestRun: () => false,
    canRerunFailedTests: () => false,
    canStartContinuousRun: () => false,
    cancelTestRun: vi.fn(),
    continuousRunEnabled: false,
    continuousRunPending: false,
    continuousRunRunning: false,
    continuousRunStopping: false,
    failedRunCompleted: 0,
    failedRunPhase: "idle",
    failedRunTotal: 0,
    refresh: mocks.jsExplorerRefresh,
    rerunFailedTests: vi.fn(),
    run: mocks.jsExplorerRun,
    startContinuousRun: vi.fn(() => false),
    stopContinuousRun: vi.fn(async () => false),
  }),
}));

vi.mock("./application/useJsTestCoverage", () => ({
  useJsTestCoverage: () => ({
    ...mocks.jsCoverageState,
    clear: mocks.jsCoverageClear,
    run: mocks.jsCoverageRun,
  }),
}));

vi.mock("./application/useScopedEditorSurfaceRunners", () => ({
  useScopedEditorSurfaceRunners: () => ({
    activateGroup: vi.fn(),
    activeRunners: {
      bufferFix: null,
      command: null,
      eslintDisable: null,
      menu: null,
      phpstanIgnore: null,
    },
    updateBufferFix: vi.fn(),
    updateCommand: vi.fn(),
    updateEslintDisable: vi.fn(),
    updateMenu: vi.fn(),
    updatePhpstanIgnore: vi.fn(),
  }),
}));

vi.mock("./components/useNoticeToastRenderers", () => ({
  useNoticeToastRenderers: () => () => null,
}));

vi.mock("./components/useWorkspaceExpressRoutesWorkbenchPanel", () => ({
  useOwnedWorkspaceExpressRoutesWorkbenchPanel: (options: Record<string, unknown>) => {
    mocks.expressPanelOptions = options;
    mocks.expressPanelProps.hasJavaScriptTypeScriptWorkspace =
      options.hasJavaScriptTypeScriptWorkspace === true;
    return mocks.expressPanelProps;
  },
}));

vi.mock("./application/usePackageDependenciesPanelController", () => ({
  usePackageDependenciesPanelController: (options: Record<string, unknown>) => {
    mocks.packagePanelOptions = options;
    return mocks.packagePanelProps;
  },
}));

vi.mock("./domain/ideProgress", () => ({
  ideProgressIndicator: () => mocks.ideProgress,
}));

vi.mock("./components/BottomPanel", () => ({
  BottomPanel: (props: {
    expressRoutesPanel?: { hasJavaScriptTypeScriptWorkspace?: boolean };
    hasExpressRoutes?: boolean;
    hasJsWorkspace?: boolean;
    onSelectView(view: string): void;
    onTrustWorkspace(): void;
  }) => {
    const hasJsWorkspace =
      props.hasJsWorkspace ?? props.expressRoutesPanel?.hasJavaScriptTypeScriptWorkspace;
    mocks.bottomPanelProps = {
      ...props,
      hasExpressRoutes: props.hasExpressRoutes ?? hasJsWorkspace,
      hasJsWorkspace,
    } as unknown as Record<string, unknown>;
    return (
      <div data-testid="bottom-panel">
        {["problems", "index", "runtime", "history", "routes", "testResults", "terminal"].map(
          (view) => (
            <button key={view} onClick={() => props.onSelectView(view)} type="button">
              panel-{view}
            </button>
          ),
        )}
        <button onClick={props.onTrustWorkspace} type="button">
          panel-trust
        </button>
      </div>
    );
  },
}));

vi.mock("./components/EditorArea", () => ({
  EditorArea: (props: {
    documents: readonly { path: string }[];
    renderContent(
      surface: { kind: "empty" } | { kind: "document"; document: { path: string }; path: string },
      groupId: string,
    ): React.ReactNode;
    state: {
      groups: Record<
        string,
        { activePath: string | null; openPaths: string[]; previewPath: string | null }
      >;
    };
  }) => (
    <div data-testid="editor-area">
      {mocks.renderEditorAreaContent
        ? Object.entries(props.state.groups).map(([groupId, group]) => {
            const document = props.documents.find(({ path }) => path === group.activePath);
            return (
              <div data-testid={`editor-group-${groupId}`} key={groupId}>
                {document && group.activePath
                  ? props.renderContent(
                      { document, kind: "document", path: group.activePath },
                      groupId,
                    )
                  : props.renderContent({ kind: "empty" }, groupId)}
              </div>
            );
          })
        : null}
    </div>
  ),
}));

vi.mock("./components/EditorRuntimeHost", () => ({
  EditorRuntimeHost: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("./components/ScopedEditorSurface", () => ({
  ScopedEditorSurface: (props: Record<string, unknown>) => {
    mocks.editorSurfaceProps.push(props);
    return <div data-testid="scoped-editor-surface" />;
  },
}));

vi.mock("./components/FileTree", () => ({
  FileTree: () => <div data-testid="file-tree" />,
}));

vi.mock("./components/ProjectTabs", () => ({
  ProjectTabs: () => <div data-testid="project-tabs" />,
}));

vi.mock("./components/StatusBar", () => ({
  StatusBar: ({
    onOpenRuntimePanel,
    onShowGitBranches,
    onShowProblems,
  }: {
    onOpenRuntimePanel(): void;
    onShowGitBranches(): void;
    onShowProblems(): void;
  }) => (
    <div data-testid="status-bar">
      <button onClick={onOpenRuntimePanel} type="button">
        status-runtime
      </button>
      <button onClick={onShowProblems} type="button">
        status-problems
      </button>
      <button onClick={onShowGitBranches} type="button">
        status-branches
      </button>
    </div>
  ),
}));

vi.mock("./components/WindowChrome", () => ({
  WindowChrome: () => <div data-testid="window-chrome" />,
}));

import App from "./App";

describe("App command routing", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    mocks.artisanClear.mockReset();
    mocks.hideBottomPanel.mockReset();
    mocks.ideProgress = { busy: true, state: "active", text: "Working" };
    mocks.jsExplorerRefresh.mockReset();
    mocks.jsExplorerRun.mockReset();
    mocks.jsExplorerState.error = null;
    mocks.jsExplorerState.isLoading = false;
    mocks.jsExplorerState.problemSnapshot = null;
    mocks.jsExplorerState.tree = null;
    mocks.jsExplorerState.truncated = false;
    mocks.jsExplorerState.unavailable = null;
    mocks.editorSurfaceProps = [];
    mocks.renderEditorAreaContent = false;
    mocks.jsCoverageClear.mockClear();
    mocks.jsCoverageRun.mockClear();
    mocks.jsCoverageState.error = null;
    mocks.jsCoverageState.isRunning = false;
    mocks.jsCoverageState.report = null;
    mocks.jsCoverageState.unavailable = null;
    mocks.expressPanelOptions = null;
    mocks.packageDiscoveryState.rootPackageJson = {};
    mocks.expressPanelProps.workspacePackageDiscovery = mocks.packageDiscoveryState;
    mocks.packagePanelOptions = null;
    mocks.expressPanelProps.onOpenRoute.mockReset();
    mocks.expressPanelProps.onQueryChange.mockReset();
    mocks.expressPanelProps.onRefresh.mockReset();
    mocks.openDebugLocation.mockReset();
    mocks.openGitBranchPanel.mockReset();
    mocks.bottomPanelProps = null;
    mocks.workbenchOverrides = {};
    mocks.runCommand.mockReset();
    mocks.phpClear.mockReset();
    mocks.setPaletteOpen.mockReset();
    mocks.showBottomPanelView.mockReset();
    vi.spyOn(
      workbenchComposition.workspaceSourceDiscoveryGateway,
      "readSourceTextBounded",
    ).mockResolvedValue({
      content: JSON.stringify({ dependencies: { express: "^5.1.0" } }),
      status: "ok",
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("routes visible exact actions through runCommand", () => {
    click(buttonByTitle("Open workspace"));
    click(buttonByText("Open"));
    click(buttonByTitle("Settings"));
    click(buttonByText("Git"));
    click(buttonByText("IDE Mode"));
    click(host.querySelector<HTMLButtonElement>(".toolbar-action"));
    click(buttonByTitle("Working"));
    click(buttonByText("status-problems"));
    click(buttonByText("status-runtime"));
    click(buttonByText("panel-problems"));
    click(buttonByText("panel-index"));
    click(buttonByText("panel-runtime"));
    click(buttonByText("panel-trust"));

    expect(mocks.runCommand.mock.calls.map(([commandId]) => commandId)).toEqual([
      "workspace.open",
      "workspace.open",
      "workbench.openSettings",
      "git.show",
      "smart.toggle",
      "workspace.trust",
      "panel.showIndex",
      "panel.showProblems",
      "runtime.show",
      "panel.showProblems",
      "panel.showIndex",
      "runtime.show",
      "workspace.trust",
    ]);
  });

  it("routes the Commands activity through the registry without a direct state fallback", () => {
    mocks.runCommand.mockReturnValue("disabled");

    click(buttonByTitle("Commands"));

    expect(mocks.runCommand).toHaveBeenCalledOnce();
    expect(mocks.runCommand).toHaveBeenCalledWith("commands.show");
    expect(mocks.setPaletteOpen).not.toHaveBeenCalled();
  });

  it("wires workspace Express routes with active and inactive dirty document overlays", async () => {
    mocks.workbenchOverrides = {
      activeDocument: {
        content: 'router.get("/users/:id", handler);',
        language: "typescript",
        name: "routes.ts",
        path: "/workspace/src/routes.ts",
        savedContent: "",
      },
      openDocuments: [
        {
          content: 'router.post("/inactive", handler);',
          language: "typescript",
          name: "inactive.ts",
          path: "/workspace/src/inactive.ts",
          savedContent: "",
        },
      ],
      bottomPanelView: "expressRoutes",
      expressRouteDiscoveryVersion: 4,
      workspaceIdentityDescriptor: { workspaceId: "workspace-1" },
      workspaceDescriptor: {
        javaScriptTypeScript: { frameworks: ["Express"] },
        php: null,
        rootPath: "/workspace",
      },
    };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    expect(mocks.bottomPanelProps?.hasExpressRoutes).toBe(true);
    expect(mocks.bottomPanelProps?.expressRoutesPanel).toBe(mocks.expressPanelProps);
    expect(mocks.expressPanelOptions).toEqual(
      expect.objectContaining({
        activeDocument: expect.objectContaining({
          content: 'router.get("/users/:id", handler);',
          path: "/workspace/src/routes.ts",
        }),
        isPanelOpen: true,
        openDocuments: [
          {
            content: 'router.post("/inactive", handler);',
            language: "typescript",
            name: "inactive.ts",
            path: "/workspace/src/inactive.ts",
            savedContent: "",
          },
        ],
        discoveryVersion: 4,
        onOpenLocation: mocks.openDebugLocation,
        rootPath: "/workspace",
        workspaceId: "workspace-1",
      }),
    );
  });

  it("keeps Express discovery reactive while its panel is not active", async () => {
    mocks.packageDiscoveryState.rootPackageJson = {
      dependencies: { express: "latest" },
    };
    mocks.workbenchOverrides = {
      activeDocument: {
        content: 'router.get("/users", handler);',
        language: "typescript",
        name: "routes.ts",
        path: "/workspace/src/routes.ts",
        savedContent: 'router.get("/users", handler);',
      },
      bottomPanelView: "problems",
      expressRouteDiscoveryVersion: 0,
      workspaceIdentityDescriptor: { workspaceId: "workspace-1" },
      workspaceDescriptor: {
        javaScriptTypeScript: { frameworks: ["Express"] },
        php: null,
        rootPath: "/workspace",
      },
    };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    expect(mocks.bottomPanelProps?.hasExpressRoutes).toBe(true);
    expect(mocks.bottomPanelProps?.expressRoutesPanel).toBe(mocks.expressPanelProps);
    expect(mocks.expressPanelOptions).toEqual(expect.objectContaining({ isPanelOpen: false }));
  });

  it("keeps package discovery open while App's real Express gate is closed in Problems", async () => {
    vi.mocked(
      workbenchComposition.workspaceSourceDiscoveryGateway.readSourceTextBounded,
    ).mockResolvedValue({
      content: JSON.stringify({ devDependencies: { turbo: "latest" } }),
      status: "ok",
    });
    mocks.workbenchOverrides = {
      activeDocument: null,
      bottomPanelView: "problems",
      bottomPanelVisible: true,
      expressRouteDiscoveryVersion: 7,
      workspaceIdentityDescriptor: { workspaceId: "workspace-1" },
      workspaceDescriptor: {
        javaScriptTypeScript: { frameworks: [] },
        php: null,
        rootPath: "/workspace",
      },
    };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    expect(mocks.expressPanelOptions).toEqual(
      expect.objectContaining({
        discoveryVersion: 7,
        hasJavaScriptTypeScriptWorkspace: true,
        isPanelOpen: false,
        packageDiscovery: mocks.packageDiscoveryState,
        rootPath: "/workspace",
        workspaceId: "workspace-1",
      }),
    );
    expect(mocks.bottomPanelProps?.workspacePackageDiscovery).toBe(mocks.packageDiscoveryState);
  });

  it("binds the package dependency panel to the active workspace descriptor and navigator", async () => {
    const packageDescriptor = {
      declaredRange: "^5",
      dev: false,
      installedVersion: "5.1.0",
      installPath: "/workspace/node_modules/express",
      name: "express",
    };
    const dirtyManifest: EditorDocument = {
      content: '{"dependencies":{"express":"next"}}',
      language: "json",
      name: "package.json",
      path: "/workspace/package.json",
      savedContent: '{"dependencies":{"express":"^5"}}',
    };
    mocks.workbenchOverrides = {
      openDocuments: [dirtyManifest],
      workspaceDescriptor: {
        javaScriptTypeScript: {
          frameworks: ["Express"],
          packageManager: "pnpm",
          packages: [packageDescriptor],
        },
        php: null,
        rootPath: "/workspace",
      },
      workspaceIdentityDescriptor: {
        canonicalRoot: "/workspace",
        workspaceId: "workspace-1",
      },
    };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    expect(mocks.packagePanelOptions).toEqual(
      expect.objectContaining({
        documents: [dirtyManifest],
        onOpenLocation: mocks.openDebugLocation,
        packageManager: "pnpm",
        packages: [packageDescriptor],
        rootPath: "/workspace",
        workspaceId: "workspace-1",
      }),
    );
    expect(mocks.bottomPanelProps?.packageDependenciesPanel).toBe(mocks.packagePanelProps);
    expect(mocks.bottomPanelProps?.hasJsWorkspace).toBe(true);
  });

  it("wires the JavaScript explorer without clearing its workspace state on panel close", async () => {
    const explorerTree = buildJsTestExplorerTree("/workspace", [
      {
        filePath: "src/payment.test.ts",
        suitePath: ["checkout"],
        target: jsTestTarget("charges", 7),
      },
    ]);
    mocks.jsExplorerState.tree = explorerTree;
    mocks.jsCoverageState.report = {
      files: [
        {
          firstUncoveredLine: 11,
          lines: [{ hits: 0, lineNumber: 11 }],
          path: "src/payment.ts",
          summary: { covered: 0, percentage: 0, total: 1 },
        },
      ],
      summary: { covered: 0, percentage: 0, total: 1 },
    };
    mocks.workbenchOverrides = {
      bottomPanelView: "testResults",
      hideBottomPanel: mocks.hideBottomPanel,
      openDebugLocation: mocks.openDebugLocation,
      workspaceDescriptor: {
        javaScriptTypeScript: { frameworks: [] },
        php: null,
        rootPath: "/workspace",
      },
      workspaceIdentityDescriptor: {
        canonicalRoot: "/workspace",
        workspaceId: "workspace-id",
      },
      workspaceTrust: { trusted: true },
    };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    let explorer = mocks.bottomPanelProps?.jsTestExplorer as {
      debugStartBlocked: boolean;
      debugging: boolean;
      onDebugNode(test: JsTestExplorerTestNode): void;
      onOpenTest(test: JsTestExplorerTestNode): void;
      onClearCoverage(): void;
      onOpenCoverageFile(file: { firstUncoveredLine: number | null; path: string }): void;
      onQueryChange(query: string): void;
      onRefresh(): void;
      onRunScope(scope: { kind: "all" }): void;
      onRunCoverage(): void;
      query: string;
      tree: unknown;
    };
    const testNode = explorerTestNode(explorerTree);
    expect(explorer.debugStartBlocked).toBe(false);
    expect(explorer.debugging).toBe(false);
    expect(explorer.onDebugNode).toEqual(expect.any(Function));

    act(() => {
      explorer.onRunScope({ kind: "all" });
      explorer.onRunCoverage();
      explorer.onClearCoverage();
      explorer.onOpenCoverageFile({ firstUncoveredLine: 11, path: "src/payment.ts" });
      explorer.onOpenCoverageFile({ firstUncoveredLine: null, path: "src/covered.ts" });
      explorer.onOpenCoverageFile({ firstUncoveredLine: 4, path: "../outside.ts" });
      explorer.onRefresh();
      explorer.onOpenTest(testNode);
      explorer.onOpenTest({ ...testNode, filePath: "../outside.test.ts" });
      explorer.onOpenTest({ ...testNode, filePath: "/workspace/src/payment.test.ts" });
      explorer.onOpenTest({ ...testNode, filePath: "/outside/payment.test.ts" });
      explorer.onQueryChange("charges");
    });

    expect(mocks.jsExplorerRun).toHaveBeenCalledExactlyOnceWith({ kind: "all" });
    expect(mocks.jsExplorerRefresh).toHaveBeenCalledOnce();
    expect(mocks.jsCoverageRun).toHaveBeenCalledOnce();
    expect(mocks.jsCoverageClear).toHaveBeenCalledOnce();
    expect(mocks.openDebugLocation).toHaveBeenCalledWith("/workspace/src/payment.test.ts", 7);
    expect(mocks.openDebugLocation).toHaveBeenCalledWith("/workspace/src/payment.ts", 11);
    expect(mocks.openDebugLocation).toHaveBeenCalledTimes(2);
    explorer = mocks.bottomPanelProps?.jsTestExplorer as typeof explorer;
    expect(explorer.query).toBe("charges");

    const onClose = mocks.bottomPanelProps?.onClose as () => void;
    act(() => onClose());

    expect(mocks.artisanClear).toHaveBeenCalledOnce();
    expect(mocks.phpClear).toHaveBeenCalledOnce();
    expect(mocks.hideBottomPanel).toHaveBeenCalledOnce();
    expect(mocks.jsExplorerRun).toHaveBeenCalledTimes(1);
    expect(mocks.jsExplorerRefresh).toHaveBeenCalledTimes(1);
    expect((mocks.bottomPanelProps?.jsTestExplorer as typeof explorer).tree).toBe(explorerTree);
  });

  it("passes JavaScript test problems and current-file identity only to the active editor group", async () => {
    const activeDocument: EditorDocument = {
      content: 'it("fails", () => {});',
      language: "typescript",
      name: "active.test.ts",
      path: "/workspace/src/active.test.ts",
      savedContent: 'it("fails", () => {});',
    };
    const inactiveDocument: EditorDocument = {
      content: "export const inactive = true;",
      language: "typescript",
      name: "inactive.ts",
      path: "/workspace/src/inactive.ts",
      savedContent: "export const inactive = true;",
    };
    const problemSnapshot = {
      entries: [
        {
          filePath: "src/active.test.ts",
          lineNumber: 1,
          message: "expected true to be false",
          name: "fails",
          status: "failed" as const,
        },
      ],
      generation: 1,
      owner: { rootKey: "/workspace", workspaceId: "workspace-id" },
      total: 1,
      truncated: false,
    };
    mocks.jsExplorerState.problemSnapshot = problemSnapshot;
    mocks.renderEditorAreaContent = true;
    mocks.workbenchOverrides = {
      activeDocument,
      activePath: activeDocument.path,
      editorGroups: {
        activeGroupId: "active-group",
        groups: {
          "active-group": {
            activePath: activeDocument.path,
            openPaths: [activeDocument.path],
            previewPath: null,
          },
          "inactive-group": {
            activePath: inactiveDocument.path,
            openPaths: [inactiveDocument.path],
            previewPath: null,
          },
        },
        layout: {
          children: [
            { groupId: "active-group", kind: "group" },
            { groupId: "inactive-group", kind: "group" },
          ],
          kind: "split",
          orientation: "horizontal",
          sizes: [0.5, 0.5],
        },
      },
      openDocuments: [activeDocument, inactiveDocument],
      openTabs: [activeDocument, inactiveDocument],
      workspaceDescriptor: {
        javaScriptTypeScript: { frameworks: [] },
        php: null,
        rootPath: "/workspace",
      },
      workspaceIdentityDescriptor: {
        canonicalRoot: "/workspace",
        caseSensitive: true,
        policy: { caseSensitive: true, unicodeNormalization: "none" },
        selectedPath: "/workspace",
        unicodeNormalizationPolicy: "preserved",
        workspaceId: "workspace-id",
      },
      workspaceTrust: { trusted: true },
    };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    const activeSurface = mocks.editorSurfaceProps.find(
      ({ activeDocument: document }) =>
        (document as EditorDocument | null)?.path === activeDocument.path,
    );
    const inactiveSurface = mocks.editorSurfaceProps.find(
      ({ activeDocument: document }) =>
        (document as EditorDocument | null)?.path === inactiveDocument.path,
    );
    expect(activeSurface).toEqual(
      expect.objectContaining({
        jsTestProblemCurrentFileIdentity: expect.objectContaining({
          relativeFilePath: "src/active.test.ts",
          root: expect.objectContaining({ workspaceId: "workspace-id" }),
        }),
        jsTestProblemSnapshot: problemSnapshot,
      }),
    );
    expect(inactiveSurface).toEqual(
      expect.objectContaining({
        jsTestProblemCurrentFileIdentity: null,
        jsTestProblemSnapshot: null,
      }),
    );
  });

  it.each<[string, Partial<EditorDocument>]>([
    ["read-only", { readOnly: true, path: "/workspace/src/routes.ts" }],
    ["outside-workspace", { path: "/workspace-other/routes.ts" }],
  ])(
    "excludes %s documents only from the dirty Express overlay",
    async (_label, documentOverrides) => {
      mocks.workbenchOverrides = {
        activeDocument: {
          content: 'router.get("/users", handler);',
          language: "typescript",
          name: "routes.ts",
          path: "/workspace/src/routes.ts",
          savedContent: 'router.get("/users", handler);',
          ...documentOverrides,
        },
        bottomPanelView: "expressRoutes",
        workspaceDescriptor: {
          javaScriptTypeScript: { frameworks: ["Express"] },
          php: null,
          rootPath: "/workspace",
        },
      };

      await act(async () => {
        root.render(<App />);
        await Promise.resolve();
      });

      expect(mocks.bottomPanelProps?.hasExpressRoutes).toBe(true);
      expect(mocks.bottomPanelProps?.expressRoutesPanel).toBe(mocks.expressPanelProps);
      expect(mocks.expressPanelOptions).toEqual(
        expect.objectContaining({ isPanelOpen: true, openDocuments: [] }),
      );
      expect(mocks.runCommand).not.toHaveBeenCalledWith("panel.showProblems");
    },
  );

  it("routes problem progress while preserving unrelated direct callbacks", async () => {
    mocks.ideProgress = { busy: false, state: "problem", text: "Indexing failed" };

    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
    });

    click(buttonByTitle("Indexing failed"));
    click(buttonByText("panel-history"));
    click(buttonByText("panel-routes"));
    click(buttonByText("panel-testResults"));
    click(buttonByText("panel-terminal"));
    click(buttonByText("status-branches"));

    expect(mocks.runCommand).toHaveBeenCalledOnce();
    expect(mocks.runCommand).toHaveBeenCalledWith("panel.showProblems");
    expect(mocks.showBottomPanelView.mock.calls.map(([view]) => view)).toEqual([
      "history",
      "routes",
      "testResults",
      "terminal",
    ]);
    expect(mocks.openGitBranchPanel).toHaveBeenCalledOnce();
  });

  function buttonByText(text: string): HTMLButtonElement | null {
    return (
      Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent === text,
      ) ?? null
    );
  }

  function buttonByTitle(title: string): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  }
});

function click(button: HTMLButtonElement | null): void {
  expect(button).not.toBeNull();
  act(() => button?.click());
}

function createWorkbench() {
  const noop = vi.fn();

  return new Proxy(
    {
      activeDocument: null,
      activeFrameworkActivityLabel: null,
      activePath: null,
      appSettings: {
        editorFontFamily: "Menlo, monospace",
        editorFontLigatures: false,
        editorFontSize: 13,
        keymap: "default",
        theme: "calm-dark",
        userSnippets: [],
        wordWrapEnabled: false,
      },
      bottomPanelView: "problems",
      bottomPanelVisible: true,
      bookmarks: [],
      callHierarchyView: null,
      classOpenOpen: false,
      commandContext: {},
      commands: [],
      diagnosticsSummary: { errors: 1, warnings: 0 },
      debugSession: {
        canRestartDebug: () => false,
        debugRestartPending: false,
        debugStopPending: false,
        isDebugStartBlocked: () => false,
        restartDebug: vi.fn(async () => undefined),
        startDebug: vi.fn(async () => undefined),
        watches: createEmptyDebugWatches(),
      },
      dirtyCount: 0,
      entriesByDirectory: {},
      expandedDirectories: new Set<string>(),
      externalFileConflictState: { conflict: null, status: "idle" },
      fileHistoryPanelOpen: false,
      fileStructureOpen: false,
      gitBranch: "main",
      gitBranchPanelOpen: false,
      gitBranchRepositoryLabel: null,
      gitCommitMessage: "",
      gitDiffPreview: null,
      gitLoading: false,
      gitOperationLoading: false,
      gitRepositoryMappings: [],
      gitRepositoryStatuses: [],
      gitStashPanelOpen: false,
      gitStatus: null,
      implementationChooser: null,
      includedGitChangePaths: new Set<string>(),
      indexHealthLogs: [],
      indexProgress: initialIndexProgress(),
      hideBottomPanel: mocks.hideBottomPanel,
      installingManagedPhpactor: false,
      intelligenceMode: "fullSmart",
      javaScriptTypeScriptLanguageServerRuntimeStatus: null,
      languageServerPlan: null,
      languageServerRuntimeStatus: null,
      loadingDirectories: new Set<string>(),
      localHistoryPanelOpen: false,
      markdownPreviewTabs: {},
      message: "",
      navigationHistory: { backStack: [], forwardStack: [] },
      notices: [],
      openDebugLocation: mocks.openDebugLocation,
      openDocuments: [],
      openGitBranchPanel: mocks.openGitBranchPanel,
      openTabs: [],
      paletteOpen: false,
      jsTestRunRequestVersion: 0,
      jsTestDiscoveryVersion: 0,
      phpTestRunRequestVersion: 0,
      phpTreeLoading: false,
      previewPath: null,
      quickOpenOpen: false,
      recentFilesSwitcherOpen: false,
      recentLocations: [],
      recentLocationsPanelOpen: false,
      runCommand: mocks.runCommand,
      searchEverywhereModel: { sections: [] },
      searchEverywhereOpen: false,
      selectedGitChange: null,
      setPaletteOpen: mocks.setPaletteOpen,
      settingsOpen: false,
      showBottomPanelView: mocks.showBottomPanelView,
      sidebarView: "files",
      textSearchOpen: false,
      todoPanelOpen: false,
      typeHierarchyView: null,
      referencesView: null,
      workspaceDescriptor: null,
      workspacePackageDiscovery: mocks.packageDiscoveryState,
      workspaceRoot: "/workspace",
      workspaceSettings: {
        formatOnPaste: false,
        javaScriptTypeScriptCompleteFunctionCalls: false,
        javaScriptTypeScriptValidation: true,
        javaScriptTypeScriptVersion: null,
        largeFileMode: "prompt",
        phpInlayHints: false,
        phpVersionOverride: null,
        revealActiveFileInTree: false,
        statusBar: {},
      },
      workspaceSymbolsOpen: false,
      workspaceTabs: ["/workspace"],
      workspaceTodos: [],
      workspaceTrust: { trusted: false },
      ...mocks.workbenchOverrides,
    },
    {
      get(target, property: string) {
        if (property in target) {
          return target[property as keyof typeof target];
        }

        return noop;
      },
    },
  );
}

function jsTestTarget(filter: string, lineNumber: number): TestGutterTarget {
  return {
    filter,
    kind: "method",
    label: `Run ${filter}`,
    match: "description",
    position: { column: 3, lineNumber },
  };
}

function explorerTestNode(
  tree: ReturnType<typeof buildJsTestExplorerTree>,
): JsTestExplorerTestNode {
  const file = tree.children[0];
  const suite = file?.children[0];
  const test = suite?.children.find((child) => child.kind === "test");
  if (!test || test.kind !== "test") {
    throw new Error("Expected JavaScript explorer test node");
  }
  return test;
}
