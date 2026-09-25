// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchNotice } from "../../application/workbenchNotice";
import type { GitHistoryGateway } from "../../domain/git";
import { initialIndexProgress } from "../../domain/indexProgress";
import type { RuntimeObservabilityGateway } from "../../domain/runtimeObservability";
import { classicTerminalTheme } from "../../domain/editorColorThemes";
import type { TerminalGateway } from "../../domain/terminal";
import type {
  BoundedWorkspaceSourceRead,
  WorkspaceSourceDiscoveryGateway,
} from "../../domain/workspaceSourceDiscovery";
import { buildJsTestExplorerTree } from "../../domain/jsTestExplorerTree";
import { buildPackageDependencyTree } from "../../domain/packageDependencyTree";
import type { TestGutterTarget } from "../../domain/testGutterTargets";
import { defaultTextSearchOptions, type TextSearchResult } from "../../domain/workspace";
import { waitForReact } from "../../test/reactTestLifecycle";
import { useWorkspacePackageGraph } from "../../application/useWorkspacePackageGraph";
import { DebugPanel } from "../DebugPanel";
import { TextSearch } from "../TextSearch";
import type { WorkbenchPanelProps } from "../workbenchPanelViews";
import { WorkbenchEditorDrawer } from "./WorkbenchEditorDrawer";
import { useOwnedWorkspaceExpressRoutesWorkbenchPanel } from "../useWorkspaceExpressRoutesWorkbenchPanel";

