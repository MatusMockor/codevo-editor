// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  createNeonIntelligence,
  useNeonIntelligence,
  type NeonConfigCache,
  type NeonDirectoryEntry,
  type NeonIntelligence,
  type NeonIntelligenceDependencies,
} from "./useNeonIntelligence";

const ROOT = "/ws";

function makeDeps(
  overrides: Partial<NeonIntelligenceDependencies> = {},
): NeonIntelligenceDependencies {
  return {
    currentWorkspaceRootRef: { current: ROOT },
    getActiveDocument: () => ({ path: `${ROOT}/config/config.neon` }),
    isNetteFrameworkActive: true,
    isSemanticIntelligenceActive: true,
    joinPath: (root, relativePath) => `${root}/${relativePath}`,
    listDirectory: vi.fn(async () => {
      throw new Error("no directory");
    }),
    openClassTarget: vi.fn(async () => true),
    openTarget: vi.fn(async () => true),
    readFileContent: vi.fn(async () => {
      throw new Error("missing");
    }),
    searchClassNames: vi.fn(async () => []),
    toRelativePath: (root, path) =>
      path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
    workspaceRoot: ROOT,
    ...overrides,
  };
}

/**
 * Fakes the workspace directory reader + file reader over a set of `.neon`
 * sources so the cross-file config scan behaves like the real gateways (unknown
 * directories / files reject). Directories are derived from the file paths.
 */
