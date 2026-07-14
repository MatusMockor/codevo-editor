// @vitest-environment jsdom

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkProviders";
import type {
  FileEntry,
  TextSearchResult,
  WorkspaceDescriptor,
} from "../domain/workspace";
import { createLatteIntelligence } from "./useLatteIntelligence";
import type {
  LatteDirectoryEntry,
  LatteIntelligenceDependencies,
} from "./useLatteIntelligence";
import { createNeonIntelligence } from "./useNeonIntelligence";
import type {
  NeonDirectoryEntry,
  NeonIntelligenceDependencies,
} from "./useNeonIntelligence";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { findNetteRedrawControlSnippetDefinitionTarget } from "./netteAjaxSnippetDefinitions";
import {
  createPhpNetteTranslationTargetResolver,
} from "./phpNetteFrameworkTargetAdapter";
import { resolvePhpFrameworkLiteralNavigationTarget } from "./phpFrameworkLiteralNavigation";
import {
  usePhpSemanticResolver,
  type UsePhpSemanticResolverOptions,
} from "./usePhpSemanticResolver";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const EBOX_CRM_ROOT =
  "/Users/matusmockor/Developer/Efabrica/boxes/ebox-crm";
const describeIfEboxCrmExists = existsSync(EBOX_CRM_ROOT)
  ? describe
  : describe.skip;
const NETTE_FRAMEWORK = createPhpFrameworkIntelligence({
  matchedProviderIds: ["nette"],
  profile: "nette",
  providers: [phpNetteFrameworkProvider],
});

type Resolver = ReturnType<typeof usePhpSemanticResolver>;

function joinPath(root: string, relativePath: string): string {
  return path.join(root, relativePath);
}

function toRelativePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

async function listDirectory(
  directory: string,
): Promise<Array<(LatteDirectoryEntry | NeonDirectoryEntry) & FileEntry>> {
  const entries = await readdir(directory, { withFileTypes: true });

  return entries
    .map((entry) => ({
      kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
      name: entry.name,
      path: path.join(directory, entry.name),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function readFileContent(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

async function findLatteFileContaining(
  relativeDirectory: string,
  needle: string,
): Promise<{ relativePath: string; source: string }> {
  const directory = joinPath(EBOX_CRM_ROOT, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = [relativeDirectory, entry.name]
      .filter(Boolean)
      .join("/");

    if (entry.isDirectory()) {
      const match = await findLatteFileContaining(relativePath, needle);

      if (match.source) {
        return match;
      }

      continue;
    }

    if (!entry.name.endsWith(".latte")) {
      continue;
    }

    const source = await readFileContent(joinPath(EBOX_CRM_ROOT, relativePath));

    if (source.includes(needle)) {
      return { relativePath, source };
    }
  }

  return { relativePath: "", source: "" };
}

async function readPhpClassSource(
  className: string,
): Promise<{ path: string; source: string } | null> {
  const shortName = className.split("\\").pop() ?? className;
  const candidates = [
    `app/modules/multiStepperModule/Forms/${shortName}.php`,
    `${className.replace(/\\/g, "/")}.php`,
  ];

  for (const relativePath of candidates) {
    const filePath = joinPath(EBOX_CRM_ROOT, relativePath);

    if (!existsSync(filePath)) {
      continue;
    }

    return {
      path: filePath,
      source: await readFileContent(filePath),
    };
  }

  return null;
}

function positionAtOffset(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lineNumber = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: offset - lineStart + 1, lineNumber };
}

function offsetInside(source: string, needle: string): number {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Fixture no longer contains ${needle}`);
  }

  return offset + Math.max(1, Math.floor(needle.length / 2));
}

function offsetAfter(source: string, needle: string): number {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Fixture no longer contains ${needle}`);
  }

  return offset + needle.length;
}

function makeLatteDeps(
  activeRelativePath: string,
  overrides: Partial<LatteIntelligenceDependencies> = {},
): LatteIntelligenceDependencies {
  const currentWorkspaceRootRef = { current: EBOX_CRM_ROOT };
  const translationResolver = createPhpNetteTranslationTargetResolver({
    currentWorkspaceRootRef,
    joinWorkspacePath: joinPath,
    readCachedTranslationTargets: () => null,
    readNavigationFileContent: readFileContent,
    readWorkspaceDirectory: listDirectory,
    relativeWorkspacePath: toRelativePath,
    supportsTranslations: () => true,
    workspaceRoot: EBOX_CRM_ROOT,
    writeCachedTranslationTargets: () => {},
  });

  return {
    collectTranslationTargets: translationResolver.collect,
    currentWorkspaceRootRef,
    findTranslationTarget: translationResolver.find,
    frameworkIntelligence: NETTE_FRAMEWORK,
    getActiveDocument: () => ({
      path: joinPath(EBOX_CRM_ROOT, activeRelativePath),
    }),
    isSemanticIntelligenceActive: true,
    joinPath,
    listDirectory,
    openPhpMethodTarget: vi.fn(async () => true),
    openPhpPropertyTarget: vi.fn(async () => true),
    openTarget: vi.fn(async () => true),
    readFileContent,
    readPhpClassSource,
    resolveDeclaredType: (_source, typeHint) => typeHint,
    resolveExpressionType: vi.fn(async () => null),
    resolvePhpReceiverCompletions: vi.fn(async () => []),
    searchText: vi.fn(async () => []),
    synthesizeTypedReceiverSource: (variableName, typeName) => ({
      position: { column: 1, lineNumber: 3 },
      source: `<?php\n/** @var \\${typeName} $${variableName} */\n$${variableName}->`,
    }),
    toRelativePath,
    workspaceRoot: EBOX_CRM_ROOT,
    ...overrides,
  };
}

function makeNeonDeps(
  activeRelativePath: string,
  overrides: Partial<NeonIntelligenceDependencies> = {},
): NeonIntelligenceDependencies {
  return {
    currentWorkspaceRootRef: { current: EBOX_CRM_ROOT },
    frameworkIntelligence: NETTE_FRAMEWORK,
    getActiveDocument: () => ({
      path: joinPath(EBOX_CRM_ROOT, activeRelativePath),
    }),
    isSemanticIntelligenceActive: true,
    joinPath,
    listDirectory,
    openClassTarget: vi.fn(async () => true),
    openDirectPhpMethodTarget: vi.fn(async () => true),
    openTarget: vi.fn(async () => true),
    readFileContent,
    resolvePhpReceiverCompletions: vi.fn(async () => []),
    searchClassNames: vi.fn(async () => []),
    setImplementationChooser: vi.fn(),
    synthesizeTypedReceiverSource: (variableName, typeName) => ({
      position: { column: variableName.length + 4, lineNumber: 3 },
      source: `<?php\n/** @var \\${typeName} $${variableName} */\n$${variableName}->`,
    }),
    toRelativePath,
    workspaceRoot: EBOX_CRM_ROOT,
    ...overrides,
  };
}

function eboxPhpDescriptor(): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: {
      classmapRoots: [{ dev: false, paths: ["app"] }],
      hasComposer: true,
      packageName: null,
      packages: [],
      phpPlatformVersion: null,
      phpVersionConstraint: null,
      psr4Roots: [],
    },
    rootPath: EBOX_CRM_ROOT,
  };
}

