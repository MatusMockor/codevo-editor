// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { usePhpClassHierarchyPredicates } from "./usePhpClassHierarchyPredicates";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";

type HookOptions = Parameters<typeof usePhpClassHierarchyPredicates>[0];
type HookApi = ReturnType<typeof usePhpClassHierarchyPredicates>;

interface ClassSource {
  members?: PhpMethodCompletion[];
  source: string;
}

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

function methodMember(
  name: string,
  overrides: Partial<PhpMethodCompletion> = {},
): PhpMethodCompletion {
  return {
    declaringClassName: "App\\Models\\User",
    name,
    parameters: "",
    returnType: "void",
    visibility: "public",
    ...overrides,
  };
}

function classPath(className: string): string {
  return `${ROOT}/${className.split("\\").join("/")}.php`;
}

function makeOptions(
  classes: Record<string, ClassSource>,
  overrides: Partial<HookOptions> = {},
): HookOptions {
  const currentWorkspaceRootRef = { current: ROOT };
  const pathToClassName = new Map(
    Object.keys(classes).map((className) => [classPath(className), className]),
  );

  return {
    currentWorkspaceRootRef,
    readPhpClassMembersFromPath: vi.fn(async (path: string) => {
      const className = pathToClassName.get(path);

      if (!className) {
        throw new Error(`Missing class source for ${path}`);
      }

      const entry = classes[className];

      if (!entry) {
        throw new Error(`Missing class entry for ${className}`);
      }

      return {
        content: entry.source,
        members: entry.members ?? [],
      };
    }),
    resolvePhpClassReference: (_source, className) =>
      className.trim().replace(/^\\+/, "") || null,
    resolvePhpClassSourcePaths: vi.fn(async (className: string) => {
      const normalizedClassName = className.trim().replace(/^\\+/, "");

      return classes[normalizedClassName] ? [classPath(normalizedClassName)] : [];
    }),
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
    captured.api = usePhpClassHierarchyPredicates(hookOptions);
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });

  return { promise, resolve };
}