describe("WorkbenchEditorDrawer views", () => {
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

  it("shows Tests but not Routes for a PHP workspace without Artisan", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      { hasArtisan: false, hasPhpWorkspace: true },
    );
    const labels = viewLabels(host);

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
    const labels = viewLabels(host);

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

  it("keeps Problems package attribution while App's real Express isOpen gate is false", async () => {
    const problem: WorkbenchNotice = {
      id: "tsc:packages/api/src/x.ts:1:1",
      message: "Cannot find name",
      navigationTarget: {
        path: "/workspace/packages/api/src/x.ts",
        range: {
          end: { column: 1, lineNumber: 1 },
          start: { column: 1, lineNumber: 1 },
        },
      },
      severity: "error",
      source: "TypeScript",
    };
    const discoveryGateway: WorkspaceSourceDiscoveryGateway = {
      enumerateJavaScriptSourceFiles: vi.fn(async () => ({
        files: ["packages/api/src/x.ts"],
        truncated: false,
        visited: 4,
      })),
      enumeratePackageJsonFiles: vi.fn(async () => ({
        files: ["package.json", "packages/api/package.json"],
        truncated: false,
        visited: 4,
      })),
      readSourceTextBounded: vi.fn(
        async (_rootPath, relativePath): Promise<BoundedWorkspaceSourceRead> => {
          if (relativePath === "package.json") {
            return {
              status: "ok",
              content: '{"name":"workspace","workspaces":["packages/*"]}',
            };
          }
          if (relativePath === "packages/api/package.json") {
            return { status: "ok", content: '{"name":"@repo/api"}' };
          }
          return { status: "ok", content: "app.get('/api', handler);" };
        },
      ),
    };

    act(() => {
      root.render(
        <ProductionProblemsPanel discoveryGateway={discoveryGateway} problem={problem} />,
      );
    });
    await waitForReact(() =>
      expect(host.querySelector('option[value="@repo/api"]')).not.toBeNull(),
    );

    act(() => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Group by package"]')?.click();
    });

    expect(
      host.querySelector('[data-package-key="@repo/api"] .cv-problems__item')?.textContent,
    ).toContain("Cannot find name");
    expect(
      Array.from(host.querySelectorAll(".cv-problems__package"), (header) => header.textContent),
    ).toEqual([expect.stringContaining("@repo/api")]);
    expect(discoveryGateway.enumerateJavaScriptSourceFiles).not.toHaveBeenCalled();
  });

  it("shows pending package attribution while a save-triggered manifest rescan is pending", async () => {
    let releaseRescan: () => void = () => undefined;
    const pendingRescan = new Promise<void>((resolve) => {
      releaseRescan = resolve;
    });
    let enumerationCount = 0;
    const problem = problemForPackageApi();
    const discoveryGateway = packageDiscoveryGateway();
    const enumeratePackageJsonFiles = discoveryGateway.enumeratePackageJsonFiles;
    expect(enumeratePackageJsonFiles).toBeDefined();
    vi.mocked(enumeratePackageJsonFiles!).mockImplementation(async () => {
      enumerationCount += 1;
      if (enumerationCount === 2) {
        await pendingRescan;
      }
      return {
        files: ["package.json", "packages/api/package.json"],
        truncated: false,
        visited: 4,
      };
    });

    act(() => {
      root.render(
        <ProductionProblemsPanel discoveryGateway={discoveryGateway} problem={problem} />,
      );
    });
    await waitForReact(() =>
      expect(host.querySelector('option[value="@repo/api"]')).not.toBeNull(),
    );
    act(() => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Group by package"]')?.click();
    });
    const packageHeader = host.querySelector<HTMLButtonElement>(".cv-problems__package");
    packageHeader?.focus();

    act(() => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Simulate JavaScript save"]')
        ?.click();
    });
    await waitForReact(() => expect(enumerationCount).toBe(2));

    expect(host.textContent).not.toContain("Package (degraded)");
    expect(host.textContent).not.toContain("Package unknown (workspace scan bounded)");
    expect(host.querySelector(".cv-problems__package")?.textContent).toContain(
      "Package pending (workspace scan loading)",
    );
    expect(host.querySelector('[data-package-key="@repo/api"]')).toBeNull();
    expect(document.activeElement).not.toBe(packageHeader);

    act(() => {
      releaseRescan();
    });
    await pendingRescan;
    await waitForReact(() =>
      expect(host.querySelector(".cv-problems__package")?.textContent).toContain("@repo/api"),
    );
    expect(host.textContent).not.toContain("Package pending (workspace scan loading)");
  });

  it("reads the root package manifest once per discovery version", async () => {
    const discoveryGateway = packageDiscoveryGateway();

    act(() => {
      root.render(
        <ProductionProblemsPanel
          discoveryGateway={discoveryGateway}
          problem={problemForPackageApi()}
        />,
      );
    });
    await waitForReact(() =>
      expect(host.querySelector('option[value="@repo/api"]')).not.toBeNull(),
    );
    const rootManifestReads = () =>
      vi
        .mocked(discoveryGateway.readSourceTextBounded)
        .mock.calls.filter(([, relativePath]) => relativePath === "package.json");

    expect(rootManifestReads()).toHaveLength(1);
    act(() => {
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Simulate JavaScript save"]')
        ?.click();
    });
    await waitForReact(() => expect(rootManifestReads()).toHaveLength(2));
  });

  it("renders non-JavaScript workspace package controls without a degraded scan claim", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "problems",
        hasJsWorkspace: false,
        notices: [problemForPackageApi()],
        workspacePackageDiscovery: {
          authority: "bounded",
          incompleteDirectories: [],
          packageManifests: [],
          unscopedAuthorityUncertain: true,
        },
      },
    );

    expect(host.textContent).toContain("No package");
    expect(host.textContent).not.toContain("Package (degraded)");
    expect(host.textContent).not.toContain("Package unknown (workspace scan bounded)");
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

    const expressRoutesItem = moreViewsItem(host, "Express routes");

    expect(expressRoutesItem).not.toBeUndefined();

    act(() => expressRoutesItem?.click());

    expect(onSelectView).toHaveBeenCalledWith("expressRoutes");

    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {},
    );

    expect(viewLabels(host)).not.toContain("Express routes");
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
      "Express routes",
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
      "Express routes",
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
      "Express routes",
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

    expect(viewLabels(host)).not.toContain("Express routes");
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
    const labels = viewLabels(host);

    expect(labels).toContain("Debug console");
  });

  it("renders the persistent search view in the panel", async () => {
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "search",
        search: <div aria-label="Persistent workspace search">results</div>,
      },
    );

    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Search");
    expect(host.querySelector('[aria-label="Persistent workspace search"]')?.textContent).toBe(
      "results",
    );
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

  it("offers Clear problems in the drawer header only for a non-empty Problems view", async () => {
    const onClearProblems = vi.fn();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        notices: [problemForPackageApi()],
        onClearProblems,
      },
    );
    act(() =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Clear problems"]')?.click(),
    );

    expect(onClearProblems).toHaveBeenCalledOnce();
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      { notices: [] },
    );
    expect(host.querySelector('button[aria-label="Clear problems"]')).toBeNull();
  });

  it("renders the PHP structure view only in a PHP workspace", async () => {
    await act(async () => {
      root.render(
        <WorkbenchEditorDrawer
          consoleHeader={null}
          frame={FRAME}
          panel={{ ...basePanelProps(), hasPhpWorkspace: true }}
          phpTree={<div aria-label="PHP tree" />}
          view="phpTree"
        />,
      );
    });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "PHP structure",
    );
    expect(host.querySelector('[aria-label="PHP tree"]')).not.toBeNull();

    await act(async () => {
      root.render(
        <WorkbenchEditorDrawer
          consoleHeader={null}
          frame={FRAME}
          panel={basePanelProps()}
          phpTree={<div aria-label="PHP tree" />}
          view="phpTree"
        />,
      );
    });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Problems");
    expect(host.querySelector('[aria-label="PHP tree"]')).toBeNull();
  });

  it("shows the console header only for the Debug console view", async () => {
    const render = (view: "debug" | "problems") =>
      act(async () => {
        root.render(
          <WorkbenchEditorDrawer
            consoleHeader={<button aria-label="Clear console" type="button" />}
            frame={FRAME}
            panel={basePanelProps()}
            phpTree={null}
            view={view}
          />,
        );
      });
    await render("debug");
    expect(host.querySelector('.cv-edrawer__head [aria-label="Clear console"]')).not.toBeNull();
    await render("problems");
    expect(host.querySelector('[aria-label="Clear console"]')).toBeNull();
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
describe("WorkbenchEditorDrawer docked search lifecycle", () => {
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

  it("preserves search selection and collapsed files across panel tab switches", async () => {
    const results: TextSearchResult[] = [
      {
        column: 1,
        lineNumber: 1,
        lineText: "needle",
        matchEnd: 6,
        matchStart: 0,
        path: "/workspace/a.ts",
        relativePath: "a.ts",
      },
      {
        column: 1,
        lineNumber: 2,
        lineText: "needle",
        matchEnd: 6,
        matchStart: 0,
        path: "/workspace/b.ts",
        relativePath: "b.ts",
      },
    ];
    const search = (
      <TextSearch
        dismissedPaths={new Set()}
        isLoading={false}
        isOpen
        onChangeOptions={vi.fn()}
        onChangeQuery={vi.fn()}
        onChangeReplacement={vi.fn()}
        onClose={vi.fn()}
        onDismissFile={vi.fn()}
        onOpen={vi.fn()}
        onReplaceAll={vi.fn()}
        onReplaceInFile={vi.fn()}
        onRestoreDismissedFiles={vi.fn()}
        options={defaultTextSearchOptions()}
        query="needle"
        replaceBusy={false}
        replacement=""
        results={results}
      />
    );

    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "search",
        search,
      },
    );
    const firstGroup = host.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse a.ts, 1 match"]',
    );
    let secondResult = host.querySelector<HTMLButtonElement>(
      '[aria-label="b.ts, line 2, column 1"]',
    );
    expect(firstGroup).not.toBeNull();
    expect(secondResult).not.toBeNull();

    act(() => {
      firstGroup?.click();
    });
    secondResult = host.querySelector<HTMLButtonElement>('[aria-label="b.ts, line 2, column 1"]');
    act(() => secondResult?.focus());
    expect(firstGroup?.getAttribute("aria-expanded")).toBe("false");
    expect(secondResult?.getAttribute("aria-selected")).toBe("true");

    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "terminal",
        search,
      },
    );
    await renderPanel(
      root,
      "/workspace",
      vi.fn(async () => true),
      undefined,
      {
        activeView: "search",
        search,
      },
    );

    expect(firstGroup?.isConnected).toBe(true);
    expect(firstGroup?.getAttribute("aria-expanded")).toBe("false");
    expect(secondResult?.isConnected).toBe(true);
    expect(secondResult?.getAttribute("aria-selected")).toBe("true");
  });
});

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
  routes: NonNullable<WorkbenchPanelProps["expressRoutesPanel"]>["routes"] = [],
): NonNullable<WorkbenchPanelProps["expressRoutesPanel"]> {
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

function ProductionProblemsPanel({
  discoveryGateway,
  problem,
}: {
  discoveryGateway: WorkspaceSourceDiscoveryGateway;
  problem: WorkbenchNotice;
}) {
  const bottomPanelVisible = true;
  const bottomPanelView: string = "problems";
  const expressWorkspaceManifestSignal = false;
  const [discoveryVersion, setDiscoveryVersion] = useState(0);
  const packageDiscovery = useWorkspacePackageGraph({
    discoveryVersion,
    enabled: true,
    gateway: discoveryGateway,
    rootPath: "/workspace",
    workspaceId: "workspace",
  });
  const expressRoutesPanel = useOwnedWorkspaceExpressRoutesWorkbenchPanel({
    activeDocument: null,
    discoveryGateway,
    discoveryVersion,
    hasJavaScriptTypeScriptWorkspace: true,
    isPanelOpen:
      (bottomPanelVisible && bottomPanelView === "expressRoutes") || expressWorkspaceManifestSignal,
    onOpenLocation: async () => true,
    openDocuments: [],
    packageDiscovery,
    rootPath: "/workspace",
    workspaceId: "workspace",
  });

  return (
    <>
      <button
        aria-label="Simulate JavaScript save"
        onClick={() => setDiscoveryVersion((current) => current + 1)}
        type="button"
      />
      <DrawerHarness
        activeView="problems"
        expressRoutesPanel={expressRoutesPanel}
        gitHistoryGateway={{} as GitHistoryGateway}
        indexHealthLogs={[]}
        indexProgress={initialIndexProgress()}
        notices={[problem]}
        onClearProblems={vi.fn()}
        onClose={vi.fn()}
        onHardReindex={vi.fn()}
        onOpenCommitFileDiff={vi.fn()}
        onOpenProblem={vi.fn(async () => true)}
        onPhpReindex={vi.fn()}
        onResizeStart={vi.fn()}
        onSelectView={vi.fn()}
        onSoftReindex={vi.fn()}
        onTrustWorkspace={vi.fn()}
        runtimeObservabilityGateway={{} as RuntimeObservabilityGateway}
        terminalGateway={terminalGateway()}
        terminalShellIntegrationEnabled={false}
        terminalTheme={classicTerminalTheme("classicDark")}
        workspacePackageDiscovery={packageDiscovery}
        workspaceRoot="/workspace"
        workspaceTrusted
      />
    </>
  );
}

function problemForPackageApi(): WorkbenchNotice {
  return {
    id: "tsc:packages/api/src/x.ts:1:1",
    message: "Cannot find name",
    navigationTarget: {
      path: "/workspace/packages/api/src/x.ts",
      range: {
        end: { column: 1, lineNumber: 1 },
        start: { column: 1, lineNumber: 1 },
      },
    },
    severity: "error",
    source: "TypeScript",
  };
}

function packageDiscoveryGateway(): WorkspaceSourceDiscoveryGateway {
  return {
    enumerateJavaScriptSourceFiles: vi.fn(async () => ({
      files: ["packages/api/src/x.ts"],
      truncated: false,
      visited: 4,
    })),
    enumeratePackageJsonFiles: vi.fn(async () => ({
      files: ["package.json", "packages/api/package.json"],
      truncated: false,
      visited: 4,
    })),
    readSourceTextBounded: vi.fn(
      async (_rootPath, relativePath): Promise<BoundedWorkspaceSourceRead> => {
        if (relativePath === "package.json") {
          return {
            status: "ok",
            content: '{"name":"workspace","workspaces":["packages/*"]}',
          };
        }
        if (relativePath === "packages/api/package.json") {
          return { status: "ok", content: '{"name":"@repo/api"}' };
        }
        return { status: "notFound" };
      },
    ),
  };
}

function DrawerHarness(props: WorkbenchPanelProps) {
  const view = props.activeView === "terminal" ? "problems" : props.activeView;
  return (
    <WorkbenchEditorDrawer
      consoleHeader={null}
      frame={FRAME}
      panel={props}
      phpTree={null}
      view={view}
    />
  );
}

const FRAME = { height: 224, onResize: () => undefined };

function viewLabels(host: HTMLElement): string[] {
  const tabs = Array.from(
    host.querySelectorAll<HTMLButtonElement>("[role='tab']"),
    (button) => button.textContent ?? "",
  );
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="More views"]')?.click());
  const more = Array.from(
    document.body.querySelectorAll('[role="menu"][aria-label="More views"] [role="menuitem"]'),
    (item) => item.textContent ?? "",
  );
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="More views"]')?.click());
  return [...tabs, ...more];
}

