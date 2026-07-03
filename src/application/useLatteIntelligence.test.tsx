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
  type LatteViewDataCache,
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
    // Identity resolution: the fixture presenters carry FQN `@var` docblocks,
    // so the declared hint is already fully qualified. The FQN-resolution
    // behavior itself is pinned by a dedicated test below.
    resolveDeclaredType: (_source, typeHint) => typeHint,
    resolveExpressionType: vi.fn(async () => null),
    resolvePhpReceiverCompletions: vi.fn(async () => []),
    searchText: vi.fn(async () => []),
    synthesizeTypedReceiverSource: (variableName, typeName) => ({
      position: { column: 1, lineNumber: 3 },
      source: `<?php\n/** @var \\${typeName} $${variableName} */\n$${variableName}->`,
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

const HOME_PRESENTER_SOURCE = `<?php

namespace App\\UI\\Home;

use Nette\\Application\\UI\\Presenter;

class HomePresenter extends Presenter
{
    public function renderDefault(): void
    {
        /** @var \\App\\Model\\Invoice $invoice */
        $invoice = $this->invoices->get(1);
        $this->template->invoice = $invoice;
    }

    public function beforeRender(): void
    {
        /** @var \\App\\Model\\Menu $menu */
        $menu = $this->menuFactory->create();
        $this->template->menu = $menu;
    }
}
`;

/**
 * Fakes the workspace text search + file reader over a set of presenter sources,
 * so the presenter view-data flow behaves like the real controller gateways
 * (every anchor query returns the presenter paths; unknown files throw).
 */
function buildNettePresenterWorkspace(
  sources: Record<string, string>,
  root: string = ROOT,
) {
  const absoluteSources = new Map<string, string>();

  for (const [relativePath, source] of Object.entries(sources)) {
    absoluteSources.set(`${root}/${relativePath}`, source);
  }

  const searchText = vi.fn(async () =>
    Array.from(absoluteSources.keys()).map((path) => ({ path })),
  );
  const readFileContent = vi.fn(async (path: string) => {
    const source = absoluteSources.get(path);

    if (source === undefined) {
      throw new Error(`no such file: ${path}`);
    }

    return source;
  });

  return { readFileContent, searchText };
}

describe("createLatteIntelligence member completion ({$var->})", () => {
  it("resolves a presenter variable's type and dispatches member completion via the dep", async () => {
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/UI/Home/HomePresenter.php": HOME_PRESENTER_SOURCE,
    });
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );
    const resolvePhpReceiverCompletions = vi.fn(async () => [
      {
        declaringClassName: "Invoice",
        name: "getTotal",
        parameters: "",
        returnType: "float",
      },
    ]);
    const deps = makeDeps({
      readFileContent,
      resolvePhpReceiverCompletions,
      searchText,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$invoice->}";
    const offset = source.indexOf("->") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "invoice",
      "\\App\\Model\\Invoice",
    );
    expect(completions.map((completion) => completion.label)).toContain(
      "getTotal",
    );
    expect(completions.every((completion) => completion.kind === "member")).toBe(
      true,
    );
  });

  it("matches a wildcard presenter binding (beforeRender applies to every action)", async () => {
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/UI/Home/HomePresenter.php": HOME_PRESENTER_SOURCE,
    });
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );
    const deps = makeDeps({
      readFileContent,
      resolvePhpReceiverCompletions: vi.fn(async () => []),
      searchText,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$menu->}";
    const offset = source.indexOf("->") + 2;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "menu",
      "\\App\\Model\\Menu",
    );
  });

  it("prefers a {varType} declaration over presenter view-data (and never loads presenters)", async () => {
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/UI/Home/HomePresenter.php": HOME_PRESENTER_SOURCE,
    });
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );
    const deps = makeDeps({
      readFileContent,
      resolvePhpReceiverCompletions: vi.fn(async () => []),
      searchText,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{varType App\\Model\\Product $invoice}\n{$invoice->}";
    const offset = source.lastIndexOf("->") + 2;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "invoice",
      "App\\Model\\Product",
    );
    // The inline type short-circuits the priority chain before any presenter
    // text search (spec §6b lazy).
    expect(searchText).not.toHaveBeenCalled();
  });

  it("types a {foreach} loop element from its collection's element type", async () => {
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );
    const deps = makeDeps({
      resolvePhpReceiverCompletions: vi.fn(async () => []),
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source =
      "{varType App\\Model\\Product[] $products}\n" +
      "{foreach $products as $product}\n{$product->}\n{/foreach}";
    const offset = source.indexOf("$product->") + "$product->".length;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "product",
      "App\\Model\\Product",
    );
  });

  it("returns nothing and never dispatches when Nette is inactive", async () => {
    const synthesizeTypedReceiverSource = vi.fn(() => ({
      position: { column: 1, lineNumber: 3 },
      source: "",
    }));
    const deps = makeDeps({
      isNetteFrameworkActive: false,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{varType App\\Model\\Product $invoice}\n{$invoice->}";
    const offset = source.lastIndexOf("->") + 2;

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
    expect(synthesizeTypedReceiverSource).not.toHaveBeenCalled();
  });

  it("drops member completions when the root changes during member resolution", async () => {
    const rootRef = { current: ROOT };
    const resolvePhpReceiverCompletions = vi.fn(async () => {
      rootRef.current = "/other";
      return [
        {
          declaringClassName: "Product",
          name: "getName",
          parameters: "",
          returnType: "string",
        },
      ];
    });
    const deps = makeDeps({
      currentWorkspaceRootRef: rootRef,
      resolvePhpReceiverCompletions,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{varType App\\Model\\Product $invoice}\n{$invoice->}";
    const offset = source.lastIndexOf("->") + 2;

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
  });
});

describe("createLatteIntelligence variable + filter completion", () => {
  it("lists in-scope variables from varType, {foreach} and presenter data", async () => {
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/UI/Home/HomePresenter.php": HOME_PRESENTER_SOURCE,
    });
    const deps = makeDeps({ readFileContent, searchText });
    const latte = createLatteIntelligence(() => deps);
    const source =
      "{varType App\\Model\\Product $product}\n" +
      "{foreach $items as $row}\n{$}\n{/foreach}";
    const offset = source.indexOf("{$}") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );
    const labels = completions.map((completion) => completion.label);

    expect(labels).toContain("$product");
    expect(labels).toContain("$row");
    expect(labels).toContain("$invoice");
    expect(completions.every((completion) => completion.kind === "variable")).toBe(
      true,
    );
  });

  it("offers Latte built-in filters after a | in an expression", async () => {
    const deps = makeDeps();
    const latte = createLatteIntelligence(() => deps);
    const source = "{$total|up}";
    const offset = source.indexOf("up") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.map((completion) => completion.label)).toContain("upper");
    expect(completions.every((completion) => completion.kind === "filter")).toBe(
      true,
    );
  });

  it("does not offer filters after a || logical or", async () => {
    const deps = makeDeps();
    const latte = createLatteIntelligence(() => deps);
    const source = "{if $a || }";
    const offset = source.indexOf("|| ") + 3;

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
  });
});

