// @vitest-environment jsdom

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkProviders";
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
): Promise<Array<LatteDirectoryEntry | NeonDirectoryEntry>> {
  const entries = await readdir(directory, { withFileTypes: true });

  return entries
    .map((entry) => ({
      kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
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
  return {
    currentWorkspaceRootRef: { current: EBOX_CRM_ROOT },
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