function makePhpResolverOptions(
  frameworkSources: readonly string[],
  classSourcePaths: ReadonlyMap<string, string>,
): UsePhpSemanticResolverOptions {
  return {
    activePhpFrameworkProviders: [phpNetteFrameworkProvider],
    currentPhpFrameworkSourceContext: () => ({
      signature: `ebox:${frameworkSources.length}`,
      workspaceSources: frameworkSources,
    }),
    currentWorkspaceRootRef: { current: EBOX_CRM_ROOT },
    fileSearch: {
      searchFiles: vi.fn(async (_root, query) => {
        const path = classSourcePaths.get(query);

        return path
          ? [
              {
                name: query,
                path,
                relativePath: toRelativePath(EBOX_CRM_ROOT, path),
              },
            ]
          : [];
      }),
    },
    intelligenceMode: "basic",
    phpClassSourcePathCacheRef: { current: {} },
    phpFrameworkBindingCacheRef: { current: {} },
    projectSymbolSearch: { searchProjectSymbols: vi.fn(async () => []) },
    readNavigationFileContent: readFileContent,
    textSearch: {
      replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
      searchText: vi.fn(async (): Promise<TextSearchResult[]> => []),
    },
    workspaceDescriptor: eboxPhpDescriptor(),
    workspaceRoot: EBOX_CRM_ROOT,
  };
}

function renderPhpResolver(initialOptions: UsePhpSemanticResolverOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: Resolver | null } = { api: null };

  function Harness({ options }: { options: UsePhpSemanticResolverOptions }) {
    captured.api = usePhpSemanticResolver(options);
    return null;
  }

  act(() => {
    root.render(<Harness options={initialOptions} />);
  });

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("resolver hook not mounted");
      }

      return captured.api;
    },
    unmount: () => act(() => root.unmount()),
  };
}

