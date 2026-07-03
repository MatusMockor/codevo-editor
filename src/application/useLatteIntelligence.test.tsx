// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  createLatteIntelligence,
  useLatteIntelligence,
  type LatteDirectoryEntry,
  type LatteIntelligence,
  type LatteIntelligenceDependencies,
  type LatteTemplateCache,
} from "./useLatteIntelligence";

const ROOT = "/ws";

/**
 * Builds an in-memory workspace tree from a list of workspace-relative `.latte`
 * paths so `listDirectory` / `readFileContent` behave like the real gateways
 * (unknown directories / files throw, mirroring the Tauri gateway).
 */
function buildWorkspace(relativePaths: string[], root: string = ROOT) {
  const fileSet = new Set<string>();
  const directories = new Map<string, Map<string, LatteDirectoryEntry>>();

  const ensureDirectory = (directory: string): void => {
    if (!directories.has(directory)) {
      directories.set(directory, new Map());
    }
  };

  for (const relativePath of relativePaths) {
    const absolute = `${root}/${relativePath}`;
    fileSet.add(absolute);

    const segments = relativePath.split("/");
    let directory = root;
    ensureDirectory(directory);

    for (let index = 0; index < segments.length; index += 1) {
      const isFile = index === segments.length - 1;
      const childPath = `${directory}/${segments[index]}`;
      ensureDirectory(directory);
      directories.get(directory)?.set(childPath, {
        kind: isFile ? "file" : "directory",
        path: childPath,
      });
      directory = childPath;

      if (!isFile) {
        ensureDirectory(directory);
      }
    }
  }

  const listDirectory = vi.fn(async (path: string): Promise<LatteDirectoryEntry[]> => {
    const entries = directories.get(path);

    if (!entries) {
      throw new Error(`no such directory: ${path}`);
    }

    return Array.from(entries.values());
  });

  const readFileContent = vi.fn(async (path: string): Promise<string> => {
    if (!fileSet.has(path)) {
      throw new Error(`no such file: ${path}`);
    }

    return "template body";
  });

  return { listDirectory, readFileContent };
}

function makeDeps(
  overrides: Partial<LatteIntelligenceDependencies> = {},
): LatteIntelligenceDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
    isNetteFrameworkActive: true,
    isSemanticIntelligenceActive: true,
    joinPath: (root, relativePath) => `${root}/${relativePath}`,
    listDirectory: vi.fn(async () => {
      throw new Error("no directory");
    }),
    openTarget: vi.fn(async () => true),
    readFileContent: vi.fn(async () => {
      throw new Error("missing");
    }),
    toRelativePath: (root, path) =>
      path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
    workspaceRoot: ROOT,
    ...overrides,
  };
}

function positionAtOffset(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lineNumber = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: offset - lineStart + 1, lineNumber };
}

