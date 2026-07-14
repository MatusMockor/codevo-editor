// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { FileEntry, WorkspaceFileGateway } from "../domain/workspace";
import {
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpFrameworkSourceRegistries,
  type PhpFrameworkSourceRegistries,
  type UsePhpFrameworkSourceRegistriesDependencies,
} from "./usePhpFrameworkSourceRegistries";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const MIGRATION_PATH = `${ROOT}/database/migrations/2026_07_05_000000_create_posts.php`;
const PROVIDER_PATH = `${ROOT}/app/Providers/AppServiceProvider.php`;
const NEON_PATH = `${ROOT}/config/config.neon`;
const MIGRATION_SOURCE = "<?php Schema::create('posts', fn () => null);";
const PROVIDER_SOURCE = "<?php Builder::macro('published', fn () => $this);";
const NEON_SOURCE = "services:\n  App\\Contracts\\Gateway: App\\NetteGateway";
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);
const NETTE_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["nette"],
    profile: "nette",
    providers: [phpNetteFrameworkProvider],
  }),
);
const HYBRID_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel", "nette"],
    profile: "generic",
    providers: [phpLaravelFrameworkProvider, phpNetteFrameworkProvider],
  }),
);

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

      if (path === `${ROOT}/config`) {
        return [fileEntry(NEON_PATH)];
      }

      if (path === `${ROOT}/app/config` || path === `${ROOT}/app/modules`) {
        return [];
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

      if (path === NEON_PATH) {
        return NEON_SOURCE;
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
    frameworkRuntime: LARAVEL_RUNTIME,
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
    rerender: (nextDeps: UsePhpFrameworkSourceRegistriesDependencies) => {
      act(() => {
        root.render(<Harness dependencies={nextDeps} />);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("usePhpFrameworkSourceRegistries", () => {
  it("loads all framework source collections through the runtime-selected provider", async () => {
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

  it("loads Nette NEON sources through the same framework source context", async () => {
    const deps = makeDeps({ frameworkRuntime: NETTE_RUNTIME });
    const harness = renderHook(deps);

    await harness.api().ensurePhpFrameworkSourceCollectionsLoaded(ROOT);

    const sourceContext = harness.api().currentPhpFrameworkSourceContext();
    expect(sourceContext.workspaceSources).toEqual([NEON_SOURCE]);
    expect(sourceContext.signature).toContain("neon:");

    harness.unmount();
  });

  it("merges active framework source providers in registry order", async () => {
    const deps = makeDeps({ frameworkRuntime: HYBRID_RUNTIME });
    const harness = renderHook(deps);

    await harness.api().ensurePhpFrameworkSourceCollectionsLoaded(ROOT);

    expect(harness.api().currentPhpFrameworkSourceContext().workspaceSources).toEqual([
      MIGRATION_SOURCE,
      PROVIDER_SOURCE,
      NEON_SOURCE,
    ]);

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

  it("invalidates inactive provider caches so framework switches cannot restore stale sources", async () => {
    const workspaceFiles = makeWorkspaceFiles();
    const laravelDeps = makeDeps({ workspaceFiles });
    const harness = renderHook(laravelDeps);

    await harness.api().ensurePhpFrameworkSourceCollectionsLoaded(ROOT);
    expect(workspaceFiles.readDirectory).toHaveBeenCalledTimes(2);

    harness.rerender(
      makeDeps({
        frameworkRuntime: GENERIC_RUNTIME,
        workspaceFiles,
      }),
    );
    harness.api().invalidatePhpFrameworkSourcePath(ROOT, MIGRATION_PATH);
    await harness.api().ensurePhpFrameworkSourceCollectionsLoaded(ROOT);
    expect(workspaceFiles.readDirectory).toHaveBeenCalledTimes(2);

    harness.rerender(laravelDeps);
    await harness.api().ensurePhpFrameworkSourceCollectionsLoaded(ROOT);
    expect(workspaceFiles.readDirectory).toHaveBeenCalledTimes(3);

    harness.unmount();
  });

  it("keeps generic runtime inert without a Laravel source signature", async () => {
    const workspaceFiles = makeWorkspaceFiles();
    const deps = makeDeps({
      frameworkRuntime: GENERIC_RUNTIME,
      workspaceFiles,
    });
    const harness = renderHook(deps);

    await harness.api().ensurePhpFrameworkSourceCollectionsLoaded(ROOT);

    expect(harness.api().currentPhpFrameworkSourceContext()).toEqual({
      signature: "",
      workspaceSources: [],
    });
    expect(workspaceFiles.readDirectory).not.toHaveBeenCalled();
    expect(deps.onSourcesLoaded).not.toHaveBeenCalled();

    harness.unmount();
  });
});