describe("createLatteIntelligence view-data cache lifecycle", () => {
  it("evicts another root's cached presenter entries once a different root becomes active", async () => {
    const viewDataCache: LatteViewDataCache = {};
    const rootA = "/ws-a";
    const rootB = "/ws-b";
    const source = "{$invoice->}";
    const offset = source.indexOf("->") + 2;
    const position = positionAtOffset(source, offset);

    const workspaceA = buildNettePresenterWorkspace(
      { "app/UI/Home/HomePresenter.php": HOME_PRESENTER_SOURCE },
      rootA,
    );
    const depsA = makeDeps({
      currentWorkspaceRootRef: { current: rootA },
      getActiveDocument: () => ({ path: `${rootA}/app/UI/Home/default.latte` }),
      readFileContent: workspaceA.readFileContent,
      searchText: workspaceA.searchText,
      workspaceRoot: rootA,
    });
    const latteA = createLatteIntelligence(() => depsA, {}, viewDataCache);

    await latteA.provideLatteCompletions(source, position);
    expect(Object.keys(viewDataCache)).toEqual([rootA]);

    const workspaceB = buildNettePresenterWorkspace(
      { "app/UI/Home/HomePresenter.php": HOME_PRESENTER_SOURCE },
      rootB,
    );
    const depsB = makeDeps({
      currentWorkspaceRootRef: { current: rootB },
      getActiveDocument: () => ({ path: `${rootB}/app/UI/Home/default.latte` }),
      readFileContent: workspaceB.readFileContent,
      searchText: workspaceB.searchText,
      workspaceRoot: rootB,
    });
    const latteB = createLatteIntelligence(() => depsB, {}, viewDataCache);

    await latteB.provideLatteCompletions(source, position);

    expect(Object.keys(viewDataCache)).toEqual([rootB]);
  });

  it("caches presenter entries per root across completion requests", async () => {
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/UI/Home/HomePresenter.php": HOME_PRESENTER_SOURCE,
    });
    const deps = makeDeps({ readFileContent, searchText });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$invoice->}";
    const offset = source.indexOf("->") + 2;
    const position = positionAtOffset(source, offset);

    await latte.provideLatteCompletions(source, position);
    const callsAfterFirst = searchText.mock.calls.length;
    await latte.provideLatteCompletions(source, position);

    expect(searchText.mock.calls.length).toBe(callsAfterFirst);
  });

  it("shares one in-flight presenter scan across concurrent completion requests", async () => {
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/UI/Home/HomePresenter.php": HOME_PRESENTER_SOURCE,
    });
    const deps = makeDeps({ readFileContent, searchText });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$invoice->}";
    const offset = source.indexOf("->") + 2;
    const position = positionAtOffset(source, offset);

    // Both requests start before either scan resolves (Monaco fires a request
    // per keystroke) - the in-flight registry must collapse them to ONE scan.
    await Promise.all([
      latte.provideLatteCompletions(source, position),
      latte.provideLatteCompletions(source, position),
    ]);

    // One call per search anchor, not one per anchor per request.
    expect(searchText.mock.calls.length).toBe(2);
  });
});