describe("createLatteIntelligence definition", () => {
  it("navigates an {include '...'} to the first existing candidate", async () => {
    const { readFileContent } = buildWorkspace([
      "app/UI/Home/partials/menu.latte",
    ]);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ readFileContent, openTarget });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include 'partials/menu'}";
    const offset = source.indexOf("menu");

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Home/partials/menu.latte",
      { column: 1, lineNumber: 1 },
      "partials/menu",
    );
  });

  it("returns false when no include candidate exists", async () => {
    const { readFileContent } = buildWorkspace([]);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ readFileContent, openTarget });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include 'partials/menu'}";

    await expect(
      latte.provideLatteDefinition(source, source.indexOf("menu")),
    ).resolves.toBe(false);
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("navigates a bare {layout} to the auto-looked-up @layout.latte", async () => {
    const { readFileContent } = buildWorkspace(["app/UI/@layout.latte"]);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ readFileContent, openTarget });
    const latte = createLatteIntelligence(() => deps);
    const source = "{layout}";

    await expect(
      latte.provideLatteDefinition(source, source.indexOf("layout")),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/@layout.latte",
      { column: 1, lineNumber: 1 },
      "@layout",
    );
  });

  it("does not auto-lookup a {layout none} (an explicit argument)", async () => {
    const { readFileContent } = buildWorkspace(["app/UI/@layout.latte"]);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ readFileContent, openTarget });
    const latte = createLatteIntelligence(() => deps);
    const source = "{layout none}";

    await expect(
      latte.provideLatteDefinition(source, source.indexOf("layout")),
    ).resolves.toBe(false);
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("does not navigate block references (later slice)", async () => {
    const { readFileContent } = buildWorkspace([]);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ readFileContent, openTarget });
    const latte = createLatteIntelligence(() => deps);
    const source = "{block content}";

    await expect(
      latte.provideLatteDefinition(source, source.indexOf("content")),
    ).resolves.toBe(false);
    expect(readFileContent).not.toHaveBeenCalled();
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("does nothing when the Nette framework is not active", async () => {
    const { readFileContent } = buildWorkspace([
      "app/UI/Home/partials/menu.latte",
    ]);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      isNetteFrameworkActive: false,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include 'partials/menu'}";

    await expect(
      latte.provideLatteDefinition(source, source.indexOf("menu")),
    ).resolves.toBe(false);
    expect(readFileContent).not.toHaveBeenCalled();
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("does nothing when the semantic tier is inactive", async () => {
    const { readFileContent } = buildWorkspace([
      "app/UI/Home/partials/menu.latte",
    ]);
    const deps = makeDeps({
      isSemanticIntelligenceActive: false,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include 'partials/menu'}";

    await expect(
      latte.provideLatteDefinition(source, source.indexOf("menu")),
    ).resolves.toBe(false);
    expect(readFileContent).not.toHaveBeenCalled();
  });

  it("drops the result when the workspace root changes during the file read", async () => {
    const rootRef = { current: ROOT };
    const openTarget = vi.fn(async () => true);
    const readFileContent = vi.fn(async () => {
      rootRef.current = "/other";
      return "template body";
    });
    const deps = makeDeps({
      currentWorkspaceRootRef: rootRef,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include 'partials/menu'}";

    await expect(
      latte.provideLatteDefinition(source, source.indexOf("menu")),
    ).resolves.toBe(false);
    expect(openTarget).not.toHaveBeenCalled();
  });
});

describe("createLatteIntelligence completions", () => {
  it("offers Latte tag names after {", async () => {
    const deps = makeDeps();
    const latte = createLatteIntelligence(() => deps);
    const source = "{for";
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, source.length),
    );
    const labels = completions.map((completion) => completion.label);

    expect(labels).toContain("for");
    expect(labels).toContain("foreach");
    expect(completions.every((completion) => completion.kind === "tag")).toBe(
      true,
    );
    expect(completions[0]).toMatchObject({ replaceEnd: 4, replaceStart: 1 });
  });

  it("offers workspace .latte templates inside an {include '...'} literal", async () => {
    const { listDirectory } = buildWorkspace([
      "app/UI/Home/default.latte",
      "app/UI/Home/partials/menu.latte",
      "app/UI/About/about.latte",
    ]);
    const deps = makeDeps({ listDirectory });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include ''}";
    const offset = source.indexOf("''") + 1;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );
    const inserts = completions.map((completion) => completion.insertText);

    expect(inserts).toContain("partials/menu.latte");
    expect(inserts).toContain("../About/about.latte");
    // The current template excludes itself from the include suggestions.
    expect(inserts).not.toContain("default.latte");
    expect(completions.every((completion) => completion.kind === "template")).toBe(
      true,
    );
  });

  it("filters include candidates by the typed prefix", async () => {
    const { listDirectory } = buildWorkspace([
      "app/UI/Home/default.latte",
      "app/UI/Home/partials/menu.latte",
      "app/UI/About/about.latte",
    ]);
    const deps = makeDeps({ listDirectory });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include 'partials/'}";
    const offset = source.indexOf("'}");
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.map((completion) => completion.insertText)).toEqual([
      "partials/menu.latte",
    ]);
  });

  it("caches the template listing per root across include requests", async () => {
    const { listDirectory } = buildWorkspace([
      "app/UI/Home/default.latte",
      "app/UI/Home/partials/menu.latte",
    ]);
    const deps = makeDeps({ listDirectory });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include ''}";
    const offset = source.indexOf("''") + 1;
    const position = positionAtOffset(source, offset);

    await latte.provideLatteCompletions(source, position);
    const callsAfterFirst = listDirectory.mock.calls.length;
    await latte.provideLatteCompletions(source, position);

    expect(listDirectory.mock.calls.length).toBe(callsAfterFirst);
  });

  it("returns nothing for include completion when Nette is inactive", async () => {
    const { listDirectory } = buildWorkspace([
      "app/UI/Home/partials/menu.latte",
    ]);
    const deps = makeDeps({ isNetteFrameworkActive: false, listDirectory });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include ''}";
    const offset = source.indexOf("''") + 1;

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it("drops include completions when the root changes during the scan", async () => {
    const rootRef = { current: ROOT };
    const { listDirectory } = buildWorkspace([
      "app/UI/Home/partials/menu.latte",
    ]);
    const trackingListDirectory = vi.fn(async (path: string) => {
      rootRef.current = "/other";
      return listDirectory(path);
    });
    const deps = makeDeps({
      currentWorkspaceRootRef: rootRef,
      listDirectory: trackingListDirectory,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include ''}";
    const offset = source.indexOf("''") + 1;

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
  });

  it("returns nothing on plain markup", async () => {
    const deps = makeDeps();
    const latte = createLatteIntelligence(() => deps);
    const source = "<p>hello</p>";

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, 3)),
    ).resolves.toEqual([]);
  });
});

