import { describe, expect, it, vi } from "vitest";
import type {
  LatteDirectoryEntry,
  LatteTemplateCache,
} from "./netteTemplateDiscovery";
import {
  latteTemplateCompletions,
  type NetteTemplateCompletionContext,
} from "./netteTemplateCompletions";

const ROOT = "/ws";

function buildWorkspace(relativePaths: string[], root: string = ROOT) {
  const directories = new Map<string, Map<string, LatteDirectoryEntry>>();

  const ensureDirectory = (directory: string): void => {
    if (!directories.has(directory)) {
      directories.set(directory, new Map());
    }
  };

  for (const relativePath of relativePaths) {
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

  return { listDirectory };
}

function completionContext({
  currentTemplateRelativePath = "app/UI/Home/default.latte",
  listDirectory = vi.fn(async () => {
    throw new Error("no directory");
  }),
  rootActive = true,
}: {
  currentTemplateRelativePath?: string;
  listDirectory?: (path: string) => Promise<LatteDirectoryEntry[]>;
  rootActive?: boolean;
} = {}) {
  const cache: LatteTemplateCache = {};

  return {
    cache,
    context: {
      cache,
      currentTemplateRelativePath,
      deps: {
        joinPath: (root, relativePath) => `${root}/${relativePath}`,
        listDirectory,
        toRelativePath: (root, path) =>
          path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
      },
      isRequestedRootActive: () => rootActive,
      maxCompletions: 100,
      maxDepth: 12,
      maxTemplates: 2_000,
      requestedRoot: ROOT,
      scanDirectories: ["app", "templates"],
      ttlMs: 5_000,
    } satisfies NetteTemplateCompletionContext,
  };
}

describe("latteTemplateCompletions", () => {
  it("offers relative include references and excludes the current template", async () => {
    const { listDirectory } = buildWorkspace([
      "app/UI/Home/default.latte",
      "app/UI/Home/partials/menu.latte",
      "app/UI/About/about.latte",
    ]);
    const { context } = completionContext({ listDirectory });

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
    const { context } = completionContext({
      currentTemplateRelativePath:
        "app/modules/efabricaSubscriptionsModule/templates/Dashboard/default.latte",
      listDirectory,
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
    const { context } = completionContext({ listDirectory });
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
    const { context } = completionContext({
      listDirectory: vi.fn(async (path: string) => {
        rootActive = false;
        return listDirectory(path);
      }),
    });
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