describe("createLatteIntelligence type-resolution edge cases", () => {
  function trackingSynthesize() {
    return vi.fn((variableName: string, typeName: string) => ({
      position: { column: 1, lineNumber: 3 },
      source: `${variableName}:${typeName}`,
    }));
  }

  it("yields no completions when presenter sightings conflict on the type", async () => {
    const conflictingPresenter = HOME_PRESENTER_SOURCE.replace(
      "@var \\App\\Model\\Invoice $invoice",
      "@var \\App\\Model\\Order $invoice",
    );
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/UI/Home/HomePresenter.php": HOME_PRESENTER_SOURCE,
      "modules/admin/app/UI/Home/HomePresenter.php": conflictingPresenter,
    });
    const synthesizeTypedReceiverSource = trackingSynthesize();
    const deps = makeDeps({
      readFileContent,
      searchText,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$invoice->}";
    const offset = source.indexOf("->") + 2;

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
    // Conservative merge: Invoice vs Order disagree -> null -> no dispatch.
    expect(synthesizeTypedReceiverSource).not.toHaveBeenCalled();
  });

  it("resolves the presenter's short type hint against its source (FQN resolution)", async () => {
    const shortHintPresenter = HOME_PRESENTER_SOURCE.replace(
      "@var \\App\\Model\\Invoice $invoice",
      "@var Invoice $invoice",
    );
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/UI/Home/HomePresenter.php": shortHintPresenter,
    });
    const synthesizeTypedReceiverSource = trackingSynthesize();
    const resolveDeclaredType = vi.fn(
      (source: string, typeHint: string | null) =>
        typeHint === "Invoice" && source.includes("namespace App\\UI\\Home")
          ? "App\\Model\\Invoice"
          : null,
    );
    const deps = makeDeps({
      readFileContent,
      resolveDeclaredType,
      searchText,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$invoice->}";
    const offset = source.indexOf("->") + 2;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    expect(resolveDeclaredType).toHaveBeenCalledWith(
      expect.stringContaining("class HomePresenter"),
      "Invoice",
    );
    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "invoice",
      "App\\Model\\Invoice",
    );
  });

  it("terminates a self-referential foreach without dispatching", async () => {
    const synthesizeTypedReceiverSource = trackingSynthesize();
    const deps = makeDeps({ synthesizeTypedReceiverSource });
    const latte = createLatteIntelligence(() => deps);
    const source = "{foreach $x as $x}\n{$x->}\n{/foreach}";
    const offset = source.indexOf("$x->") + "$x->".length;

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
    expect(synthesizeTypedReceiverSource).not.toHaveBeenCalled();
  });

  it("terminates mutually-referential foreach loops via the depth bound", async () => {
    const synthesizeTypedReceiverSource = trackingSynthesize();
    const deps = makeDeps({ synthesizeTypedReceiverSource });
    const latte = createLatteIntelligence(() => deps);
    const source =
      "{foreach $a as $b}\n{foreach $b as $a}\n{$a->}\n{/foreach}\n{/foreach}";
    const offset = source.indexOf("$a->") + "$a->".length;

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
    expect(synthesizeTypedReceiverSource).not.toHaveBeenCalled();
  });

  it("resolves a {var} local through the expression engine, with {varType} winning over it", async () => {
    const synthesizeTypedReceiverSource = trackingSynthesize();
    const resolveExpressionType = vi.fn(
      async (_source: string, _position: unknown, expression: string) =>
        expression === "new Product()" ? "App\\Model\\Product" : null,
    );
    const deps = makeDeps({
      resolveExpressionType,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);

    const localSource = "{var $p = new Product()}\n{$p->}";
    const localOffset = localSource.indexOf("$p->") + "$p->".length;
    await latte.provideLatteCompletions(
      localSource,
      positionAtOffset(localSource, localOffset),
    );

    expect(synthesizeTypedReceiverSource).toHaveBeenLastCalledWith(
      "p",
      "App\\Model\\Product",
    );

    const prioritySource =
      "{varType App\\Model\\Order $p}\n{var $p = new Product()}\n{$p->}";
    const priorityOffset = prioritySource.indexOf("$p->") + "$p->".length;
    await latte.provideLatteCompletions(
      prioritySource,
      positionAtOffset(prioritySource, priorityOffset),
    );

    // Priority 1 ({varType}) wins over the {var} expression inference.
    expect(synthesizeTypedReceiverSource).toHaveBeenLastCalledWith(
      "p",
      "App\\Model\\Order",
    );
  });

  it("matches a classic dotted template (Product.show.latte) to Presenter:action", async () => {
    const productPresenter = `<?php
class ProductPresenter extends Nette\\Application\\UI\\Presenter
{
    public function renderShow(): void
    {
        /** @var \\App\\Model\\Product $product */
        $product = $this->products->get(1);
        $this->template->product = $product;
    }
}
`;
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/Presenters/ProductPresenter.php": productPresenter,
    });
    const synthesizeTypedReceiverSource = trackingSynthesize();
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/Presenters/templates/Product.show.latte`,
      }),
      readFileContent,
      searchText,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$product->}";
    const offset = source.indexOf("->") + 2;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "product",
      "\\App\\Model\\Product",
    );
  });

  it("offers nothing inside a string literal within an expression tag", async () => {
    const deps = makeDeps();
    const latte = createLatteIntelligence(() => deps);
    const source = "{var $a = 'x|'}";
    const offset = source.indexOf("x|") + 2;

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
  });
});

/**
 * Builds an in-memory FS (listDirectory + content-returning readFileContent)
 * from a map of workspace-relative paths to their file contents, so the
 * presenter-link flows behave like the real Tauri gateways (unknown dirs /
 * files throw).
 */
function buildContentWorkspace(
  sources: Record<string, string>,
  root: string = ROOT,
) {
  const fileContents = new Map<string, string>();
  const directories = new Map<string, Map<string, LatteDirectoryEntry>>();
  const ensureDirectory = (directory: string): void => {
    if (!directories.has(directory)) {
      directories.set(directory, new Map());
    }
  };

  for (const [relativePath, content] of Object.entries(sources)) {
    const absolute = `${root}/${relativePath}`;
    fileContents.set(absolute, content);

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
    const content = fileContents.get(path);

    if (content === undefined) {
      throw new Error(`no such file: ${path}`);
    }

    return content;
  });

  return { listDirectory, readFileContent };
}

const PRODUCT_PRESENTER_SOURCE = `<?php

namespace App\\UI\\Product;

use Nette\\Application\\UI\\Presenter;

class ProductPresenter extends Presenter
{
    public function renderShow(): void
    {
    }

    public function actionEdit(): void
    {
    }

    public function handleDelete(): void
    {
    }
}
`;

describe("createLatteIntelligence presenter link definition (S7 Latte)", () => {
  it("navigates a {link Product:show} to the presenter renderShow method", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ listDirectory, openTarget, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "<a n:href=x>{link Product:show}</a>";
    const offset = source.indexOf("Product:show") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Product/ProductPresenter.php",
      expect.objectContaining({ lineNumber: 9 }),
      "Product:show",
    );
  });

  it("navigates an n:href=\"Product:show\" the same way", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ listDirectory, openTarget, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = '<a n:href="Product:show $id">Go</a>';
    const offset = source.indexOf("Product:show") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Product/ProductPresenter.php",
      expect.objectContaining({ lineNumber: 9 }),
      "Product:show",
    );
  });

  it("falls back to the classic presenter when only it exists", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/Presenters/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ listDirectory, openTarget, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link Product:show}";
    const offset = source.indexOf("Product:show") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/Presenters/ProductPresenter.php",
      expect.objectContaining({ lineNumber: 9 }),
      "Product:show",
    );
  });

  it("navigates a signal target (delete!) to the handleDelete method", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ listDirectory, openTarget, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link Product:delete!}";
    const offset = source.indexOf("Product:delete") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Product/ProductPresenter.php",
      expect.objectContaining({ lineNumber: 17 }),
      "Product:delete!",
    );
  });

  it("resolves a relative action to the current template's presenter", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Product/show.latte` }),
      listDirectory,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link edit}";
    const offset = source.indexOf("edit") + 1;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Product/ProductPresenter.php",
      expect.objectContaining({ lineNumber: 13 }),
      "edit",
    );
  });

  it("opens at line 1 when the presenter exists but the method is absent", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ listDirectory, openTarget, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link Product:missing}";
    const offset = source.indexOf("Product:missing") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Product/ProductPresenter.php",
      { column: 1, lineNumber: 1 },
      "Product:missing",
    );
  });

  it("returns false for a dynamic {link $dest}", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ openTarget, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link $dest}";
    const offset = source.indexOf("$dest") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("returns false for a {link this} current-action marker", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ openTarget, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link this}";
    const offset = source.indexOf("this") + 1;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("does nothing when the Nette framework is inactive", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      isNetteFrameworkActive: false,
      listDirectory,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link Product:show}";
    const offset = source.indexOf("Product:show") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(readFileContent).not.toHaveBeenCalled();
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("drops the result when the root changes during the presenter read", async () => {
    const rootRef = { current: ROOT };
    const openTarget = vi.fn(async () => true);
    const readFileContent = vi.fn(async () => {
      rootRef.current = "/other";
      return PRODUCT_PRESENTER_SOURCE;
    });
    const deps = makeDeps({
      currentWorkspaceRootRef: rootRef,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link Product:show}";
    const offset = source.indexOf("Product:show") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(openTarget).not.toHaveBeenCalled();
  });
});

