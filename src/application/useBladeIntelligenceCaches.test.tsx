import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  createPhpFrameworkProviderCapabilityRegistry,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { FileEntry, TextSearchResult } from "../domain/workspace";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  useBladeIntelligenceCaches,
  type BladeIntelligenceCacheDependencies,
  type BladeIntelligenceCaches,
} from "./useBladeIntelligenceCaches";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const CONTROLLER_PATH = `${ROOT}/app/Http/Controllers/InvoiceController.php`;
const COMPONENT_PATH = `${ROOT}/resources/views/components/alert.blade.php`;

function textResult(path: string): TextSearchResult {
  return {
    column: 1,
    lineNumber: 1,
    lineText: "",
    path,
    relativePath: path.slice(ROOT.length + 1),
  };
}

function fileEntry(path: string, kind: FileEntry["kind"]): FileEntry {
  return { kind, name: path.split("/").pop() ?? path, path };
}

function makeDeps(
  overrides: Partial<BladeIntelligenceCacheDependencies> = {},
): BladeIntelligenceCacheDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    frameworkRuntime: frameworkRuntime([phpLaravelFrameworkProvider]),
    readNavigationFileContent: vi.fn(async () => `<?php
use App\\Models\\Invoice;

return view('invoices.show', ['invoice' => Invoice::findOrFail(1)]);
`),
    relativeWorkspacePath: (root, path) =>
      path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
    resolvePhpClassPropertyOrRelationType: vi.fn(async () => null),
    resolvePhpDeclaredType: (_source, typeName) => typeName,
    resolvePhpExpressionType: vi.fn(async () => null),
    textSearch: { searchText: vi.fn(async () => [textResult(CONTROLLER_PATH)]) },
    workspaceFiles: {
      readDirectory: vi.fn(async () => [fileEntry(COMPONENT_PATH, "file")]),
    },
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function frameworkRuntime(
  providers: readonly PhpFrameworkProvider[],
): PhpFrameworkRuntimeContext {
  const capabilities = createPhpFrameworkProviderCapabilityRegistry(providers);

  return {
    capabilities,
    providers,
    profile: "laravel",
    hasProvider: (providerId) =>
      providers.some((provider) => provider.id === providerId),
    supports: (capability) => capabilities.supports(capability),
    supportsTargetCollection: (kind) =>
      capabilities.supportsTargetCollection(kind),
  };
}

function renderHook(deps: BladeIntelligenceCacheDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: BladeIntelligenceCaches | null } = { api: null };

  function Harness({
    dependencies,
  }: {
    dependencies: BladeIntelligenceCacheDependencies;
  }) {
    captured.api = useBladeIntelligenceCaches(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): BladeIntelligenceCaches => {
    if (!captured.api) {
      throw new Error("cache hook not mounted");
    }

    return captured.api;
  };

  return {
    api,
    rerender: (next: BladeIntelligenceCacheDependencies) => {
      act(() => {
        root.render(<Harness dependencies={next} />);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useBladeIntelligenceCaches", () => {
  it("caches view-data entries across resolver calls", async () => {
    const searchText = vi.fn(async () => [textResult(CONTROLLER_PATH)]);
    const harness = renderHook(makeDeps({ textSearch: { searchText } }));

    await expect(
      harness.api().collectBladeViewVariablesWithDisplayTypes("invoices.show"),
    ).resolves.toContainEqual(expect.objectContaining({ name: "$invoice" }));
    const callsAfterFirstLoad = searchText.mock.calls.length;
    await expect(
      harness.api().collectBladeViewVariablesWithDisplayTypes("invoices.show"),
    ).resolves.toContainEqual(expect.objectContaining({ name: "$invoice" }));

    expect(searchText).toHaveBeenCalledTimes(callsAfterFirstLoad);
    harness.unmount();
  });

  it("invalidates view-data for PHP paths only", async () => {
    const searchText = vi.fn(async () => [textResult(CONTROLLER_PATH)]);
    const harness = renderHook(makeDeps({ textSearch: { searchText } }));

    await harness.api().collectBladeViewVariablesWithDisplayTypes("invoices.show");
    const callsAfterFirstLoad = searchText.mock.calls.length;
    harness
      .api()
      .invalidateBladeViewDataEntriesForPath(ROOT, `${ROOT}/README.md`);
    await harness.api().collectBladeViewVariablesWithDisplayTypes("invoices.show");
    expect(searchText).toHaveBeenCalledTimes(callsAfterFirstLoad);
    harness
      .api()
      .invalidateBladeViewDataEntriesForPath(ROOT, CONTROLLER_PATH);
    await harness.api().collectBladeViewVariablesWithDisplayTypes("invoices.show");

    expect(searchText).toHaveBeenCalledTimes(callsAfterFirstLoad * 2);
    harness.unmount();
  });

  it("reset clears view-data and component caches", async () => {
    const searchText = vi.fn(async () => [textResult(CONTROLLER_PATH)]);
    const readDirectory = vi.fn(async () => [fileEntry(COMPONENT_PATH, "file")]);
    const harness = renderHook(
      makeDeps({
        textSearch: { searchText },
        workspaceFiles: { readDirectory },
      }),
    );

    await harness.api().collectBladeViewVariablesWithDisplayTypes("invoices.show");
    await harness.api().collectBladeComponentNames();
    const viewDataCallsAfterFirstLoad = searchText.mock.calls.length;
    const componentCallsAfterFirstLoad = readDirectory.mock.calls.length;
    harness.api().resetBladeIntelligenceCaches();
    await harness.api().collectBladeViewVariablesWithDisplayTypes("invoices.show");
    await harness.api().collectBladeComponentNames();

    expect(searchText).toHaveBeenCalledTimes(viewDataCallsAfterFirstLoad * 2);
    expect(readDirectory).toHaveBeenCalledTimes(componentCallsAfterFirstLoad * 2);
    harness.unmount();
  });

  it("drops stale view-data and component scans after root switches", async () => {
    const currentWorkspaceRootRef = { current: ROOT };
    const searchText = vi.fn(async () => {
      currentWorkspaceRootRef.current = "/other";

      return [textResult(CONTROLLER_PATH)];
    });
    const readDirectory = vi.fn(async () => {
      currentWorkspaceRootRef.current = "/other";

      return [fileEntry(COMPONENT_PATH, "file")];
    });
    const harness = renderHook(
      makeDeps({
        currentWorkspaceRootRef,
        textSearch: { searchText },
        workspaceFiles: { readDirectory },
      }),
    );

    await expect(
      harness.api().collectBladeViewVariablesWithDisplayTypes("invoices.show"),
    ).resolves.toEqual([]);

    currentWorkspaceRootRef.current = ROOT;

    await expect(harness.api().collectBladeComponentNames()).resolves.toEqual([]);
    harness.unmount();
  });
});
