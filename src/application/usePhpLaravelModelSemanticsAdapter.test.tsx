import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { resolvePhpClassName } from "../domain/phpNavigation";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type {
  PhpModelSemanticsAdapter,
  PhpModelSemanticsAdapterDependencies,
} from "./phpModelSemanticsAdapter";
import { usePhpLaravelModelSemanticsAdapter } from "./usePhpLaravelModelSemanticsAdapter";

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

const USER_CLASS_SOURCE = `<?php
namespace App\\Models;

use App\\Models\\Post;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;

class User
{
    public function author(): BelongsTo
    {
        return $this->belongsTo(Post::class);
    }
}
`;

function phpDescriptor(): WorkspaceDescriptor {
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
    rootPath: ROOT,
  };
}

function userMembers(): PhpMethodCompletion[] {
  return [
    {
      declaringClassName: "App\\Models\\User",
      name: "author",
      parameters: "",
      returnType: "BelongsTo<Post>",
    },
  ];
}

function makeDependencies(
  overrides: Partial<PhpModelSemanticsAdapterDependencies> = {},
): PhpModelSemanticsAdapterDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    frameworkRuntime: LARAVEL_RUNTIME,
    phpClassHasDynamicBuilderFinder: vi.fn(async () => false),
    phpClassHasNamedBuilderScope: vi.fn(async () => false),
    readNavigationFileContent: vi.fn(async () => USER_CLASS_SOURCE),
    readPhpClassMembersFromPath: vi.fn(async () => ({
      content: USER_CLASS_SOURCE,
      members: userMembers(),
    })),
    resolvePhpClassReference: (source, className) =>
      resolvePhpClassName(source, className),
    resolvePhpClassSourcePaths: vi.fn(async () => [
      `${ROOT}/app/Models/User.php`,
    ]),
    resolvePhpDeclaredType: () => null,
    resolvePhpFrameworkProjectMorphMapModelType: vi.fn(async () => null),
    resolvePhpGenericTemplateTypesForInheritedClass: vi.fn(
      async () => new Map<string, string>(),
    ),
    resolvePhpGenericTemplateTypesForMixinClass: vi.fn(
      async () => new Map<string, string>(),
    ),
    resolvePhpMethodReturnType: vi.fn(async () => null),
    workspaceDescriptor: phpDescriptor(),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(dependencies: PhpModelSemanticsAdapterDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpModelSemanticsAdapter | null } = { api: null };

  function Harness({
    hookOptions,
  }: {
    hookOptions: PhpModelSemanticsAdapterDependencies;
  }) {
    captured.api = usePhpLaravelModelSemanticsAdapter(hookOptions);
    return null;
  }

  act(() => {
    root.render(<Harness hookOptions={dependencies} />);
  });

  return {
    api: (): PhpModelSemanticsAdapter => {
      expect(captured.api).not.toBeNull();

      return captured.api as PhpModelSemanticsAdapter;
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

  expect(offset).toBeGreaterThanOrEqual(0);

  const lines = source.slice(0, offset + needle.length).split("\n");

  return {
    column: lines[lines.length - 1]?.length ?? 0,
    lineNumber: lines.length,
  };
}

describe("usePhpLaravelModelSemanticsAdapter", () => {
  it("resolves the builder model type for a static builder call", async () => {
    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\User;

class UserController
{
    public function index(): void
    {
        $users = User::query();
    }
}
`;
    const harness = renderHook(makeDependencies());

    await expect(
      harness
        .api()
        .resolveModelBuilderModelType(
          source,
          positionAfter(source, "User::query"),
          "User::query()",
        ),
    ).resolves.toBe("App\\Models\\User");

    harness.unmount();
  });

  it("returns null for builder resolution without eloquent model semantics", async () => {
    const source = `<?php
use App\\Models\\User;
$users = User::query();
`;
    const harness = renderHook(
      makeDependencies({ frameworkRuntime: GENERIC_RUNTIME }),
    );

    await expect(
      harness
        .api()
        .resolveModelBuilderModelType(
          source,
          positionAfter(source, "User::query"),
          "User::query()",
        ),
    ).resolves.toBeNull();

    harness.unmount();
  });

  it("resolves a relation type from class members", async () => {
    const harness = renderHook(makeDependencies());

    await expect(
      harness
        .api()
        .resolveModelPropertyOrRelationType("App\\Models\\User", "author"),
    ).resolves.toBe("App\\Models\\Post");

    harness.unmount();
  });

  it("resolves a relation path owner type across relation segments", async () => {
    const harness = renderHook(makeDependencies());

    await expect(
      harness
        .api()
        .resolveModelRelationPathOwnerType("App\\Models\\User", ["author"]),
    ).resolves.toBe("App\\Models\\Post");

    harness.unmount();
  });

  it("resolves a collection model type from a PHPDoc collection generic", async () => {
    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;
use Illuminate\\Support\\Collection;

class AlbumController
{
    public function index(): void
    {
        /** @var Collection<int, Album> $albums */
        $album = $albums->first();
    }
}
`;
    const harness = renderHook(makeDependencies());

    await expect(
      harness
        .api()
        .resolveModelCollectionModelType(
          source,
          positionAfter(source, "$albums->first"),
          "$albums",
        ),
    ).resolves.toBe("App\\Models\\Album");

    harness.unmount();
  });
});
