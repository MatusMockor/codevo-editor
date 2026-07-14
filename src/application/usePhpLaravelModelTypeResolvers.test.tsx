// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import { resolvePhpClassName } from "../domain/phpNavigation";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { usePhpLaravelModelTypeResolvers } from "./usePhpLaravelModelTypeResolvers";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
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
const STALE_LEGACY_LARAVEL_RUNTIME = {
  ...GENERIC_RUNTIME,
  isLaravel: true,
  providers: [],
  hasProvider: () => false,
};

type HookOptions = Parameters<typeof usePhpLaravelModelTypeResolvers>[0];
type HookApi = ReturnType<typeof usePhpLaravelModelTypeResolvers>;

function phpDescriptor(rootPath = ROOT): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: {
      classmapRoots: [],
      hasComposer: true,
      packageName: null,
      packages: [],
      phpPlatformVersion: null,
      phpVersionConstraint: null,
      psr4Roots: [],
    },
    rootPath,
  };
}

function classPath(className: string): string {
  return `${ROOT}/${className.split("\\").join("/")}.php`;
}

function makeOptions(
  classes: Record<string, string | Promise<string>>,
  overrides: Partial<HookOptions> = {},
): HookOptions {
  const currentWorkspaceRootRef = { current: ROOT };
  const sourcesByPath = new Map(
    Object.entries(classes).map(([className, source]) => [
      classPath(className),
      source,
    ]),
  );

  return {
    currentWorkspaceRootRef,
    frameworkRuntime: LARAVEL_RUNTIME,
    phpClassHasLaravelDynamicWhere: vi.fn(async () => false),
    phpClassHasLaravelLocalScope: vi.fn(async () => false),
    readNavigationFileContent: vi.fn(async (path: string) => {
      const source = sourcesByPath.get(path);

      if (source === undefined) {
        throw new Error(`Missing class source for ${path}`);
      }

      return source;
    }),
    resolvePhpClassPropertyOrRelationType: vi.fn(async () => null),
    resolvePhpClassReference: (source, className) =>
      resolvePhpClassName(source, className),
    resolvePhpClassSourcePaths: vi.fn(async (className: string) => {
      const normalizedClassName = className.trim().replace(/^\\+/, "");

      return sourcesByPath.has(classPath(normalizedClassName))
        ? [classPath(normalizedClassName)]
        : [];
    }),
    resolvePhpLaravelMethodGenericModelType: vi.fn(async () => null),
    resolvePhpLaravelRelationPathOwnerType: vi.fn(async () => null),
    resolvePhpMethodReturnType: vi.fn(async () => null),
    workspaceDescriptor: phpDescriptor(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(options: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: HookApi | null } = { api: null };

  function Harness({ hookOptions }: { hookOptions: HookOptions }) {
    captured.api = usePhpLaravelModelTypeResolvers(hookOptions);
    return null;
  }

  act(() => {
    root.render(<Harness hookOptions={options} />);
  });

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("hook not mounted");
      }

      return captured.api;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function positionAfter(source: string, needle: string): EditorPosition {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing marker ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split("\n");

  return {
    column: lines[lines.length - 1]?.length ?? 0,
    lineNumber: lines.length,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });

  return { promise, resolve };
}

describe("usePhpLaravelModelTypeResolvers", () => {
  it("uses runtime Laravel state for the Laravel gate", async () => {
    const source = `<?php
$query->whereEmail('a@example.com');
`;
    const phpClassHasLaravelDynamicWhere = vi.fn(async () => true);
    const options = makeOptions(
      {},
      {
        frameworkRuntime: GENERIC_RUNTIME,
        phpClassHasLaravelDynamicWhere,
      },
    );
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpEloquentBuilderModelType(
          source,
          positionAfter(source, "$query->whereEmail"),
          "$query->whereEmail('a@example.com')",
        ),
    ).resolves.toBeNull();

    expect(phpClassHasLaravelDynamicWhere).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("ignores stale legacy Laravel state for builder model resolution", async () => {
    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\User;

class UserController
{
    public function index(): void
    {
        $user = User::whereEmail('a@example.com')->first();
    }
}
`;
    const options = makeOptions(
      {},
      {
        frameworkRuntime: STALE_LEGACY_LARAVEL_RUNTIME,
        phpClassHasLaravelDynamicWhere: vi.fn(async () => true),
        phpClassHasLaravelLocalScope: vi.fn(async () => true),
        resolvePhpClassPropertyOrRelationType: vi.fn(async () => "App\\Models\\User"),
        resolvePhpLaravelMethodGenericModelType: vi.fn(
          async () => "App\\Models\\User",
        ),
        resolvePhpLaravelRelationPathOwnerType: vi.fn(
          async () => "App\\Models\\User",
        ),
        resolvePhpMethodReturnType: vi.fn(async () => "App\\Models\\User"),
      },
    );
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpEloquentBuilderModelType(
          source,
          positionAfter(source, "User::whereEmail"),
          "User::whereEmail('a@example.com')->first()",
        ),
    ).resolves.toBeNull();

    expect(options.phpClassHasLaravelDynamicWhere).not.toHaveBeenCalled();
    expect(options.phpClassHasLaravelLocalScope).not.toHaveBeenCalled();
    expect(options.resolvePhpLaravelMethodGenericModelType).not.toHaveBeenCalled();
    expect(options.resolvePhpClassPropertyOrRelationType).not.toHaveBeenCalled();
    expect(options.resolvePhpLaravelRelationPathOwnerType).not.toHaveBeenCalled();
    expect(options.resolvePhpMethodReturnType).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("ignores stale legacy Laravel state for collection model resolution", async () => {
    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Collections\\AlbumCollection;

class AlbumController
{
    public function index(): void
    {
        /** @var AlbumCollection $albums */
        $album = $albums->first();
    }
}
`;
    const options = makeOptions(
      {
        "App\\Collections\\AlbumCollection": `<?php
namespace App\\Collections;

use App\\Models\\Album;
use Illuminate\\Database\\Eloquent\\Collection;

/** @phpstan-extends Collection<int, Album> */
class AlbumCollection extends Collection
{
}
`,
      },
      {
        frameworkRuntime: STALE_LEGACY_LARAVEL_RUNTIME,
        resolvePhpLaravelMethodGenericModelType: vi.fn(
          async () => "App\\Models\\Album",
        ),
      },
    );
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpLaravelCollectionModelType(
          source,
          positionAfter(source, "$albums->first"),
          "$albums",
        ),
    ).resolves.toBeNull();

    expect(options.resolvePhpClassSourcePaths).not.toHaveBeenCalled();
    expect(options.readNavigationFileContent).not.toHaveBeenCalled();
    expect(options.resolvePhpLaravelMethodGenericModelType).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("resolves a model from a custom collection PHPDoc generic", async () => {
    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Collections\\AlbumCollection;

class AlbumController
{
    public function index(): void
    {
        /** @var AlbumCollection $albums */
        $album = $albums->first();
    }
}
`;
    const options = makeOptions({
      "App\\Collections\\AlbumCollection": `<?php
namespace App\\Collections;

use App\\Models\\Album;
use Illuminate\\Database\\Eloquent\\Collection;

/** @phpstan-extends Collection<int, Album> */
class AlbumCollection extends Collection
{
}
`,
    });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpLaravelCollectionModelType(
          source,
          positionAfter(source, "$albums->first"),
          "$albums",
        ),
    ).resolves.toBe("App\\Models\\Album");

    expect(options.readNavigationFileContent).toHaveBeenCalledWith(
      classPath("App\\Collections\\AlbumCollection"),
    );

    harness.unmount();
  });

  it("resolves a model from parent collection traversal", async () => {
    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Collections\\AlbumCollection;

class AlbumController
{
    public function index(): void
    {
        /** @var AlbumCollection $albums */
        $album = $albums->first();
    }
}
`;
    const options = makeOptions({
      "App\\Collections\\AlbumCollection": `<?php
namespace App\\Collections;

class AlbumCollection extends BaseAlbumCollection
{
}
`,
      "App\\Collections\\BaseAlbumCollection": `<?php
namespace App\\Collections;

use App\\Models\\Album;
use Illuminate\\Database\\Eloquent\\Collection;

/** @phpstan-extends Collection<int, Album> */
class BaseAlbumCollection extends Collection
{
}
`,
    });
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .resolvePhpLaravelCollectionModelType(
          source,
          positionAfter(source, "$albums->first"),
          "$albums",
        ),
    ).resolves.toBe("App\\Models\\Album");

    expect(options.readNavigationFileContent).toHaveBeenCalledWith(
      classPath("App\\Collections\\AlbumCollection"),
    );
    expect(options.readNavigationFileContent).toHaveBeenCalledWith(
      classPath("App\\Collections\\BaseAlbumCollection"),
    );

    harness.unmount();
  });

  it("returns null when the workspace root changes after collection source read", async () => {
    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Collections\\AlbumCollection;

class AlbumController
{
    public function index(): void
    {
        /** @var AlbumCollection $albums */
        $album = $albums->first();
    }
}
`;
    const collectionRead = createDeferred<string>();
    const options = makeOptions({
      "App\\Collections\\AlbumCollection": collectionRead.promise,
      "App\\Collections\\BaseAlbumCollection": `<?php
namespace App\\Collections;

/** @phpstan-extends \\Illuminate\\Database\\Eloquent\\Collection<int, \\App\\Models\\Album> */
class BaseAlbumCollection
{
}
`,
    });
    const harness = renderHook(options);
    const modelTypePromise = harness
      .api()
      .resolvePhpLaravelCollectionModelType(
        source,
        positionAfter(source, "$albums->first"),
        "$albums",
      );

    await vi.waitFor(() => {
      expect(options.readNavigationFileContent).toHaveBeenCalledWith(
        classPath("App\\Collections\\AlbumCollection"),
      );
    });

    options.currentWorkspaceRootRef.current = "/other-workspace";
    collectionRead.resolve(`<?php
namespace App\\Collections;

class AlbumCollection extends BaseAlbumCollection
{
}
`);

    await expect(modelTypePromise).resolves.toBeNull();
    expect(options.readNavigationFileContent).not.toHaveBeenCalledWith(
      classPath("App\\Collections\\BaseAlbumCollection"),
    );

    harness.unmount();
  });
});
