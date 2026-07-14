// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  nettePresenterActionMethodCandidates,
  nettePresenterClassCandidatePathsForLink,
  parseNetteLinkTarget,
} from "../domain/latteLinkNavigation";
import {
  phpNetteFrameworkProvider,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  createLatteFrameworkCapabilities,
  createLatteIntelligence,
  useLatteIntelligence,
  type LatteDirectoryEntry,
  type LatteIntelligence,
  type LatteIntelligenceDependencies,
  type LatteTemplateCache,
  type LatteViewDataCache,
} from "./useLatteIntelligence";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

const ROOT = "/ws";
const NETTE_FRAMEWORK = createPhpFrameworkIntelligence({
  matchedProviderIds: ["nette"],
  profile: "nette",
  providers: [phpNetteFrameworkProvider],
});
const GENERIC_FRAMEWORK = createPhpFrameworkIntelligence({
  matchedProviderIds: [],
  profile: "generic",
  providers: [],
});
const STALE_NETTE_PROFILE_WITHOUT_PROVIDER = createPhpFrameworkIntelligence({
  matchedProviderIds: [],
  profile: "nette",
  providers: [],
});
const CUSTOM_LATTE_TEMPLATE_PROVIDER: PhpFrameworkProvider = {
  id: "custom-latte-template",
  latte: {
    supportsTemplateIntelligence: true,
  },
};
const CUSTOM_LATTE_TEMPLATE_FRAMEWORK = createPhpFrameworkIntelligence({
  matchedProviderIds: [CUSTOM_LATTE_TEMPLATE_PROVIDER.id],
  profile: "generic",
  providers: [CUSTOM_LATTE_TEMPLATE_PROVIDER],
});
const CUSTOM_LATTE_VIEW_DATA_PROVIDER: PhpFrameworkProvider = {
  id: "custom-latte-view-data",
  latte: {
    supportsTemplateIntelligence: true,
  },
  viewData: {
    entryFromSource: ({ source }) => ({
      bindings: source.includes("assignView(")
        ? [
            {
              variables: [
                {
                  detail: "$custom",
                  name: "$custom",
                  typeHint: "App\\Model\\Custom",
                  valueExpression: "$custom",
                  valueOffset: source.indexOf("$custom"),
                },
              ],
              viewName: "Home:default",
            },
          ]
        : [],
      source,
    }),
    searchQueries: ["assignView("],
  },
};
const CUSTOM_LATTE_VIEW_DATA_FRAMEWORK = createPhpFrameworkIntelligence({
  matchedProviderIds: [CUSTOM_LATTE_VIEW_DATA_PROVIDER.id],
  profile: "generic",
  providers: [CUSTOM_LATTE_VIEW_DATA_PROVIDER],
});
const CUSTOM_LATTE_LINK_PROVIDER: PhpFrameworkProvider = {
  id: "custom-latte-link",
  latte: {
    parsePresenterLinkTarget: ({ target }) => parseNetteLinkTarget(target),
    presenterActionMethodCandidates: ({ action, isSignal }) =>
      nettePresenterActionMethodCandidates(action, isSignal),
    presenterClassCandidatePathsForLink: ({ currentRelativePath, target }) =>
      nettePresenterClassCandidatePathsForLink(target, currentRelativePath),
    supportsPresenterLinkIntelligence: true,
    supportsTemplateIntelligence: true,
  },
  php: {
    presenterLinkAt: ({ offset, source }) => {
      const completion = customPhpPresenterLinkCompletionAt(source, offset);

      if (!completion) {
        return null;
      }

      return {
        call: "jumpTo",
        target: source.slice(completion.replaceStart, completion.replaceEnd),
        targetEnd: completion.replaceEnd,
        targetStart: completion.replaceStart,
      };
    },
    presenterLinkCompletionAt: ({ offset, source }) =>
      customPhpPresenterLinkCompletionAt(source, offset),
  },
};
const CUSTOM_LATTE_LINK_FRAMEWORK = createPhpFrameworkIntelligence({
  matchedProviderIds: [CUSTOM_LATTE_LINK_PROVIDER.id],
  profile: "generic",
  providers: [CUSTOM_LATTE_LINK_PROVIDER],
});

function customPhpPresenterLinkCompletionAt(source: string, offset: number) {
  const callStart = source.indexOf("$this->jumpTo('");

  if (callStart < 0) {
    return null;
  }

  const replaceStart = source.indexOf("'", callStart) + 1;
  const replaceEnd = source.indexOf("'", replaceStart);

  if (offset < replaceStart || offset > replaceEnd) {
    return null;
  }

  return {
    prefix: source.slice(replaceStart, offset),
    replaceEnd,
    replaceStart,
  };
}

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
    collectTranslationTargets: vi.fn(async () => []),
    currentWorkspaceRootRef: { current: ROOT },
    findTranslationTarget: vi.fn(async () => null),
    frameworkIntelligence: NETTE_FRAMEWORK,
    getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
    isSemanticIntelligenceActive: true,
    joinPath: (root, relativePath) => `${root}/${relativePath}`,
    listDirectory: vi.fn(async () => {
      throw new Error("no directory");
    }),
    openPhpMethodTarget: vi.fn(async () => false),
    openPhpPropertyTarget: vi.fn(async () => false),
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

