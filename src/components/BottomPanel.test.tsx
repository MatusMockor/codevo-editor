// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import type { GitHistoryGateway } from "../domain/git";
import { initialIndexProgress } from "../domain/indexProgress";
import type { RuntimeObservabilityGateway } from "../domain/runtimeObservability";
import { terminalThemeForAppTheme } from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import { buildJsTestExplorerTree } from "../domain/jsTestExplorerTree";
import { buildPackageDependencyTree } from "../domain/packageDependencyTree";
import type { TestGutterTarget } from "../domain/testGutterTargets";
import { BottomPanel } from "./BottomPanel";
import { DebugPanel } from "./DebugPanel";

interface CapturedTerminalPanelProps {
  isActive: boolean;
  onCwdChange?(cwd: string | null): void;
  onOpenLink?(path: string, line?: number, column?: number): boolean | Promise<boolean> | undefined;
  profileId: string | null;
  rootPath: string | null;
}

const bottomPanelMocks = vi.hoisted(() => ({
  terminalProps: [] as unknown[],
  terminalUnmounts: 0,
}));

vi.mock("./TerminalPanel", async () => {
  const React = await import("react");
  return {
    TerminalPanel: (props: CapturedTerminalPanelProps) => {
      React.useEffect(
        () => () => {
          bottomPanelMocks.terminalUnmounts += 1;
        },
        [],
      );
      bottomPanelMocks.terminalProps.push(props);
      return <div aria-label="Mock terminal" />;
    },
  };
});