describe("createLatteIntelligence PHP presenter link definition (S7 PHP)", () => {
  it("navigates $this->link('Product:show') to the presenter method", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/HomePresenter.php` }),
      listDirectory,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "$url = $this->link('Product:show', $id);";
    const offset = source.indexOf("Product:show") + 2;

    await expect(
      latte.provideNettePhpLinkDefinition(source, offset),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Product/ProductPresenter.php",
      expect.objectContaining({ lineNumber: 9 }),
      "Product:show",
    );
  });

  it("navigates a relative $this->redirect('edit') to the current presenter", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/UI/Product/ProductPresenter.php`,
      }),
      listDirectory,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "$this->redirect('edit');";
    const offset = source.indexOf("edit") + 1;

    await expect(
      latte.provideNettePhpLinkDefinition(source, offset),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Product/ProductPresenter.php",
      expect.objectContaining({ lineNumber: 13 }),
      "edit",
    );
  });

  it("returns false for a dynamic PHP link argument", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/HomePresenter.php` }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "$this->link($destination);";
    const offset = source.indexOf("$destination") + 2;

    await expect(
      latte.provideNettePhpLinkDefinition(source, offset),
    ).resolves.toBe(false);
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("does nothing when the Nette framework is inactive", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/HomePresenter.php` }),
      isNetteFrameworkActive: false,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "$this->link('Product:show');";
    const offset = source.indexOf("Product:show") + 2;

    await expect(
      latte.provideNettePhpLinkDefinition(source, offset),
    ).resolves.toBe(false);
    expect(openTarget).not.toHaveBeenCalled();
  });
});

