// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  createNeonIntelligence,
  useNeonIntelligence,
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