describe("BottomPanel terminal links", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    bottomPanelMocks.terminalProps.length = 0;
    bottomPanelMocks.terminalUnmounts = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("builds terminal navigation targets with exact and default positions", async () => {
    const onOpenProblem = vi.fn(async () => true);

    await renderPanel(root, "/workspace", onOpenProblem);
    const onOpenLink = terminalProps().onOpenLink;

    expect(onOpenLink).toBeTypeOf("function");

    const exactResult = await onOpenLink?.("/workspace/src/Foo.php", 12, 4);
    const defaultResult = await onOpenLink?.("/workspace/src/Bar.php");

    expect(exactResult).toBe(true);
    expect(defaultResult).toBe(true);
    expect(onOpenProblem.mock.calls).toEqual([
      [
        {
          id: "terminal:/workspace/src/Foo.php:12:4",
          message: "/workspace/src/Foo.php",
          navigationTarget: {
            path: "/workspace/src/Foo.php",
            range: {
              end: { column: 4, lineNumber: 12 },
              start: { column: 4, lineNumber: 12 },
            },
          },
          severity: "info",
          source: "Terminal",
        },
      ],
      [
        {
          id: "terminal:/workspace/src/Bar.php:1:1",
          message: "/workspace/src/Bar.php",
          navigationTarget: {
            path: "/workspace/src/Bar.php",
            range: {
              end: { column: 1, lineNumber: 1 },
              start: { column: 1, lineNumber: 1 },
            },
          },
          severity: "info",
          source: "Terminal",
        },
      ],
    ]);
  });

  it("drops a stale terminal activation after the workspace root changes", async () => {
    const onOpenProblem = vi.fn(async () => true);

    await renderPanel(root, "/workspace/old", onOpenProblem);
    const staleOnOpenLink = terminalProps().onOpenLink;

    await renderPanel(root, "/workspace/new", onOpenProblem);
    await staleOnOpenLink?.("/workspace/old/src/Foo.php", 3, 2);

    expect(onOpenProblem).not.toHaveBeenCalled();
  });

  it("replaces terminal ownership when a same-root workspace identity changes", async () => {
    const onOpenProblem = vi.fn(async () => true);
    await renderPanel(root, "/workspace", onOpenProblem, undefined, {
      terminalOwnerKey: "workspace-a",
    });
    const first = terminalProps();

    await renderPanel(root, "/workspace", onOpenProblem, undefined, {
      terminalOwnerKey: "workspace-b",
    });

    expect(bottomPanelMocks.terminalUnmounts).toBe(1);
    expect(terminalProps()).not.toBe(first);
  });

  it("loads the default profile, updates the active tab, and restores each tab profile", async () => {
    const gateway = terminalGateway();
    gateway.listProfiles = vi.fn(async () => [
      { command: "/bin/zsh", id: "zsh", label: "Zsh" },
      { command: "/bin/fish", id: "fish", label: "Fish" },
    ]);
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        terminalGateway: gateway,
      },
    );

    const profile = host.querySelector<HTMLSelectElement>('[aria-label="Terminal profile"]');
    expect(profile?.value).toBe("zsh");
    expect(activeTerminalProps().profileId).toBe("zsh");

    act(() => {
      host.querySelector<HTMLButtonElement>('[aria-label="New Terminal"]')?.click();
    });
    if (!profile) throw new Error("Missing terminal profile selector");
    act(() => {
      profile.value = "fish";
      profile.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(activeTerminalProps().profileId).toBe("fish");

    const terminalTabs = () =>
      [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter((button) =>
        button.getAttribute("aria-controls")?.startsWith("terminal-"),
      );
    act(() => terminalTabs()[0]?.click());
    expect(profile.value).toBe("zsh");
    expect(activeTerminalProps().profileId).toBe("zsh");
    act(() => terminalTabs()[1]?.click());
    expect(profile.value).toBe("fish");
    expect(activeTerminalProps().profileId).toBe("fish");
  });

  it("renders the active terminal cwd as a button inside the workspace", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      vi.fn(),
    );

    act(() => terminalProps().onCwdChange?.("/workspace/src"));

    const cwd = host.querySelector('[title="/workspace/src"]');

    expect(cwd?.tagName).toBe("BUTTON");
    expect(cwd?.textContent).toBe("/workspace/src");
    expect(cwd?.getAttribute("aria-label")).toBe("Reveal /workspace/src in file tree");
  });

  it("renders the cwd as a plain span outside the workspace or without a root", async () => {
    const onRevealDirectoryInTree = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      onRevealDirectoryInTree,
    );

    act(() => terminalProps().onCwdChange?.("/other/src"));

    expect(host.querySelector('[title="/other/src"]')?.tagName).toBe("SPAN");

    await renderPanel(
      root,
      null,
      vi.fn(async () => true),
      onRevealDirectoryInTree,
    );
    act(() => terminalProps().onCwdChange?.("/other/src"));

    expect(host.querySelector('[title="/other/src"]')?.tagName).toBe("SPAN");
  });

  it("reveals the current terminal cwd when its button is clicked", async () => {
    const onRevealDirectoryInTree = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      onRevealDirectoryInTree,
    );

    act(() => terminalProps().onCwdChange?.("/workspace/src"));
    act(() => {
      (host.querySelector('[title="/workspace/src"]') as HTMLButtonElement).click();
    });

    expect(onRevealDirectoryInTree).toHaveBeenCalledWith("/workspace/src");
  });

  it("shows Tests but not Routes for a PHP workspace without Artisan", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      { hasArtisan: false, hasPhpWorkspace: true },
    );
    const labels = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[role='tab']"),
      (button) => button.textContent,
    );

    expect(labels).toContain("Tests");
    expect(labels).not.toContain("Routes");
  });

  it("shows the Tests tab for a JavaScript-only workspace", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      { hasArtisan: false, hasJsWorkspace: true, hasPhpWorkspace: false },
    );
    const labels = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[role='tab']"),
      (button) => button.textContent,
    );

    expect(labels).toContain("Tests");
    expect(labels).toContain("Packages");
  });

  it("renders and selects the package dependency tree only for a JavaScript workspace", async () => {
    const onOpenDependency = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "packages",
        hasJsWorkspace: true,
        packageDependenciesPanel: packageDependenciesProps({
          onOpenDependency,
        }),
      },
    );

    expect(host.querySelector('[aria-label="Workspace dependencies"]')).not.toBeNull();
    expect(host.textContent).toContain("express");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Packages");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[role="option"]')?.click();
      await Promise.resolve();
    });
    expect(onOpenDependency).toHaveBeenCalledWith(expect.objectContaining({ name: "express" }));

    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "packages",
        hasJsWorkspace: false,
        packageDependenciesPanel: packageDependenciesProps(),
      },
    );
    expect(host.querySelector('[aria-label="Workspace dependencies"]')).toBeNull();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Problems");
  });

  it("shows, selects, and renders Symfony only when the framework is available", async () => {
    const onSelectView = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "symfony",
        hasSymfony: true,
        onSelectView,
        symfonyWorkspacePanel: symfonyWorkspacePanelProps(),
      },
    );

    const symfonyTab = Array.from(host.querySelectorAll<HTMLButtonElement>("[role='tab']")).find(
      (button) => button.textContent === "Symfony",
    );
    expect(symfonyTab?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[aria-label="Symfony workspace"]')).not.toBeNull();

    act(() => symfonyTab?.click());
    expect(onSelectView).toHaveBeenCalledWith("symfony");
  });

  it("shows, selects, and renders Nette services only for a full Nette application", async () => {
    const onSelectView = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "nette",
        hasNette: true,
        netteWorkspacePanel: netteWorkspacePanelProps(),
        onSelectView,
      },
    );

    const netteTab = Array.from(host.querySelectorAll<HTMLButtonElement>("[role='tab']")).find(
      (button) => button.textContent === "Nette",
    );
    expect(netteTab?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[aria-label="Nette workspace"]')).not.toBeNull();
    act(() => netteTab?.click());
    expect(onSelectView).toHaveBeenCalledWith("nette");

    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "nette",
        hasNette: false,
        netteWorkspacePanel: netteWorkspacePanelProps(),
      },
    );
    expect(host.querySelector('[aria-label="Nette workspace"]')).toBeNull();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Problems");
  });

  it("falls back to Problems for a stale Symfony view without framework support", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "symfony",
        hasSymfony: false,
        symfonyWorkspacePanel: symfonyWorkspacePanelProps(),
      },
    );

    expect(host.textContent).not.toContain("Symfony");
    expect(host.querySelector('[aria-label="Symfony workspace"]')).toBeNull();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Problems");
    expect(host.querySelector('[aria-label="Problems"]')).not.toBeNull();
  });

  it("offers workspace trust from the Symfony panel", async () => {
    const onTrustWorkspace = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "symfony",
        hasSymfony: true,
        onTrustWorkspace,
        symfonyWorkspacePanel: symfonyWorkspacePanelProps({
          commands: {
            message: "Trust this workspace before running Symfony Console.",
            status: "unavailable",
          },
        }),
        workspaceTrusted: false,
      },
    );

    const trustButton = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Trust",
    );
    act(() => trustButton?.click());
    expect(onTrustWorkspace).toHaveBeenCalledOnce();
  });

  it("shows and selects Express Routes only when route discovery is available", async () => {
    const onSelectView = vi.fn();

    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        expressRoutesPanel: expressRoutesPanelProps([expressRoute()]),
        onSelectView,
      },
    );

    const expressRoutesTab = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[role='tab']"),
    ).find((button) => button.textContent === "Express Routes");

    expect(expressRoutesTab).not.toBeUndefined();

    act(() => expressRoutesTab?.click());

    expect(onSelectView).toHaveBeenCalledWith("expressRoutes");

    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {},
    );

    expect(host.textContent).not.toContain("Express Routes");
  });

  it("renders Express Routes for a signaled or explicitly active view", async () => {
    const onOpenExpressRoute = vi.fn();
    const expressRoutes = [
      {
        column: 1,
        id: "src%2Froutes.ts:app:GET:%2Fusers:12:1:1",
        line: 12,
        method: "GET",
        occurrence: 1,
        path: "/users",
        receiver: "app" as const,
        relativeFilePath: "src/routes.ts",
      },
    ];
    const onQueryChange = vi.fn();
    const onRefresh = vi.fn();

    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "expressRoutes",
        expressRoutesPanel: {
          error: null,
          loading: false,
          onOpenRoute: onOpenExpressRoute,
          onQueryChange,
          onRefresh,
          query: "",
          routes: expressRoutes,
          truncated: false,
        },
      },
    );

    expect(host.querySelector('[aria-label="Express routes"]')).not.toBeNull();
    expect(host.textContent).toContain("/users");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "Express Routes",
    );

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[role="option"]')?.click();
      await Promise.resolve();
    });

    expect(onOpenExpressRoute).toHaveBeenCalledWith(expressRoutes[0]);

    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "expressRoutes",
        expressRoutesPanel: {
          error: null,
          loading: false,
          onOpenRoute: onOpenExpressRoute,
          onQueryChange,
          onRefresh,
          query: "",
          routes: expressRoutes,
          truncated: false,
        },
      },
    );

    expect(host.querySelector('[aria-label="Express routes"]')).not.toBeNull();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "Express Routes",
    );
  });

  it("shows an honest empty state when the palette opens an unsignaled Express panel", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "expressRoutes",
        expressRoutesPanel: {
          error: null,
          loading: false,
          onOpenRoute: vi.fn(),
          onQueryChange: vi.fn(),
          onRefresh: vi.fn(),
          query: "",
          routes: [],
          truncated: false,
        },
        hasExpressRoutes: true,
        hasJsWorkspace: true,
      },
    );

    expect(host.textContent).toContain("No Express routes found.");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "Express Routes",
    );
  });

  it("rejects a persisted Express view outside a JS/TS workspace", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "expressRoutes",
        expressRoutesPanel: expressRoutesPanelProps(),
      },
    );

    expect(host.textContent).not.toContain("Express Routes");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Problems");
  });

  it("renders only the JavaScript results block for a JS-only workspace", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "testResults",
        hasArtisan: false,
        hasJsWorkspace: true,
        hasPhpWorkspace: false,
      },
    );

    expect(host.querySelector('[aria-label="JavaScript Test Explorer"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="PHP test results"]')).toBeNull();
  });

  it("renders PHP and JavaScript results blocks for a mixed workspace", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "testResults",
        hasArtisan: false,
        hasJsWorkspace: true,
        hasPhpWorkspace: true,
      },
    );

    expect(host.querySelector('[aria-label="JavaScript Test Explorer"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="PHP test results"]')).not.toBeNull();
  });

  it("keeps the PHP-only results block for a PHP workspace", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "testResults",
        hasArtisan: true,
        hasJsWorkspace: false,
        hasPhpWorkspace: true,
      },
    );

    expect(host.querySelector('[aria-label="PHP test results"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="JavaScript Test Explorer"]')).toBeNull();
  });

  it("forwards PHP coverage controls and summary to the PHP results block", async () => {
    const onRunPhpTestCoverage = vi.fn();
    const onClearPhpTestCoverage = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "testResults",
        hasJsWorkspace: false,
        hasPhpWorkspace: true,
        onClearPhpTestCoverage,
        onRunPhpTestCoverage,
        phpTestCanRunCoverage: true,
        phpTestCoverageSummary: { covered: 3, percentage: 75, total: 4 },
      },
    );

    expect(host.querySelector('[aria-label="PHP coverage summary"]')?.textContent).toBe(
      "3/4 lines covered · 75.0%",
    );
    act(() => {
      host.querySelector<HTMLButtonElement>('[aria-label="Run PHP tests with coverage"]')?.click();
      host.querySelector<HTMLButtonElement>('[aria-label="Clear PHP test coverage"]')?.click();
    });

    expect(onRunPhpTestCoverage).toHaveBeenCalledOnce();
    expect(onClearPhpTestCoverage).toHaveBeenCalledOnce();
  });

  it("always shows the Debug tab", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      { hasArtisan: false, hasJsWorkspace: false, hasPhpWorkspace: false },
    );
    const labels = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[role='tab']"),
      (button) => button.textContent,
    );

    expect(labels).toContain("Debug");
  });

  it("renders the debug panel with pass-through props for the debug view", async () => {
    const onStep = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "debug",
        debug: (
          <DebugPanel
            {...{
              breakpoints: [],
              console: {
                state: {
                  owner: { sessionId: 1, pauseGeneration: 1 },
                  entries: [],
                  history: [],
                  pendingRequestIds: [],
                  nextSequence: 1,
                  totalBytes: 0,
                },
                clear: vi.fn(),
                submit: vi.fn().mockResolvedValue(undefined),
              },
              debugAdapterKind: null,
              exceptionPauseError: null,
              exceptionPauseMode: "none",
              exceptionPausePending: false,
              hasJavaScriptTypeScriptWorkspace: true,
              lastStartError: null,
              onDisconnect: vi.fn(),
              onLoadVariables: vi.fn(),
              onNavigateToBreakpoint: vi.fn(),
              onNavigateToFrame: vi.fn(),
              onPause: vi.fn(),
              onRemoveBreakpoint: vi.fn(),
              onSelectFrame: vi.fn(),
              onSetBreakpointCondition: vi.fn(),
              onSetBreakpointHitCondition: vi.fn(),
              onSetBreakpointLogMessage: vi.fn(),
              onSetBreakpointEnabled: vi.fn(),
              onSetExceptionPauseMode: vi.fn(),
              onStep,
              onStop: vi.fn(),
              rootPath: "/workspace",
              scopeLoadState: { kind: "unavailable" },
              scopes: [],
              selectedFrameId: null,
              snapshot: {
                state: {
                  kind: "stopped",
                  sessionId: 1,
                  reason: "breakpoint",
                  frames: [],
                  topFrame: null,
                },
                lastSeq: 1,
              },
              variablesByReference: {},
              watches: {
                definitions: [],
                evaluations: {},
                pendingIds: [],
                onAdd: vi.fn(),
                onClear: vi.fn(),
                onRemove: vi.fn(),
                onSetEnabled: vi.fn(),
                onUpdate: vi.fn(),
              },
              workspaceTrusted: true,
            }}
          />
        ),
      },
    );

    expect(host.querySelector('[aria-label="Debug"]')).not.toBeNull();

    act(() => {
      (host.querySelector('[aria-label="Continue"]') as HTMLButtonElement).click();
    });

    expect(onStep).toHaveBeenCalledWith("continue");
  });

  it("renders no debug panel when debug props are not wired", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      { activeView: "debug" },
    );

    expect(host.querySelector('[aria-label="Debug"]')).toBeNull();
  });

  it("forwards JavaScript explorer run, refresh, query, and navigation props", async () => {
    const onOpenTest = vi.fn();
    const onQueryChange = vi.fn();
    const onRefresh = vi.fn();
    const onRunScope = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "testResults",
        hasArtisan: false,
        hasJsWorkspace: true,
        hasPhpWorkspace: false,
        jsTestExplorer: jsExplorerProps({
          onOpenTest,
          onQueryChange,
          onRefresh,
          onRunScope,
        }),
      },
    );

    act(() => {
      host.querySelector<HTMLButtonElement>('[aria-label="Run all JavaScript tests"]')?.click();
      host.querySelector<HTMLButtonElement>('[aria-label="Refresh JavaScript tests"]')?.click();
      host.querySelector<HTMLButtonElement>('[aria-label="Open test suite works"]')?.click();
    });
    act(() => {
      const input = host.querySelector<HTMLInputElement>('[aria-label="Filter JavaScript tests"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "works",
      );
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onRunScope).toHaveBeenCalledExactlyOnceWith({ kind: "all" });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onQueryChange).toHaveBeenCalledWith("works");
    expect(onOpenTest).toHaveBeenCalledOnce();
  });
});