function buildNeonWorkspace(
  sources: Record<string, string>,
  root: string = ROOT,
) {
  const fileContents = new Map<string, string>();
  const directories = new Map<string, Map<string, NeonDirectoryEntry>>();

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

  const listDirectory = vi.fn(async (path: string): Promise<NeonDirectoryEntry[]> => {
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

function positionAtOffset(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lineNumber = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: offset - lineStart + 1, lineNumber };
}

describe("createNeonIntelligence definition", () => {
  it("navigates a named-service class FQN to its PHP file", async () => {
    const openClassTarget = vi.fn(async () => true);
    const deps = makeDeps({ openClassTarget });
    const neon = createNeonIntelligence(() => deps);
    const source = "services:\n    router: App\\Router\\RouterFactory\n";
    const offset = source.indexOf("App\\Router\\RouterFactory") + 2;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(true);
    expect(openClassTarget).toHaveBeenCalledWith("App\\Router\\RouterFactory");
  });

  it("navigates an anonymous `- Class` FQN entry", async () => {
    const openClassTarget = vi.fn(async () => true);
    const deps = makeDeps({ openClassTarget });
    const neon = createNeonIntelligence(() => deps);
    const source = "services:\n    - App\\Model\\ProductRepository\n";
    const offset = source.indexOf("App\\Model\\ProductRepository") + 4;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(true);
    expect(openClassTarget).toHaveBeenCalledWith(
      "App\\Model\\ProductRepository",
    );
  });

  it("navigates an includes: entry to the relative .neon file", async () => {
    const openTarget = vi.fn(async () => true);
    const readFileContent = vi.fn(async () => "parameters:\n");
    const deps = makeDeps({ openTarget, readFileContent });
    const neon = createNeonIntelligence(() => deps);
    const source = "includes:\n    - parameters.neon\n    - services.neon\n";
    const offset = source.indexOf("parameters.neon") + 2;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(true);
    expect(readFileContent).toHaveBeenCalledWith(
      "/ws/config/parameters.neon",
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/config/parameters.neon",
      { column: 1, lineNumber: 1 },
      "parameters.neon",
    );
  });

  it("resolves a ../ parent include against the current file's directory", async () => {
    const openTarget = vi.fn(async () => true);
    const readFileContent = vi.fn(async () => "parameters:\n");
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/config/services.neon` }),
      openTarget,
      readFileContent,
    });
    const neon = createNeonIntelligence(() => deps);
    const source = "includes:\n    - ../common.neon\n";
    const offset = source.indexOf("../common.neon") + 3;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/common.neon",
      { column: 1, lineNumber: 1 },
      "../common.neon",
    );
  });

  it("returns false when the included file does not exist", async () => {
    const openTarget = vi.fn(async () => true);
    const readFileContent = vi.fn(async () => {
      throw new Error("missing");
    });
    const deps = makeDeps({ openTarget, readFileContent });
    const neon = createNeonIntelligence(() => deps);
    const source = "includes:\n    - missing.neon\n";
    const offset = source.indexOf("missing.neon") + 2;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("does nothing when the Nette framework is inactive", async () => {
    const openClassTarget = vi.fn(async () => true);
    const deps = makeDeps({ isNetteFrameworkActive: false, openClassTarget });
    const neon = createNeonIntelligence(() => deps);
    const source = "services:\n    router: App\\Router\\RouterFactory\n";
    const offset = source.indexOf("App\\Router\\RouterFactory") + 2;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(openClassTarget).not.toHaveBeenCalled();
  });

  it("does nothing when the semantic tier is inactive", async () => {
    const openClassTarget = vi.fn(async () => true);
    const deps = makeDeps({
      isSemanticIntelligenceActive: false,
      openClassTarget,
    });
    const neon = createNeonIntelligence(() => deps);
    const source = "services:\n    router: App\\Router\\RouterFactory\n";
    const offset = source.indexOf("App\\Router\\RouterFactory") + 2;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(openClassTarget).not.toHaveBeenCalled();
  });

  it("drops an include navigation when the root changes during the read", async () => {
    const rootRef = { current: ROOT };
    const openTarget = vi.fn(async () => true);
    const readFileContent = vi.fn(async () => {
      rootRef.current = "/other";
      return "parameters:\n";
    });
    const deps = makeDeps({
      currentWorkspaceRootRef: rootRef,
      openTarget,
      readFileContent,
    });
    const neon = createNeonIntelligence(() => deps);
    const source = "includes:\n    - parameters.neon\n";
    const offset = source.indexOf("parameters.neon") + 2;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("returns false off any navigable construct", async () => {
    const deps = makeDeps();
    const neon = createNeonIntelligence(() => deps);
    const source = "parameters:\n    debug: true\n";
    const offset = source.indexOf("debug");

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(
      false,
    );
  });
});

describe("createNeonIntelligence completions", () => {
  it("offers class-name completions in a services value position", async () => {
    const searchClassNames = vi.fn(async () => [
      "App\\Mailer\\Mailer",
      "App\\Mapper\\Mapper",
    ]);
    const deps = makeDeps({ searchClassNames });
    const neon = createNeonIntelligence(() => deps);
    const source = "services:\n    x:\n        factory: App\\Ma";
    const offset = source.length;
    const completions = await neon.provideNeonCompletions(
      source,
      positionAtOffset(source, offset),
    );
    const labels = completions.map((completion) => completion.label);

    expect(labels).toContain("App\\Mailer\\Mailer");
    expect(labels).toContain("App\\Mapper\\Mapper");
    expect(completions.every((completion) => completion.kind === "class")).toBe(
      true,
    );
    expect(completions[0]).toMatchObject({
      replaceStart: source.indexOf("App\\Ma"),
      replaceEnd: source.length,
    });
  });

  it("passes the typed prefix through to the class-name search", async () => {
    const searchClassNames = vi.fn(async () => []);
    const deps = makeDeps({ searchClassNames });
    const neon = createNeonIntelligence(() => deps);
    const source = "services:\n    x:\n        factory: App\\Ma";
    const offset = source.length;

    await neon.provideNeonCompletions(source, positionAtOffset(source, offset));

    expect(searchClassNames).toHaveBeenCalledWith(
      ROOT,
      "App\\Ma",
      expect.any(Number),
    );
  });

  it("offers nothing outside the services section", async () => {
    const searchClassNames = vi.fn(async () => ["App\\Foo"]);
    const deps = makeDeps({ searchClassNames });
    const neon = createNeonIntelligence(() => deps);
    const source = "parameters:\n    repo: App\\";
    const offset = source.length;

    await expect(
      neon.provideNeonCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
    expect(searchClassNames).not.toHaveBeenCalled();
  });

  it("returns nothing when the Nette framework is inactive", async () => {
    const searchClassNames = vi.fn(async () => ["App\\Foo"]);
    const deps = makeDeps({ isNetteFrameworkActive: false, searchClassNames });
    const neon = createNeonIntelligence(() => deps);
    const source = "services:\n    - App\\";
    const offset = source.length;

    await expect(
      neon.provideNeonCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
    expect(searchClassNames).not.toHaveBeenCalled();
  });

  it("drops completions when the root changes during the class search", async () => {
    const rootRef = { current: ROOT };
    const searchClassNames = vi.fn(async () => {
      rootRef.current = "/other";
      return ["App\\Foo"];
    });
    const deps = makeDeps({
      currentWorkspaceRootRef: rootRef,
      searchClassNames,
    });
    const neon = createNeonIntelligence(() => deps);
    const source = "services:\n    - App\\";
    const offset = source.length;

    await expect(
      neon.provideNeonCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
  });
});

describe("useNeonIntelligence hook mount", () => {
  function renderHook(deps: NeonIntelligenceDependencies) {
    const container = document.createElement("div");
    const root = createRoot(container);
    const captured: { api: NeonIntelligence | null } = { api: null };

    function Harness({
      dependencies,
    }: {
      dependencies: NeonIntelligenceDependencies;
    }) {
      captured.api = useNeonIntelligence(dependencies);
      return null;
    }

    act(() => {
      root.render(<Harness dependencies={deps} />);
    });

    return {
      captured,
      rerender: (next: NeonIntelligenceDependencies) => {
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

    expect(typeof firstApi?.provideNeonDefinition).toBe("function");
    expect(typeof firstApi?.provideNeonCompletions).toBe("function");
    await expect(
      firstApi?.provideNeonCompletions("services:\n    - App\\", {
        column: 10,
        lineNumber: 2,
      }),
    ).resolves.toEqual([]);

    harness.rerender(makeDeps({ isNetteFrameworkActive: false }));
    expect(harness.captured.api).toBe(firstApi);

    harness.unmount();
  });
});

describe("createNeonIntelligence %param% definition (Fáza 3)", () => {
  it("navigates a %param% to its same-file parameters: leaf without any I/O", async () => {
    const openTarget = vi.fn(async () => true);
    const listDirectory = vi.fn(async () => {
      throw new Error("should not scan for a same-file hit");
    });
    const deps = makeDeps({ listDirectory, openTarget });
    const neon = createNeonIntelligence(() => deps);
    const source = "parameters:\n    dbHost: localhost\n    dsn: %dbHost%\n";
    const offset = source.indexOf("%dbHost%") + 2;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/config/config.neon",
      expect.objectContaining({ lineNumber: 2 }),
      "%dbHost%",
    );
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it("navigates a %param% defined in another config file (cross-file)", async () => {
    const { listDirectory, readFileContent } = buildNeonWorkspace({
      "config/config.neon": "parameters:\n    dsn: %dbHost%\n",
      "config/parameters.neon": "parameters:\n    dbHost: localhost\n",
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ listDirectory, openTarget, readFileContent });
    const neon = createNeonIntelligence(() => deps);
    const source = "parameters:\n    dsn: %dbHost%\n";
    const offset = source.indexOf("%dbHost%") + 2;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/config/parameters.neon",
      expect.objectContaining({ lineNumber: 2 }),
      "%dbHost%",
    );
  });

  it("returns false for a %param% defined nowhere", async () => {
    const { listDirectory, readFileContent } = buildNeonWorkspace({
      "config/config.neon": "parameters:\n    dsn: %missing%\n",
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ listDirectory, openTarget, readFileContent });
    const neon = createNeonIntelligence(() => deps);
    const source = "parameters:\n    dsn: %missing%\n";
    const offset = source.indexOf("%missing%") + 2;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("does nothing when the Nette framework is inactive", async () => {
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ isNetteFrameworkActive: false, openTarget });
    const neon = createNeonIntelligence(() => deps);
    const source = "parameters:\n    dbHost: localhost\n    dsn: %dbHost%\n";
    const offset = source.indexOf("%dbHost%") + 2;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(
      false,
    );
    expect(openTarget).not.toHaveBeenCalled();
  });
});

describe("createNeonIntelligence @service definition (Fáza 3)", () => {
  it("navigates a named @service to its same-file services: entry", async () => {
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ openTarget });
    const neon = createNeonIntelligence(() => deps);
    const source =
      "services:\n    logger: Monolog\\Logger\n    app:\n        arguments: [@logger]\n";
    const offset = source.indexOf("[@logger]") + 2;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/config/config.neon",
      expect.objectContaining({ lineNumber: 2 }),
      "@logger",
    );
  });

  it("navigates a class-typed @\\App\\Class reference via the class index", async () => {
    const openClassTarget = vi.fn(async () => true);
    const deps = makeDeps({ openClassTarget });
    const neon = createNeonIntelligence(() => deps);
    const source =
      "services:\n    app:\n        arguments: [@\\App\\Model\\Foo]\n";
    const offset = source.indexOf("@\\App\\Model\\Foo") + 3;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(true);
    expect(openClassTarget).toHaveBeenCalledWith("App\\Model\\Foo");
  });

  it("navigates a named @service defined in another config file (cross-file)", async () => {
    const { listDirectory, readFileContent } = buildNeonWorkspace({
      "config/config.neon":
        "services:\n    app:\n        arguments: [@logger]\n",
      "config/services.neon": "services:\n    logger: Monolog\\Logger\n",
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ listDirectory, openTarget, readFileContent });
    const neon = createNeonIntelligence(() => deps);
    const source = "services:\n    app:\n        arguments: [@logger]\n";
    const offset = source.indexOf("[@logger]") + 2;

    await expect(neon.provideNeonDefinition(source, offset)).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/config/services.neon",
      expect.objectContaining({ lineNumber: 2 }),
      "@logger",
    );
  });
});

describe("createNeonIntelligence %param% + @service completion (Fáza 3)", () => {
  it("offers merged same-file + cross-file parameter names after %", async () => {
    const { listDirectory, readFileContent } = buildNeonWorkspace({
      "config/config.neon": "parameters:\n    dbHost: localhost\n    dsn: %db\n",
      "config/params.neon": "parameters:\n    dbPassword: secret\n",
    });
    const deps = makeDeps({ listDirectory, readFileContent });
    const neon = createNeonIntelligence(() => deps);
    const source = "parameters:\n    dbHost: localhost\n    dsn: %db\n";
    const offset = source.indexOf("%db") + 3;
    const completions = await neon.provideNeonCompletions(
      source,
      positionAtOffset(source, offset),
    );
    const labels = completions.map((completion) => completion.label);

    expect(labels).toContain("dbHost");
    expect(labels).toContain("dbPassword");
    expect(
      completions.every((completion) => completion.kind === "parameter"),
    ).toBe(true);
  });

  it("offers merged same-file + cross-file service names after @", async () => {
    const { listDirectory, readFileContent } = buildNeonWorkspace({
      "config/config.neon":
        "services:\n    app:\n        arguments: [@lo]\n",
      "config/services.neon": "services:\n    logger: Monolog\\Logger\n",
    });
    const deps = makeDeps({ listDirectory, readFileContent });
    const neon = createNeonIntelligence(() => deps);
    const source = "services:\n    app:\n        arguments: [@lo]\n";
    const offset = source.indexOf("[@lo]") + 4;
    const completions = await neon.provideNeonCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.map((completion) => completion.label)).toContain(
      "logger",
    );
    expect(
      completions.every((completion) => completion.kind === "service"),
    ).toBe(true);
  });

  it("returns nothing for %param% completion when Nette is inactive", async () => {
    const listDirectory = vi.fn(async () => {
      throw new Error("no directory");
    });
    const deps = makeDeps({ isNetteFrameworkActive: false, listDirectory });
    const neon = createNeonIntelligence(() => deps);
    const source = "parameters:\n    dsn: %db\n";
    const offset = source.indexOf("%db") + 3;

    await expect(
      neon.provideNeonCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it("drops %param% completions when the root changes during the scan", async () => {
    const rootRef = { current: ROOT };
    const built = buildNeonWorkspace({
      "config/config.neon": "parameters:\n    dsn: %db\n",
      "config/params.neon": "parameters:\n    dbPassword: secret\n",
    });
    const listDirectory = vi.fn(async (path: string) => {
      rootRef.current = "/other";
      return built.listDirectory(path);
    });
    const deps = makeDeps({
      currentWorkspaceRootRef: rootRef,
      listDirectory,
      readFileContent: built.readFileContent,
    });
    const neon = createNeonIntelligence(() => deps);
    const source = "parameters:\n    dsn: %db\n";
    const offset = source.indexOf("%db") + 3;

    await expect(
      neon.provideNeonCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
  });
});

describe("createNeonIntelligence config cache lifecycle (Fáza 3)", () => {
  it("evicts another root's cached config once a different root becomes active", async () => {
    const cache: NeonConfigCache = {};
    const rootA = "/ws-a";
    const rootB = "/ws-b";
    const source = "parameters:\n    dsn: %db\n";
    const offset = source.indexOf("%db") + 3;

    const workspaceA = buildNeonWorkspace(
      {
        "config/config.neon": source,
        "config/params.neon": "parameters:\n    dbHost: a\n",
      },
      rootA,
    );
    const depsA = makeDeps({
      currentWorkspaceRootRef: { current: rootA },
      getActiveDocument: () => ({ path: `${rootA}/config/config.neon` }),
      listDirectory: workspaceA.listDirectory,
      readFileContent: workspaceA.readFileContent,
      workspaceRoot: rootA,
    });
    const neonA = createNeonIntelligence(() => depsA, cache);

    await neonA.provideNeonCompletions(source, positionAtOffset(source, offset));
    expect(Object.keys(cache)).toEqual([rootA]);

    const workspaceB = buildNeonWorkspace(
      {
        "config/config.neon": source,
        "config/params.neon": "parameters:\n    dbHost: b\n",
      },
      rootB,
    );
    const depsB = makeDeps({
      currentWorkspaceRootRef: { current: rootB },
      getActiveDocument: () => ({ path: `${rootB}/config/config.neon` }),
      listDirectory: workspaceB.listDirectory,
      readFileContent: workspaceB.readFileContent,
      workspaceRoot: rootB,
    });
    const neonB = createNeonIntelligence(() => depsB, cache);

    await neonB.provideNeonCompletions(source, positionAtOffset(source, offset));

    expect(Object.keys(cache)).toEqual([rootB]);
  });
});