describeIfEboxCrmExists("ebox-crm Nette provider smoke", () => {
  it("resolves real getByType IRecencyStorage autowiring to RedisRecencyStorage", async () => {
    const profileSelectPath = "tests/Api/Pack1/ProfileSelectApiCest.php";
    const configPath = "app/modules/baseModule/config.neon";
    const redisStoragePath =
      "app/modules/baseModule/model/Recency/Storage/RedisRecencyStorage.php";
    const interfacePath =
      "app/modules/baseModule/model/Recency/Storage/IRecencyStorage.php";
    const [profileSelect, config, redisStorage, interfaceSource] =
      await Promise.all([
        readFileContent(joinPath(EBOX_CRM_ROOT, profileSelectPath)),
        readFileContent(joinPath(EBOX_CRM_ROOT, configPath)),
        readFileContent(joinPath(EBOX_CRM_ROOT, redisStoragePath)),
        readFileContent(joinPath(EBOX_CRM_ROOT, interfacePath)),
      ]);
    const harness = renderPhpResolver(
      makePhpResolverOptions(
        [config, redisStorage, interfaceSource, profileSelect],
        new Map([
          [
            "RedisRecencyStorage.php",
            joinPath(EBOX_CRM_ROOT, redisStoragePath),
          ],
          ["IRecencyStorage.php", joinPath(EBOX_CRM_ROOT, interfacePath)],
        ]),
      ),
    );

    expect(profileSelect).toContain("getByType(IRecencyStorage::class)");
    expect(config).toContain(
      "Efabrica\\Crm\\BaseModule\\RecencyStore\\Storage\\RedisRecencyStorage",
    );
    expect(redisStorage).toContain("implements IRecencyStorage");
    expect(interfaceSource).toContain("interface IRecencyStorage");

    const requestedClassName = harness
      .api()
      .resolvePhpClassReference(profileSelect, "IRecencyStorage");

    expect(requestedClassName).toBe(
      "Efabrica\\Crm\\BaseModule\\RecencyStore\\Storage\\IRecencyStorage",
    );
    await expect(
      harness.api().resolvePhpFrameworkBoundConcrete(requestedClassName ?? ""),
    ).resolves.toBe(
      "Efabrica\\Crm\\BaseModule\\RecencyStore\\Storage\\RedisRecencyStorage",
    );

    harness.unmount();
  });

  it("covers presenter link definition, include paths, controls, and presenter link completion over real Latte files", async () => {
    const usersShowPath =
      "app/modules/usersModule/templates/UsersAdmin/show.latte";
    const usersShow = await readFileContent(joinPath(EBOX_CRM_ROOT, usersShowPath));
    const usersDeps = makeLatteDeps(usersShowPath);
    const latte = createLatteIntelligence(() => usersDeps);
    const usersPresenterPath =
      "app/modules/usersModule/Presenters/UsersAdminPresenter.php";
    const usersPresenter = await readFileContent(
      joinPath(EBOX_CRM_ROOT, usersPresenterPath),
    );

    await expect(
      latte.provideLatteDefinition(
        usersShow,
        offsetAfter(usersShow, 'n:href="d'),
      ),
    ).resolves.toBe(true);
    expect(usersDeps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, usersPresenterPath),
      positionAtOffset(usersPresenter, usersPresenter.indexOf("renderDefault")),
      "default",
    );

    await expect(
      latte.provideLatteDefinition(
        usersShow,
        offsetInside(usersShow, "{control userAlertStorage}"),
      ),
    ).resolves.toBe(true);
    expect(usersDeps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, usersPresenterPath),
      positionAtOffset(
        usersPresenter,
        usersPresenter.indexOf("createComponentUserAlertStorage"),
      ),
      "userAlertStorage",
    );

    const controlSource = "{control d}";
    const controlCompletions = await latte.provideLatteCompletions(
      controlSource,
      positionAtOffset(controlSource, controlSource.indexOf("d") + 1),
    );
    expect(controlCompletions.map((item) => item.label)).toContain("detailWidget");

    const linkSource = '<a n:href="UsersAdmin:s"></a>';
    const linkCompletions = await latte.provideLatteCompletions(
      linkSource,
      positionAtOffset(linkSource, linkSource.indexOf(":s") + 2),
    );
    expect(linkCompletions.map((item) => item.label)).toContain("UsersAdmin:show");

    const translationSource = "{_'adyen.admin.menu.'}";
    const translationCompletions = await latte.provideLatteCompletions(
      translationSource,
      positionAtOffset(
        translationSource,
        translationSource.indexOf("menu.") + "menu.".length,
      ),
    );
    expect(translationCompletions.map((item) => item.label)).toContain(
      "adyen.admin.menu.notification_modifiers",
    );

    const translationDefinitionSource =
      "{_'adyen.admin.menu.notification_modifiers'}";
    await expect(
      latte.provideLatteDefinition(
        translationDefinitionSource,
        translationDefinitionSource.indexOf("notification_modifiers"),
      ),
    ).resolves.toBe(true);
    expect(usersDeps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, "app/modules/adyenModule/lang/adyen.en_US.neon"),
      expect.any(Object),
      "adyen.admin.menu.notification_modifiers",
    );

    const relationsPath =
      "app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/showRelations.latte";
    const relations = await readFileContent(joinPath(EBOX_CRM_ROOT, relationsPath));
    const relationsDeps = makeLatteDeps(relationsPath);
    const relationsLatte = createLatteIntelligence(() => relationsDeps);

    await expect(
      relationsLatte.provideLatteDefinition(
        relations,
        offsetInside(relations, "partials/@showHeader.latte"),
      ),
    ).resolves.toBe(true);
    expect(relationsDeps.openTarget).toHaveBeenLastCalledWith(
      joinPath(
        EBOX_CRM_ROOT,
        "app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/partials/@showHeader.latte",
      ),
      { column: 1, lineNumber: 1 },
      "partials/@showHeader.latte",
    );

    const includeCompletions = await relationsLatte.provideLatteCompletions(
      relations,
      positionAtOffset(relations, relations.indexOf("partials/@show") + 14),
    );
    expect(includeCompletions.map((item) => item.label)).toEqual(
      expect.arrayContaining([
        "partials/@showHeader.latte",
        "partials/@showSubmenu.latte",
      ]),
    );
  });

  it("covers Nette AJAX snippet navigation from Latte to redrawControl over real component files", async () => {
    const templatePath =
      "app/modules/mailerModule/Components/MailLogs/mail_logs.latte";
    const componentPath =
      "app/modules/mailerModule/Components/MailLogs/MailLogs.php";
    const source = await readFileContent(joinPath(EBOX_CRM_ROOT, templatePath));
    const component = await readFileContent(joinPath(EBOX_CRM_ROOT, componentPath));
    const deps = makeLatteDeps(templatePath);
    const latte = createLatteIntelligence(() => deps);

    await expect(
      latte.provideLatteDefinition(
        source,
        offsetInside(source, "{snippet mailLogslisting}"),
      ),
    ).resolves.toBe(true);
    expect(deps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, componentPath),
      positionAtOffset(component, component.indexOf("mailLogslisting")),
      "mailLogslisting",
    );
  });

  it("covers literal addComponent controls over real ebox presenter/template pairs", async () => {
    const cases = [
      {
        componentName: "vp",
        presenterPath:
          "app/modules/efabricaPaymentsModule/Presenters/PaymentLogsAdminPresenter.php",
        registrationNeedle: "$this->addComponent($vp, 'vp')",
        templatePath:
          "app/modules/efabricaPaymentsModule/templates/PaymentLogsAdmin/default.latte",
      },
      {
        componentName: "paginator",
        presenterPath:
          "app/modules/paymentsModule/Presenters/PaymentsRecurrentAdminPresenter.php",
        registrationNeedle: "$this->addComponent($pnp, 'paginator')",
        templatePath:
          "app/modules/paymentsModule/templates/PaymentsRecurrentAdmin/default.latte",
      },
    ];

    for (const fixture of cases) {
      const source = await readFileContent(
        joinPath(EBOX_CRM_ROOT, fixture.templatePath),
      );
      const presenter = await readFileContent(
        joinPath(EBOX_CRM_ROOT, fixture.presenterPath),
      );
      const deps = makeLatteDeps(fixture.templatePath);
      const latte = createLatteIntelligence(() => deps);

      await expect(
        latte.provideLatteDefinition(
          source,
          source.indexOf(`{control ${fixture.componentName}`) +
            "{control ".length +
            Math.max(1, Math.floor(fixture.componentName.length / 2)),
        ),
      ).resolves.toBe(true);
      expect(deps.openTarget).toHaveBeenLastCalledWith(
        joinPath(EBOX_CRM_ROOT, fixture.presenterPath),
        positionAtOffset(
          presenter,
          presenter.indexOf(fixture.registrationNeedle) +
            fixture.registrationNeedle.lastIndexOf(fixture.componentName),
        ),
        fixture.componentName,
      );

      const completionSource = `{control ${fixture.componentName.slice(0, 1)}}`;
      const completions = await latte.provideLatteCompletions(
        completionSource,
        positionAtOffset(
          completionSource,
          completionSource.indexOf(fixture.componentName.slice(0, 1)) + 1,
        ),
      );
      expect(completions.map((item) => item.label)).toContain(
        fixture.componentName,
      );
    }
  });

  it("covers Nette AJAX snippet navigation from redrawControl to colocated Latte over real component files", async () => {
    const templatePath =
      "app/modules/mailerModule/Components/MailLogs/mail_logs.latte";
    const componentPath =
      "app/modules/mailerModule/Components/MailLogs/MailLogs.php";
    const template = await readFileContent(joinPath(EBOX_CRM_ROOT, templatePath));
    const component = await readFileContent(joinPath(EBOX_CRM_ROOT, componentPath));

    await expect(
      resolvePhpFrameworkLiteralNavigationTarget(
        {
          activeDocument: {
            content: component,
            path: joinPath(EBOX_CRM_ROOT, componentPath),
          },
          offset: offsetInside(component, "mailLogslisting"),
          position: positionAtOffset(
            component,
            component.indexOf("mailLogslisting"),
          ),
          providers: [phpNetteFrameworkProvider],
          source: component,
          supportsStringLiterals: true,
        },
        {
          collectNamedRouteTargets: vi.fn(async () => []),
          findConfigTarget: vi.fn(async () => null),
          findEnvTarget: vi.fn(async () => null),
          findNetteRedrawControlSnippetTarget: (currentPath, snippetName) =>
            findNetteRedrawControlSnippetDefinitionTarget(
              {
                currentPhpRelativePath: toRelativePath(
                  EBOX_CRM_ROOT,
                  currentPath,
                ),
                deps: {
                  joinPath,
                  readFileContent,
                },
                isRequestedRootActive: () => true,
                requestedRoot: EBOX_CRM_ROOT,
              },
              snippetName,
            ),
          findTranslationTarget: vi.fn(async () => null),
          findViewTarget: vi.fn(async () => null),
        },
      ),
    ).resolves.toEqual({
      kind: "nette.ajax-snippet",
      label: "mailLogslisting",
      path: joinPath(EBOX_CRM_ROOT, templatePath),
      position: positionAtOffset(template, template.indexOf("mailLogslisting")),
    });
  });

  it("resolves the real ebox webalize Latte filter to the Nette Strings method", async () => {
    const { relativePath: templatePath, source } = await findLatteFileContaining(
      "app",
      "|webalize",
    );
    expect(templatePath).not.toBe("");

    const deps = makeLatteDeps(templatePath);
    const latte = createLatteIntelligence(() => deps);

    await expect(
      latte.provideLatteDefinition(source, offsetInside(source, "webalize")),
    ).resolves.toBe(true);
    expect(deps.openPhpMethodTarget).toHaveBeenLastCalledWith(
      "Nette\\Utils\\Strings",
      "webalize",
    );
  });

  it("covers delegated Nette form factory fields used by real ebox n:name attributes", async () => {
    const templatePath =
      "app/modules/multiStepperModule/templates/MultiSteppersAdmin/show.latte";
    const source = await readFileContent(joinPath(EBOX_CRM_ROOT, templatePath));
    const deps = makeLatteDeps(templatePath);
    const latte = createLatteIntelligence(() => deps);

    const gatewaySubscriptionTypeLinkCompletions =
      await latte.provideLatteCompletions(
        source,
        positionAtOffset(
          source,
          offsetAfter(source, 'n:name="subscription_type_link_id'),
        ),
      );
    expect(gatewaySubscriptionTypeLinkCompletions).toContainEqual(
      expect.objectContaining({
        detail: "Nette form field",
        label: "subscription_type_link_id",
      }),
    );

    const gatewayJsonCompletions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offsetAfter(source, 'n:name="gateways_json')),
    );
    expect(gatewayJsonCompletions).toContainEqual(
      expect.objectContaining({
        detail: "Nette form field",
        label: "gateways_json",
      }),
    );

    for (const fieldName of ["stepper_id", "guard_id", "type", "config"]) {
      const completions = await latte.provideLatteCompletions(
        source,
        positionAtOffset(source, offsetAfter(source, `n:name="${fieldName}`)),
      );

      expect(completions).toContainEqual(
        expect.objectContaining({
          detail: "Nette form field",
          label: fieldName,
        }),
      );
    }
  });

  it("covers ebox Template::add() view-data feeding Latte variable and member completion", async () => {
    const templatePath =
      "app/modules/parentalControlsModule/templates/ParentalControlsAdmin/show.latte";
    const presenterPath =
      "app/modules/parentalControlsModule/presenters/ParentalControlsAdminPresenter.php";
    const resolvePhpReceiverCompletions = vi.fn(async () => [
      {
        declaringClassName: "Nette\\Database\\Table\\ActiveRow",
        kind: "property" as const,
        name: "id",
        parameters: "",
        returnType: "mixed",
      },
    ]);
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );
    const deps = makeLatteDeps(templatePath, {
      resolveExpressionType: vi.fn(async (_source, _position, expression) =>
        expression.includes("parentalControlsRangesRepository->find")
          ? "Nette\\Database\\Table\\ActiveRow"
          : null,
      ),
      resolvePhpReceiverCompletions,
      searchText: vi.fn(async (_root, query) =>
        query === "template->add("
          ? [{ path: joinPath(EBOX_CRM_ROOT, presenterPath) }]
          : [],
      ),
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const variableSource = "{$ra}";
    const variableCompletions = await latte.provideLatteCompletions(
      variableSource,
      positionAtOffset(variableSource, variableSource.indexOf("ra") + 2),
    );

    expect(variableCompletions.map((item) => item.label)).toContain("$range");

    const memberSource = "{$range->}";
    const memberCompletions = await latte.provideLatteCompletions(
      memberSource,
      positionAtOffset(memberSource, memberSource.indexOf("->") + 2),
    );

    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "range",
      "Nette\\Database\\Table\\ActiveRow",
    );
    expect(memberCompletions.map((item) => item.label)).toContain("id");
  });

  it("covers variable completion inside a real n:foreach attribute value", async () => {
    const templatePath =
      "app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/showAddons.latte";
    const source = await readFileContent(joinPath(EBOX_CRM_ROOT, templatePath));
    const deps = makeLatteDeps(templatePath);
    const latte = createLatteIntelligence(() => deps);

    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(
        source,
        offsetAfter(source, 'n:foreach="$groupAddonTypeGr'),
      ),
    );

    expect(completions.map((item) => item.label)).toContain(
      "$groupAddonTypeGroups",
    );

    const filterCompletions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offsetAfter(source, "created_at|user")),
    );

    expect(filterCompletions.map((item) => item.label)).toContain("userDate");
  });

  it("covers iterable object foreach member completion via current() fallback over real Latte files", async () => {
    const apiTokensSelection =
      "Efabrica\\Crm\\ActiveRowTypes\\Selection\\ApiTokensSelection";
    const apiTokensActiveRow =
      "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\ApiTokensActiveRow";
    const subscriptionTypeGroupsSelection =
      "Efabrica\\Crm\\ActiveRowTypes\\Selection\\SubscriptionTypeGroupsSelection";
    const subscriptionTypeGroupsActiveRow =
      "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\SubscriptionTypeGroupsActiveRow";
    const resolvePhpReceiverCompletions = vi.fn(async () => [
      {
        declaringClassName: "Nette\\Database\\Table\\ActiveRow",
        kind: "property" as const,
        name: "id",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Nette\\Database\\Table\\ActiveRow",
        kind: "property" as const,
        name: "name",
        parameters: "",
        returnType: "mixed",
      },
    ]);
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );

    const apiTokensTemplatePath =
      "app/modules/apiModule/templates/ApiTokensAdmin/default.latte";
    const apiTokensPresenterPath =
      "app/modules/apiModule/Presenters/ApiTokensAdminPresenter.php";
    const apiTokensSource = await readFileContent(
      joinPath(EBOX_CRM_ROOT, apiTokensTemplatePath),
    );
    const apiTokensDeps = makeLatteDeps(apiTokensTemplatePath, {
      resolveExpressionType: vi.fn(async (_source, _position, expression) => {
        if (expression.includes("apiTokensRepository->all")) {
          return apiTokensSelection;
        }

        if (expression === "$apiTokens->current()") {
          return `${apiTokensActiveRow}|false`;
        }

        return null;
      }),
      resolvePhpReceiverCompletions,
      searchText: vi.fn(async () => [
        { path: joinPath(EBOX_CRM_ROOT, apiTokensPresenterPath) },
      ]),
      synthesizeTypedReceiverSource,
    });
    const apiTokensLatte = createLatteIntelligence(() => apiTokensDeps);
    const apiTokenCompletions = await apiTokensLatte.provideLatteCompletions(
      apiTokensSource,
      positionAtOffset(apiTokensSource, offsetAfter(apiTokensSource, "$apiToken->")),
    );

    expect(synthesizeTypedReceiverSource).toHaveBeenLastCalledWith(
      "apiToken",
      apiTokensActiveRow,
    );
    expect(apiTokenCompletions.map((item) => item.label)).toContain("name");

    const relationsTemplatePath =
      "app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/relations.latte";
    const relationsPresenterPath =
      "app/modules/efabricaSubscriptionsModule/Presenters/SubscriptionTypeGroupAdminPresenter.php";
    const relationsSource = await readFileContent(
      joinPath(EBOX_CRM_ROOT, relationsTemplatePath),
    );
    const relationsDeps = makeLatteDeps(relationsTemplatePath, {
      resolveExpressionType: vi.fn(async (_source, _position, expression) => {
        if (
          expression.includes("subscriptionTypeGroupsRepository->getTable") ||
          expression === "clone $subscriptionTypeGroups"
        ) {
          return subscriptionTypeGroupsSelection;
        }

        if (expression === "$sourceSubscriptionTypeGroups->current()") {
          return `${subscriptionTypeGroupsActiveRow}|false|null`;
        }

        return null;
      }),
      resolvePhpReceiverCompletions,
      searchText: vi.fn(async () => [
        { path: joinPath(EBOX_CRM_ROOT, relationsPresenterPath) },
      ]),
      synthesizeTypedReceiverSource,
    });
    const relationsLatte = createLatteIntelligence(() => relationsDeps);
    const relationCompletions = await relationsLatte.provideLatteCompletions(
      relationsSource,
      positionAtOffset(
        relationsSource,
        offsetAfter(relationsSource, "{$subscriptionTypeGroup->"),
      ),
    );

    expect(synthesizeTypedReceiverSource).toHaveBeenLastCalledWith(
      "subscriptionTypeGroup",
      subscriptionTypeGroupsActiveRow,
    );
    expect(relationCompletions.map((item) => item.label)).toContain("id");
  });

  it("covers real ebox Latte filter definition targets from NEON registrations", async () => {
    const usersTemplatePath =
      "app/modules/usersModule/templates/UsersAdmin/show.latte";
    const usersSource = await readFileContent(
      joinPath(EBOX_CRM_ROOT, usersTemplatePath),
    );
    const usersDeps = makeLatteDeps(usersTemplatePath);
    const usersLatte = createLatteIntelligence(() => usersDeps);
    const usersConfigPath = "app/modules/usersModule/config/config.neon";
    const usersConfig = await readFileContent(
      joinPath(EBOX_CRM_ROOT, usersConfigPath),
    );

    await expect(
      usersLatte.provideLatteDefinition(
        usersSource,
        offsetInside(usersSource, "userLabel"),
      ),
    ).resolves.toBe(true);
    expect(usersDeps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, usersConfigPath),
      positionAtOffset(usersConfig, usersConfig.indexOf("userLabel")),
      "userLabel",
    );

    await expect(
      usersLatte.provideLatteDefinition(
        usersSource,
        offsetInside(usersSource, "gravatar"),
      ),
    ).resolves.toBe(true);
    expect(usersDeps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, usersConfigPath),
      positionAtOffset(usersConfig, usersConfig.indexOf("gravatar")),
      "gravatar",
    );

    const subscriptionTemplatePath =
      "app/modules/efabricaSubscriptionsModule/templates/SubscriptionTypeGroupAdmin/default.latte";
    const subscriptionSource = await readFileContent(
      joinPath(EBOX_CRM_ROOT, subscriptionTemplatePath),
    );
    const subscriptionDeps = makeLatteDeps(subscriptionTemplatePath);
    const subscriptionLatte = createLatteIntelligence(() => subscriptionDeps);

    await expect(
      subscriptionLatte.provideLatteDefinition(
        subscriptionSource,
        offsetInside(subscriptionSource, "formatContentGroups"),
      ),
    ).resolves.toBe(true);
    expect(subscriptionDeps.openPhpMethodTarget).toHaveBeenLastCalledWith(
      "Crm\\IntegrationModule\\Helper\\ContentGroupHelper",
      "getFormattedContentGroupData",
    );

    const apiTokensTemplatePath =
      "app/modules/apiModule/templates/ApiTokensAdmin/default.latte";
    const apiTokensSource = await readFileContent(
      joinPath(EBOX_CRM_ROOT, apiTokensTemplatePath),
    );
    const apiTokensDeps = makeLatteDeps(apiTokensTemplatePath);
    const apiTokensLatte = createLatteIntelligence(() => apiTokensDeps);
    await expect(
      apiTokensLatte.provideLatteDefinition(
        apiTokensSource,
        offsetInside(apiTokensSource, "userDate"),
      ),
    ).resolves.toBe(true);
    expect(apiTokensDeps.openPhpMethodTarget).toHaveBeenLastCalledWith(
      "Crm\\ApplicationModule\\Helpers\\UserDateHelper",
      "process",
    );
  });

  it("covers NEON class refs, service reference definition, service completions, and setup methods over real config", async () => {
    const configPath = "app/modules/usersModule/config/config.neon";
    const source = await readFileContent(joinPath(EBOX_CRM_ROOT, configPath));
    const openClassTarget = vi.fn(async () => true);
    const openDirectPhpMethodTarget = vi.fn(async () => true);
    const deps = makeNeonDeps(configPath, {
      openClassTarget,
      openDirectPhpMethodTarget,
      resolvePhpReceiverCompletions: vi.fn(async () => [
        {
          declaringClassName: "Crm\\UsersModule\\Email\\EmailValidator",
          insertText: "addValidator($validator)",
          name: "addValidator",
          parameters: "$validator",
          returnType: "void",
        },
      ]),
    });
    const neon = createNeonIntelligence(() => deps);

    await expect(
      neon.provideNeonDefinition(
        source,
        offsetInside(source, "Crm\\UsersModule\\Email\\EmailValidator"),
      ),
    ).resolves.toBe(true);
    expect(openClassTarget).toHaveBeenLastCalledWith(
      "Crm\\UsersModule\\Email\\EmailValidator",
    );

    await expect(
      neon.provideNeonDefinition(source, offsetInside(source, "@mailgunClient")),
    ).resolves.toBe(true);
    expect(deps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, configPath),
      positionAtOffset(source, source.indexOf("mailgunClient:")),
      "@mailgunClient",
    );

    const serviceCompletions = await neon.provideNeonCompletions(
      source,
      positionAtOffset(source, source.indexOf("@mailgunClient") + "@mail".length),
    );
    expect(serviceCompletions.map((item) => item.label)).toContain(
      "mailgunClient",
    );

    await expect(
      neon.provideNeonDefinition(source, offsetInside(source, "addValidator")),
    ).resolves.toBe(true);
    expect(openDirectPhpMethodTarget).toHaveBeenLastCalledWith(
      "Crm\\UsersModule\\Email\\EmailValidator",
      "addValidator",
    );

    const setupMethodOffset = source.indexOf("addValidator");
    const setupCompletionSource = `${source.slice(0, setupMethodOffset)}add${source.slice(
      setupMethodOffset + "addValidator".length,
    )}`;
    const setupCompletions = await neon.provideNeonCompletions(
      setupCompletionSource,
      positionAtOffset(setupCompletionSource, setupMethodOffset + "add".length),
    );
    expect(setupCompletions.map((item) => item.label)).toContain("addValidator");
  });

  it("resolves the real payments gateway permission policy service to its concrete type handoffs", async () => {
    const configPath = "app/modules/paymentsModule/config/config.neon";
    const source = await readFileContent(joinPath(EBOX_CRM_ROOT, configPath));
    const policyClass =
      "Crm\\PaymentsModule\\Action\\PaymentGatewayPermissions\\Check\\DefaultGatewayPermissionCheckPolicy";
    const openClassTarget = vi.fn(async () => true);
    const openDirectPhpMethodTarget = vi.fn(async () => true);
    const resolvePhpReceiverCompletions = vi.fn(async () => [
      {
        declaringClassName: policyClass,
        insertText: "isEnabled()",
        name: "isEnabled",
        parameters: "",
        returnType: "bool",
      },
    ]);
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `<?php\n/** @var \\${typeName} $${variableName} */\n$${variableName}->`,
      }),
    );
    const deps = makeNeonDeps(configPath, {
      openClassTarget,
      openDirectPhpMethodTarget,
      resolvePhpReceiverCompletions,
      synthesizeTypedReceiverSource,
    });
    const neon = createNeonIntelligence(() => deps);

    await expect(
      neon.provideNeonDefinition(source, offsetInside(source, policyClass)),
    ).resolves.toBe(true);
    expect(openClassTarget).toHaveBeenLastCalledWith(policyClass);

    const serviceCompletionSource =
      "services:\n    probe: @gatewayPermission";
    const serviceCompletions = await neon.provideNeonCompletions(
      serviceCompletionSource,
      positionAtOffset(serviceCompletionSource, serviceCompletionSource.length),
    );
    expect(serviceCompletions.map((item) => item.label)).toContain(
      "gatewayPermissionCheckPolicy",
    );

    const consumerSource =
      "services:\n    probe: @gatewayPermissionCheckPolicy::isEnabled\n";
    await expect(
      neon.provideNeonDefinition(
        consumerSource,
        offsetInside(consumerSource, "isEnabled"),
      ),
    ).resolves.toBe(true);
    expect(openDirectPhpMethodTarget).toHaveBeenLastCalledWith(
      policyClass,
      "isEnabled",
    );

    const setupSource = [
      "services:",
      "    probe:",
      `        factory: ${policyClass}(true)`,
      "        setup:",
      "            - is",
    ].join("\n");
    const setupCompletions = await neon.provideNeonCompletions(
      setupSource,
      positionAtOffset(setupSource, setupSource.length),
    );
    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "service",
      policyClass,
    );
    expect(setupCompletions).toContainEqual(
      expect.objectContaining({
        detail: `${policyClass}::isEnabled(): bool`,
        label: "isEnabled",
      }),
    );
  });
});
