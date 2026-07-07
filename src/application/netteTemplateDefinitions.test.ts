import { describe, expect, it, vi } from "vitest";
import { detectLatteReferenceAt } from "../domain/latteNavigation";
import type { LatteDirectoryEntry } from "./netteTemplateDiscovery";
import {
  resolveLatteTemplateDefinition,
  type NetteTemplateDependencies,
} from "./netteTemplateDefinitions";

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

  const readFileContent = vi.fn(async (path: string): Promise<string> => {
    if (!fileSet.has(path)) {
      throw new Error(`no such file: ${path}`);
    }

    return "template body";
  });

  return { readFileContent };
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
