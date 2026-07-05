// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TextSearchResult } from "../domain/workspace";
import { usePhpTraitHostPredicates } from "./usePhpTraitHostPredicates";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";

type HookOptions = Parameters<typeof usePhpTraitHostPredicates>[0];
type HookApi = ReturnType<typeof usePhpTraitHostPredicates>;

function classPath(className: string): string {
  return `${ROOT}/${className.split("\\").join("/")}.php`;
}

function searchResult(path: string, query: string): TextSearchResult {
  return {
    column: 1,
    lineNumber: 1,
    lineText: query,
    path,
    relativePath: path.slice(ROOT.length + 1),
  };
}

function makeOptions(
  sources: Record<string, string>,
  overrides: Partial<HookOptions> = {},
): HookOptions {
  const currentWorkspaceRootRef = { current: ROOT };
  const pathToSource = new Map(
    Object.entries(sources).map(([className, source]) => [
      classPath(className),
      source,
    ]),
  );

  return {
    currentWorkspaceRootRef,
    isPhpPath: (path) => path.endsWith(".php"),
    phpClassHierarchyHasConstant: vi.fn(async () => false),
    phpClassHierarchyHasMethod: vi.fn(async () => false),
    phpClassHierarchyHasProperty: vi.fn(async () => false),
    readNavigationFileContent: vi.fn(async (path: string) => {
      const source = pathToSource.get(path);

      if (source === undefined) {
        throw new Error(`Missing source for ${path}`);
      }

      return source;
    }),
    resolvePhpClassPropertyOrRelationType: vi.fn(async () => null),
    resolvePhpClassReference: (_source, className) =>
      className.trim().replace(/^\\+/, "") || null,
    searchText: vi.fn(async (_root: string, query: string) =>
      Array.from(pathToSource.entries())
        .filter(([path, source]) => path.includes(query) || source.includes(query))
        .map(([path]) => searchResult(path, query)),
    ),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function renderHook(options: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: HookApi | null } = { api: null };

  function Harness({ hookOptions }: { hookOptions: HookOptions }) {
    captured.api = usePhpTraitHostPredicates(hookOptions);
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

describe("usePhpTraitHostPredicates", () => {
  it("finds a method on a concrete class using the trait", async () => {
    const options = makeOptions(
      {
        "App\\Models\\Post": `<?php
namespace App\\Models;

class Post
{
    use \\App\\Traits\\HasSlugs;
}
`,
      },
      {
        phpClassHierarchyHasMethod: vi.fn(async (className, methodName) =>
          className === "App\\Models\\Post" && methodName === "slug",
        ),
      },
    );
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .phpTraitHostMethodExists("App\\Traits\\HasSlugs", "slug"),
    ).resolves.toBe(true);

    harness.unmount();
  });

  it("finds a property on a concrete class using the trait", async () => {
    const options = makeOptions(
      {
        "App\\Models\\Post": `<?php
namespace App\\Models;

class Post
{
    use \\App\\Traits\\HasMetadata;
}
`,
      },
      {
        phpClassHierarchyHasProperty: vi.fn(async (className, propertyName) =>
          className === "App\\Models\\Post" && propertyName === "metadata",
        ),
      },
    );
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .phpTraitHostPropertyExists("App\\Traits\\HasMetadata", "$metadata"),
    ).resolves.toBe(true);

    harness.unmount();
  });

  it("resolves a trait host property type and checks that class hierarchy for the method", async () => {
    const options = makeOptions(
      {
        "App\\Models\\Post": `<?php
namespace App\\Models;

class Post
{
    use \\App\\Traits\\FormatsTitles;
}
`,
      },
      {
        phpClassHierarchyHasMethod: vi.fn(async (className, methodName) =>
          className === "App\\Support\\TitleFormatter" &&
          methodName === "format",
        ),
        resolvePhpClassPropertyOrRelationType: vi.fn(
          async (className, propertyName) =>
            className === "App\\Models\\Post" && propertyName === "formatter"
              ? "App\\Support\\TitleFormatter"
              : null,
        ),
      },
    );
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .phpTraitHostPropertyMethodExists(
          "App\\Traits\\FormatsTitles",
          "$formatter",
          "format",
        ),
    ).resolves.toBe(true);

    expect(options.resolvePhpClassPropertyOrRelationType).toHaveBeenCalledWith(
      "App\\Models\\Post",
      "formatter",
    );
    expect(options.phpClassHierarchyHasMethod).toHaveBeenCalledWith(
      "App\\Support\\TitleFormatter",
      "format",
    );

    harness.unmount();
  });

  it("finds a constant on a concrete class using the trait", async () => {
    const options = makeOptions(
      {
        "App\\Enums\\PostStatus": `<?php
namespace App\\Enums;

enum PostStatus
{
    use \\App\\Traits\\HasLabels;
}
`,
      },
      {
        phpClassHierarchyHasConstant: vi.fn(async (className, constantName) =>
          className === "App\\Enums\\PostStatus" &&
          constantName === "DEFAULT_LABEL",
        ),
      },
    );
    const harness = renderHook(options);

    await expect(
      harness
        .api()
        .phpTraitHostConstantExists(
          "App\\Traits\\HasLabels",
          "DEFAULT_LABEL",
        ),
    ).resolves.toBe(true);

    harness.unmount();
  });

  it("returns false when the workspace root changes after text search", async () => {
    const textSearch = createDeferred<TextSearchResult[]>();
    const options = makeOptions(
      {
        "App\\Models\\Post": `<?php
namespace App\\Models;

class Post
{
    use \\App\\Traits\\HasSlugs;
}
`,
      },
      {
        searchText: vi.fn(() => textSearch.promise),
      },
    );
    const harness = renderHook(options);
    const result = harness
      .api()
      .phpTraitHostMethodExists("App\\Traits\\HasSlugs", "slug");

    options.currentWorkspaceRootRef.current = "/other";
    textSearch.resolve([searchResult(classPath("App\\Models\\Post"), "HasSlugs")]);

    await expect(result).resolves.toBe(false);
    expect(options.readNavigationFileContent).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("returns false when the workspace root changes after host source read", async () => {
    const hostSourceRead = createDeferred<string>();
    const hostPath = classPath("App\\Models\\Post");
    const options = makeOptions(
      {
        "App\\Models\\Post": `<?php
namespace App\\Models;

class Post
{
    use \\App\\Traits\\HasSlugs;
}
`,
      },
      {
        phpClassHierarchyHasMethod: vi.fn(async () => true),
        readNavigationFileContent: vi.fn(() => hostSourceRead.promise),
        searchText: vi.fn(async () => [
          searchResult(hostPath, "App\\Traits\\HasSlugs"),
        ]),
      },
    );
    const harness = renderHook(options);
    const result = harness
      .api()
      .phpTraitHostMethodExists("App\\Traits\\HasSlugs", "slug");

    await vi.waitFor(() => {
      expect(options.readNavigationFileContent).toHaveBeenCalledWith(hostPath);
    });

    options.currentWorkspaceRootRef.current = "/other";
    hostSourceRead.resolve(`<?php
namespace App\\Models;

class Post
{
    use \\App\\Traits\\HasSlugs;
}
`);

    await expect(result).resolves.toBe(false);
    expect(options.phpClassHierarchyHasMethod).not.toHaveBeenCalled();

    harness.unmount();
  });

  it("returns false when the workspace root changes after trait host property type resolution", async () => {
    const propertyType = createDeferred<string | null>();
    const options = makeOptions(
      {
        "App\\Models\\Post": `<?php
namespace App\\Models;

class Post
{
    use \\App\\Traits\\FormatsTitles;
}
`,
      },
      {
        phpClassHierarchyHasMethod: vi.fn(async () => true),
        resolvePhpClassPropertyOrRelationType: vi.fn(
          () => propertyType.promise,
        ),
      },
    );
    const harness = renderHook(options);
    const result = harness
      .api()
      .phpTraitHostPropertyMethodExists(
        "App\\Traits\\FormatsTitles",
        "$formatter",
        "format",
      );

    await vi.waitFor(() => {
      expect(options.resolvePhpClassPropertyOrRelationType).toHaveBeenCalledWith(
        "App\\Models\\Post",
        "formatter",
      );
    });

    options.currentWorkspaceRootRef.current = "/other";
    propertyType.resolve("App\\Support\\TitleFormatter");

    await expect(result).resolves.toBe(false);
    expect(options.phpClassHierarchyHasMethod).not.toHaveBeenCalled();

    harness.unmount();
  });
});