function moreViewsItem(host: HTMLElement, label: string): HTMLElement | undefined {
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="More views"]')?.click());
  return Array.from(
    document.body.querySelectorAll<HTMLElement>(
      '[role="menu"][aria-label="More views"] [role="menuitem"]',
    ),
  ).find((item) => item.textContent === label);
}

function basePanelProps(): WorkbenchPanelProps {
  return {
    activeView: "problems",
    gitHistoryGateway: {} as GitHistoryGateway,
    indexHealthLogs: [],
    indexProgress: initialIndexProgress(),
    notices: [],
    onClearProblems: vi.fn(),
    onClose: vi.fn(),
    onHardReindex: vi.fn(),
    onOpenCommitFileDiff: vi.fn(),
    onOpenProblem: vi.fn(async () => true),
    onPhpReindex: vi.fn(),
    onResizeStart: vi.fn(),
    onSelectView: vi.fn(),
    onSoftReindex: vi.fn(),
    onTrustWorkspace: vi.fn(),
    runtimeObservabilityGateway: {} as RuntimeObservabilityGateway,
    terminalGateway: terminalGateway(),
    terminalShellIntegrationEnabled: false,
    terminalTheme: classicTerminalTheme("classicDark"),
    workspaceRoot: "/workspace",
    workspaceTrusted: true,
  };
}

