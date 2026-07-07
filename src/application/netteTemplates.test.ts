import { describe, expect, it, vi } from "vitest";
import {
  isLatteScanSkippedDirectory,
  latteTemplateCompletions,
  resolveLatteTemplateDefinition,
  type LatteDirectoryEntry,
  type LatteTemplateCache,
  type NetteTemplateDependencies,
} from "./netteTemplates";
import { detectLatteReferenceAt } from "../domain/latteNavigation";

const ROOT = "/ws";

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
  overrides: Partial<NetteTemplateDependencies> = {},
): NetteTemplateDependencies {
  return {
    joinPath: (root, relativePath) => `${root}/${relativePath}`,
    listDirectory: vi.fn(async () => {
      throw new Error("no directory");
    }),
    openTarget: vi.fn(async () => true),
    readFileContent: vi.fn(async () => {
      throw new Error("no file");
    }),
    toRelativePath: (root, path) =>
      path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
    ...overrides,
  };
}

function completionContext({
  currentTemplateRelativePath = "app/UI/Home/default.latte",
  deps = makeDeps(),
  rootActive = true,
}: {
  currentTemplateRelativePath?: string;
  deps?: NetteTemplateDependencies;
  rootActive?: boolean;
} = {}) {
  const cache: LatteTemplateCache = {};

  return {
    cache,
    context: {
      cache,
      currentTemplateRelativePath,
      deps,
      isRequestedRootActive: () => rootActive,
      maxCompletions: 100,
      maxDepth: 12,
      maxTemplates: 2_000,
      requestedRoot: ROOT,
      scanDirectories: ["app", "templates"],
      ttlMs: 5_000,
    },
  };
}

describe("latteTemplateCompletions", () => {
  it("offers relative include references and excludes the current template", async () => {
    const { listDirectory } = buildWorkspace([
      "app/UI/Home/default.latte",
      "app/UI/Home/partials/menu.latte",
      "app/UI/About/about.latte",
    ]);
    const deps = makeDeps({ listDirectory });
    const { context } = completionContext({ deps });

    const completions = await latteTemplateCompletions(context, {
      prefix: "",
      replaceEnd: 11,
      replaceStart: 10,
    });

    const inserts = completions.map((completion) => completion.insertText);
    expect(inserts).toContain("partials/menu.latte");
    expect(inserts).toContain("../About/about.latte");
    expect(inserts).not.toContain("default.latte");
    expect(completions.every((completion) => completion.kind === "template"))
      .toBe(true);
  });

  it("also offers module template-root references for Nette module templates", async () => {
    const { listDirectory } = buildWorkspace([
      "app/modules/efabricaSubscriptionsModule/templates/Dashboard/default.latte",
      "app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/partials/@showHeader.latte",
    ]);
    const deps = makeDeps({ listDirectory });
    const { context } = completionContext({
      currentTemplateRelativePath:
        "app/modules/efabricaSubscriptionsModule/templates/Dashboard/default.latte",
      deps,
    });

    const completions = await latteTemplateCompletions(context, {
      prefix: "SubscriptionTypeGroupAdmin/",
      replaceEnd: 30,
      replaceStart: 1,
    });

    expect(completions.map((completion) => completion.insertText)).toContain(
      "SubscriptionTypeGroupAdmin/partials/@showHeader.latte",
    );
  });

  it("caches a root scan across completion requests", async () => {
    const { listDirectory } = buildWorkspace([
      "app/UI/Home/default.latte",
      "app/UI/Home/partials/menu.latte",
    ]);
    const deps = makeDeps({ listDirectory });
    const { context } = completionContext({ deps });
    const request = { prefix: "", replaceEnd: 11, replaceStart: 10 };

    await latteTemplateCompletions(context, request);
    const callsAfterFirst = listDirectory.mock.calls.length;
    await latteTemplateCompletions(context, request);

    expect(listDirectory.mock.calls.length).toBe(callsAfterFirst);
  });

  it("stops when the active root changes during a scan", async () => {
    let rootActive = true;
    const { listDirectory } = buildWorkspace([
      "app/UI/Home/partials/menu.latte",
    ]);
    const deps = makeDeps({
      listDirectory: vi.fn(async (path: string) => {
        rootActive = false;
        return listDirectory(path);
      }),
    });
    const { context } = completionContext({ deps });
    context.isRequestedRootActive = () => rootActive;

    await expect(
      latteTemplateCompletions(context, {
        prefix: "",
        replaceEnd: 11,
        replaceStart: 10,
      }),
    ).resolves.toEqual([]);
  });
});

describe("resolveLatteTemplateDefinition", () => {
  it("navigates a quoted include reference to the first existing candidate", async () => {
    const { readFileContent } = buildWorkspace([
      "app/UI/Home/partials/menu.latte",
    ]);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ openTarget, readFileContent });
    const source = "{include 'partials/menu'}";
    const reference = detectLatteReferenceAt(source, source.indexOf("menu"));

    await expect(
      resolveLatteTemplateDefinition(
        {
          currentTemplateRelativePath: "app/UI/Home/default.latte",
          deps,
          isRequestedRootActive: () => true,
          requestedRoot: ROOT,
        },
        reference,
        source,
        source.indexOf("menu"),
      ),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Home/partials/menu.latte",
      { column: 1, lineNumber: 1 },
      "partials/menu",
    );
  });

  it("navigates a bare layout macro to the nearest @layout.latte", async () => {
    const { readFileContent } = buildWorkspace([
      "app/UI/Home/@layout.latte",
      "app/UI/@layout.latte",
    ]);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ openTarget, readFileContent });
    const source = "{layout}";

    await expect(
      resolveLatteTemplateDefinition(
        {
          currentTemplateRelativePath: "app/UI/Home/default.latte",
          deps,
          isRequestedRootActive: () => true,
          requestedRoot: ROOT,
        },
        null,
        source,
        source.indexOf("layout") + 1,
      ),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Home/@layout.latte",
      { column: 1, lineNumber: 1 },
      "@layout",
    );
  });

  it("does not treat {layout none} as a bare layout navigation target", async () => {
    const { readFileContent } = buildWorkspace(["app/UI/Home/@layout.latte"]);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ openTarget, readFileContent });
    const source = "{layout none}";

    await expect(
      resolveLatteTemplateDefinition(
        {
          currentTemplateRelativePath: "app/UI/Home/default.latte",
          deps,
          isRequestedRootActive: () => true,
          requestedRoot: ROOT,
        },
        null,
        source,
        source.indexOf("layout") + 1,
      ),
    ).resolves.toBe(false);
    expect(openTarget).not.toHaveBeenCalled();
  });
});

describe("isLatteScanSkippedDirectory", () => {
  it("skips generated and dependency directories by basename", () => {
    expect(isLatteScanSkippedDirectory("/ws/app/vendor")).toBe(true);
    expect(isLatteScanSkippedDirectory("/ws/app/node_modules")).toBe(true);
    expect(isLatteScanSkippedDirectory("/ws/app/UI/Home")).toBe(false);
  });
});