function terminalProps(): CapturedTerminalPanelProps {
  return bottomPanelMocks.terminalProps[
    bottomPanelMocks.terminalProps.length - 1
  ] as CapturedTerminalPanelProps;
}

function activeTerminalProps(): CapturedTerminalPanelProps {
  const active = [...bottomPanelMocks.terminalProps]
    .reverse()
    .find((candidate) => (candidate as CapturedTerminalPanelProps).isActive);
  if (!active) throw new Error("Missing active terminal");
  return active as CapturedTerminalPanelProps;
}

function expressRoute() {
  return {
    column: 1,
    id: "src%2Froutes.ts:app:GET:%2Fusers:12:1:1",
    line: 12,
    method: "GET",
    occurrence: 1,
    path: "/users",
    receiver: "app" as const,
    relativeFilePath: "src/routes.ts",
  };
}

function expressRoutesPanelProps(
  routes: NonNullable<Parameters<typeof BottomPanel>[0]["expressRoutesPanel"]>["routes"] = [],
): NonNullable<Parameters<typeof BottomPanel>[0]["expressRoutesPanel"]> {
  return {
    error: null,
    loading: false,
    onOpenRoute: vi.fn(),
    onQueryChange: vi.fn(),
    onRefresh: vi.fn(),
    query: "",
    routes,
    truncated: false,
  };
}

