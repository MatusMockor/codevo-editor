import { describe, expect, it, vi } from "vitest";
import type { BladeViewDataEntry } from "../domain/bladeViewVariables";
import {
  createPhpFrameworkProviderCapabilityRegistry,
  phpLaravelFrameworkProvider,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { TextSearchResult } from "../domain/workspace";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  ensureBladeViewDataEntriesLoaded,
  invalidateBladeViewDataEntriesForPath,
  type BladeViewDataCacheRef,
  type BladeViewDataCacheDependencies,
  type BladeViewDataInFlightRef,
} from "./bladeViewDataCache";

const ROOT = "/ws";
const OTHER_ROOT = "/other";
const PHP_FILE = `${ROOT}/app/Http/Controllers/InvoiceController.php`;
const PROVIDERS = [phpLaravelFrameworkProvider];

const invoiceControllerSource = `<?php
use App\\Models\\Invoice;

class InvoiceController
{
    public function show(): mixed
    {
        $invoice = Invoice::findOrFail(1);

        return view('x', ['invoice' => $invoice]);
    }
}
`;

function textResult(path: string): TextSearchResult {
  return {
    path,
    relativePath: path.startsWith(`${ROOT}/`)
      ? path.slice(ROOT.length + 1)
      : path,
    lineNumber: 1,
    column: 1,
    lineText: "return view('x', ['invoice' => $invoice]);",
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function makeDeps(
  overrides: Partial<BladeViewDataCacheDependencies> = {},
): BladeViewDataCacheDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    entriesByRootRef: { current: {} },
    frameworkRuntime: frameworkRuntime(PROVIDERS),
    loadInFlightRef: { current: new Map() },
    readNavigationFileContent: vi.fn(async () => invoiceControllerSource),
    textSearch: { searchText: vi.fn(async () => [textResult(PHP_FILE)]) },
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
    isLaravel: providers.some((provider) => provider.id === "laravel"),
    isNette: providers.some((provider) => provider.id === "nette"),
    hasProvider: (providerId) =>
      providers.some((provider) => provider.id === providerId),
    supports: (capability) => capabilities.supports(capability),
    supportsTargetCollection: (kind) =>
      capabilities.supportsTargetCollection(kind),
  };
}

describe("bladeViewDataCache", () => {
  it("uses the cached entries on a cache hit without searching or reading again", async () => {
    const searchText = vi.fn(async () => [textResult(PHP_FILE)]);
    const readNavigationFileContent = vi.fn(async () => invoiceControllerSource);
    const deps = makeDeps({
      readNavigationFileContent,
      textSearch: { searchText },
    });

    const first = await ensureBladeViewDataEntriesLoaded(ROOT, deps);
    const second = await ensureBladeViewDataEntriesLoaded(ROOT, deps);

    expect(first).not.toBeNull();
    expect(first?.[0]?.bindings[0]).toMatchObject({ viewName: "x" });
    expect(second).toBe(first);
    expect(searchText.mock.calls.length).toBeGreaterThan(0);
    expect(readNavigationFileContent).toHaveBeenCalledTimes(1);
  });

  it("dedupes in-flight loads for the same root", async () => {
    const search = deferred<TextSearchResult[]>();
    const searchText = vi.fn(() => search.promise);
    const readNavigationFileContent = vi.fn(async () => invoiceControllerSource);
    const deps = makeDeps({
      readNavigationFileContent,
      textSearch: { searchText },
    });

    const firstLoad = ensureBladeViewDataEntriesLoaded(ROOT, deps);
    const secondLoad = ensureBladeViewDataEntriesLoaded(ROOT, deps);
    const callsAfterFirstRequest = searchText.mock.calls.length;

    expect(callsAfterFirstRequest).toBeGreaterThan(0);

    search.resolve([textResult(PHP_FILE)]);
    const [first, second] = await Promise.all([firstLoad, secondLoad]);

    expect(second).toBe(first);
    expect(searchText).toHaveBeenCalledTimes(callsAfterFirstRequest);
    expect(readNavigationFileContent).toHaveBeenCalledTimes(1);
    expect(deps.loadInFlightRef.current.has(ROOT)).toBe(false);
  });

  it("ignores non-PHP invalidations and clears cached/in-flight PHP entries", () => {
    const cachedEntries: BladeViewDataEntry[] = [
      { bindings: [], source: invoiceControllerSource },
    ];
    const inFlight = Promise.resolve(cachedEntries);
    const entriesByRootRef: BladeViewDataCacheRef = {
      current: { [ROOT]: cachedEntries },
    };
    const loadInFlightRef: BladeViewDataInFlightRef = {
      current: new Map([[ROOT, inFlight]]),
    };

    invalidateBladeViewDataEntriesForPath(
      entriesByRootRef,
      loadInFlightRef,
      ROOT,
      `${ROOT}/README.md`,
    );

    expect(entriesByRootRef.current[ROOT]).toBe(cachedEntries);
    expect(loadInFlightRef.current.get(ROOT)).toBe(inFlight);

    invalidateBladeViewDataEntriesForPath(
      entriesByRootRef,
      loadInFlightRef,
      ROOT,
      PHP_FILE,
    );

    expect(entriesByRootRef.current[ROOT]).toBeUndefined();
    expect(loadInFlightRef.current.has(ROOT)).toBe(false);
  });

  it("deletes in-flight loads on invalidation so stale work cannot write cache", async () => {
    const search = deferred<TextSearchResult[]>();
    const entriesByRootRef: BladeViewDataCacheRef = { current: {} };
    const loadInFlightRef: BladeViewDataInFlightRef = { current: new Map() };
    const deps = makeDeps({
      entriesByRootRef,
      loadInFlightRef,
      readNavigationFileContent: vi.fn(async () => invoiceControllerSource),
      textSearch: { searchText: vi.fn(() => search.promise) },
    });

    const staleLoad = ensureBladeViewDataEntriesLoaded(ROOT, deps);

    expect(loadInFlightRef.current.has(ROOT)).toBe(true);

    invalidateBladeViewDataEntriesForPath(
      entriesByRootRef,
      loadInFlightRef,
      ROOT,
      PHP_FILE,
    );

    expect(loadInFlightRef.current.has(ROOT)).toBe(false);

    search.resolve([textResult(PHP_FILE)]);
    await expect(staleLoad).resolves.toHaveLength(1);

    expect(entriesByRootRef.current[ROOT]).toBeUndefined();
  });

  it("drops loaded results after a root switch and does not cache them", async () => {
    const currentWorkspaceRootRef = { current: ROOT };
    const entriesByRootRef: BladeViewDataCacheRef = { current: {} };
    const loadInFlightRef: BladeViewDataInFlightRef = { current: new Map() };
    const searchText = vi.fn(async () => [textResult(PHP_FILE)]);
    const readNavigationFileContent = vi.fn(async () => {
      currentWorkspaceRootRef.current = OTHER_ROOT;

      return invoiceControllerSource;
    });
    const deps = makeDeps({
      currentWorkspaceRootRef,
      entriesByRootRef,
      loadInFlightRef,
      readNavigationFileContent,
      textSearch: { searchText },
    });

    await expect(
      ensureBladeViewDataEntriesLoaded(ROOT, deps),
    ).resolves.toBeNull();

    expect(searchText.mock.calls.length).toBeGreaterThan(0);
    expect(readNavigationFileContent).toHaveBeenCalledTimes(1);
    expect(entriesByRootRef.current[ROOT]).toBeUndefined();
    expect(loadInFlightRef.current.has(ROOT)).toBe(false);
  });
});
