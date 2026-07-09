// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import type { WorkspaceDescriptor } from "../domain/workspace";
import {
  usePhpClassTargetNavigation,
  type PhpClassTargetNavigation,
  type PhpClassTargetNavigationDependencies,
} from "./usePhpClassTargetNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";

const PHP_DESCRIPTOR: WorkspaceDescriptor = {
  javaScriptTypeScript: null,
  php: {
    classmapRoots: [],
    hasComposer: true,
    packageName: "app/test",
    packages: [],
    phpPlatformVersion: null,
    phpVersionConstraint: null,
    psr4Roots: [{ dev: false, namespace: "App\\", paths: ["app"] }],
  },
  rootPath: ROOT,
};

function symbol(
  overrides: Partial<ProjectSymbolSearchResult> = {},
): ProjectSymbolSearchResult {
  return {
    column: 5,
    containerName: null,
    fullyQualifiedName: "App\\Services\\ReportService",
    kind: "class",
    lineNumber: 8,
    name: "ReportService",
    path: `${ROOT}/app/Services/ReportService.php`,
    relativePath: "app/Services/ReportService.php",
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<PhpClassTargetNavigationDependencies> = {},
): PhpClassTargetNavigationDependencies {
  return {
    activeDocument: {
      content: "<?php new ReportService();",
      language: "php",
      name: "Controller.php",
      path: `${ROOT}/app/Controller.php`,
      savedContent: "",
    },
    currentWorkspaceRootRef: { current: ROOT },
    intelligenceMode: "fullSmart",
    openNavigationTarget: vi.fn(async () => true),
    projectSymbolSearch: {
      searchProjectSymbols: vi.fn(async () => [symbol()]),
    },
    readNavigationFileContent: vi.fn(async () => `<?php
namespace App\\Services;

class ReportService
{
}`),
    workspaceDescriptor: PHP_DESCRIPTOR,
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(deps: PhpClassTargetNavigationDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpClassTargetNavigation | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpClassTargetNavigationDependencies;
  }) {
    captured.api = usePhpClassTargetNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpClassTargetNavigation => {
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
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe("usePhpClassTargetNavigation", () => {
  it("opens indexed class symbols when indexing is active", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({ openNavigationTarget });
    const harness = renderHook(deps);

    const handled = await harness.api().openPhpClassTarget(
      "App\\Services\\ReportService",
      "ReportService",
    );

    expect(handled).toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Services/ReportService.php`,
      { column: 5, lineNumber: 8 },
      "ReportService",
    );
    expect(deps.readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("falls back to PSR-4 class files when the index has no exact match", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      openNavigationTarget,
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(async () => []),
      },
    });
    const harness = renderHook(deps);

    const handled = await harness.api().openPhpClassTarget(
      "App\\Services\\ReportService",
      "ReportService",
    );

    expect(handled).toBe(true);
    expect(deps.readNavigationFileContent).toHaveBeenCalledWith(
      `${ROOT}/app/Services/ReportService.php`,
    );
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Services/ReportService.php`,
      expect.objectContaining({ lineNumber: 4 }),
      "ReportService",
    );

    harness.unmount();
  });

  it("drops class targets when the active workspace changes", async () => {
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
    const navigationPromise = harness.api().openPhpClassTarget(
      "App\\Services\\ReportService",
      "ReportService",
    );

    currentWorkspaceRootRef.current = OTHER_ROOT;
    symbols.resolve([symbol()]);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("drops class targets when the navigation request becomes stale after an awaited resolver", async () => {
    const symbols = deferred<ProjectSymbolSearchResult[]>();
    let requestActive = true;
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      openNavigationTarget,
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(() => symbols.promise),
      },
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().openPhpClassTarget(
      "App\\Services\\ReportService",
      "ReportService",
      { canNavigate: () => requestActive },
    );

    requestActive = false;
    symbols.resolve([symbol()]);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();
    expect(deps.readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });
});
