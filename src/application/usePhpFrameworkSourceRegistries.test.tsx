// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { FileEntry, WorkspaceFileGateway } from "../domain/workspace";
import {
  usePhpFrameworkSourceRegistries,
  type PhpFrameworkSourceRegistries,
  type UsePhpFrameworkSourceRegistriesDependencies,
} from "./usePhpFrameworkSourceRegistries";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const MIGRATION_PATH = `${ROOT}/database/migrations/2026_07_05_000000_create_posts.php`;
const PROVIDER_PATH = `${ROOT}/app/Providers/AppServiceProvider.php`;
const MIGRATION_SOURCE = "<?php Schema::create('posts', fn () => null);";
const PROVIDER_SOURCE = "<?php Builder::macro('published', fn () => $this);";

function fileEntry(path: string): FileEntry {
  return { name: path.split("/").pop() ?? path, path, kind: "file" };
}

function makeWorkspaceFiles(): Pick<
  WorkspaceFileGateway,
  "readDirectory" | "readTextFile"
> {
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
  };
}

function makeDeps(
  overrides: Partial<UsePhpFrameworkSourceRegistriesDependencies> = {},
): UsePhpFrameworkSourceRegistriesDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    isLaravelFrameworkActive: true,
    onSourcesLoaded: vi.fn(),
    workspaceFiles: makeWorkspaceFiles(),
    ...overrides,
  };
}

function renderHook(deps: UsePhpFrameworkSourceRegistriesDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpFrameworkSourceRegistries | null } = { api: null };

  function Harness({
    dependencies,
  }: {
    dependencies: UsePhpFrameworkSourceRegistriesDependencies;
  }) {
    captured.api = usePhpFrameworkSourceRegistries(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpFrameworkSourceRegistries => {
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

describe("usePhpFrameworkSourceRegistries", () => {
  it("loads all framework source collections through the neutral API", async () => {
    const deps = makeDeps();
    const harness = renderHook(deps);

    await harness.api().ensurePhpFrameworkSourceCollectionsLoaded(ROOT);

    const sourceContext = harness.api().currentPhpFrameworkSourceContext();
    expect(sourceContext.workspaceSources).toEqual([
      MIGRATION_SOURCE,
      PROVIDER_SOURCE,
    ]);
    expect(sourceContext.signature).toContain("m:");
    expect(sourceContext.signature).toContain("|p:");
    expect(deps.onSourcesLoaded).toHaveBeenCalledWith(ROOT);

    harness.unmount();
  });

  it("invalidates matching framework source paths through one API", async () => {
    const workspaceFiles = makeWorkspaceFiles();
    const deps = makeDeps({ workspaceFiles });
    const harness = renderHook(deps);

    await harness.api().ensurePhpFrameworkSourceCollectionsLoaded(ROOT);
    expect(workspaceFiles.readDirectory).toHaveBeenCalledTimes(2);

    harness.api().invalidatePhpFrameworkSourcePath(ROOT, MIGRATION_PATH);
    await harness.api().ensurePhpFrameworkSourceCollectionsLoaded(ROOT);
    expect(workspaceFiles.readDirectory).toHaveBeenCalledTimes(3);

    harness.api().invalidatePhpFrameworkSourcePath(ROOT, PROVIDER_PATH);
    await harness.api().ensurePhpFrameworkSourceCollectionsLoaded(ROOT);
    expect(workspaceFiles.readDirectory).toHaveBeenCalledTimes(4);

    harness.unmount();
  });
});
