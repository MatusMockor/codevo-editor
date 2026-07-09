// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
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
    );

    harness.unmount();
  });

  it("prefers deterministic PHP class navigation before indexed fallback", async () => {
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
      goToPhpClassIdentifierDefinition,
    });
    const harness = renderHook(deps);

    const handled = await harness.api().goToIndexedSymbolDefinition();

    expect(handled).toBe(true);
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
});
