// @vitest-environment jsdom

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { FileEntry } from "../domain/workspace";
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
import { createPhpNetteTranslationTargetResolver } from "./phpNetteFrameworkTargetAdapter";

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

describeIfEboxCrmExists("ebox-crm Nette provider smoke", () => {
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
    const integrationConfigPath =
      "app/modules/integrationModule/config/config.neon";
    const integrationConfig = await readFileContent(
      joinPath(EBOX_CRM_ROOT, integrationConfigPath),
    );

    await expect(
      subscriptionLatte.provideLatteDefinition(
        subscriptionSource,
        offsetInside(subscriptionSource, "formatContentGroups"),
      ),
    ).resolves.toBe(true);
    expect(subscriptionDeps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, integrationConfigPath),
      positionAtOffset(
        integrationConfig,
        integrationConfig.indexOf("formatContentGroups"),
      ),
      "formatContentGroups",
    );

    const apiTokensTemplatePath =
      "app/modules/apiModule/templates/ApiTokensAdmin/default.latte";
    const apiTokensSource = await readFileContent(
      joinPath(EBOX_CRM_ROOT, apiTokensTemplatePath),
    );
    const apiTokensDeps = makeLatteDeps(apiTokensTemplatePath);
    const apiTokensLatte = createLatteIntelligence(() => apiTokensDeps);
    const applicationConfigPath =
      "app/modules/applicationModule/config/config.neon";
    const applicationConfig = await readFileContent(
      joinPath(EBOX_CRM_ROOT, applicationConfigPath),
    );

    await expect(
      apiTokensLatte.provideLatteDefinition(
        apiTokensSource,
        offsetInside(apiTokensSource, "userDate"),
      ),
    ).resolves.toBe(true);
    expect(apiTokensDeps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, applicationConfigPath),
      positionAtOffset(applicationConfig, applicationConfig.indexOf("userDate")),
      "userDate",
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
});