describe("usePhpClassHierarchyPredicates", () => {
  it("finds directly declared methods, properties, and constants", async () => {
    const harness = renderHook(
      makeOptions({
        "App\\Models\\User": {
          source: `<?php
namespace App\\Models;

class User
{
    /** @property-read string $email */
    public string $name;
    public const TABLE = 'users';

    public function activate(): void {}
}
`,
        },
      }),
    );

    await expect(
      harness.api().phpClassHierarchyHasMethod("App\\Models\\User", "activate"),
    ).resolves.toBe(true);
    await expect(
      harness.api().phpClassHierarchyHasProperty("App\\Models\\User", "$name"),
    ).resolves.toBe(true);
    await expect(
      harness.api().phpClassHierarchyHasProperty("App\\Models\\User", "email"),
    ).resolves.toBe(true);
    await expect(
      harness.api().phpClassHierarchyHasConstant("App\\Models\\User", "TABLE"),
    ).resolves.toBe(true);

    harness.unmount();
  });

  it("treats property names as case-sensitive", async () => {
    const harness = renderHook(
      makeOptions({
        "App\\Models\\Comment": {
          members: [methodMember("name", { kind: "property" })],
          source: `<?php
namespace App\\Models;

class Comment
{
    private string $name;
}
`,
        },
      }),
    );

    await expect(
      harness.api().phpClassHierarchyHasProperty("App\\Models\\Comment", "name"),
    ).resolves.toBe(true);
    await expect(
      harness.api().phpClassHierarchyHasProperty("App\\Models\\Comment", "Name"),
    ).resolves.toBe(false);

    harness.unmount();
  });

  it("treats constant names as case-sensitive", async () => {
    const harness = renderHook(
      makeOptions({
        "App\\Models\\Comment": {
          source: `<?php
namespace App\\Models;

class Comment
{
    public const STATUS = 'approved';
}
`,
        },
      }),
    );

    await expect(
      harness
        .api()
        .phpClassHierarchyHasConstant("App\\Models\\Comment", "STATUS"),
    ).resolves.toBe(true);
    await expect(
      harness
        .api()
        .phpClassHierarchyHasConstant("App\\Models\\Comment", "Status"),
    ).resolves.toBe(false);

    harness.unmount();
  });

  it("keeps method lookups case-insensitive", async () => {
    const harness = renderHook(
      makeOptions({
        "App\\Models\\Comment": {
          members: [methodMember("approveNow")],
          source: `<?php
namespace App\\Models;

class Comment
{
    public function approveNow(): void {}
}
`,
        },
      }),
    );

    await expect(
      harness
        .api()
        .phpClassHierarchyHasMethod("App\\Models\\Comment", "approvenow"),
    ).resolves.toBe(true);

    harness.unmount();
  });

  it("traverses parent classes, implemented interfaces, and used traits", async () => {
    const harness = renderHook(
      makeOptions({
        "App\\Contracts\\HasUuid": {
          source: `<?php
namespace App\\Contracts;

interface HasUuid
{
    public const UUID_COLUMN = 'uuid';
}
`,
        },
        "App\\Models\\BaseUser": {
          source: `<?php
namespace App\\Models;

class BaseUser
{
    public function baseMethod(): void {}
}
`,
        },
        "App\\Models\\User": {
          source: `<?php
namespace App\\Models;

class User extends \\App\\Models\\BaseUser implements \\App\\Contracts\\HasUuid
{
    use \\App\\Traits\\HasAudit;
}
`,
        },
        "App\\Traits\\HasAudit": {
          source: `<?php
namespace App\\Traits;

trait HasAudit
{
    protected string $auditTrail;
}
`,
        },
      }),
    );

    await expect(
      harness.api().phpClassHierarchyHasMethod("App\\Models\\User", "baseMethod"),
    ).resolves.toBe(true);
    await expect(
      harness.api().phpClassHierarchyHasProperty(
        "App\\Models\\User",
        "auditTrail",
      ),
    ).resolves.toBe(true);
    await expect(
      harness.api().phpClassHierarchyHasConstant(
        "App\\Models\\User",
        "UUID_COLUMN",
      ),
    ).resolves.toBe(true);

    harness.unmount();
  });

  it("returns false when the workspace root changes after class path resolution", async () => {
    const sourcePaths = createDeferred<string[]>();
    const readPhpClassMembersFromPath = vi.fn();
    const options = makeOptions(
      {
        "App\\Models\\User": {
          source: `<?php class User { public function activate(): void {} }`,
        },
      },
      {
        readPhpClassMembersFromPath,
        resolvePhpClassSourcePaths: vi.fn(() => sourcePaths.promise),
      },
    );
    const harness = renderHook(options);
    const result = harness
      .api()
      .phpClassHierarchyHasMethod("App\\Models\\User", "activate");

    options.currentWorkspaceRootRef.current = "/other";
    sourcePaths.resolve([classPath("App\\Models\\User")]);

    await expect(result).resolves.toBe(false);
    expect(readPhpClassMembersFromPath).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("returns false when the workspace root changes after class source read", async () => {
    const sourceRead = createDeferred<{
      content: string;
      members: PhpMethodCompletion[];
    }>();
    const options = makeOptions(
      {
        "App\\Models\\User": {
          source: "",
        },
      },
      {
        readPhpClassMembersFromPath: vi.fn(() => sourceRead.promise),
      },
    );
    const harness = renderHook(options);
    const result = harness
      .api()
      .phpClassHierarchyHasMethod("App\\Models\\User", "activate");

    options.currentWorkspaceRootRef.current = "/other";
    sourceRead.resolve({
      content: `<?php class User { public function activate(): void {} }`,
      members: [],
    });

    await expect(result).resolves.toBe(false);

    harness.unmount();
  });

  it("distinguishes static method checks from instance methods", async () => {
    const harness = renderHook(
      makeOptions({
        "App\\Models\\User": {
          members: [
            methodMember("booted", { isStatic: true }),
            methodMember("activate"),
          ],
          source: `<?php
namespace App\\Models;

class User
{
    public function activate(): void {}
    public static function booted(): void {}
}
`,
        },
      }),
    );

    await expect(
      harness
        .api()
        .phpClassHierarchyHasStaticMethod("App\\Models\\User", "activate"),
    ).resolves.toBe(false);
    await expect(
      harness
        .api()
        .phpClassHierarchyHasStaticMethod("App\\Models\\User", "booted"),
    ).resolves.toBe(true);

    harness.unmount();
  });
});