function neonFilterWorkspaceOverrides(
  root: string,
  filterName: string,
): Partial<LatteIntelligenceDependencies> {
  const configPath = `${root}/app/config/config.neon`;
  const neon = [
    "services:",
    "    filterLoader:",
    "        setup:",
    `            - register('${filterName}', [@templateHelper, process])`,
    "    scenariosGenericEventsManager:",
    "        setup:",
    "            - register('generate_password_reset_url', App\\Scenarios\\GeneratePasswordResetUrl())",
    "",
  ].join("\n");

  return {
    listDirectory: vi.fn(async (path: string): Promise<LatteDirectoryEntry[]> => {
      if (path === `${root}/app`) {
        return [{ kind: "directory", path: `${root}/app/config` }];
      }

      if (path === `${root}/app/config`) {
        return [{ kind: "file", path: configPath }];
      }

      throw new Error(`no such directory: ${path}`);
    }),
    readFileContent: vi.fn(async (path: string): Promise<string> => {
      if (path === configPath) {
        return neon;
      }

      throw new Error(`no such file: ${path}`);
    }),
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

  it("does not open an include after the navigation request goes stale", async () => {
    let navigationAllowed = true;
    const openTarget = vi.fn(async () => true);
    const readFileContent = vi.fn(async () => {
      navigationAllowed = false;

      return "template body";
    });
    const deps = makeDeps({ readFileContent, openTarget });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include 'partials/menu'}";
    const offset = source.indexOf("menu");

    await expect(
      latte.provideLatteDefinition(source, offset, {
        canNavigate: () => navigationAllowed,
      }),
    ).resolves.toBe(false);
    expect(readFileContent).toHaveBeenCalled();
    expect(openTarget).not.toHaveBeenCalled();
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

  it("navigates a NEON filter to its registration even when its service is defined elsewhere", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/config/filters.neon": [
        "services:",
        "    filterLoader:",
        "        setup:",
        "            - addFilter('UserDate', [@userDateFilter, format])",
        "",
      ].join("\n"),
      "config/services.neon": [
        "services:",
        "    userDateFilter:",
        "        class: App\\Filters\\UserDateFilter",
        "",
      ].join("\n"),
    });
    const openPhpMethodTarget = vi.fn(async () => true);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      listDirectory,
      openPhpMethodTarget,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$createdAt|UserDate}";

    await expect(
      latte.provideLatteDefinition(source, source.indexOf("UserDate")),
    ).resolves.toBe(true);

    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/config/filters.neon`,
      expect.any(Object),
      "UserDate",
    );
    expect(openPhpMethodTarget).not.toHaveBeenCalled();
  });

  it("does not scan the active template directory as NEON project config for filters", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Home/default.latte": "{$createdAt|UserDate}",
      "app/UI/Home/services.neon": [
        "services:",
        "    userDateFilter:",
        "        class: App\\Filters\\WrongTemplateLocalFilter",
        "",
      ].join("\n"),
      "app/config/filters.neon": [
        "services:",
        "    filterLoader:",
        "        setup:",
        "            - addFilter('UserDate', [@userDateFilter, format])",
        "",
      ].join("\n"),
      "config/services.neon": [
        "services:",
        "    userDateFilter:",
        "        class: App\\Filters\\UserDateFilter",
        "",
      ].join("\n"),
    });
    const openPhpMethodTarget = vi.fn(async () => true);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      listDirectory,
      openPhpMethodTarget,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$createdAt|UserDate}";

    await expect(
      latte.provideLatteDefinition(source, source.indexOf("UserDate")),
    ).resolves.toBe(true);

    expect(openTarget).toHaveBeenCalledWith(
      `${ROOT}/app/config/filters.neon`,
      expect.any(Object),
      "UserDate",
    );
    expect(openPhpMethodTarget).not.toHaveBeenCalled();
  });

  it("keeps filter registration navigation stable after project config cache invalidation", async () => {
    let serviceClassName = "App\\Filters\\OldUserDateFilter";
    const workspace = buildContentWorkspace({
      "app/config/filters.neon": [
        "services:",
        "    filterLoader:",
        "        setup:",
        "            - addFilter('UserDate', [@userDateFilter, format])",
        "",
      ].join("\n"),
      "config/services.neon": "",
    });
    const readFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/config/services.neon`) {
        return [
          "services:",
          "    userDateFilter:",
          `        class: ${serviceClassName}`,
          "",
        ].join("\n");
      }

      return workspace.readFileContent(path);
    });
    const openPhpMethodTarget = vi.fn(async () => true);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      listDirectory: workspace.listDirectory,
      openPhpMethodTarget,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$createdAt|UserDate}";

    await expect(
      latte.provideLatteDefinition(source, source.indexOf("UserDate")),
    ).resolves.toBe(true);
    serviceClassName = "App\\Filters\\NewUserDateFilter";
    latte.invalidateNeonConfigForPath(ROOT, `${ROOT}/config/services.neon`);
    await expect(
      latte.provideLatteDefinition(source, source.indexOf("UserDate")),
    ).resolves.toBe(true);

    expect(openTarget).toHaveBeenNthCalledWith(
      1,
      `${ROOT}/app/config/filters.neon`,
      expect.any(Object),
      "UserDate",
    );
    expect(openTarget).toHaveBeenNthCalledWith(
      2,
      `${ROOT}/app/config/filters.neon`,
      expect.any(Object),
      "UserDate",
    );
    expect(openPhpMethodTarget).not.toHaveBeenCalled();
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

  it("lets a custom Latte provider resolve templates without Nette presenter links", async () => {
    const templateWorkspace = buildWorkspace([
      "app/UI/Home/partials/menu.latte",
    ]);
    const templateOpenTarget = vi.fn(async () => true);
    const templateDeps = makeDeps({
      frameworkIntelligence: CUSTOM_LATTE_TEMPLATE_FRAMEWORK,
      openTarget: templateOpenTarget,
      readFileContent: templateWorkspace.readFileContent,
    });
    const templateLatte = createLatteIntelligence(() => templateDeps);
    const includeSource = "{include 'partials/menu'}";

    await expect(
      templateLatte.provideLatteDefinition(
        includeSource,
        includeSource.indexOf("menu"),
      ),
    ).resolves.toBe(true);
    expect(templateOpenTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Home/partials/menu.latte",
      { column: 1, lineNumber: 1 },
      "partials/menu",
    );

    const presenterWorkspace = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const presenterOpenTarget = vi.fn(async () => true);
    const presenterDeps = makeDeps({
      frameworkIntelligence: CUSTOM_LATTE_TEMPLATE_FRAMEWORK,
      listDirectory: presenterWorkspace.listDirectory,
      openTarget: presenterOpenTarget,
      readFileContent: presenterWorkspace.readFileContent,
    });
    const presenterLatte = createLatteIntelligence(() => presenterDeps);
    const linkSource = "{link Product:show}";

    await expect(
      presenterLatte.provideLatteDefinition(
        linkSource,
        linkSource.indexOf("Product:show") + 2,
      ),
    ).resolves.toBe(false);
    expect(presenterWorkspace.readFileContent).not.toHaveBeenCalled();
    expect(presenterOpenTarget).not.toHaveBeenCalled();
  });

  it("navigates ebox-crm style module template paths from the module templates root", async () => {
    const { readFileContent } = buildWorkspace([
      "app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/partials/@showHeader.latte",
    ]);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/modules/efabricaSubscriptionsModule/templates/Dashboard/default.latte`,
      }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source =
      "{include 'SubscriptionTypeGroupAdmin/partials/@showHeader.latte'}";
    const offset = source.indexOf("@showHeader");

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/partials/@showHeader.latte",
      { column: 1, lineNumber: 1 },
      "SubscriptionTypeGroupAdmin/partials/@showHeader.latte",
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

  it("navigates an {include #block} reference to the matching local block", async () => {
    const { readFileContent } = buildWorkspace([]);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/UI/Home/default.latte`,
      }),
      readFileContent,
      openTarget,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include #content}\n\n{block content}\n{/block}";

    await expect(
      latte.provideLatteDefinition(source, source.indexOf("content")),
    ).resolves.toBe(true);
    expect(readFileContent).not.toHaveBeenCalled();
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Home/default.latte",
      { column: 8, lineNumber: 3 },
      "content",
    );
  });

  it("navigates a {block} name to its own declaration position", async () => {
    const { readFileContent } = buildWorkspace([]);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/UI/Home/default.latte`,
      }),
      readFileContent,
      openTarget,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{block content}\n{/block}";

    await expect(
      latte.provideLatteDefinition(source, source.indexOf("content")),
    ).resolves.toBe(true);
    expect(readFileContent).not.toHaveBeenCalled();
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Home/default.latte",
      { column: 8, lineNumber: 1 },
      "content",
    );
  });

  it("navigates a Latte variable to its render-method presenter assignment", async () => {
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/UI/Home/HomePresenter.php": HOME_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ openTarget, readFileContent, searchText });
    const latte = createLatteIntelligence(() => deps);
    const source = "<h1>{$invoice}</h1>";
    const offset = source.indexOf("$invoice") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Home/HomePresenter.php",
      positionAtOffset(
        HOME_PRESENTER_SOURCE,
        HOME_PRESENTER_SOURCE.indexOf("$invoice;"),
      ),
      "$invoice",
    );
  });

  it("navigates a Latte variable to wildcard presenter data from beforeRender", async () => {
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/UI/Home/HomePresenter.php": HOME_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({ openTarget, readFileContent, searchText });
    const latte = createLatteIntelligence(() => deps);
    const source = "{if $menu}{$menu}{/if}";
    const offset = source.indexOf("$menu") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Home/HomePresenter.php",
      positionAtOffset(
        HOME_PRESENTER_SOURCE,
        HOME_PRESENTER_SOURCE.indexOf("$menu;"),
      ),
      "$menu",
    );
  });

  it("navigates a component template $control variable to the backing control class", async () => {
    const controlSource = `<?php
namespace App\\Components\\ProductList;

class ProductListControl extends Nette\\Application\\UI\\Control
{
}
`;
    const { readFileContent } = buildNettePresenterWorkspace({
      "app/Components/ProductList/ProductListControl.php": controlSource,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/Components/ProductList/product_list.latte`,
      }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$control}";
    const offset = source.indexOf("$control") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/Components/ProductList/ProductListControl.php",
      positionAtOffset(controlSource, controlSource.indexOf("ProductListControl")),
      "$control",
    );
  });

  it("navigates a Latte property expression through the typed PHP member context", async () => {
    const openPhpPropertyTarget = vi.fn(async () => true);
    const resolvePhpReceiverCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Model\\Consent",
        kind: "property" as const,
        name: "name",
        parameters: "",
        returnType: "string",
      },
    ]);
    const deps = makeDeps({
      openPhpPropertyTarget,
      resolvePhpReceiverCompletions,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{varType App\\Model\\Consent $consent}\n{$consent->name}";
    const offset = source.indexOf("name") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(resolvePhpReceiverCompletions).toHaveBeenCalledWith(
      expect.stringContaining("App\\Model\\Consent"),
      { column: 1, lineNumber: 3 },
      "$consent",
    );
    expect(openPhpPropertyTarget).toHaveBeenCalledWith(
      "App\\Model\\Consent",
      "name",
    );
    await expect(
      latte.provideLatteDefinitionOutcome(source, offset),
    ).resolves.toEqual({
      handled: true,
      shouldBlockFallback: true,
    });
  });

  it("blocks generic fallback for an unresolved Latte property expression", async () => {
    const resolvePhpReceiverCompletions = vi.fn(async () => []);
    const openPhpPropertyTarget = vi.fn(async () => true);
    const deps = makeDeps({
      openPhpPropertyTarget,
      resolvePhpReceiverCompletions,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{varType App\\Model\\Consent $consent}\n{$consent->name}";
    const offset = source.indexOf("name") + 2;

    await expect(
      latte.provideLatteDefinitionOutcome(source, offset),
    ).resolves.toEqual({
      handled: false,
      shouldBlockFallback: true,
    });
    expect(resolvePhpReceiverCompletions).toHaveBeenCalled();
    expect(openPhpPropertyTarget).not.toHaveBeenCalled();
  });

  it("does nothing when the Nette framework is not active", async () => {
    const { readFileContent } = buildWorkspace([
      "app/UI/Home/partials/menu.latte",
    ]);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      frameworkIntelligence: GENERIC_FRAMEWORK,
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

  it("offers module templates-root include candidates in module templates", async () => {
    const { listDirectory } = buildWorkspace([
      "app/modules/efabricaSubscriptionsModule/templates/Dashboard/default.latte",
      "app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/partials/@showHeader.latte",
    ]);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/modules/efabricaSubscriptionsModule/templates/Dashboard/default.latte`,
      }),
      listDirectory,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include 'SubscriptionTypeGroupAdmin/'}";
    const offset = source.indexOf("'}");
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.map((completion) => completion.insertText)).toContain(
      "SubscriptionTypeGroupAdmin/partials/@showHeader.latte",
    );
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
    const deps = makeDeps({
      frameworkIntelligence: GENERIC_FRAMEWORK,
      listDirectory,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{include ''}";
    const offset = source.indexOf("''") + 1;

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it("returns nothing for a stale Nette profile without the provider capability", async () => {
    const listDirectory = vi.fn(async () => {
      throw new Error("should not scan without the provider capability");
    });
    const deps = makeDeps({
      frameworkIntelligence: STALE_NETTE_PROFILE_WITHOUT_PROVIDER,
      listDirectory,
    });
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
    const deps = makeDeps({ frameworkIntelligence: GENERIC_FRAMEWORK });
    const harness = renderHook(deps);
    const firstApi = harness.captured.api;

    expect(
      typeof firstApi?.collectCompleteLatteTemplateRelativePaths,
    ).toBe("function");
    expect(typeof firstApi?.collectLatteTemplateRelativePaths).toBe("function");
    expect(typeof firstApi?.provideLatteDefinition).toBe("function");
    expect(typeof firstApi?.provideLatteCompletions).toBe("function");
    await expect(
      firstApi?.provideLatteCompletions("{for", { column: 5, lineNumber: 1 }),
    ).resolves.toEqual([]);

    harness.rerender(makeDeps({ frameworkIntelligence: GENERIC_FRAMEWORK }));
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

  it("collects template relative paths through the shared per-root cache", async () => {
    const cache: LatteTemplateCache = {};
    const { listDirectory } = buildWorkspace([
      "app/UI/Home/default.latte",
      "app/UI/Home/partials/card.latte",
    ]);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      listDirectory,
    });
    const latte = createLatteIntelligence(() => deps, cache);

    await expect(latte.collectLatteTemplateRelativePaths()).resolves.toEqual([
      "app/UI/Home/default.latte",
      "app/UI/Home/partials/card.latte",
    ]);
    expect(cache[ROOT]?.relativePaths).toEqual([
      "app/UI/Home/default.latte",
      "app/UI/Home/partials/card.latte",
    ]);
  });

  it("returns no complete template paths when the scan hits a safety limit", async () => {
    const manyRelativePaths = Array.from(
      { length: 2500 },
      (_, index) => `app/file${index}.latte`,
    );
    const { listDirectory } = buildWorkspace(manyRelativePaths);
    const cache: LatteTemplateCache = {};
    const deps = makeDeps({ listDirectory });
    const latte = createLatteIntelligence(() => deps, cache);

    await expect(latte.collectLatteTemplateRelativePaths()).resolves.not.toEqual(
      [],
    );
    await expect(
      latte.collectCompleteLatteTemplateRelativePaths(),
    ).resolves.toEqual([]);
    expect(cache[ROOT]?.complete).toBe(false);
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
    expect(cache[ROOT]?.complete).toBe(false);
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
    expect(cache[ROOT]?.complete).toBe(false);
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
  it("resolves a {templateType} property and dispatches typed member completion", async () => {
    const templateSource = `<?php
namespace App\\UI\\Product;

use App\\Model\\Product;
use Nette\\Bridges\\ApplicationLatte\\Template;

class ProductTemplate extends Template
{
    public Product $product;
}
`;
    const searchText = vi.fn(async (_root: string, query: string) =>
      query === "class ProductTemplate"
        ? [{ path: `${ROOT}/app/UI/Product/ProductTemplate.php` }]
        : [],
    );
    const readFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/app/UI/Product/ProductTemplate.php`) {
        return templateSource;
      }

      throw new Error(`no such file: ${path}`);
    });
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );
    const resolvePhpReceiverCompletions = vi.fn(async () => [
      {
        declaringClassName: "Product",
        name: "getName",
        parameters: "",
        returnType: "string",
      },
    ]);
    const resolveDeclaredType = vi.fn((source: string, typeHint: string | null) =>
      typeHint === "Product" && source.includes("namespace App\\UI\\Product")
        ? "App\\Model\\Product"
        : typeHint,
    );
    const deps = makeDeps({
      readFileContent,
      resolveDeclaredType,
      resolvePhpReceiverCompletions,
      searchText,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source =
      "{templateType App\\UI\\Product\\ProductTemplate}\n{$product->}";
    const offset = source.indexOf("->") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(searchText).toHaveBeenCalledWith(
      ROOT,
      "class ProductTemplate",
      50,
    );
    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "product",
      "App\\Model\\Product",
    );
    expect(completions.map((completion) => completion.label)).toContain(
      "getName",
    );
  });

  it("prefers an inline {varType} declaration over a {templateType} property", async () => {
    const searchText = vi.fn(async () => [
      { path: `${ROOT}/app/UI/Product/ProductTemplate.php` },
    ]);
    const readFileContent = vi.fn(async () => `<?php
namespace App\\UI\\Product;

use Nette\\Bridges\\ApplicationLatte\\Template;

class ProductTemplate extends Template
{
    public TemplateProduct $product;
}
`);
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
    const source =
      "{templateType App\\UI\\Product\\ProductTemplate}\n" +
      "{varType App\\Model\\InlineProduct $product}\n" +
      "{$product->}";
    const offset = source.lastIndexOf("->") + 2;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "product",
      "App\\Model\\InlineProduct",
    );
    expect(searchText).not.toHaveBeenCalled();
    expect(readFileContent).not.toHaveBeenCalled();
  });

  it("targets the requested {templateType} class when a PHP file contains multiple Template classes", async () => {
    const templateSource = `<?php
namespace App\\UI\\Product;

use Nette\\Bridges\\ApplicationLatte\\Template;

class OtherTemplate extends Template
{
    public OtherProduct $product;
}

class ProductTemplate extends Template
{
    public Product $product;
}
`;
    const searchText = vi.fn(async (_root: string, query: string) =>
      query === "class ProductTemplate"
        ? [{ path: `${ROOT}/app/UI/Product/Templates.php` }]
        : [],
    );
    const readFileContent = vi.fn(async () => templateSource);
    const resolveDeclaredType = vi.fn((source: string, typeHint: string | null) =>
      typeHint === "Product" && source.includes("namespace App\\UI\\Product")
        ? "App\\Model\\Product"
        : typeHint,
    );
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );
    const deps = makeDeps({
      readFileContent,
      resolveDeclaredType,
      resolvePhpReceiverCompletions: vi.fn(async () => []),
      searchText,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source =
      "{templateType App\\UI\\Product\\ProductTemplate}\n{$product->}";
    const offset = source.indexOf("->") + 2;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "product",
      "App\\Model\\Product",
    );
  });

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

  it("resolves a presenter property type when the assigned expression is conservative", async () => {
    const presenterSource = `<?php
namespace App\\UI\\UsersAdmin;

class UsersAdminPresenter extends BasePresenter
{
    /** @var \\App\\Model\\User */
    private $selectedUser;

    public function renderShow(): void
    {
        $this->template->user = $this->selectedUser;
    }
}
`;
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/UI/UsersAdmin/UsersAdminPresenter.php": presenterSource,
    });
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/UI/UsersAdmin/show.latte`,
      }),
      readFileContent,
      resolveExpressionType: vi.fn(async () => null),
      searchText,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$user->}";
    const offset = source.indexOf("->") + 2;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "user",
      "\\App\\Model\\User",
    );
  });

  it("types the implicit $presenter variable as the current presenter", async () => {
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
        declaringClassName: "HomePresenter",
        name: "link",
        parameters: "string $destination",
        returnType: "string",
      },
    ]);
    const deps = makeDeps({
      readFileContent,
      resolvePhpReceiverCompletions,
      searchText,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$presenter->}";
    const offset = source.indexOf("->") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "presenter",
      "App\\UI\\Home\\HomePresenter",
    );
    expect(completions.map((completion) => completion.label)).toContain("link");
  });

  it("types the implicit $control variable as the Nette base control", async () => {
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );
    const resolvePhpReceiverCompletions = vi.fn(async () => [
      {
        declaringClassName: "Control",
        name: "getPresenter",
        parameters: "",
        returnType: "Nette\\Application\\UI\\Presenter",
      },
    ]);
    const deps = makeDeps({
      resolvePhpReceiverCompletions,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$control->}";
    const offset = source.indexOf("->") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "control",
      "Nette\\Application\\UI\\Control",
    );
    expect(completions.map((completion) => completion.label)).toContain(
      "getPresenter",
    );
  });

  it("resolves component template variables from the colocated control class", async () => {
    const controlSource = `<?php
