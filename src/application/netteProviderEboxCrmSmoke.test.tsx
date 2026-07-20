import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
// @vitest-environment jsdom

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { resolvePhpClassName } from "../domain/phpNavigation";
import { phpReceiverExpressionTypeInSource } from "../domain/phpSemanticEngine";
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
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { synthesizePhpTypedReceiverSource } from "./phpTypedReceiverSource";
import { findNetteRedrawControlSnippetDefinitionTarget } from "./netteAjaxSnippetDefinitions";
import {
  createPhpNetteTranslationTargetResolver,
} from "./phpNetteFrameworkTargetAdapter";
import { resolvePhpFrameworkLiteralNavigationTarget } from "./phpFrameworkLiteralNavigation";
import {
  usePhpSemanticResolver,
  type UsePhpSemanticResolverOptions,
} from "./usePhpSemanticResolver";
import {
  usePhpClassMemberCollectors,
  type PhpClassMemberCollectors,
} from "./usePhpClassMemberCollectors";
import {
  usePhpMethodReturnTypeResolver,
  type UsePhpMethodReturnTypeResolverOptions,
} from "./usePhpMethodReturnTypeResolver";
import {
  usePhpMethodCompletionResolvers,
  type PhpMethodCompletionResolverDependencies,
  type PhpMethodCompletionResolvers,
} from "./usePhpMethodCompletionResolvers";

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
type ClassMemberCollectorOptions = Parameters<
  typeof usePhpClassMemberCollectors
>[0];

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

function renderPhpClassMemberCollectors(options: ClassMemberCollectorOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpClassMemberCollectors | null } = { api: null };

  function Harness({ hookOptions }: { hookOptions: ClassMemberCollectorOptions }) {
    captured.api = usePhpClassMemberCollectors(hookOptions);
    return null;
  }

  act(() => {
    root.render(<Harness hookOptions={options} />);
  });

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("class member collector hook not mounted");
      }

      return captured.api;
    },
    unmount: () => act(() => root.unmount()),
  };
}

function renderPhpMethodResolver(options: UsePhpMethodReturnTypeResolverOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: {
    api: ReturnType<typeof usePhpMethodReturnTypeResolver> | null;
  } = { api: null };

  function Harness({ hookOptions }: { hookOptions: UsePhpMethodReturnTypeResolverOptions }) {
    captured.api = usePhpMethodReturnTypeResolver(hookOptions);
    return null;
  }

  act(() => root.render(<Harness hookOptions={options} />));

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("method resolver hook not mounted");
      }

      return captured.api;
    },
    unmount: () => act(() => root.unmount()),
  };
}

function renderPhpCompletionResolvers(
  options: PhpMethodCompletionResolverDependencies,
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpMethodCompletionResolvers | null } = { api: null };

  function Harness({ hookOptions }: { hookOptions: PhpMethodCompletionResolverDependencies }) {
    captured.api = usePhpMethodCompletionResolvers(hookOptions);
    return null;
  }

  act(() => root.render(<Harness hookOptions={options} />));

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("completion resolver hook not mounted");
      }

      return captured.api;
    },
    unmount: () => act(() => root.unmount()),
  };
}

function makePhpClassMemberCollectorOptions(
  frameworkSources: readonly string[],
  classSourcePaths: ReadonlyMap<string, string>,
  resolvePhpFrameworkBoundConcrete: (
    className: string,
  ) => Promise<string | null>,
): ClassMemberCollectorOptions {
  const currentWorkspaceRootRef = { current: EBOX_CRM_ROOT };

  return {
    currentPhpFrameworkSourceContext: () => ({
      signature: `ebox:${frameworkSources.length}`,
      workspaceSources: frameworkSources,
    }),
    currentWorkspaceRootRef,
    frameworkRuntime: createPhpFrameworkRuntimeContext(NETTE_FRAMEWORK),
    readNavigationFileContent: readFileContent,
    resolvePhpClassReference: (source, className) =>
      resolvePhpClassName(source, className),
    resolvePhpClassSourcePaths: vi.fn(async (className: string) => {
      const filePath = classSourcePaths.get(
        className.trim().replace(/^\\+/, ""),
      );

      return filePath ? [filePath] : [];
    }),
    resolvePhpDeclaredType: (source, typeName) =>
      typeName ? resolvePhpClassName(source, typeName) : null,
    resolvePhpFrameworkBoundConcrete,
    workspaceDescriptor: eboxPhpDescriptor(),
    workspaceRoot: EBOX_CRM_ROOT,
  };
}