describe("useLatteIntelligence hook mount", () => {
  function renderHook(deps: LatteIntelligenceDependencies) {
    const container = document.createElement("div");
    const root = createRoot(container);
    const captured: { api: LatteIntelligence | null } = { api: null };

    function Harness({
      dependencies,
    }: {
      dependencies: LatteIntelligenceDependencies;
    }) {
      captured.api = useLatteIntelligence(dependencies);
      return null;
    }

    act(() => {
      root.render(<Harness dependencies={deps} />);
    });

    return {
      captured,
      rerender: (next: LatteIntelligenceDependencies) => {
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

  it("exposes a stable definition/completion API and honours gating", async () => {
    const deps = makeDeps({ isNetteFrameworkActive: false });
    const harness = renderHook(deps);
    const firstApi = harness.captured.api;

    expect(typeof firstApi?.provideLatteDefinition).toBe("function");
    expect(typeof firstApi?.provideLatteCompletions).toBe("function");
    await expect(
      firstApi?.provideLatteCompletions("{for", { column: 5, lineNumber: 1 }),
    ).resolves.toEqual([]);

    harness.rerender(makeDeps({ isNetteFrameworkActive: false }));
    expect(harness.captured.api).toBe(firstApi);

    harness.unmount();
  });
});

describe("createLatteIntelligence template cache lifecycle (F1)", () => {
  it("evicts another root's cached template listing once a different root becomes active", async () => {
    const cache: LatteTemplateCache = {};
    const rootA = "/ws-a";
    const rootB = "/ws-b";
    const source = "{include ''}";
    const offset = source.indexOf("''") + 1;
    const position = positionAtOffset(source, offset);

    const { listDirectory: listA } = buildWorkspace(
      ["app/UI/Home/default.latte"],
      rootA,
    );
    const depsA = makeDeps({
      currentWorkspaceRootRef: { current: rootA },
      getActiveDocument: () => ({ path: `${rootA}/app/UI/Home/default.latte` }),
      listDirectory: listA,
      workspaceRoot: rootA,
    });
    const latteA = createLatteIntelligence(() => depsA, cache);

    await latteA.provideLatteCompletions(source, position);
    expect(Object.keys(cache)).toEqual([rootA]);

    const { listDirectory: listB } = buildWorkspace(
      ["app/UI/Home/default.latte"],
      rootB,
    );
    const depsB = makeDeps({
      currentWorkspaceRootRef: { current: rootB },
      getActiveDocument: () => ({ path: `${rootB}/app/UI/Home/default.latte` }),
      listDirectory: listB,
      workspaceRoot: rootB,
    });
    const latteB = createLatteIntelligence(() => depsB, cache);

    await latteB.provideLatteCompletions(source, position);

    expect(Object.keys(cache)).toEqual([rootB]);
  });

  it("evicts a stale root's cached listing even when only provideLatteDefinition runs on the new root", async () => {
    const cache: LatteTemplateCache = {};
    const rootA = "/ws-a";
    const rootB = "/ws-b";
    const includeSource = "{include ''}";
    const includeOffset = includeSource.indexOf("''") + 1;

    const { listDirectory: listA } = buildWorkspace(
      ["app/UI/Home/default.latte"],
      rootA,
    );
    const depsA = makeDeps({
      currentWorkspaceRootRef: { current: rootA },
      getActiveDocument: () => ({ path: `${rootA}/app/UI/Home/default.latte` }),
      listDirectory: listA,
      workspaceRoot: rootA,
    });
    const latteA = createLatteIntelligence(() => depsA, cache);

    await latteA.provideLatteCompletions(
      includeSource,
      positionAtOffset(includeSource, includeOffset),
    );
    expect(Object.keys(cache)).toEqual([rootA]);

    const { readFileContent: readB } = buildWorkspace([], rootB);
    const depsB = makeDeps({
      currentWorkspaceRootRef: { current: rootB },
      getActiveDocument: () => ({ path: `${rootB}/app/UI/Home/default.latte` }),
      readFileContent: readB,
      workspaceRoot: rootB,
    });
    const latteB = createLatteIntelligence(() => depsB, cache);
    const definitionSource = "{include 'missing'}";

    await latteB.provideLatteDefinition(
      definitionSource,
      definitionSource.indexOf("missing"),
    );

    expect(Object.keys(cache)).toEqual([]);
  });
});

describe("createLatteIntelligence workspace template scan bounds (F2)", () => {
  // Path at nesting level N is prefixed by N "lK" directory hops from `app`
  // (app = depth 0, app/l1 = depth 1, ...), so `levelPathAt(12)` sits at the
  // deepest directory the depth cap still permits and `levelPathAt(13)` sits
  // one level past it.
  function levelPathAt(level: number): string {
    const hops = Array.from({ length: level }, (_, index) => `l${index + 1}`);

    return [...hops, `level${level}.latte`].reduce(
      (prefix, segment) => `${prefix}/${segment}`,
      "app",
    );
  }

  function buildDeepLatteTree(depthCount: number): string[] {
    return Array.from({ length: depthCount }, (_, level) => levelPathAt(level));
  }

  it("stops descending beyond the max scan depth and returns the partial result", async () => {
    const { listDirectory } = buildWorkspace(buildDeepLatteTree(15));
    const cache: LatteTemplateCache = {};
    const deps = makeDeps({ listDirectory });
    const latte = createLatteIntelligence(() => deps, cache);
    const source = "{include ''}";
    const offset = source.indexOf("''") + 1;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    const scanned = cache[ROOT]?.relativePaths ?? [];

    expect(scanned).toContain(levelPathAt(12));
    expect(scanned).not.toContain(levelPathAt(13));
    expect(scanned).not.toContain(levelPathAt(14));
  });

  it("skips vendor/node_modules directories nested inside the scan roots", async () => {
    const { listDirectory } = buildWorkspace([
      "app/UI/Home/default.latte",
      "app/vendor/some-package/templates/leaked.latte",
      "app/node_modules/some-pkg/leaked.latte",
    ]);
    const cache: LatteTemplateCache = {};
    const deps = makeDeps({ listDirectory });
    const latte = createLatteIntelligence(() => deps, cache);
    const source = "{include ''}";
    const offset = source.indexOf("''") + 1;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    const scanned = cache[ROOT]?.relativePaths ?? [];

    expect(scanned).toContain("app/UI/Home/default.latte");
    expect(scanned).not.toContain(
      "app/vendor/some-package/templates/leaked.latte",
    );
    expect(scanned).not.toContain("app/node_modules/some-pkg/leaked.latte");
  });

  it("caps the scanned .latte file count at MAX_LATTE_TEMPLATE_FILES", async () => {
    const manyRelativePaths = Array.from(
      { length: 2500 },
      (_, index) => `app/file${index}.latte`,
    );
    const { listDirectory } = buildWorkspace(manyRelativePaths);
    const cache: LatteTemplateCache = {};
    const deps = makeDeps({ listDirectory });
    const latte = createLatteIntelligence(() => deps, cache);
    const source = "{include ''}";
    const offset = source.indexOf("''") + 1;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    const scanned = cache[ROOT]?.relativePaths ?? [];

    expect(scanned.length).toBeLessThanOrEqual(2000);
    expect(scanned.length).toBeGreaterThan(0);
  });

  it("does not revisit the same directory twice within one scan", async () => {
    const listDirectory = vi.fn(
      async (path: string): Promise<LatteDirectoryEntry[]> => {
        if (path === `${ROOT}/app`) {
          return [
            { kind: "directory", path: `${ROOT}/app/shared` },
            { kind: "directory", path: `${ROOT}/app/shared` },
          ];
        }

        if (path === `${ROOT}/app/shared`) {
          return [{ kind: "file", path: `${ROOT}/app/shared/menu.latte` }];
        }

        throw new Error(`no such directory: ${path}`);
      },
    );
    const cache: LatteTemplateCache = {};
    const deps = makeDeps({ listDirectory });
    const latte = createLatteIntelligence(() => deps, cache);
    const source = "{include ''}";
    const offset = source.indexOf("''") + 1;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    const sharedListingCalls = listDirectory.mock.calls.filter(
      ([path]) => path === `${ROOT}/app/shared`,
    );

    expect(sharedListingCalls.length).toBe(1);
  });
});