async function renderPanel(
  root: Root,
  workspaceRoot: string | null,
  onOpenProblem: (notice: WorkbenchNotice) => Promise<boolean>,
  _onRevealDirectoryInTree?: (path: string) => void,
  overrides: Partial<WorkbenchPanelProps> = {},
) {
  await act(async () => {
    root.render(
      <DrawerHarness
        activeView="problems"
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
        onResizeStart={vi.fn()}
        onSelectView={vi.fn()}
        onSoftReindex={vi.fn()}
        onTrustWorkspace={vi.fn()}
        runtimeObservabilityGateway={{} as RuntimeObservabilityGateway}
        terminalGateway={terminalGateway()}
        terminalShellIntegrationEnabled={false}
        terminalTheme={classicTerminalTheme("classicDark")}
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
  overrides: Partial<NonNullable<WorkbenchPanelProps["jsTestExplorer"]>> = {},
): NonNullable<WorkbenchPanelProps["jsTestExplorer"]> {
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
  overrides: Partial<NonNullable<WorkbenchPanelProps["packageDependenciesPanel"]>> = {},
): NonNullable<WorkbenchPanelProps["packageDependenciesPanel"]> {
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
  overrides: Partial<NonNullable<WorkbenchPanelProps["symfonyWorkspacePanel"]>> = {},
): NonNullable<WorkbenchPanelProps["symfonyWorkspacePanel"]> {
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

function netteWorkspacePanelProps(): NonNullable<WorkbenchPanelProps["netteWorkspacePanel"]> {
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
