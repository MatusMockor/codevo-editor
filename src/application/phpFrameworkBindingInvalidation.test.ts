import { describe, expect, it, vi } from "vitest";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { WorkspaceFileChangeEvent } from "../domain/workspaceFileChange";
import {
  createPhpFrameworkBindingFileChangeInvalidator,
  phpFrameworkBindingKnownCandidateChanged,
} from "./phpFrameworkBindingInvalidation";

const ROOT = "/workspace";
const OTHER_ROOT = "/other";
const PHP_PATH = `${ROOT}/app/Provider.php`;

interface Deferred<T> {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function event(
  overrides: Partial<WorkspaceFileChangeEvent> = {},
): WorkspaceFileChangeEvent {
  return {
    rootPath: ROOT,
    kind: "modified",
    path: PHP_PATH,
    relativePath: "app/Provider.php",
    fileKind: "file",
    ...overrides,
  };
}

function provider(): PhpFrameworkProvider {
  return {
    id: "test",
    semantics: {
      containerBindingsFromSource: ({ source }) =>
        source.includes("bind")
          ? [
              {
                abstractClassName: "App\\Contracts\\Service",
                concreteClassName: "App\\Services\\ConcreteService",
              },
            ]
          : [],
      isContainerBindingCandidatePath: ({ path }) =>
        path.endsWith("/config/services.php"),
    },
  };
}

function dependencies(
  overrides: Partial<{
    currentRoot: string | null;
    generation: number;
    providers: readonly PhpFrameworkProvider[];
    readTextFile: (path: string) => Promise<string>;
    supportsConcreteClassNamesFromSource: boolean;
    supportsContainerBindingsFromSource: boolean;
  }> = {},
) {
  const state = {
    currentRoot: overrides.currentRoot ?? ROOT,
    generation: overrides.generation ?? 1,
  };
  const invalidateBindingCache = vi.fn(() => {
    state.generation += 1;
  });
  const readTextFile = vi.fn(
    overrides.readTextFile ?? (async () => "<?php bind();"),
  );

  return {
    state,
    deps: {
      frameworkRuntime: {
        supports: vi.fn((capability: string) => {
          if (capability === "containerBindingsFromSource") {
            return overrides.supportsContainerBindingsFromSource ?? true;
          }

          if (capability === "containerConcreteClassNamesFromSource") {
            return overrides.supportsConcreteClassNamesFromSource ?? false;
          }

          return false;
        }),
      },
      frameworkProviders: overrides.providers ?? [provider()],
      currentRootPath: () => state.currentRoot,
      currentBindingCacheGeneration: () => state.generation,
      invalidateBindingCache,
      isBindingSearchCandidatePath: vi.fn((_path: string) => false),
      readTextFile,
    },
  };
}

describe("phpFrameworkBindingKnownCandidateChanged", () => {
  it("detects resolver-tracked binding search paths", () => {
    const trackedCandidate = vi.fn((path: string) => path === PHP_PATH);

    expect(
      phpFrameworkBindingKnownCandidateChanged(event(), [], trackedCandidate),
    ).toBe(true);
  });

  it("detects provider-owned candidate paths on renames", () => {
    expect(
      phpFrameworkBindingKnownCandidateChanged(
        event({
          path: `${ROOT}/config/other.php`,
          previousPath: `${ROOT}/config/services.php`,
        }),
        [provider()],
        () => false,
      ),
    ).toBe(true);
  });
});

describe("createPhpFrameworkBindingFileChangeInvalidator", () => {
  it("skips unsupported, stale-root, and directory changes", async () => {
    const unsupported = dependencies({
      supportsContainerBindingsFromSource: false,
    });
    createPhpFrameworkBindingFileChangeInvalidator(unsupported.deps)(event());

    const staleRoot = dependencies({ currentRoot: OTHER_ROOT });
    createPhpFrameworkBindingFileChangeInvalidator(staleRoot.deps)(event());

    const directory = dependencies();
    createPhpFrameworkBindingFileChangeInvalidator(directory.deps)(
      event({ fileKind: "directory" }),
    );

    await flushPromises();

    expect(unsupported.deps.invalidateBindingCache).not.toHaveBeenCalled();
    expect(unsupported.deps.readTextFile).not.toHaveBeenCalled();
    expect(staleRoot.deps.invalidateBindingCache).not.toHaveBeenCalled();
    expect(staleRoot.deps.readTextFile).not.toHaveBeenCalled();
    expect(directory.deps.invalidateBindingCache).not.toHaveBeenCalled();
    expect(directory.deps.readTextFile).not.toHaveBeenCalled();
  });

  it("invalidates immediately for known candidate paths", () => {
    const harness = dependencies();
    harness.deps.isBindingSearchCandidatePath = vi.fn(
      (path: string): boolean => path === PHP_PATH,
    );

    createPhpFrameworkBindingFileChangeInvalidator(harness.deps)(event());

    expect(harness.deps.invalidateBindingCache).toHaveBeenCalledOnce();
    expect(harness.deps.readTextFile).not.toHaveBeenCalled();
  });

  it("invalidates PHP changes immediately when concrete class scanning is available", () => {
    const harness = dependencies({
      supportsConcreteClassNamesFromSource: true,
    });

    createPhpFrameworkBindingFileChangeInvalidator(harness.deps)(event());

    expect(harness.deps.invalidateBindingCache).toHaveBeenCalledOnce();
    expect(harness.deps.readTextFile).not.toHaveBeenCalled();
  });

  it("scans PHP source and invalidates when a binding appears", async () => {
    const harness = dependencies({
      readTextFile: async () => "<?php bind();",
    });

    createPhpFrameworkBindingFileChangeInvalidator(harness.deps)(event());
    await flushPromises();

    expect(harness.deps.readTextFile).toHaveBeenCalledWith(PHP_PATH);
    expect(harness.deps.invalidateBindingCache).toHaveBeenCalledOnce();
  });

  it("does not invalidate when scanned PHP source has no bindings", async () => {
    const harness = dependencies({
      readTextFile: async () => "<?php echo 'plain';",
    });

    createPhpFrameworkBindingFileChangeInvalidator(harness.deps)(event());
    await flushPromises();

    expect(harness.deps.invalidateBindingCache).not.toHaveBeenCalled();
  });

  it("invalidates on read failure while the request is still current", async () => {
    const harness = dependencies({
      readTextFile: async () => {
        throw new Error("unreadable");
      },
    });

    createPhpFrameworkBindingFileChangeInvalidator(harness.deps)(event());
    await flushPromises();

    expect(harness.deps.invalidateBindingCache).toHaveBeenCalledOnce();
  });

  it("drops async source scan results after a root switch", async () => {
    const read = createDeferred<string>();
    const harness = dependencies({ readTextFile: () => read.promise });

    createPhpFrameworkBindingFileChangeInvalidator(harness.deps)(event());
    harness.state.currentRoot = OTHER_ROOT;
    read.resolve("<?php bind();");
    await flushPromises();

    expect(harness.deps.invalidateBindingCache).not.toHaveBeenCalled();
  });

  it("drops async source scan results after cache generation changes", async () => {
    const read = createDeferred<string>();
    const harness = dependencies({ readTextFile: () => read.promise });

    createPhpFrameworkBindingFileChangeInvalidator(harness.deps)(event());
    harness.state.generation += 1;
    read.resolve("<?php bind();");
    await flushPromises();

    expect(harness.deps.invalidateBindingCache).not.toHaveBeenCalled();
  });
});
