// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { FileEntry, WorkspaceFileGateway } from "../domain/workspace";
import {
  phpLaravelMigrationSourcesSignature,
} from "./phpLaravelMigrationSources";
import {
  phpLaravelProviderSourcesSignature,
} from "./phpLaravelProviderSources";
import {
  useLaravelSourceRegistries,
  type LaravelSourceRegistries,
  type UseLaravelSourceRegistriesDependencies,
} from "./useLaravelSourceRegistries";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const OTHER_ROOT = "/other-workspace";
const MIGRATION_PATH = `${ROOT}/database/migrations/2026_07_05_000000_create_posts.php`;
const PROVIDER_PATH = `${ROOT}/app/Providers/AppServiceProvider.php`;
const MIGRATION_SOURCE = "<?php Schema::create('posts', fn () => null);";
const PROVIDER_SOURCE = "<?php Builder::macro('published', fn () => $this);";

type LaravelSourceRegistryTestDependencies =
  UseLaravelSourceRegistriesDependencies;

function fileEntry(path: string): FileEntry {
  return { name: path.split("/").pop() ?? path, path, kind: "file" };
}

function makeWorkspaceFiles(
  overrides: Partial<
    Pick<WorkspaceFileGateway, "readDirectory" | "readTextFile">
  > = {},
): Pick<WorkspaceFileGateway, "readDirectory" | "readTextFile"> {
  return {
    readDirectory: vi.fn(async (path: string) => {
      if (path === `${ROOT}/database/migrations`) {
        return [fileEntry(MIGRATION_PATH)];
      }

      if (path === `${ROOT}/app/Providers`) {
        return [fileEntry(PROVIDER_PATH)];
      }

      return [];
    }),
    readTextFile: vi.fn(async (path: string) => {
      if (path === MIGRATION_PATH) {
        return MIGRATION_SOURCE;
      }

      if (path === PROVIDER_PATH) {
        return PROVIDER_SOURCE;
      }

      throw new Error(`Unexpected read: ${path}`);
    }),
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<LaravelSourceRegistryTestDependencies> = {},
): LaravelSourceRegistryTestDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    isActive: true,
    onSourcesLoaded: vi.fn(),
    workspaceFiles: makeWorkspaceFiles(),
    ...overrides,
  };
}

function renderHook(deps: LaravelSourceRegistryTestDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: LaravelSourceRegistries | null } = { api: null };

  function Harness({
    dependencies,
  }: {
    dependencies: LaravelSourceRegistryTestDependencies;
  }) {
    captured.api = useLaravelSourceRegistries(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): LaravelSourceRegistries => {
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

describe("useLaravelSourceRegistries", () => {
  it("combines loaded migration and provider sources for the active root", async () => {
    const deps = makeDeps();
    const harness = renderHook(deps);

    await harness.api().ensurePhpLaravelMigrationSourcesLoaded(ROOT);
    await harness.api().ensurePhpLaravelProviderSourcesLoaded(ROOT);

    expect(harness.api().currentPhpLaravelSourceContext()).toEqual({
      signature: [
        `m:${phpLaravelMigrationSourcesSignature([MIGRATION_SOURCE])}`,
        `p:${phpLaravelProviderSourcesSignature([PROVIDER_SOURCE])}`,
      ].join("|"),
      workspaceSources: [MIGRATION_SOURCE, PROVIDER_SOURCE],
    });
    expect(deps.onSourcesLoaded).toHaveBeenCalledTimes(2);
    expect(deps.onSourcesLoaded).toHaveBeenCalledWith(ROOT);

    harness.unmount();
  });

  it("reloads only after invalidating a matching Laravel source path", async () => {
    const readDirectory = vi.fn(makeWorkspaceFiles().readDirectory);
    const deps = makeDeps({
      workspaceFiles: {
        ...makeWorkspaceFiles(),
        readDirectory,
      },
    });
    const harness = renderHook(deps);

    await harness.api().ensurePhpLaravelMigrationSourcesLoaded(ROOT);
    await harness.api().ensurePhpLaravelMigrationSourcesLoaded(ROOT);
    expect(readDirectory).toHaveBeenCalledTimes(1);

    harness.api().invalidatePhpLaravelMigrationSourcesForPath(
      ROOT,
      `${ROOT}/app/Models/Post.php`,
    );
    await harness.api().ensurePhpLaravelMigrationSourcesLoaded(ROOT);
    expect(readDirectory).toHaveBeenCalledTimes(1);

    harness.api().invalidatePhpLaravelMigrationSourcesForPath(
      ROOT,
      MIGRATION_PATH,
    );
    await harness.api().ensurePhpLaravelMigrationSourcesLoaded(ROOT);
    expect(readDirectory).toHaveBeenCalledTimes(2);

    harness.unmount();
  });

  it("drops an in-flight load when the active workspace root changes", async () => {
    const migrationDirectoryRead = deferred<FileEntry[]>();
    const currentWorkspaceRootRef = { current: ROOT };
    const deps = makeDeps({
      currentWorkspaceRootRef,
      workspaceFiles: makeWorkspaceFiles({
        readDirectory: vi.fn(async (path: string) => {
          if (path === `${ROOT}/database/migrations`) {
            return migrationDirectoryRead.promise;
          }

          return [];
        }),
      }),
    });
    const harness = renderHook(deps);
    const loading = harness.api().ensurePhpLaravelMigrationSourcesLoaded(ROOT);

    currentWorkspaceRootRef.current = OTHER_ROOT;
    migrationDirectoryRead.resolve([fileEntry(MIGRATION_PATH)]);
    await loading;

    expect(harness.api().currentPhpLaravelSourceContext()).toEqual({
      signature: "m:|p:",
      workspaceSources: [],
    });
    expect(deps.onSourcesLoaded).not.toHaveBeenCalled();

    harness.unmount();
  });
});