namespace App\\Components\\ProductList;

class ProductListControl extends Nette\\Application\\UI\\Control
{
    public function render(): void
    {
        /** @var \\App\\Model\\Product $product */
        $product = $this->products->get(1);
        $this->template->product = $product;
    }
}
`;
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/Components/ProductList/ProductListControl.php": controlSource,
    });
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/Components/ProductList/product_list.latte`,
      }),
      readFileContent,
      resolvePhpReceiverCompletions: vi.fn(async () => []),
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

  it("types $control as the colocated component class inside a component template", async () => {
    const controlSource = `<?php
namespace App\\Components\\ProductList;

class ProductListControl extends Nette\\Application\\UI\\Control
{
}
`;
    const { readFileContent } = buildNettePresenterWorkspace({
      "app/Components/ProductList/ProductListControl.php": controlSource,
    });
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/Components/ProductList/product_list.latte`,
      }),
      readFileContent,
      resolvePhpReceiverCompletions: vi.fn(async () => []),
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$control->}";
    const offset = source.indexOf("->") + 2;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "control",
      "App\\Components\\ProductList\\ProductListControl",
    );
  });

  it("types $presenter from the presenter factory that creates the component", async () => {
    const controlSource = `<?php
namespace App\\Components\\ProductList;

class ProductListControl extends Nette\\Application\\UI\\Control
{
}
`;
    const presenterSource = `<?php
namespace App\\UI\\Home;

use App\\Components\\ProductList\\ProductListControl;
use Nette\\Application\\UI\\Presenter;

class HomePresenter extends Presenter
{
    protected function createComponentProductList(): ProductListControl
    {
        return new ProductListControl();
    }
}
`;
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/Components/ProductList/ProductListControl.php": controlSource,
      "app/UI/Home/HomePresenter.php": presenterSource,
    });
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/Components/ProductList/product_list.latte`,
      }),
      readFileContent,
      resolveDeclaredType: (source, typeHint) =>
        typeHint === "ProductListControl" &&
        source.includes("use App\\Components\\ProductList\\ProductListControl")
          ? "App\\Components\\ProductList\\ProductListControl"
          : typeHint,
      resolvePhpReceiverCompletions: vi.fn(async () => []),
      searchText,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$presenter->}";
    const offset = source.indexOf("->") + 2;

    await latte.provideLatteCompletions(source, positionAtOffset(source, offset));

    expect(searchText).toHaveBeenCalledWith(ROOT, "createComponent", 200);
    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "presenter",
      "App\\UI\\Home\\HomePresenter",
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
      frameworkIntelligence: GENERIC_FRAMEWORK,
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
  it("lists variables declared by a {templateType} Template class", async () => {
    const templateSource = `<?php
namespace App\\UI\\Product;

use App\\Model\\Job;
use App\\Model\\Product;
use Nette\\Application\\UI\\Form;
use Nette\\Bridges\\ApplicationLatte\\Template;

/**
 * @property-read Form $form
 */
class ProductTemplate extends Template
{
    public Job $job;
    public Product $product;
}
`;
    const searchText = vi.fn(async (_root: string, query: string) =>
      query === "class ProductTemplate"
        ? [{ path: `${ROOT}/app/UI/Product/ProductTemplate.php` }]
        : [],
    );
    const readFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/app/UI/Product/ProductTemplate.php`) {
        return templateSource;
      }

      throw new Error(`no such file: ${path}`);
    });
    const deps = makeDeps({ readFileContent, searchText });
    const latte = createLatteIntelligence(() => deps);
    const source = "{templateType App\\UI\\Product\\ProductTemplate}\n{$}";
    const offset = source.indexOf("{$}") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );
    const labels = completions.map((completion) => completion.label);

    expect(labels).toEqual(expect.arrayContaining(["$job", "$product", "$form"]));
    expect(completions.find((completion) => completion.label === "$product"))
      .toMatchObject({ detail: "template type · Product" });
  });

  it("keeps an inline variable display type when {templateType} declares the same variable", async () => {
    const templateSource = `<?php
namespace App\\UI\\Product;

use Nette\\Bridges\\ApplicationLatte\\Template;

class ProductTemplate extends Template
{
    public TemplateProduct $product;
    public TemplateJob $job;
}
`;
    const searchText = vi.fn(async (_root: string, query: string) =>
      query === "class ProductTemplate"
        ? [{ path: `${ROOT}/app/UI/Product/ProductTemplate.php` }]
        : [],
    );
    const readFileContent = vi.fn(async () => templateSource);
    const deps = makeDeps({ readFileContent, searchText });
    const latte = createLatteIntelligence(() => deps);
    const source =
      "{templateType App\\UI\\Product\\ProductTemplate}\n" +
      "{parameters App\\Model\\InlineProduct $product}\n" +
      "{$}";
    const offset = source.indexOf("{$}") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.find((completion) => completion.label === "$product"))
      .toMatchObject({ detail: "template parameters · InlineProduct" });
    expect(completions.find((completion) => completion.label === "$job"))
      .toMatchObject({ detail: "template type · TemplateJob" });
  });

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
    expect(labels).toContain("$presenter");
    expect(labels).toContain("$control");
    expect(completions.every((completion) => completion.kind === "variable")).toBe(
      true,
    );
  });

  it("does not offer a local {var} before its declaration", async () => {
    const deps = makeDeps();
    const latte = createLatteIntelligence(() => deps);
    const source = "{$}\n{var $future = new Product()}";
    const offset = source.indexOf("{$}") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.map((completion) => completion.label)).not.toContain(
      "$future",
    );
  });

  it("lists variables from ebox-style module presenters using Template::add()", async () => {
    const presenterSource = `<?php
namespace Efabrica\\Crm\\ParentalControlsModule\\Presenters;

class ParentalControlsAdminPresenter extends BasePresenter
{
    public function renderShow(string $id): void
    {
        $template = $this->template;
        $template->add('range', $this->ranges->find($id));
    }
}
`;
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/modules/parentalControlsModule/Presenters/ParentalControlsAdminPresenter.php":
        presenterSource,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/modules/parentalControlsModule/templates/ParentalControlsAdmin/show.latte`,
      }),
      readFileContent,
      searchText,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$}";
    const offset = source.indexOf("{$}") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(searchText).toHaveBeenCalledWith(ROOT, "template->add(", 200);
    expect(completions.find((completion) => completion.label === "$range"))
      .toMatchObject({ detail: "presenter data" });
  });

  it("lists component template variables assigned inside a createComponent factory", async () => {
    const presenterSource = `<?php
namespace App\\UI\\Home;

class HomePresenter extends Nette\\Application\\UI\\Presenter
{
    protected function createComponentProductList(): ProductListControl
    {
        $control = new ProductListControl();
        /** @var \\App\\Model\\Product $product */
        $product = $this->products->get(1);
        $control->template->product = $product;

        return $control;
    }
}
`;
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/UI/Home/HomePresenter.php": presenterSource,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/Components/ProductList/product_list.latte`,
      }),
      readFileContent,
      searchText,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$}";
    const offset = source.indexOf("{$}") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(searchText).toHaveBeenCalledWith(ROOT, "createComponent", 200);
    expect(completions.find((completion) => completion.label === "$product"))
      .toMatchObject({ detail: "presenter data · Product" });
  });

  it("lists variables assigned by a colocated control class in its component template", async () => {
    const controlSource = `<?php
namespace App\\Components\\ProductList;

class ProductListControl extends Nette\\Application\\UI\\Control
{
    public function render(): void
    {
        /** @var \\App\\Model\\Product $product */
        $product = $this->products->get(1);
        $this->template->product = $product;
    }
}
`;
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/Components/ProductList/ProductListControl.php": controlSource,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/Components/ProductList/product_list.latte`,
      }),
      readFileContent,
      searchText,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$}";
    const offset = source.indexOf("{$}") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.find((completion) => completion.label === "$product"))
      .toMatchObject({ detail: "presenter data · Product" });
  });

  it("lists variables assigned to the component template in the presenter factory", async () => {
    const controlSource = `<?php
namespace App\\Components\\ProductList;

class ProductListControl extends Nette\\Application\\UI\\Control
{
    public function render(): void
    {
        /** @var \\App\\Model\\Product $product */
        $product = $this->products->get(1);
        $this->template->product = $product;
    }
}
`;
    const presenterSource = `<?php
namespace App\\UI\\Home;

use App\\Components\\ProductList\\ProductListControl;
use Nette\\Application\\UI\\Presenter;

class HomePresenter extends Presenter
{
    protected function createComponentProductList(): ProductListControl
    {
        $control = new ProductListControl();
        /** @var \\App\\Model\\Category $category */
        $category = $this->categories->get(1);
        $control->template->category = $category;

        return $control;
    }
}
`;
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/Components/ProductList/ProductListControl.php": controlSource,
      "app/UI/Home/HomePresenter.php": presenterSource,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/Components/ProductList/product_list.latte`,
      }),
      readFileContent,
      searchText,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$}";
    const offset = source.indexOf("{$}") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(searchText).toHaveBeenCalledWith(ROOT, "createComponent", 200);
    expect(completions.find((completion) => completion.label === "$product"))
      .toMatchObject({ detail: "presenter data · Product" });
    expect(completions.find((completion) => completion.label === "$category"))
      .toMatchObject({ detail: "presenter data · Category" });
  });

  it("lists named render/action parameters from a parameter-only presenter", async () => {
    const presenterSource = `<?php
namespace App\\UI\\Product;

class ProductPresenter extends BasePresenter
{
    public function actionShow(int $id): void
    {
    }

    public function renderShow(\\App\\Model\\Product $product): void
    {
    }
}
`;
    const { readFileContent, searchText } = buildNettePresenterWorkspace({
      "app/UI/Product/ProductPresenter.php": presenterSource,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/UI/Product/show.latte`,
      }),
      readFileContent,
      searchText,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$}";
    const offset = source.indexOf("{$}") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(searchText).toHaveBeenCalledWith(ROOT, "function render", 200);
    expect(searchText).toHaveBeenCalledWith(ROOT, "function action", 200);
    expect(completions.find((completion) => completion.label === "$id"))
      .toMatchObject({ detail: "presenter data · int" });
    expect(completions.find((completion) => completion.label === "$product"))
      .toMatchObject({ detail: "presenter data · Product" });
  });

  it("loads Latte view data through the active provider capability", async () => {
    const presenterSource = "<?php\n$custom = new Custom();\nassignView();\n";
    const searchText = vi.fn(async (_root: string, query: string) =>
      query === "assignView(" ? [{ path: `${ROOT}/src/CustomPresenter.php` }] : [],
    );
    const readFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/src/CustomPresenter.php`) {
        return presenterSource;
      }

      throw new Error(`no such file: ${path}`);
    });
    const deps = makeDeps({
      frameworkIntelligence: CUSTOM_LATTE_VIEW_DATA_FRAMEWORK,
      readFileContent,
      searchText,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$}";
    const offset = source.indexOf("{$}") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(searchText).toHaveBeenCalledTimes(1);
    expect(searchText).toHaveBeenCalledWith(ROOT, "assignView(", 200);
    expect(completions.find((completion) => completion.label === "$custom"))
      .toMatchObject({ detail: "presenter data · Custom" });
  });

  it("does not scan view data when the active Latte provider has no view-data capability", async () => {
    const searchText = vi.fn(async () => {
      throw new Error("view-data search should come from provider capability");
    });
    const deps = makeDeps({
      frameworkIntelligence: CUSTOM_LATTE_TEMPLATE_FRAMEWORK,
      searchText,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$}";
    const offset = source.indexOf("{$}") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(searchText).not.toHaveBeenCalled();
    expect(completions.map((completion) => completion.label)).toEqual(
      expect.arrayContaining(["$presenter", "$control"]),
    );
  });

  it("offers Nette implicit template variables in an empty expression", async () => {
    const deps = makeDeps();
    const latte = createLatteIntelligence(() => deps);
    const source = "{$}";
    const offset = source.indexOf("{$}") + 2;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.find((completion) => completion.label === "$presenter"))
      .toMatchObject({ detail: "Nette template context · Presenter" });
    expect(completions.find((completion) => completion.label === "$control"))
      .toMatchObject({ detail: "Nette template context · Control" });
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

  it("merges project-registered NEON filters into | completions without non-filter leakage", async () => {
    const deps = makeDeps(neonFilterWorkspaceOverrides(ROOT, "userDate"));
    const latte = createLatteIntelligence(() => deps);
    const source = "{$total|}";
    const offset = source.indexOf("|") + 1;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );
    const labels = completions.map((completion) => completion.label);

    expect(labels).toContain("upper");
    expect(labels).toContain("userDate");
    expect(labels).not.toContain("generate_password_reset_url");
    expect(
      completions.find((completion) => completion.label === "userDate"),
    ).toMatchObject({ detail: "Project Latte filter", kind: "filter" });
  });

  it("filters project filter names by the typed | prefix", async () => {
    const deps = makeDeps(neonFilterWorkspaceOverrides(ROOT, "userDate"));
    const latte = createLatteIntelligence(() => deps);
    const source = "{$total|user}";
    const offset = source.indexOf("user") + "user".length;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.map((completion) => completion.label)).toEqual([
      "userDate",
    ]);
  });

  it("does not duplicate a builtin when a project re-registers its name", async () => {
    const deps = makeDeps(neonFilterWorkspaceOverrides(ROOT, "date"));
    const latte = createLatteIntelligence(() => deps);
    const source = "{$total|date}";
    const offset = source.indexOf("date") + "date".length;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions).toEqual([
      expect.objectContaining({ detail: "Latte filter", label: "date" }),
    ]);
  });

  it("never offers another root's project filters from a shared cache", async () => {
    const rootA = "/ws-a";
    const rootB = "/ws-b";
    const filterCache = {};
    const depsA = makeDeps({
      ...neonFilterWorkspaceOverrides(rootA, "secretA"),
      currentWorkspaceRootRef: { current: rootA },
      getActiveDocument: () => ({ path: `${rootA}/app/UI/Home/default.latte` }),
      workspaceRoot: rootA,
    });
    const latteA = createLatteIntelligence(
      () => depsA,
      {},
      {},
      {},
      {},
      {},
      createLatteFrameworkCapabilities(() => [phpNetteFrameworkProvider]),
      filterCache,
    );
    const source = "{$total|secret}";
    const position = positionAtOffset(source, source.indexOf("}"));

    const completionsA = await latteA.provideLatteCompletions(source, position);
    expect(completionsA.map((completion) => completion.label)).toContain(
      "secretA",
    );

    const depsB = makeDeps({
      currentWorkspaceRootRef: { current: rootB },
      getActiveDocument: () => ({ path: `${rootB}/app/UI/Home/default.latte` }),
      workspaceRoot: rootB,
    });
    const latteB = createLatteIntelligence(
      () => depsB,
      {},
      {},
      {},
      {},
      {},
      createLatteFrameworkCapabilities(() => [phpNetteFrameworkProvider]),
      filterCache,
    );

    const completionsB = await latteB.provideLatteCompletions(source, position);
    expect(completionsB.map((completion) => completion.label)).not.toContain(
      "secretA",
    );
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
    expect(
      (searchText.mock.calls as unknown as Array<[string, string, number]>)
        .map(([, query]) => query),
    ).toEqual([
      "->template->",
      "template->add(",
      "setParameters(",
      "function render",
      "function action",
      "createComponent",
    ]);
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

  it("does not type member completion from a later {var} declaration", async () => {
    const synthesizeTypedReceiverSource = trackingSynthesize();
    const resolveExpressionType = vi.fn(async () => "App\\Model\\Product");
    const deps = makeDeps({
      resolveExpressionType,
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{$p->}\n{var $p = new Product()}";
    const offset = source.indexOf("$p->") + "$p->".length;

    await expect(
      latte.provideLatteCompletions(source, positionAtOffset(source, offset)),
    ).resolves.toEqual([]);
    expect(resolveExpressionType).not.toHaveBeenCalled();
    expect(synthesizeTypedReceiverSource).not.toHaveBeenCalled();
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

const PRODUCTS_ADMIN_PRESENTER_SOURCE = `<?php
namespace App\\ProductsModule\\Presenters;

class ProductsAdminPresenter extends AdminPresenter
{
    public function actionCreate(): void
    {
    }

    public function renderDefault(): void
    {
    }
}
`;

const SUBSCRIPTION_TYPE_GROUP_ADMIN_PRESENTER_SOURCE = `<?php
namespace App\\EfabricaSubscriptionsModule\\Presenters;

class SubscriptionTypeGroupAdminPresenter extends AdminPresenter
{
    public function renderShowBasic(int $id): void
    {
    }

    public function renderShowAddons(int $id): void
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

  it.each([
    ["n:href", '<a n:href="ProductsAdmin:create">Create</a>'],
    ["{link}", "{link ProductsAdmin:create}"],
    ["{plink}", "{plink ProductsAdmin:create}"],
  ])(
    "navigates %s ProductsAdmin:create inside a classic module template",
    async (_kind, source) => {
      const { readFileContent } = buildContentWorkspace({
        "app/modules/productsModule/Presenters/ProductsAdminPresenter.php":
          PRODUCTS_ADMIN_PRESENTER_SOURCE,
      });
      const openTarget = vi.fn(async () => true);
      const deps = makeDeps({
        getActiveDocument: () => ({
          path: `${ROOT}/app/modules/productsModule/templates/Home/default.latte`,
        }),
        openTarget,
        readFileContent,
      });
      const latte = createLatteIntelligence(() => deps);
      const offset = source.indexOf("ProductsAdmin:create") + 2;

      await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
        true,
      );
      expect(openTarget).toHaveBeenCalledWith(
        "/ws/app/modules/productsModule/Presenters/ProductsAdminPresenter.php",
        expect.objectContaining({ lineNumber: 6 }),
        "ProductsAdmin:create",
      );
    },
  );

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

  it("resolves a relative n:href from an ebox-crm style presenter partial", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/modules/efabricaSubscriptionsModule/Presenters/SubscriptionTypeGroupAdminPresenter.php":
        SUBSCRIPTION_TYPE_GROUP_ADMIN_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/partials/@showSubmenu.latte`,
      }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = `<a n:href="showBasic $group['id']">Basic</a>`;
    const offset = source.indexOf("showBasic") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/modules/efabricaSubscriptionsModule/Presenters/SubscriptionTypeGroupAdminPresenter.php",
      expect.objectContaining({ lineNumber: 6 }),
      "showBasic",
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

  it("does not inherit Nette Latte links for a template-only provider", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      frameworkIntelligence: CUSTOM_LATTE_TEMPLATE_FRAMEWORK,
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

  it("does not open a PHP presenter link after the navigation request goes stale", async () => {
    let navigationAllowed = true;
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const staleReadFileContent = vi.fn(async (path: string) => {
      const content = await readFileContent(path);
      navigationAllowed = false;

      return content;
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/HomePresenter.php` }),
      listDirectory,
      openTarget,
      readFileContent: staleReadFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "$url = $this->link('Product:show', $id);";
    const offset = source.indexOf("Product:show") + 2;

    await expect(
      latte.provideNettePhpLinkDefinition(source, offset, {
        canNavigate: () => navigationAllowed,
      }),
    ).resolves.toBe(false);
    expect(staleReadFileContent).toHaveBeenCalled();
    expect(openTarget).not.toHaveBeenCalled();
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

  it("does not inherit Nette PHP link detection for a template-only provider", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/HomePresenter.php` }),
      frameworkIntelligence: CUSTOM_LATTE_TEMPLATE_FRAMEWORK,
      listDirectory,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "$this->link('Product:show');";
    const offset = source.indexOf("Product:show") + 2;

    await expect(
      latte.provideNettePhpLinkDefinition(source, offset),
    ).resolves.toBe(false);
    expect(listDirectory).not.toHaveBeenCalled();
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("uses the active provider registry for custom PHP presenter-link detection", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Product/ProductPresenter.php": PRODUCT_PRESENTER_SOURCE,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      frameworkIntelligence: CUSTOM_LATTE_LINK_FRAMEWORK,
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/HomePresenter.php` }),
      listDirectory,
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "$this->jumpTo('Product:show');";
    const offset = source.indexOf("Product:show") + 2;

    await expect(
      latte.providePhpPresenterLinkDefinition(source, offset),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Product/ProductPresenter.php",
      expect.objectContaining({ lineNumber: 9 }),
      "Product:show",
    );
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

  it("offers current-presenter relative action and signal targets", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/UI/Product/ProductPresenter.php`,
      }),
      listDirectory,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link d}";
    const offset = source.indexOf("d") + 1;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions).toContainEqual(
      expect.objectContaining({
        insertText: "delete!",
        kind: "link",
        label: "delete!",
      }),
    );
  });

  it("offers route-default presenter actions discovered from Nette router files", async () => {
    const routerSource = `<?php
use Nette\\Application\\Routers\\Route;

$router[] = new Route('/archive/<id>', 'Archive:show');
$router[] = new Route('/admin', ['presenter' => 'Admin:Dashboard', 'action' => 'default']);
`;
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/Router/RouterFactory.php": routerSource,
    });
    const deps = makeDeps({ listDirectory, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "{link A}";
    const offset = source.indexOf("A") + 1;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );
    const labels = completions.map((completion) => completion.label);

    expect(labels).toContain("Archive:show");
    expect(labels).toContain("Admin:Dashboard:default");
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

  it("offers classic-module presenter actions inside n:href", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/modules/productsModule/Presenters/ProductsAdminPresenter.php":
        PRODUCTS_ADMIN_PRESENTER_SOURCE,
    });
    const deps = makeDeps({ listDirectory, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = '<a n:href="ProductsAdmin:c">';
    const offset = source.indexOf("ProductsAdmin:c") + "ProductsAdmin:c".length;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.map((completion) => completion.label)).toEqual([
      "ProductsAdmin:create",
    ]);
    expect(completions[0]).toMatchObject({
      insertText: "ProductsAdmin:create",
      kind: "link",
    });
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
      frameworkIntelligence: GENERIC_FRAMEWORK,
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

describe("createLatteIntelligence PHP presenter link completion (S8 PHP)", () => {
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

  it("offers Presenter:action targets inside $this->link('...')", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({ listDirectory, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "$this->link('P');";
    const offset = source.indexOf("P'");
    const completions = await latte.provideNettePhpLinkCompletions(
      source,
      offset,
    );
    if (!completions) {
      throw new Error("Expected Nette PHP link completions.");
    }
    const labels = completions.map((completion) => completion.label);

    expect(labels).toContain("Product:show");
    expect(labels).toContain("Product:edit");
    expect(labels).toContain("Product:delete!");
    expect(completions.every((completion) => completion.kind === "link")).toBe(
      true,
    );
  });

  it("uses the active provider registry for custom PHP completion ranges", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "src/Screen.screen.php": "<?php\n// screen show\n",
    });
    const source = "$this->jumpTo('Sc');";
    const replaceStart = source.indexOf("Sc");
    const replaceEnd = replaceStart + "Sc".length;
    const presenterLinkTargetsFromSource = vi.fn(
      ({ path, source: content }: { path: string; source: string }) =>
        path.endsWith("Screen.screen.php") && content.includes("screen show")
          ? ["Screen.show"]
          : [],
    );
    const screenLinkProvider: PhpFrameworkProvider = {
      ...CUSTOM_LATTE_LINK_PROVIDER,
      id: "custom-screen-link",
      latte: {
        ...CUSTOM_LATTE_LINK_PROVIDER.latte,
        isPresenterSourcePath: ({ path }) => path.endsWith(".screen.php"),
        presenterLinkTargetsFromSource,
        presenterScanDirectories: ["src"],
        supportsPresenterLinkIntelligence: true,
        supportsTemplateIntelligence: true,
      },
    };
    const deps = makeDeps({
      frameworkIntelligence: createPhpFrameworkIntelligence({
        matchedProviderIds: [screenLinkProvider.id],
        profile: "generic",
        providers: [screenLinkProvider],
      }),
      listDirectory,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);

    const completions = await latte.provideNettePhpLinkCompletions(
      source,
      replaceEnd,
    );

    expect(listDirectory).toHaveBeenCalledWith(`${ROOT}/src`);
    expect(presenterLinkTargetsFromSource).toHaveBeenCalledWith({
      path: `${ROOT}/src/Screen.screen.php`,
      source: expect.stringContaining("screen show"),
    });
    expect(completions).toEqual([
      {
        detail: "Nette presenter action",
        insertText: "Screen.show",
        kind: "link",
        label: "Screen.show",
        replaceEnd,
        replaceStart,
      },
    ]);
  });

  it("filters targets by the typed prefix inside ->redirect('...')", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({ listDirectory, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "$this->redirect('Product:s');";
    const offset = source.indexOf("Product:s") + "Product:s".length;
    const completions = await latte.provideNettePhpLinkCompletions(
      source,
      offset,
    );
    if (!completions) {
      throw new Error("Expected filtered Nette PHP link completions.");
    }

    expect(completions.map((completion) => completion.label)).toEqual([
      "Product:show",
    ]);
  });

  it("filters targets by the typed prefix inside ->redirect(status, '...')", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({ listDirectory, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "$this->redirect(303, 'Product:s');";
    const offset = source.indexOf("Product:s") + "Product:s".length;
    const completions = await latte.provideNettePhpLinkCompletions(
      source,
      offset,
    );
    if (!completions) {
      throw new Error("Expected filtered Nette PHP redirect completions.");
    }

    expect(completions.map((completion) => completion.label)).toEqual([
      "Product:show",
    ]);
  });

  it("returns null when the cursor is not on a link-call string argument", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({ listDirectory, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "$this->products->get(1);";

    await expect(
      latte.provideNettePhpLinkCompletions(source, source.indexOf("get")),
    ).resolves.toBeNull();
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it("exposes a sync PHP presenter-link completion context guard", () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({ listDirectory, readFileContent });
    const latte = createLatteIntelligence(() => deps);
    const source = "$this->link('P');";

    expect(
      latte.isPhpPresenterLinkCompletionContext(source, source.indexOf("P'")),
    ).toBe(true);
    expect(
      latte.isPhpPresenterLinkCompletionContext(
        "$this->products->get(1);",
        "$this->products->get(1);".indexOf("get"),
      ),
    ).toBe(false);
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it("does not inherit Nette PHP completion detection for a template-only provider", () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({
      frameworkIntelligence: CUSTOM_LATTE_TEMPLATE_FRAMEWORK,
      listDirectory,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "$this->link('P');";

    expect(
      latte.isPhpPresenterLinkCompletionContext(source, source.indexOf("P'")),
    ).toBe(false);
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it("reuses the same per-root presenter-target cache as the Latte-side completion", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({ listDirectory, readFileContent });
    const latte = createLatteIntelligence(() => deps);

    const latteSource = "{link P}";
    await latte.provideLatteCompletions(
      latteSource,
      positionAtOffset(latteSource, latteSource.indexOf("P") + 1),
    );
    const scansAfterLatteSide = listDirectory.mock.calls.length;
    expect(scansAfterLatteSide).toBeGreaterThan(0);

    const phpSource = "$this->link('P');";
    const phpCompletions = await latte.provideNettePhpLinkCompletions(
      phpSource,
      phpSource.indexOf("P'"),
    );
    if (!phpCompletions) {
      throw new Error("Expected cached Nette PHP link completions.");
    }

    // Same requested root, same cache entry still warm: no additional scan.
    expect(listDirectory.mock.calls.length).toBe(scansAfterLatteSide);
    expect(phpCompletions.map((completion) => completion.label)).toContain(
      "Product:show",
    );
  });

  it("returns null fast for a template-only provider (no scan)", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace(PRESENTERS);
    const deps = makeDeps({
      frameworkIntelligence: CUSTOM_LATTE_TEMPLATE_FRAMEWORK,
      listDirectory,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "$this->link('P');";

    await expect(
      latte.provideNettePhpLinkCompletions(source, source.indexOf("P'")),
    ).resolves.toBeNull();
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it("drops PHP link completions when the root changes during discovery", async () => {
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
    const source = "$this->link('P');";

    await expect(
      latte.provideNettePhpLinkCompletions(source, source.indexOf("P'")),
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
        $form = new Form();
        $form->addText('email', 'Email');
        $form->addSelect('role', 'Role');
        $form->addTextArea('message', 'Message');
        $form->addSubmit('send', 'Send');

        return $form;
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

  it("navigates a {control name:part} render variant to the control render method", async () => {
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const openPhpMethodTarget = vi.fn(async () => true);
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      listDirectory,
      openPhpMethodTarget,
      openTarget,
      readFileContent,
      resolveDeclaredType: (_source, typeHint) =>
        typeHint === "ProductListControl"
          ? "App\\UI\\Home\\ProductListControl"
          : typeHint,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{control productList:pagination}";
    const offset = source.indexOf("pagination") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\UI\\Home\\ProductListControl",
      "renderPagination",
    );
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("navigates Nette module {control} references to the module presenter factory", async () => {
    const presenter = `<?php
namespace App\\ProductsModule\\Presenters;

class ProductsAdminPresenter extends AdminPresenter
{
    public function createComponentProductsGrid(string $name): DataGrid
    {
    }
}
`;
    const { readFileContent } = buildContentWorkspace({
      "app/modules/productsModule/Presenters/ProductsAdminPresenter.php": presenter,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/modules/productsModule/templates/ProductsAdmin/default.latte`,
      }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "      {control productsGrid}";
    const offset = source.indexOf("productsGrid") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/modules/productsModule/Presenters/ProductsAdminPresenter.php",
      expect.objectContaining({ lineNumber: 6 }),
      "productsGrid",
    );
  });

  it("navigates component-template {control} references to the colocated control class", async () => {
    const controlSource = `<?php
namespace Crm\\ApiModule\\Components\\ApiConsoleControl;

use Nette\\Application\\UI\\Control;
use Nette\\Application\\UI\\Form;

class ApiConsoleControl extends Control
{
    protected function createComponentConsoleForm(): Form
    {
    }
}
`;
    const { readFileContent } = buildContentWorkspace({
      "app/modules/apiModule/Components/ApiConsoleControl/ApiConsoleControl.php":
        controlSource,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/modules/apiModule/Components/ApiConsoleControl/api_console.latte`,
      }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{control consoleForm}";
    const offset = source.indexOf("consoleForm") + 2;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/modules/apiModule/Components/ApiConsoleControl/ApiConsoleControl.php",
      expect.objectContaining({ lineNumber: 9 }),
      "consoleForm",
    );
  });

  it("navigates a component-template signal link to the colocated control handler", async () => {
    const controlSource = `<?php
namespace Crm\\ApiModule\\Components\\AccessTokenControl;

use Nette\\Application\\UI\\Control;

class AccessTokenControl extends Control
{
    public function handleRemoveAccessToken(): void
    {
    }
}
`;
    const { readFileContent } = buildContentWorkspace({
      "app/modules/apiModule/Components/AccessTokenControl/AccessTokenControl.php":
        controlSource,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/modules/apiModule/Components/AccessTokenControl/access_token.latte`,
      }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = `<a n:href="removeAccessToken!">Remove</a>`;
    const offset = source.indexOf("removeAccessToken") + 3;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/modules/apiModule/Components/AccessTokenControl/AccessTokenControl.php",
      expect.objectContaining({ lineNumber: 8 }),
      "removeAccessToken!",
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

  it("navigates a {form contactForm} macro the same way", async () => {
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
    const source = "{form contactForm}{/form}";
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

  it("navigates an input n:name to a field inside the active form component", async () => {
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
    const source = '<form n:name="contactForm"><input n:name="email"></form>';
    const offset = source.indexOf("email") + 1;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Home/HomePresenter.php",
      expect.objectContaining({ lineNumber: 17 }),
      "email",
    );
  });

  it("navigates n:name to fields from delegated non-promoted constructor-injected form factories", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

use App\\Forms\\GatewayFormFactory;
use Nette\\Application\\UI\\Form;

class HomePresenter
{
    private $gatewayFormFactory;

    public function __construct(GatewayFormFactory $gatewayFormFactory)
    {
        $this->gatewayFormFactory = $gatewayFormFactory;
    }

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create();
    }
}
`;
    const factory = `<?php
namespace App\\Forms;

use Nette\\Application\\UI\\Form;

class GatewayFormFactory
{
    public function create(): Form
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": presenter,
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      openTarget,
      readFileContent,
      readPhpClassSource: vi.fn(async (className: string) =>
        className === "App\\Forms\\GatewayFormFactory"
          ? { path: `${ROOT}/app/Forms/GatewayFormFactory.php`, source: factory }
          : null,
      ),
      resolveDeclaredType: (_source, typeHint) =>
        typeHint === "GatewayFormFactory"
          ? "App\\Forms\\GatewayFormFactory"
          : typeHint,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = '<form n:name="gatewayForm"><input n:name="email"></form>';
    const offset = source.indexOf("email") + 1;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/Forms/GatewayFormFactory.php",
      expect.objectContaining({ lineNumber: 11 }),
      "email",
    );
  });

  it("navigates n:name to fields from NEON service-typed delegated form factories", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

class HomePresenter
{
    private $gatewayFormFactory;

    protected function createComponentGatewayForm()
    {
        return $this->gatewayFormFactory->create();
    }
}
`;
    const factory = `<?php
namespace App\\Forms;

class GatewayFormFactory
{
    public function create()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": presenter,
      "config/services.neon":
        "services:\n    gatewayFormFactory: App\\Forms\\GatewayFormFactory\n",
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      listDirectory,
      openTarget,
      readFileContent,
      readPhpClassSource: vi.fn(async (className: string) =>
        className === "App\\Forms\\GatewayFormFactory"
          ? { path: `${ROOT}/app/Forms/GatewayFormFactory.php`, source: factory }
          : null,
      ),
    });
    const latte = createLatteIntelligence(() => deps);
    const source = '<form n:name="gatewayForm"><input n:name="email"></form>';
    const offset = source.indexOf("email") + 1;

    await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
      true,
    );
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/Forms/GatewayFormFactory.php",
      expect.objectContaining({ lineNumber: 9 }),
      "email",
    );
  });

  it.each(["input", "label", "inputError"] as const)(
    "navigates a {%s email} macro to a field inside the active form component",
    async (macro) => {
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
      const source = `{form contactForm}{${macro} email}{/form}`;
      const offset = source.indexOf("email") + 1;

      await expect(latte.provideLatteDefinition(source, offset)).resolves.toBe(
        true,
      );
      expect(openTarget).toHaveBeenCalledWith(
        "/ws/app/UI/Home/HomePresenter.php",
        expect.objectContaining({ lineNumber: 17 }),
        "email",
      );
    },
  );

  it("does not resolve a field n:name when the active form is dynamic", async () => {
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
    const source = '<form n:name="$form"><input n:name="email"></form>';
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
      frameworkIntelligence: GENERIC_FRAMEWORK,
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

  it("navigates a colocated control createComponent method back to its Latte usage", async () => {
    const controlSource = `<?php
class ApiConsoleControl extends Nette\\Application\\UI\\Control
{
    protected function createComponentConsoleForm(): Nette\\Application\\UI\\Form
    {
    }
}
`;
    const { readFileContent } = buildContentWorkspace({
      "app/modules/apiModule/Components/ApiConsoleControl/api_console.latte":
        "<h2>Api Web Console</h2>\n{control consoleForm}\n",
    });
    const openTarget = vi.fn(async () => true);
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/modules/apiModule/Components/ApiConsoleControl/ApiConsoleControl.php`,
      }),
      openTarget,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const offset = controlSource.indexOf("createComponentConsoleForm") + 2;

    await expect(
      latte.provideNettePhpLinkDefinition(controlSource, offset),
    ).resolves.toBe(true);
    expect(openTarget).toHaveBeenCalledWith(
      "/ws/app/modules/apiModule/Components/ApiConsoleControl/api_console.latte",
      expect.objectContaining({ lineNumber: 2 }),
      "consoleForm",
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

  it("offers colocated control signal handlers inside component-template links", async () => {
    const controlSource = `<?php
namespace Crm\\ApiModule\\Components\\AccessTokenControl;

use Nette\\Application\\UI\\Control;

class AccessTokenControl extends Control
{
    public function handleRemoveAccessToken(): void
    {
    }

    public function handleRefresh(): void
    {
    }
}
`;
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/modules/apiModule/Components/AccessTokenControl/AccessTokenControl.php":
        controlSource,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({
        path: `${ROOT}/app/modules/apiModule/Components/AccessTokenControl/access_token.latte`,
      }),
      listDirectory,
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = `{link remove}`;
    const offset = source.indexOf("}");
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions.map((completion) => completion.label)).toEqual([
      "removeAccessToken!",
    ]);
    expect(completions[0]).toMatchObject({
      insertText: "removeAccessToken!",
      kind: "link",
      replaceStart: source.indexOf("remove"),
      replaceEnd: source.indexOf("}"),
    });
  });

  it("offers component names in a form n:name attribute", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = '<form n:name="cont"></form>';
    const offset = source.indexOf("cont") + "cont".length;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions).toContainEqual(
      expect.objectContaining({
        insertText: "contactForm",
        kind: "component",
        label: "contactForm",
        replaceEnd: source.indexOf("cont") + "cont".length,
        replaceStart: source.indexOf("cont"),
      }),
    );
  });

  it("offers component names in a form macro", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = "{form cont}";
    const offset = source.indexOf("cont") + "cont".length;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions).toContainEqual(
      expect.objectContaining({
        insertText: "contactForm",
        kind: "component",
        label: "contactForm",
        replaceEnd: source.indexOf("cont") + "cont".length,
        replaceStart: source.indexOf("cont"),
      }),
    );
  });

  it("offers field names for input/label/select/textarea/button n:name inside the active form", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = [
      '<form n:name="contactForm">',
      '  <input n:name="e">',
      '  <label n:name="e"></label>',
      '  <select n:name="r"></select>',
      '  <textarea n:name="m"></textarea>',
      '  <button n:name="s"></button>',
      "</form>",
    ].join("\n");

    await expect(
      latte.provideLatteCompletions(
        source,
        positionAtOffset(source, source.indexOf('"e"') + 2),
      ),
    ).resolves.toContainEqual(
      expect.objectContaining({
        detail: "Nette form field",
        insertText: "email",
        label: "email",
      }),
    );
    await expect(
      latte.provideLatteCompletions(
        source,
        positionAtOffset(
          source,
          source.indexOf('"e"', source.indexOf("<label")) + 2,
        ),
      ),
    ).resolves.toContainEqual(
      expect.objectContaining({
        detail: "Nette form field",
        insertText: "email",
        label: "email",
      }),
    );
    await expect(
      latte.provideLatteCompletions(
        source,
        positionAtOffset(source, source.indexOf('"r"') + 2),
      ),
    ).resolves.toContainEqual(expect.objectContaining({ label: "role" }));
    await expect(
      latte.provideLatteCompletions(
        source,
        positionAtOffset(source, source.indexOf('"m"') + 2),
      ),
    ).resolves.toContainEqual(expect.objectContaining({ label: "message" }));
    await expect(
      latte.provideLatteCompletions(
        source,
        positionAtOffset(source, source.indexOf('"s"') + 2),
      ),
    ).resolves.toContainEqual(expect.objectContaining({ label: "send" }));
  });

  it("offers n:name fields from delegated non-promoted constructor-injected form factories", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

use App\\Forms\\GatewayFormFactory;
use Nette\\Application\\UI\\Form;

class HomePresenter
{
    private $gatewayFormFactory;

    public function __construct(GatewayFormFactory $gatewayFormFactory)
    {
        $this->gatewayFormFactory = $gatewayFormFactory;
    }

    protected function createComponentGatewayForm(): Form
    {
        return $this->gatewayFormFactory->create();
    }
}
`;
    const factory = `<?php
namespace App\\Forms;

use Nette\\Application\\UI\\Form;

class GatewayFormFactory
{
    public function create(): Form
    {
        $form = new Form();
        $form->addText('email', 'Email');
        $form->addPassword('password', 'Password');
        return $form;
    }
}
`;
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": presenter,
    });
    const readPhpClassSource = vi.fn(async (className: string) =>
      className === "App\\Forms\\GatewayFormFactory"
        ? { path: `${ROOT}/app/Forms/GatewayFormFactory.php`, source: factory }
        : null,
    );
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      readFileContent,
      readPhpClassSource,
      resolveDeclaredType: (_source, typeHint) =>
        typeHint === "GatewayFormFactory"
          ? "App\\Forms\\GatewayFormFactory"
          : typeHint,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = '<form n:name="gatewayForm"><input n:name="pa"></form>';
    const offset = source.indexOf("pa") + "pa".length;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: "Nette form field",
          insertText: "password",
          label: "password",
        }),
      ]),
    );
    expect(readPhpClassSource).toHaveBeenCalledWith(
      "App\\Forms\\GatewayFormFactory",
    );
  });

  it("offers n:name fields from NEON service-typed delegated form factories", async () => {
    const presenter = `<?php
namespace App\\UI\\Home;

class HomePresenter
{
    private $gatewayFormFactory;

    protected function createComponentGatewayForm()
    {
        return $this->gatewayFormFactory->create();
    }
}
`;
    const factory = `<?php
namespace App\\Forms;

class GatewayFormFactory
{
    public function create()
    {
        $form = new Form();
        $form->addText('email', 'Email');
        return $form;
    }
}
`;
    const { listDirectory, readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": presenter,
      "config/services.neon":
        "services:\n    gatewayFormFactory: App\\Forms\\GatewayFormFactory\n",
    });
    const readPhpClassSource = vi.fn(async (className: string) =>
      className === "App\\Forms\\GatewayFormFactory"
        ? { path: `${ROOT}/app/Forms/GatewayFormFactory.php`, source: factory }
        : null,
    );
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      listDirectory,
      readFileContent,
      readPhpClassSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const source = '<form n:name="gatewayForm"><input n:name="em"></form>';
    const offset = source.indexOf("em") + "em".length;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offset),
    );

    expect(completions).toContainEqual(
      expect.objectContaining({
        detail: "Nette form field",
        insertText: "email",
        label: "email",
      }),
    );
    expect(readPhpClassSource).toHaveBeenCalledWith(
      "App\\Forms\\GatewayFormFactory",
    );
  });

  it.each(["input", "label", "inputError"] as const)(
    "offers field names for {%s} macros inside the active form",
    async (macro) => {
      const { readFileContent } = buildContentWorkspace({
        "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
      });
      const deps = makeDeps({
        getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
        readFileContent,
      });
      const latte = createLatteIntelligence(() => deps);
      const source = `{form contactForm}{${macro} em}{/form}`;
      const offset = source.indexOf("em") + "em".length;

      await expect(
        latte.provideLatteCompletions(source, positionAtOffset(source, offset)),
      ).resolves.toContainEqual(
        expect.objectContaining({
          detail: "Nette form field",
          insertText: "email",
          label: "email",
        }),
      );
    },
  );

  it("does not offer field completions for standalone, data-n:name, or dynamic form cases", async () => {
    const { readFileContent } = buildContentWorkspace({
      "app/UI/Home/HomePresenter.php": COMPONENT_PRESENTER_SOURCE,
    });
    const deps = makeDeps({
      getActiveDocument: () => ({ path: `${ROOT}/app/UI/Home/default.latte` }),
      readFileContent,
    });
    const latte = createLatteIntelligence(() => deps);
    const standalone = '<input n:name="e">';
    const dataAttribute =
      '<form n:name="contactForm"><input data-n:name="e"></form>';
    const dynamic = '<form n:name="$form"><input n:name="e"></form>';

    await expect(
      latte.provideLatteCompletions(
        standalone,
        positionAtOffset(standalone, standalone.indexOf("e") + 1),
      ),
    ).resolves.toEqual([]);
    await expect(
      latte.provideLatteCompletions(
        dataAttribute,
        positionAtOffset(dataAttribute, dataAttribute.indexOf("e") + 1),
      ),
    ).resolves.toEqual([]);
    await expect(
      latte.provideLatteCompletions(
        dynamic,
        positionAtOffset(dynamic, dynamic.lastIndexOf("e") + 1),
      ),
    ).resolves.toEqual([]);
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
      frameworkIntelligence: GENERIC_FRAMEWORK,
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