describeIfEboxCrmExists("ebox-crm Nette provider smoke", () => {
  it("completes real SortableTrait host members from SubscriptionTypeGroupsRepository", async () => {
    const traitPath =
      "app/modules/applicationModule/Models/Repository/SortableTrait.php";
    const repositoryPath =
      "app/modules/efabricaSubscriptionsModule/model/Repository/SubscriptionTypeGroupsRepository.php";
    const baseRepositoryPath =
      "app/modules/applicationModule/Models/Repository/Repository.php";
    const [traitSource, repositorySource, baseRepositorySource] =
      await Promise.all(
        [traitPath, repositoryPath, baseRepositoryPath].map((relativePath) =>
          readFileContent(joinPath(EBOX_CRM_ROOT, relativePath)),
        ),
      );
    const traitClassName =
      "Efabrica\\Crm\\NotificationModule\\Repository\\SortableTrait";
    const repositoryClassName =
      "Efabrica\\Crm\\SubscriptionsModule\\Repository\\SubscriptionTypeGroupsRepository";
    const classSourcePaths = new Map<string, string>([
      [traitClassName, joinPath(EBOX_CRM_ROOT, traitPath)],
      [repositoryClassName, joinPath(EBOX_CRM_ROOT, repositoryPath)],
      [
        "Crm\\ApplicationModule\\Repository",
        joinPath(EBOX_CRM_ROOT, baseRepositoryPath),
      ],
    ]);
    const frameworkSources = [
      traitSource,
      repositorySource,
      baseRepositorySource,
    ];
    const collectors = renderPhpClassMemberCollectors(
      makePhpClassMemberCollectorOptions(
        frameworkSources,
        classSourcePaths,
        vi.fn(async () => null),
      ),
    );
    const completionResolvers = renderPhpCompletionResolvers({
      collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => []),
      collectPhpMethodsForClass: collectors.api().collectPhpMethodsForClass,
      currentPhpFrameworkSourceContext: () => ({
        workspaceSources: frameworkSources,
      }),
      frameworkRuntime: createPhpFrameworkRuntimeContext(NETTE_FRAMEWORK),
      phpNormalizedReceiverExpressionIsThis: (expression) =>
        expression.trim() === "$this",
      resolvePhpClassReference: (source, className) =>
        resolvePhpClassName(source, className),
      resolvePhpExpressionType: vi.fn(async () => null),
      resolvePhpFrameworkBuilderModelType: vi.fn(async () => null),
    });

    const completions = await completionResolvers
      .api()
      .resolvePhpReceiverMethodCompletions(
        traitSource,
        positionAtOffset(
          traitSource,
          traitSource.indexOf("$this->getTable") + "$this->getTable".length,
        ),
        "$this",
        {
          contextualThisClassName: null,
          declaringClassName: traitClassName,
          hostClassNames: [repositoryClassName],
          memberSource: traitSource,
        },
      );
    const completionNames = completions.map((completion) => completion.name);

    expect(completionNames).toEqual(
      expect.arrayContaining([
        "getTable",
        "update",
        "sortingColumn",
        "sortingStep",
      ]),
    );
    expect(completions).toContainEqual(
      expect.objectContaining({
        declaringClassName: "Crm\\ApplicationModule\\Repository",
        name: "getTable",
      }),
    );
    expect(completions).toContainEqual(
      expect.objectContaining({
        declaringClassName: repositoryClassName,
        name: "update",
      }),
    );
    expect(completions).toContainEqual(
      expect.objectContaining({ kind: "property", name: "sortingColumn" }),
    );
    expect(completions).toContainEqual(
      expect.objectContaining({ kind: "property", name: "sortingStep" }),
    );

    completionResolvers.unmount();
    collectors.unmount();
  });

  it("infers UsersRepository rows through presenter view data into Latte members", async () => {
    const repositoryPath =
      "app/modules/usersModule/Models/Repositories/UsersRepository.php";
    const baseRepositoryPath =
      "app/modules/applicationModule/Models/Repository/Repository.php";
    const repositoryTraitPath =
      "app/modules/activeRowTypeModule/Generated/Repository/UsersRepositoryTrait.php";
    const activeRowPath =
      "app/modules/activeRowTypeModule/Generated/ActiveRow/UsersActiveRow.php";
    const selectionPath =
      "app/modules/activeRowTypeModule/Generated/Selection/UsersSelection.php";
    const presenterPath =
      "app/modules/usersModule/Presenters/UsersAdminPresenter.php";
    const templatePath =
      "app/modules/usersModule/templates/UsersAdmin/show.latte";
    const paths = [
      repositoryPath,
      baseRepositoryPath,
      repositoryTraitPath,
      activeRowPath,
      selectionPath,
      presenterPath,
    ];
    const sources = await Promise.all(
      paths.map((relativePath) =>
        readFileContent(joinPath(EBOX_CRM_ROOT, relativePath)),
      ),
    );
    const [repository, baseRepository, repositoryTrait, activeRow, selection] =
      sources;
    const classSourcePaths = new Map<string, string>([
      ["UsersRepository.php", joinPath(EBOX_CRM_ROOT, repositoryPath)],
      ["Repository.php", joinPath(EBOX_CRM_ROOT, baseRepositoryPath)],
      ["UsersRepositoryTrait.php", joinPath(EBOX_CRM_ROOT, repositoryTraitPath)],
      ["UsersActiveRow.php", joinPath(EBOX_CRM_ROOT, activeRowPath)],
      ["UsersSelection.php", joinPath(EBOX_CRM_ROOT, selectionPath)],
      ["UsersAdminPresenter.php", joinPath(EBOX_CRM_ROOT, presenterPath)],
    ]);
    const activeRowType =
      "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\UsersActiveRow";
    const selectionType =
      "Efabrica\\Crm\\ActiveRowTypes\\Selection\\UsersSelection";
    classSourcePaths.set(
      "Crm\\UsersModule\\Repository\\UsersRepository",
      joinPath(EBOX_CRM_ROOT, repositoryPath),
    );
    classSourcePaths.set(activeRowType, joinPath(EBOX_CRM_ROOT, activeRowPath));
    classSourcePaths.set(selectionType, joinPath(EBOX_CRM_ROOT, selectionPath));
    const classNamesByPath = new Map<string, string>([
      [joinPath(EBOX_CRM_ROOT, repositoryPath), "Crm\\UsersModule\\Repository\\UsersRepository"],
      [joinPath(EBOX_CRM_ROOT, baseRepositoryPath), "Crm\\ApplicationModule\\Repository"],
      [joinPath(EBOX_CRM_ROOT, repositoryTraitPath), "Efabrica\\Crm\\ActiveRowTypes\\Repository\\UsersRepositoryTrait"],
      [joinPath(EBOX_CRM_ROOT, activeRowPath), activeRowType],
      [joinPath(EBOX_CRM_ROOT, selectionPath), selectionType],
    ]);
    const sourcesByClassName = new Map(
      [...classNamesByPath].map(([filePath, className]) => [
        className,
        { filePath, source: sources[paths.indexOf(toRelativePath(EBOX_CRM_ROOT, filePath))] ?? "" },
      ]),
    );
    const methodResolver = renderPhpMethodResolver({
      currentWorkspaceRootRef: { current: EBOX_CRM_ROOT },
      frameworkRuntime: createPhpFrameworkRuntimeContext(NETTE_FRAMEWORK),
      readPhpClassMembersFromPath: async (filePath) => ({
        content: sourcesByClassName.get(classNamesByPath.get(filePath) ?? "")?.source ?? "",
        members: [],
      }),
      resolvePhpClassReference: (source, className) =>
        resolvePhpClassName(source, className),
      resolvePhpClassSourcePaths: async (className) => {
        const entry = sourcesByClassName.get(className.trim().replace(/^\\+/, ""));
        return entry ? [entry.filePath] : [];
      },
      resolvePhpEloquentBuilderModelTypeRef: { current: vi.fn(async () => null) },
      resolvePhpFrameworkBoundConcrete: vi.fn(async () => null),
      resolvePhpFrameworkReturnTypeReference: (source, typeName) =>
        typeName ? resolvePhpClassName(source, typeName) : null,
      resolvePhpGenericTemplateTypesForInheritedClass: vi.fn(async () => new Map()),
      resolvePhpGenericTemplateTypesForMixinClass: vi.fn(async () => new Map()),
      resolvePhpFrameworkProjectMorphMapModelType: vi.fn(async () => null),
      resolvePhpMethodDeclaredReturnType: (source, typeName) =>
        typeName ? resolvePhpClassName(source, typeName) : null,
      workspaceDescriptor: eboxPhpDescriptor(),
      workspaceRoot: EBOX_CRM_ROOT,
    });

    await expect(
      methodResolver.api().resolvePhpMethodReturnType(
        "Crm\\UsersModule\\Repository\\UsersRepository",
        "find",
      ),
    ).resolves.toBe(`${activeRowType}|null`);
    await expect(
      methodResolver.api().resolvePhpMethodReturnType(selectionType, "where"),
    ).resolves.toBe(selectionType);

    const collectors = renderPhpClassMemberCollectors(
      makePhpClassMemberCollectorOptions(
        sources,
        classSourcePaths,
        vi.fn(async () => null),
      ),
    );
    const rowMembers = await collectors.api().collectPhpMethodsForClass(activeRowType);

    expect(rowMembers).toContainEqual(
      expect.objectContaining({ kind: "property", name: "email" }),
    );
    await expect(
      methodResolver.api().resolvePhpMethodReturnType(selectionType, "fetch"),
    ).resolves.toBe(`${activeRowType}|null`);

    const resolvePhpReceiverCompletions = vi.fn(async () => rowMembers);
    const latteDeps = makeLatteDeps(templatePath, {
      resolveExpressionType: vi.fn(async (_source, _position, expression) =>
        expression.includes("usersRepository->find") || expression === "$user"
          ? methodResolver
              .api()
              .resolvePhpMethodReturnType(
                "Crm\\UsersModule\\Repository\\UsersRepository",
                "find",
              )
          : null,
      ),
      resolvePhpReceiverCompletions,
      searchText: vi.fn(async () => [
        { path: joinPath(EBOX_CRM_ROOT, presenterPath) },
      ]),
    });
    const latte = createLatteIntelligence(() => latteDeps);
    const template = await readFileContent(joinPath(EBOX_CRM_ROOT, templatePath));
    const completions = await latte.provideLatteCompletions(
      template,
      positionAtOffset(template, offsetAfter(template, "$detailUser->")),
    );

    expect(resolvePhpReceiverCompletions).toHaveBeenCalledWith(
      expect.stringContaining(activeRowType),
      expect.any(Object),
      "$detailUser",
    );
    expect(completions.map((item) => item.label)).toContain("email");

    collectors.unmount();
    methodResolver.unmount();
    expect(repository).toContain("use UsersRepositoryTrait");
    expect(repositoryTrait).toContain("@method UsersActiveRow|null find");
    expect(activeRow).toContain("@property-read string $email");
    expect(selection).toContain("@method UsersActiveRow|null fetch");
    expect(baseRepository).toContain("public function find");
  });

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

  it("expands real ebox Nette interface receivers with autowired concrete repository members", async () => {
    const configPath = "app/modules/paymentsModule/config/config.neon";
    const interfacePath =
      "app/modules/paymentsModule/Models/VariableSymbolInterface.php";
    const concretePath =
      "app/modules/paymentsModule/Models/Repositories/VariableSymbol.php";
    const consumerPath =
      "app/modules/paymentsModule/Models/Repositories/PaymentsRepository.php";
    const baseRepositoryPath =
      "app/modules/applicationModule/Models/Repository/Repository.php";
    const [
      config,
      interfaceSource,
      concreteSource,
      consumerSource,
      baseRepositorySource,
    ] = await Promise.all([
      readFileContent(joinPath(EBOX_CRM_ROOT, configPath)),
      readFileContent(joinPath(EBOX_CRM_ROOT, interfacePath)),
      readFileContent(joinPath(EBOX_CRM_ROOT, concretePath)),
      readFileContent(joinPath(EBOX_CRM_ROOT, consumerPath)),
      readFileContent(joinPath(EBOX_CRM_ROOT, baseRepositoryPath)),
    ]);
    const interfaceClassName = "Crm\\PaymentsModule\\VariableSymbolInterface";
    const concreteClassName = "Crm\\PaymentsModule\\Repository\\VariableSymbol";
    const classSourcePaths = new Map([
      [interfaceClassName, joinPath(EBOX_CRM_ROOT, interfacePath)],
      [concreteClassName, joinPath(EBOX_CRM_ROOT, concretePath)],
      [
        "Crm\\ApplicationModule\\Repository",
        joinPath(EBOX_CRM_ROOT, baseRepositoryPath),
      ],
      [
        "Crm\\PaymentsModule\\Repository\\PaymentsRepository",
        joinPath(EBOX_CRM_ROOT, consumerPath),
      ],
      ["VariableSymbolInterface.php", joinPath(EBOX_CRM_ROOT, interfacePath)],
      ["VariableSymbol.php", joinPath(EBOX_CRM_ROOT, concretePath)],
      ["Repository.php", joinPath(EBOX_CRM_ROOT, baseRepositoryPath)],
      ["PaymentsRepository.php", joinPath(EBOX_CRM_ROOT, consumerPath)],
    ]);
    const frameworkSources = [
      config,
      interfaceSource,
      concreteSource,
      consumerSource,
      baseRepositorySource,
    ];
    const resolver = renderPhpResolver(
      makePhpResolverOptions(frameworkSources, classSourcePaths),
    );
    const collectors = renderPhpClassMemberCollectors(
      makePhpClassMemberCollectorOptions(
        frameworkSources,
        classSourcePaths,
        resolver.api().resolvePhpFrameworkBoundConcrete,
      ),
    );

    expect(config).toContain("factory: Crm\\PaymentsModule\\Repository\\VariableSymbol");
    expect(concreteSource).toContain(
      "class VariableSymbol extends Repository implements VariableSymbolInterface",
    );
    expect(consumerSource).toContain(
      "private VariableSymbolInterface $variableSymbol",
    );
    expect(consumerSource).toContain(
      "$this->variableSymbol = $variableSymbol",
    );

    await expect(
      resolver.api().resolvePhpFrameworkBoundConcrete(interfaceClassName),
    ).resolves.toBe(concreteClassName);

    const members = await collectors
      .api()
      .collectPhpMethodsForClass(interfaceClassName);
    const memberNames = members.map((member) => member.name);

    expect(memberNames).toEqual(
      expect.arrayContaining(["getNew", "getTable", "findBy"]),
    );
    expect(members).toContainEqual(
      expect.objectContaining({
        declaringClassName: interfaceClassName,
        name: "getNew",
      }),
    );
    expect(members).toContainEqual(
      expect.objectContaining({
        declaringClassName: "Crm\\ApplicationModule\\Repository",
        name: "getTable",
      }),
    );
    expect(memberNames).not.toContain("available");
    expect(memberNames).not.toContain("generateRandom");

    collectors.unmount();
    resolver.unmount();
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

  it("resolves the real RempMailer MailTemplatesAdmin link through setMapping", async () => {
    const templatePath =
      "app/modules/mailerModule/Components/UserEmailsWidget/user_emails_widget.latte";
    const presenterPath =
      "app/modules/mailerModule/Presenters/MailTemplatesAdminPresenter.php";
    const extensionPath =
      "app/modules/mailerModule/DI/RempMailerModuleExtension.php";
    const configPath = "app/config/config.neon";
    const [template, presenter] = await Promise.all([
      readFileContent(joinPath(EBOX_CRM_ROOT, templatePath)),
      readFileContent(joinPath(EBOX_CRM_ROOT, presenterPath)),
    ]);
    const deps = makeLatteDeps(templatePath, {
      readPhpClassSource: vi.fn(async (className: string) =>
        className ===
        "Crm\\RempMailerModule\\Presenters\\MailTemplatesAdminPresenter"
          ? {
              path: joinPath(EBOX_CRM_ROOT, presenterPath),
              source: presenter,
            }
          : null,
      ),
      searchText: vi.fn(async (_root, query) => {
        if (query === "application:") {
          return [{ path: joinPath(EBOX_CRM_ROOT, configPath) }];
        }

        if (query === "setMapping") {
          return [{ path: joinPath(EBOX_CRM_ROOT, extensionPath) }];
        }

        return [];
      }),
    });
    const latte = createLatteIntelligence(() => deps);
    const link = ":RempMailer:MailTemplatesAdmin:show";

    await expect(
      latte.provideLatteDefinition(template, offsetInside(template, link)),
    ).resolves.toBe(true);
    expect(deps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, presenterPath),
      positionAtOffset(presenter, presenter.indexOf("actionShow")),
      link,
    );
  });

  it("carries typed static include arguments into the real subscription header", async () => {
    const callerPath =
      "app/modules/subscriptionsModule/templates/SubscriptionTypesAdmin/show.latte";
    const headerPath =
      "app/modules/subscriptionsModule/templates/SubscriptionTypesAdmin/header.latte";
    const untypedSecondaryCallerPath =
      "app/modules/subscriptionsModule/templates/SubscriptionTypesAdmin/stats.latte";
    const activeRowPath =
      "app/modules/activeRowTypeModule/Generated/ActiveRow/SubscriptionTypesActiveRow.php";
    const activeRowType =
      "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\SubscriptionTypesActiveRow";
    const [caller, header, activeRowSource] = await Promise.all(
      [callerPath, headerPath, activeRowPath].map((relativePath) =>
        readFileContent(joinPath(EBOX_CRM_ROOT, relativePath)),
      ),
    );
    const collectors = renderPhpClassMemberCollectors(
      makePhpClassMemberCollectorOptions(
        [activeRowSource],
        new Map([
          [activeRowType, joinPath(EBOX_CRM_ROOT, activeRowPath)],
        ]),
        vi.fn(async () => null),
      ),
    );
    const completionResolvers = renderPhpCompletionResolvers({
      collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => []),
      collectPhpMethodsForClass: collectors.api().collectPhpMethodsForClass,
      currentPhpFrameworkSourceContext: () => ({
        workspaceSources: [activeRowSource],
      }),
      frameworkRuntime: createPhpFrameworkRuntimeContext(NETTE_FRAMEWORK),
      phpNormalizedReceiverExpressionIsThis: (expression) =>
        expression.trim() === "$this",
      resolvePhpClassReference: (source, className) =>
        resolvePhpClassName(source, className),
      resolvePhpExpressionType: async (source, position, expression) =>
        phpReceiverExpressionTypeInSource(source, position, expression),
      resolvePhpFrameworkBuilderModelType: vi.fn(async () => null),
    });
    const deps = makeLatteDeps(headerPath, {
      listDirectory: async (directory) =>
        (await listDirectory(directory)).filter(
          (entry) =>
            entry.path !==
            joinPath(EBOX_CRM_ROOT, untypedSecondaryCallerPath),
        ),
      resolvePhpReceiverCompletions:
        completionResolvers.api().resolvePhpReceiverMethodCompletions,
      synthesizeTypedReceiverSource: synthesizePhpTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const firstTypeOffset = offsetAfter(header, "$type");

    const variableCompletions = await latte.provideLatteCompletions(
      header,
      positionAtOffset(header, firstTypeOffset),
    );
    expect(variableCompletions).toContainEqual(
      expect.objectContaining({
        detail: "include argument · SubscriptionTypesActiveRow",
        label: "$type",
      }),
    );

    const memberCompletions = await latte.provideLatteCompletions(
      header,
      positionAtOffset(header, offsetAfter(header, "$type->")),
    );
    expect(memberCompletions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: `${activeRowType}::id: int`,
          label: "id",
        }),
        expect.objectContaining({
          detail: `${activeRowType}::name: string`,
          label: "name",
        }),
      ]),
    );

    await expect(
      latte.provideLatteDefinition(header, firstTypeOffset - 1),
    ).resolves.toBe(true);
    const includeValueOffset =
      caller.indexOf("type => $type") + "type => ".length;
    expect(deps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, callerPath),
      positionAtOffset(caller, includeValueOffset),
      "$type",
    );

    completionResolvers.unmount();
    collectors.unmount();
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

  it("types the real ApiTokenMetaForm key array-access receiver", async () => {
    const templatePath =
      "app/modules/apiModule/templates/ApiTokensAdmin/show.latte";
    const presenterPath =
      "app/modules/apiModule/Presenters/ApiTokensAdminPresenter.php";
    const factoryPath =
      "app/modules/apiModule/Forms/ApiTokenMetaFormFactory.php";
    const textInputPath =
      "vendor/nette/forms/src/Forms/Controls/TextInput.php";
    const textBasePath =
      "vendor/nette/forms/src/Forms/Controls/TextBase.php";
    const baseControlPath =
      "vendor/nette/forms/src/Forms/Controls/BaseControl.php";
    const relativePaths = [
      templatePath,
      presenterPath,
      factoryPath,
      textInputPath,
      textBasePath,
      baseControlPath,
    ];
    const [template, presenter, factory, textInput, textBase, baseControl] =
      await Promise.all(
        relativePaths.map((relativePath) =>
          readFileContent(joinPath(EBOX_CRM_ROOT, relativePath)),
        ),
      );
    const classSourcePaths = new Map<string, string>([
      [
        "Nette\\Forms\\Controls\\TextInput",
        joinPath(EBOX_CRM_ROOT, textInputPath),
      ],
      [
        "Nette\\Forms\\Controls\\TextBase",
        joinPath(EBOX_CRM_ROOT, textBasePath),
      ],
      [
        "Nette\\Forms\\Controls\\BaseControl",
        joinPath(EBOX_CRM_ROOT, baseControlPath),
      ],
    ]);
    const memberSources = [textInput, textBase, baseControl];
    const collectors = renderPhpClassMemberCollectors(
      makePhpClassMemberCollectorOptions(
        memberSources,
        classSourcePaths,
        vi.fn(async () => null),
      ),
    );
    const completionResolvers = renderPhpCompletionResolvers({
      collectPhpFrameworkSyntheticMethodsForClass: vi.fn(async () => []),
      collectPhpMethodsForClass: collectors.api().collectPhpMethodsForClass,
      currentPhpFrameworkSourceContext: () => ({
        workspaceSources: memberSources,
      }),
      frameworkRuntime: createPhpFrameworkRuntimeContext(NETTE_FRAMEWORK),
      phpNormalizedReceiverExpressionIsThis: (expression) =>
        expression.trim() === "$this",
      resolvePhpClassReference: (source, className) =>
        resolvePhpClassName(source, className),
      resolvePhpExpressionType: async (source, position, expression) =>
        phpReceiverExpressionTypeInSource(source, position, expression),
      resolvePhpFrameworkBuilderModelType: vi.fn(async () => null),
    });
    const openPhpPropertyTarget = vi.fn(async () => true);
    const deps = makeLatteDeps(templatePath, {
      openPhpPropertyTarget,
      readPhpClassSource: vi.fn(async (className: string) =>
        className === "Crm\\ApiModule\\Forms\\ApiTokenMetaFormFactory"
          ? {
              path: joinPath(EBOX_CRM_ROOT, factoryPath),
              source: factory,
            }
          : null,
      ),
      resolveDeclaredType: (source, typeHint) =>
        typeHint ? resolvePhpClassName(source, typeHint) : null,
      resolvePhpReceiverCompletions:
        completionResolvers.api().resolvePhpReceiverMethodCompletions,
      synthesizeTypedReceiverSource: synthesizePhpTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const receiver = `$control["apiTokenMetaForm"]['key']`;
    const expression = `${receiver}->htmlId`;

    expect(template).toContain(expression);
    expect(presenter).toContain("createComponentApiTokenMetaForm");
    expect(factory).toContain("$form->addText('key'");

    const completions = await latte.provideLatteCompletions(
      template,
      positionAtOffset(
        template,
        template.indexOf(expression) + `${receiver}->html`.length,
      ),
    );

    expect(completions.map((item) => item.label)).toContain("htmlId");
    await expect(
      latte.provideLatteDefinition(
        template,
        template.indexOf(expression) + expression.indexOf("htmlId") + 2,
      ),
    ).resolves.toBe(true);
    expect(openPhpPropertyTarget).toHaveBeenLastCalledWith(
      "Nette\\Forms\\Controls\\BaseControl",
      "htmlId",
    );

    completionResolvers.unmount();
    collectors.unmount();
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
    const gatewayFactoryPath =
      "app/modules/multiStepperModule/Forms/StepperGatewayFormFactory.php";
    const gatewayFactory = await readFileContent(
      joinPath(EBOX_CRM_ROOT, gatewayFactoryPath),
    );
    const guardFactoryPath =
      "app/modules/multiStepperModule/Forms/StepperGuardFormFactory.php";
    const guardFactory = await readFileContent(
      joinPath(EBOX_CRM_ROOT, guardFactoryPath),
    );

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
    await expect(
      latte.provideLatteDefinition(
        source,
        offsetInside(source, 'n:name="subscription_type_link_id"'),
      ),
    ).resolves.toBe(true);
    expect(deps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, gatewayFactoryPath),
      positionAtOffset(
        gatewayFactory,
        gatewayFactory.indexOf("subscription_type_link_id"),
      ),
      "subscription_type_link_id",
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
    await expect(
      latte.provideLatteDefinition(
        source,
        offsetInside(source, 'n:name="gateways_json"'),
      ),
    ).resolves.toBe(true);
    expect(deps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, gatewayFactoryPath),
      positionAtOffset(gatewayFactory, gatewayFactory.indexOf("gateways_json")),
      "gateways_json",
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

    await expect(
      latte.provideLatteDefinition(
        source,
        offsetAfter(source, 'n:name="ty'),
      ),
    ).resolves.toBe(true);
    expect(deps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, guardFactoryPath),
      positionAtOffset(guardFactory, guardFactory.indexOf("'type'") + 1),
      "type",
    );
  });

  it("covers ebox Adyen n:name completion and definition over a public property form factory", async () => {
    const templatePath =
      "app/modules/adyenModule/presenters/templates/NotificationModifierAdmin/edit.latte";
    const factoryPath =
      "app/modules/adyenModule/Component/NotificationModifierForm/NotificationModifierFormFactory.php";
    const [source, factory] = await Promise.all([
      readFileContent(joinPath(EBOX_CRM_ROOT, templatePath)),
      readFileContent(joinPath(EBOX_CRM_ROOT, factoryPath)),
    ]);
    const deps = makeLatteDeps(templatePath, {
      readPhpClassSource: vi.fn(async (className: string) => {
        const resolvedClassName = className.trim().replace(/^\\+/, "");

        return resolvedClassName ===
          "Efabrica\\Crm\\AdyenModule\\Component\\NotificationModifierForm\\NotificationModifierFormFactory" ||
          resolvedClassName === "NotificationModifierFormFactory"
          ? {
              path: joinPath(EBOX_CRM_ROOT, factoryPath),
              source: factory,
            }
          : null;
      }),
      resolveDeclaredType: (source, typeHint) =>
        typeHint ? resolvePhpClassName(source, typeHint) : null,
    });
    const latte = createLatteIntelligence(() => deps);

    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, offsetAfter(source, 'n:name="where_')),
    );
    expect(completions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: "Nette form field",
          label: "where_key",
        }),
        expect.objectContaining({
          detail: "Nette form field",
          label: "where_value",
        }),
      ]),
    );

    await expect(
      latte.provideLatteDefinition(
        source,
        offsetAfter(source, 'n:name="sa'),
      ),
    ).resolves.toBe(true);
    expect(deps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, factoryPath),
      positionAtOffset(factory, factory.indexOf("save")),
      "save",
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

  it("loads inherited ProductsAdmin view data from the real Admin and Base presenters", async () => {
    const templatePath =
      "app/modules/productsModule/templates/ProductsAdmin/default.latte";
    const presenterPath =
      "app/modules/productsModule/Presenters/ProductsAdminPresenter.php";
    const adminPresenterPath =
      "app/modules/adminModule/Presenters/AdminPresenter.php";
    const basePresenterPath =
      "app/modules/applicationModule/Presenters/BasePresenter.php";
    const [source, adminPresenter, basePresenter] = await Promise.all([
      readFileContent(joinPath(EBOX_CRM_ROOT, templatePath)),
      readFileContent(joinPath(EBOX_CRM_ROOT, adminPresenterPath)),
      readFileContent(joinPath(EBOX_CRM_ROOT, basePresenterPath)),
    ]);
    const inheritedClasses = new Map([
      [
        "Crm\\AdminModule\\Presenters\\AdminPresenter",
        {
          path: joinPath(EBOX_CRM_ROOT, adminPresenterPath),
          source: adminPresenter,
        },
      ],
      [
        "Crm\\ApplicationModule\\Presenters\\BasePresenter",
        {
          path: joinPath(EBOX_CRM_ROOT, basePresenterPath),
          source: basePresenter,
        },
      ],
    ]);
    const deps = makeLatteDeps(templatePath, {
      readFileContent: vi.fn(readFileContent),
      readPhpClassSource: vi.fn(async (className: string) =>
        inheritedClasses.get(className.trim().replace(/^\\+/, "")) ?? null,
      ),
      resolveDeclaredType: (presenterSource, typeHint) =>
        typeHint ? resolvePhpClassName(presenterSource, typeHint) : null,
      searchText: vi.fn(async () => []),
    });
    const latte = createLatteIntelligence(() => deps);
    const completionOffset = source.indexOf("$totalCount") + 1;
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(source, completionOffset),
    );
    const labels = completions.map((completion) => completion.label);

    expect(labels).toContain("$current_user");
    expect(labels).toContain("$siteTitle");
    expect(labels).toContain("$locale");

    const definitionSource = `${source}\n{$siteTitle}`;
    await expect(
      latte.provideLatteDefinition(
        definitionSource,
        definitionSource.lastIndexOf("siteTitle") + 2,
      ),
    ).resolves.toBe(true);
    expect(deps.openTarget).toHaveBeenLastCalledWith(
      joinPath(EBOX_CRM_ROOT, basePresenterPath),
      expect.any(Object),
      "$siteTitle",
    );
    expect(deps.readFileContent).toHaveBeenCalledWith(
      joinPath(EBOX_CRM_ROOT, presenterPath),
    );
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

  it("types a real ebox method-chain foreach collection end to end", async () => {
    const templatePath =
      "app/modules/subscriptionsModule/templates/SubscriptionTypesAdmin/default.latte";
    const collectionExpression =
      "$type->related('subscription_type_items')->where('deleted_at', null)";
    const itemType =
      "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\SubscriptionTypeItemsActiveRow";
    const source = await readFileContent(joinPath(EBOX_CRM_ROOT, templatePath));
    const synthesizeTypedReceiverSource = vi.fn(
      (variableName: string, typeName: string) => ({
        position: { column: 1, lineNumber: 3 },
        source: `${variableName}:${typeName}`,
      }),
    );
    const deps = makeLatteDeps(templatePath, {
      resolveExpressionType: vi.fn(async (_source, _position, expression) =>
        expression === collectionExpression
          ? `Nette\\Database\\Table\\Selection<int, ${itemType}>`
          : null,
      ),
      resolvePhpReceiverCompletions: vi.fn(async () => [
        {
          declaringClassName: itemType,
          kind: "property" as const,
          name: "name",
          parameters: "",
          returnType: "string",
        },
      ]),
      synthesizeTypedReceiverSource,
    });
    const latte = createLatteIntelligence(() => deps);
    const completions = await latte.provideLatteCompletions(
      source,
      positionAtOffset(
        source,
        offsetAfter(source, "{$subscriptionTypeItem->name"),
      ),
    );

    expect(synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "subscriptionTypeItem",
      itemType,
    );
    expect(completions.map((item) => item.label)).toContain("name");
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

    await expect(
      usersLatte.provideLatteDefinition(
        usersSource,
        offsetInside(usersSource, "userLabel"),
      ),
    ).resolves.toBe(true);
    expect(usersDeps.openPhpMethodTarget).toHaveBeenLastCalledWith(
      "Crm\\UsersModule\\Helpers\\UserLabelHelper",
      "process",
    );
    expect(usersDeps.openTarget).not.toHaveBeenCalled();

    await expect(
      usersLatte.provideLatteDefinition(
        usersSource,
        offsetInside(usersSource, "gravatar"),
      ),
    ).resolves.toBe(true);
    expect(usersDeps.openPhpMethodTarget).toHaveBeenLastCalledWith(
      "Crm\\UsersModule\\Helpers\\GravatarHelper",
      "process",
    );
    expect(usersDeps.openTarget).not.toHaveBeenCalled();

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
    expect(subscriptionDeps.openTarget).not.toHaveBeenCalled();

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
    expect(apiTokensDeps.openTarget).not.toHaveBeenCalled();
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