describe("createLatteIntelligence presenter link completion (S7)", () => {
  const PRESENTERS = {
    "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    "app/UI/Home/HomePresenter.php": `<?php
namespace App\\UI\\Home;
class HomePresenter extends Nette\\Application\\UI\\Presenter
{
    public function renderDefault(): void {}
}
`,
  };

  it("offers Presenter:action targets in a {link} macro", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({ listDirectory, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link P}";
    const offset = source.indexOf("P") + 1;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );
    const labels = completions.map((completion) => completion.label);

    expect(labels).toContain("Product:show");
    expect(labels).toContain("Product:edit");
    expect(labels).toContain("Product:delete!");
    expect(completions.every((completion) => completion.kind === "link")).toBe(
      true,
    );
  });

  it("filters targets by the typed prefix", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({ listDirectory, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link Product:s}";
    const offset = source.indexOf("Product:s") + "Product:s".length;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.map((completion) => completion.label)).toEqual([
      "Product:show",
    ]);
  });

  it("offers targets inside an n:href attribute", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({ listDirectory, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = '<a n:href="Home">';
    const offset = source.indexOf("Home") + "Home".length;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.map((completion) => completion.label)).toContain(
      "Home:default",
    );
  });

  it("caches presenter discovery across completion requests", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({ listDirectory, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link P}";
    const position = positionAtOffset(source, source.indexOf("P") + 1);

    await latte.provideLatteCompletions(source, position);
    const callsAfterFirst = listDirectory.mock.calls.length;
    await latte.provideLatteCompletions(source, position);

    expect(listDirectory.mock.calls.length).toBe(callsAfterFirst);
  });

  it("returns nothing when the Nette framework is inactive", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({
      isNetteFrameworkActive: false,
      listDirectory,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link P}";
    const position = positionAtOffset(source, source.indexOf("P") + 1);

    await expect(
      latte.provideLatteCompletions(source, position),
    ).resolves.toEqual([]);
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it("drops link completions when the root changes during discovery", async () => {
    const rootRef = { current: ROOT };
    const built = buildContentWorkspace(PRESENTERS);
    const listDirectory = vi.fn(async (path: string) => {
      rootRef.current = "/other";
      return built.listDirectory(path);
    });
    const deps = makeDeps({
      currentWorkspaceRootRef: rootRef,
      listDirectory,
      readFileContent: built.readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link P}";
    const position = positionAtOffset(source, source.indexOf("P") + 1);

    await expect(
      latte.provideLatteCompletions(source, position),
    ).resolves.toEqual([]);
  });
});

const COMPONENT_PRESENTER_SOURCE = `<?php

namespace App\\UI\\Home;

use Nette\\Application\\UI\\Presenter;
use Nette\\Application\\UI\\Form;

class HomePresenter extends Presenter
{
    public function renderDefault(): void
    {
    }

    protected function createComponentContactForm(): Form
    {
        return new Form();
    }

    protected function createComponentProductList(): ProductListControl
    {
        return new ProductListControl();
    }
}
`;

describe("createLatteIntelligence {control} component definition (Fáza 2)", () => {
  it("navigates {control contactForm} to createComponentContactForm", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      listDirectory,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{control contactForm}";
    const offset = source.indexOf("contactForm") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Home/HomePresenter.php",
      expect.objectContaining({ lineNumber: 14 }),
      "contactForm",
    );
  });

  it("navigates a <form n:name=\"contactForm\"> the same way", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = '<form n:name="contactForm" method="post"></form>';
    const offset = source.indexOf("contactForm") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Home/HomePresenter.php",
      expect.objectContaining({ lineNumber: 14 }),
      "contactForm",
    );
  });

  it("does not treat an input field's n:name as a component", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = '<input n:name="email">';
    const offset = source.indexOf("email") + 1;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("returns false when the factory is absent from the presenter (trait/parent case)", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{control inheritedWidget}";
    const offset = source.indexOf("inheritedWidget") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("does nothing when the Nette framework is inactive", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      isNetteFrameworkActive: false,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{control contactForm}";
    const offset = source.indexOf("contactForm") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(readFileContent).not.toHaveBeenCalled();
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("drops the result when the root changes during the presenter read", async () => {
    const rootRef = { current: ROOT };
    const openTarget = vi.fn(async () => true);
    const readFileContent = vi.fn(async () => {
      rootRef.current = "/other";
      return COMPONENT_PRESENTER_SOURCE;
    });
    const deps = makeDeps({
      currentWorkspaceRootRef: rootRef,
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{control contactForm}";
    const offset = source.indexOf("contactForm") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(openTarget).not.toHaveBeenCalled();
  });
});

describe("createLatteIntelligence createComponent -> {control} reverse (Fáza 2)", () => {
  it("navigates createComponentContactForm to its first {control} usage", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/default.latte":
        "<h1>Home</h1>\n{control contactForm}\n",
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/UI/Home/HomePresenter.php`,
      }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = COMPONENT_PRESENTER_SOURCE;
    const offset = source.indexOf("createComponentContactForm") + 2;

    await expect(
      latte.provideNettePhpLinkDefinition(source, offset),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Home/default.latte",
      expect.objectContaining({ lineNumber: 2 }),
      "contactForm",
    );
  });

  it("returns false when the component is never used in a template", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/default.latte": "<h1>Home</h1>\n{control productList}\n",
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/UI/Home/HomePresenter.php`,
      }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = COMPONENT_PRESENTER_SOURCE;
    const offset = source.indexOf("createComponentContactForm") + 2;

    await expect(
      latte.provideNettePhpLinkDefinition(source, offset),
    ).resolves.toBe(false);
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("still resolves a $this->link presenter link (existing branch preserved)", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/HomePresenter.php` }),
      listDirectory,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "$url = $this->link('Product:show');";
    const offset = source.indexOf("Product:show") + 2;

    await expect(
      latte.provideNettePhpLinkDefinition(source, offset),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Product/ProductPresenter.php",
      expect.objectContaining({ lineNumber: 9 }),
      "Product:show",
    );
  });
});

