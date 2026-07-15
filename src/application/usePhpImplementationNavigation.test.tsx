// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import {
  usePhpImplementationNavigation,
  type PhpImplementationNavigation,
  type PhpImplementationNavigationDependencies,
} from "./usePhpImplementationNavigation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other";

const BASE_SOURCE = `<?php
namespace App\\Services;

abstract class BaseAdapter
{
    abstract public function getPlatform(): string;
}`;

const IMPLEMENTATION_SOURCE = `<?php
namespace App\\Services;

final class FacebookAdapterService extends BaseAdapter
{
    public function getPlatform(): string
    {
        return 'facebook';
    }
}`;

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing needle ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split(/\r?\n/);

  return {
    column: lines[lines.length - 1].length,
    lineNumber: lines.length,
  };
}

function methodSymbol(
  overrides: Partial<ProjectSymbolSearchResult> = {},
): ProjectSymbolSearchResult {
  return {
    column: 21,
    containerName: "App\\Services\\FacebookAdapterService",
    fullyQualifiedName: "App\\Services\\FacebookAdapterService::getPlatform",
    kind: "method",
    lineNumber: 6,
    name: "getPlatform",
    path: `${ROOT}/app/Services/FacebookAdapterService.php`,
    relativePath: "app/Services/FacebookAdapterService.php",
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<PhpImplementationNavigationDependencies> = {},
): PhpImplementationNavigationDependencies {
  return {
    activeDocument: {
      content: BASE_SOURCE,
      language: "php",
      name: "BaseAdapter.php",
      path: `${ROOT}/app/Services/BaseAdapter.php`,
      savedContent: "",
    },
    activeEditorPositionRef: {
      current: positionAfter(BASE_SOURCE, "getPlatform"),
    },
    currentWorkspaceRootRef: { current: ROOT },
    identifierAtEditorPosition: vi.fn(() => "getPlatform"),
    intelligenceMode: "fullSmart",
    openNavigationTarget: vi.fn(async () => true),
    projectSymbolSearch: {
      searchProjectSymbols: vi.fn(async () => [methodSymbol()]),
    },
    readNavigationFileContent: vi.fn(async () => IMPLEMENTATION_SOURCE),
    resolvePhpClassReference: vi.fn((_source, reference) =>
      reference === "BaseAdapter" ? "App\\Services\\BaseAdapter" : null,
    ),
    resolvePhpClassSourcePaths: vi.fn(async (className) =>
      className === "App\\Services\\BaseAdapter"
        ? [`${ROOT}/app/Services/BaseAdapter.php`]
        : [],
    ),
    setImplementationChooser: vi.fn(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(deps: PhpImplementationNavigationDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpImplementationNavigation | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpImplementationNavigationDependencies;
  }) {
    captured.api = usePhpImplementationNavigation(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpImplementationNavigation => {
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

describe("usePhpImplementationNavigation", () => {
  it("discovers indexed PHP implementations through inherited source", async () => {
    const deps = makeDeps();
    const harness = renderHook(deps);

    const targets = await harness
      .api()
      .indexedPhpImplementationTargets(positionAfter(BASE_SOURCE, "getPlatform"));

    expect(targets).toHaveLength(1);
    expect(targets[0]).toEqual(
      expect.objectContaining({
        label: "FacebookAdapterService",
        path: `${ROOT}/app/Services/FacebookAdapterService.php`,
      }),
    );

    harness.unmount();
  });

  it("opens the only indexed PHP implementation", async () => {
    const openNavigationTarget = vi.fn(async () => true);
    const setImplementationChooser = vi.fn();
    const deps = makeDeps({ openNavigationTarget, setImplementationChooser });
    const harness = renderHook(deps);

    const handled = await harness.api().goToIndexedPhpImplementation();

    expect(handled).toBe(true);
    expect(setImplementationChooser).toHaveBeenCalledWith(null);
    expect(openNavigationTarget).toHaveBeenCalledWith(
      `${ROOT}/app/Services/FacebookAdapterService.php`,
      { column: 21, lineNumber: 6 },
      "FacebookAdapterService",
      { shouldCommit: expect.any(Function) },
    );

    harness.unmount();
  });

  it("drops stale implementation targets after switching workspace", async () => {
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
    const navigationPromise = harness.api().goToIndexedPhpImplementation();

    currentWorkspaceRootRef.current = OTHER_ROOT;
    symbols.resolve([methodSymbol()]);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not show an implementation chooser after the navigation request becomes stale", async () => {
    const symbols = deferred<ProjectSymbolSearchResult[]>();
    let requestActive = true;
    const setImplementationChooser = vi.fn();
    const deps = makeDeps({
      projectSymbolSearch: {
        searchProjectSymbols: vi.fn(() => symbols.promise),
      },
      setImplementationChooser,
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToIndexedPhpImplementation(
      undefined,
      { canNavigate: () => requestActive },
    );

    requestActive = false;
    symbols.resolve([
      methodSymbol(),
      methodSymbol({
        containerName: "App\\Services\\InstagramAdapterService",
        path: `${ROOT}/app/Services/InstagramAdapterService.php`,
        relativePath: "app/Services/InstagramAdapterService.php",
      }),
    ]);

    await expect(navigationPromise).resolves.toBe(false);
    expect(setImplementationChooser).not.toHaveBeenCalled();
    expect(deps.openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("does not open an implementation after the navigation request becomes stale", async () => {
    const source = deferred<string>();
    let requestActive = true;
    const openNavigationTarget = vi.fn(async () => true);
    const deps = makeDeps({
      openNavigationTarget,
      readNavigationFileContent: vi.fn(() => source.promise),
    });
    const harness = renderHook(deps);
    const navigationPromise = harness.api().goToIndexedPhpImplementation(
      undefined,
      { canNavigate: () => requestActive },
    );

    requestActive = false;
    source.resolve(IMPLEMENTATION_SOURCE);

    await expect(navigationPromise).resolves.toBe(false);
    expect(openNavigationTarget).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("opens an implementation while an alias-preserving request remains valid", async () => {
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
    const navigationPromise = harness.api().goToIndexedPhpImplementation(
      undefined,
      { canNavigate: () => true },
    );

    currentWorkspaceRootRef.current = `${ROOT}/`;
    symbols.resolve([methodSymbol()]);

    await expect(navigationPromise).resolves.toBe(true);
    expect(openNavigationTarget).toHaveBeenCalledOnce();

    harness.unmount();
  });
});
