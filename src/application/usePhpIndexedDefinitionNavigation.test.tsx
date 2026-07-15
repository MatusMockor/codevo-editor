// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import {
  usePhpIndexedDefinitionNavigation,
  type PhpIndexedDefinitionNavigation,
  type PhpIndexedDefinitionNavigationDependencies,
} from "./usePhpIndexedDefinitionNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";

function symbol(
  overrides: Partial<ProjectSymbolSearchResult> = {},
): ProjectSymbolSearchResult {
  return {
    column: 3,
    containerName: null,
    fullyQualifiedName: "App\\Services\\ReportService",
    kind: "class",
    lineNumber: 9,
    name: "ReportService",
    path: `${ROOT}/app/Services/ReportService.php`,
    relativePath: "app/Services/ReportService.php",
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<PhpIndexedDefinitionNavigationDependencies> = {},
): PhpIndexedDefinitionNavigationDependencies {
  const falseHandler = vi.fn(async () => false);

  return {
    activeDocument: {
      content: "const selected = ReportService;",
      language: "typescript",
      name: "index.ts",
      path: `${ROOT}/src/index.ts`,
      savedContent: "",
    },
    activeEditorPositionRef: { current: { column: 18, lineNumber: 1 } },
    currentWorkspaceRootRef: { current: ROOT },
    goToPhpFrameworkIdentifierDefinition: vi.fn(async () => false),
    goToPhpClassConstantDefinition: falseHandler,
    goToPhpClassIdentifierDefinition: vi.fn(async () => false),
    goToPhpMethodCallDefinition: falseHandler,
    goToPhpStaticMethodCallDefinition: falseHandler,
    identifierAtEditorPosition: vi.fn(() => "ReportService"),
    intelligenceMode: "fullSmart",
    openNavigationTarget: vi.fn(async () => true),
    projectSymbolSearch: {
      searchProjectSymbols: vi.fn(async () => [symbol()]),
    },
    providers: [phpLaravelFrameworkProvider],
    reportErrorForActiveWorkspaceRoot: vi.fn(),
    setMessage: vi.fn(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(deps: PhpIndexedDefinitionNavigationDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpIndexedDefinitionNavigation | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpIndexedDefinitionNavigationDependencies;
  }) {
    captured.api = usePhpIndexedDefinitionNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpIndexedDefinitionNavigation => {
    if (!captured.api) {
      throw new Error("hook not mounted");
    }

    return captured.api;
  };

  return {
    api,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, reject, resolve };
}

describe("usePhpIndexedDefinitionNavigation", () => {
  it("opens indexed symbols for non-PHP documents", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({ openNavigationTarget });
    const harness = renderHook(deps);

    const handled = await harness.api().goToIndexedSymbolDefinition();

    expect(handled).toBe(true);
    expect(deps.projectSymbolSearch.searchProjectSymbols).toHaveBeenCalledWith(
      ROOT,
      "ReportService",
      25,
    );
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Services/ReportService.php`,
      { column: 3, lineNumber: 9 },
      "ReportService",
      { shouldCommit: expect.any(Function) },
    );

    harness.unmount();
  });

  it("uses deterministic PHP class navigation after a framework miss before indexed fallback", async () => {
    const goToPhpFrameworkIdentifierDefinition = vi.fn(async () => false);
    const goToPhpClassIdentifierDefinition = vi.fn(async () => true);
    const deps = makeDeps({
      activeDocument: {
        content: `<?php
namespace App;

new ReportService();`,
        language: "php",
        name: "Controller.php",
        path: `${ROOT}/app/Controller.php`,
        savedContent: "",
      },
      activeEditorPositionRef: { current: { column: 6, lineNumber: 4 } },
      goToPhpFrameworkIdentifierDefinition,
      goToPhpClassIdentifierDefinition,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToIndexedSymbolDefinition();

    expect(handled).toBe(true);
    expect(goToPhpFrameworkIdentifierDefinition).toHaveBeenCalledWith({
      kind: "classIdentifier",
      name: "ReportService",
    });
    expect(goToPhpClassIdentifierDefinition).toHaveBeenCalledWith(
      "ReportService",
    );
    expect(deps.projectSymbolSearch.searchProjectSymbols).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("delegates PHP framework identifier contexts to the framework handler", async () => {
    const goToPhpFrameworkIdentifierDefinition = vi.fn(async () => true);
    const deps = makeDeps({
      activeDocument: {
        content: `<?php
route('dashboard');`,
        language: "php",
        name: "web.php",
        path: `${ROOT}/routes/web.php`,
        savedContent: "",
      },
      activeEditorPositionRef: { current: { column: 10, lineNumber: 2 } },
      goToPhpFrameworkIdentifierDefinition,
      identifierAtEditorPosition: vi.fn(() => "dashboard"),
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToIndexedSymbolDefinition();

    expect(handled).toBe(true);
    expect(goToPhpFrameworkIdentifierDefinition).toHaveBeenCalledWith({
      kind: "laravelNamedRouteString",
      routeName: "dashboard",
    });
    expect(deps.projectSymbolSearch.searchProjectSymbols).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not reinterpret a recognized unresolved Laravel route action as core PHP", async () => {
    const source = "<?php Route::get('/', [ReportController::class, 'missing']);";
    const goToPhpFrameworkIdentifierDefinition = vi.fn(async () => false);
    const goToPhpClassIdentifierDefinition = vi.fn(async () => true);
    const deps = makeDeps({
      activeDocument: {
        content: source,
        language: "php",
        name: "web.php",
        path: `${ROOT}/routes/web.php`,
        savedContent: "",
      },
      activeEditorPositionRef: {
        current: { column: source.indexOf("missing") + 7, lineNumber: 1 },
      },
      goToPhpClassIdentifierDefinition,
      goToPhpFrameworkIdentifierDefinition,
      identifierAtEditorPosition: vi.fn(() => "missing"),
    });
    const harness = renderHook(deps);

    await expect(harness.api().goToIndexedSymbolDefinition()).resolves.toBe(false);
    expect(goToPhpFrameworkIdentifierDefinition).toHaveBeenCalledWith({
      className: "ReportController",
      kind: "laravelRouteActionMethod",
      methodName: "missing",
    });
    expect(goToPhpClassIdentifierDefinition).not.toHaveBeenCalled();
    expect(deps.projectSymbolSearch.searchProjectSymbols).not.toHaveBeenCalled();

    harness.unmount();
  });

  it.each([
    { label: "generic", providers: [] },
    { label: "Nette-only", providers: [phpNetteFrameworkProvider] },
  ])("uses core context with $label providers", async ({ providers }) => {
    const source = "<?php route('dashboard');";
    const goToPhpFrameworkIdentifierDefinition = vi.fn(async () => false);
    const goToPhpClassIdentifierDefinition = vi.fn(async () => true);
    const deps = makeDeps({
      activeDocument: {
        content: source,
        language: "php",
        name: "web.php",
        path: `${ROOT}/routes/web.php`,
        savedContent: "",
      },
      activeEditorPositionRef: {
        current: { column: source.indexOf("dashboard") + 9, lineNumber: 1 },
      },
      goToPhpClassIdentifierDefinition,
      goToPhpFrameworkIdentifierDefinition,
      identifierAtEditorPosition: vi.fn(() => "dashboard"),
      providers,
    });
    const harness = renderHook(deps);

    await expect(harness.api().goToIndexedSymbolDefinition()).resolves.toBe(true);
    expect(goToPhpFrameworkIdentifierDefinition).toHaveBeenCalledWith({
      kind: "classIdentifier",
      name: "dashboard",
    });
    expect(goToPhpClassIdentifierDefinition).toHaveBeenCalledWith("dashboard");

    harness.unmount();
  });

  it("drops indexed targets when the active workspace changes", async () => {
    const symbols = deferred<ProjectSymbolSearchResult[]>();
    const currentWorkspaceRootRef = { current: ROOT };
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      currentWorkspaceRootRef,
      openNavigationTarget,
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(() => symbols.promise),
      },
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToIndexedSymbolDefinition();

    currentWorkspaceRootRef.current = OTHER_ROOT;
    symbols.resolve([symbol()]);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("drops indexed search errors when the active workspace changes", async () => {
    const symbols = deferred<ProjectSymbolSearchResult[]>();
    const currentWorkspaceRootRef = { current: ROOT };
    const reportErrorForActiveWorkspaceRoot = vi.fn();
    const deps = makeDeps({
      currentWorkspaceRootRef,
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(() => symbols.promise),
      },
      reportErrorForActiveWorkspaceRoot,
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToIndexedSymbolDefinition();

    currentWorkspaceRootRef.current = OTHER_ROOT;
    symbols.reject(new Error("stale indexed definition"));

    await expect(navigationPromise).resolves.toBe(false);
    expect(reportErrorForActiveWorkspaceRoot).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not open an indexed target after same-root request replacement", async () => {
    const symbols = deferred<ProjectSymbolSearchResult[]>();
    const openNavigationTarget = vi.fn(async () => true);
    let requestActive = true;
    const request = { canNavigate: () => requestActive };
    const deps = makeDeps({
      openNavigationTarget,
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(() => symbols.promise),
      },
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToIndexedSymbolDefinition(request);

    requestActive = false;
    symbols.resolve([symbol()]);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not commit an indexed target during same-root request replacement", async () => {
    const openStarted = deferred<void>();
    const finishOpen = deferred<void>();
    const committedTargets: string[] = [];
    let requestActive = true;
    const request = { canNavigate: () => requestActive };
    const openNavigationTarget = vi.fn(async (
      path: string,
      _position: { column: number; lineNumber: number },
      _label: string,
      options?: { shouldCommit?: () => boolean },
    ) => {
      openStarted.resolve();
      await finishOpen.promise;

      if (options?.shouldCommit?.() === false) {
        return false;
      }

      committedTargets.push(path);
      return true;
    });
    const deps = makeDeps({ openNavigationTarget });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToIndexedSymbolDefinition(request);

    await openStarted.promise;
    requestActive = false;
    finishOpen.resolve();

    await expect(navigationPromise).resolves.toBe(false);
    expect(committedTargets).toEqual([]);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Services/ReportService.php`,
      { column: 3, lineNumber: 9 },
      "ReportService",
      { shouldCommit: expect.any(Function) },
    );

    harness.unmount();
  });

  it("does not set an indexed miss message after same-root request replacement", async () => {
    const symbols = deferred<ProjectSymbolSearchResult[]>();
    const setMessage = vi.fn();
    let requestActive = true;
    const request = { canNavigate: () => requestActive };
    const deps = makeDeps({
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(() => symbols.promise),
      },
      setMessage,
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToIndexedSymbolDefinition(request);

    requestActive = false;
    symbols.resolve([]);

    await expect(navigationPromise).resolves.toBe(false);
    expect(setMessage).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not report an indexed error after same-root request replacement", async () => {
    const symbols = deferred<ProjectSymbolSearchResult[]>();
    const reportErrorForActiveWorkspaceRoot = vi.fn();
    let requestActive = true;
    const request = { canNavigate: () => requestActive };
    const deps = makeDeps({
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(() => symbols.promise),
      },
      reportErrorForActiveWorkspaceRoot,
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToIndexedSymbolDefinition(request);

    requestActive = false;
    symbols.reject(new Error("stale indexed definition"));

    await expect(navigationPromise).resolves.toBe(false);
    expect(reportErrorForActiveWorkspaceRoot).not.toHaveBeenCalled();

    harness.unmount();
  });
});