describe("createLatteIntelligence {control} completion (Fáza 2)", () => {
  it("offers the presenter's createComponent* names in a {control } macro", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{control }";
    const offset = source.indexOf("}");
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );
    const labels = completions.map((completion) => completion.label);

    expect(labels).toContain("contactForm");
    expect(labels).toContain("productList");
    expect(
      completions.every((completion) => completion.kind === "component"),
    ).toBe(true);
  });

  it("filters components by the typed prefix", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{control contac}";
    const offset = source.indexOf("}");
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.map((completion) => completion.label)).toEqual([
      "contactForm",
    ]);
  });

  it("caches the presenter component scan across completion requests", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{control }";
    const position = positionAtOffset(source, source.indexOf("}"));

    await latte.provideLatteCompletions(source, position);
    const callsAfterFirst = readFileContent.mock.calls.length;
    await latte.provideLatteCompletions(source, position);

    expect(readFileContent.mock.calls.length).toBe(callsAfterFirst);
  });

  it("returns nothing when the Nette framework is inactive", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      isNetteFrameworkActive: false,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{control }";

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, source.indexOf("}"))),
    ).resolves.toEqual([]);
    expect(readFileContent).not.toHaveBeenCalled();
  });

  it("drops component completions when the root changes during the scan", async () => {
    const rootRef = { current: ROOT };
    const readFileContent = vi.fn(async () => {
      rootRef.current = "/other";
      return COMPONENT_PRESENTER_SOURCE;
    });
    const deps = makeDeps({
      currentWorkspaceRootRef: rootRef,
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{control }";

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, source.indexOf("}"))),
    ).resolves.toEqual([]);
  });
});