async function renderPanel(
  root: Root,
  workspaceRoot: string | null,
  onOpenProblem: (notice: WorkbenchNotice) => Promise<boolean>,
  onRevealDirectoryInTree?: (path: string) => void,
  overrides: Partial<Parameters<typeof BottomPanel>[0]> = {},
) {
  await import("./TerminalTabsPanel");
  await act(async () => {
    root.render(
      <BottomPanel
        activeView="terminal"
        gitHistoryGateway={{} as GitHistoryGateway}
        indexHealthLogs={[]}
        indexProgress={initialIndexProgress()}
        notices={[]}
        jsTestExplorer={jsExplorerProps()}
        onClearProblems={vi.fn()}
        onClose={vi.fn()}
        onHardReindex={vi.fn()}
        onOpenCommitFileDiff={vi.fn()}
        onOpenProblem={onOpenProblem}
        onPhpReindex={vi.fn()}
        onRevealDirectoryInTree={onRevealDirectoryInTree}
        onResizeStart={vi.fn()}
        onSelectView={vi.fn()}
        onSoftReindex={vi.fn()}
        onTrustWorkspace={vi.fn()}
        runtimeObservabilityGateway={{} as RuntimeObservabilityGateway}
        terminalGateway={terminalGateway()}
        terminalShellIntegrationEnabled={false}
        terminalTheme={terminalThemeForAppTheme("dark")}
        workspaceRoot={workspaceRoot}
        workspaceTrusted
        {...overrides}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

function jsExplorerProps(
  overrides: Partial<NonNullable<Parameters<typeof BottomPanel>[0]["jsTestExplorer"]>> = {},
): NonNullable<Parameters<typeof BottomPanel>[0]["jsTestExplorer"]> {
  return {
    canCancelTestRun: false,
    canRerunFailedTests: false,
    canStartContinuousRun: false,
    continuousRunEnabled: false,
    continuousRunPending: false,
    continuousRunRunning: false,
    continuousRunStopping: false,
    coverageError: null,
    coverageReport: null,
    coverageRunning: false,
    coverageUnavailable: null,
    debugError: null,
    debugging: false,
    debugStartBlocked: false,
    debugUnavailable: null,
    error: null,
    executionStartBlocked: false,
    failedRunCompleted: 0,
    failedRunPhase: "idle",
    failedRunTotal: 0,
    loading: false,
    onCancelTestRun: vi.fn(),
    onOpenTest: vi.fn(),
    onClearCoverage: vi.fn(),
    onDebugNode: vi.fn(),
    onOpenCoverageFile: vi.fn(),
    onQueryChange: vi.fn(),
    onRefresh: vi.fn(),
    onRerunFailedTests: vi.fn(),
    onRunScope: vi.fn(),
    onRunCoverage: vi.fn(),
    onStartContinuousRun: vi.fn(),
    onStopContinuousRun: vi.fn(),
    query: "",
    running: false,
    tree: buildJsTestExplorerTree("/workspace", [
      {
        filePath: "src/example.test.ts",
        suitePath: ["suite"],
        target: jsTestTarget("works", 3),
      },
    ]),
    truncated: false,
    unavailable: null,
    ...overrides,
  };
}

function packageDependenciesProps(
  overrides: Partial<
    NonNullable<Parameters<typeof BottomPanel>[0]["packageDependenciesPanel"]>
  > = {},
): NonNullable<Parameters<typeof BottomPanel>[0]["packageDependenciesPanel"]> {
  return {
    busy: false,
    error: null,
    manager: "npm",
    onCancelOperation: vi.fn(),
    onCheckOutdated: vi.fn(),
    onConfirmOperation: vi.fn(),
    onInstallPackage: vi.fn(),
    onOpenDependency: vi.fn(),
    onQueryChange: vi.fn(),
    onRemoveDependency: vi.fn(),
    onUpdateDependency: vi.fn(),
    pendingOperation: null,
    query: "",
    status: null,
    tree: buildPackageDependencyTree([
      {
        declaredRange: "^5",
        dev: false,
        installedVersion: "5.1.0",
        installPath: "/workspace/node_modules/express",
        name: "express",
      },
    ]),
    trusted: true,
    ...overrides,
  };
}

function symfonyWorkspacePanelProps(
  overrides: Partial<NonNullable<Parameters<typeof BottomPanel>[0]["symfonyWorkspacePanel"]>> = {},
): NonNullable<Parameters<typeof BottomPanel>[0]["symfonyWorkspacePanel"]> {
  return {
    activeTab: "commands",
    busy: false,
    commands: { commands: [], status: "ok", total: 0, truncated: false },
    error: null,
    filteredCommands: [],
    filteredRoutes: [],
    filteredServices: [],
    onOpenRouteController: vi.fn(async () => false),
    onOpenService: vi.fn(async () => false),
    onQueryChange: vi.fn(),
    onRefresh: vi.fn(async () => true),
    onTabChange: vi.fn(),
    query: "",
    routes: { routes: [], status: "ok", total: 0, truncated: false },
    services: { services: [], status: "ok", total: 0, truncated: false },
    ...overrides,
  };
}

function netteWorkspacePanelProps(): NonNullable<
  Parameters<typeof BottomPanel>[0]["netteWorkspacePanel"]
> {
  return {
    activeSection: "services",
    onSectionChange: vi.fn(),
    presenters: {
      busy: false,
      error: null,
      filteredPresenters: [],
      onOpenMethod: vi.fn(async () => false),
      onOpenPresenter: vi.fn(async () => false),
      onOpenTemplate: vi.fn(async () => false),
      onQueryChange: vi.fn(),
      onRefresh: vi.fn(async () => true),
      presenters: { presenters: [], status: "ok", total: 0, truncated: false },
      query: "",
    },
    routes: {
      busy: false,
      error: null,
      filteredRoutes: [],
      onOpenDefinition: vi.fn(async () => false),
      onOpenTarget: vi.fn(async () => false),
      onQueryChange: vi.fn(),
      onRefresh: vi.fn(async () => true),
      query: "",
      routes: { routes: [], status: "ok", total: 0, truncated: false },
    },
    services: {
      busy: false,
      error: null,
      filteredServices: [],
      onOpenClass: vi.fn(async () => false),
      onOpenDefinition: vi.fn(async () => false),
      onQueryChange: vi.fn(),
      onRefresh: vi.fn(async () => true),
      query: "",
      services: { services: [], status: "ok", total: 0, truncated: false },
    },
  };
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
    stop: vi.fn(async (sessionId) => ({
      kind: "stopped" as const,
      sessionId,
    })),
    stopAll: vi.fn(async () => undefined),
    stopRoot: vi.fn(async () => undefined),
    subscribeOutput: vi.fn(async () => () => undefined),
    writeInput: vi.fn(async () => undefined),
  };
}
