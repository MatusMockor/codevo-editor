import { describe, expect, it, vi } from "vitest";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { LatteIntelligenceDependencies } from "./latteIntelligenceContracts";
import {
  latteExpressionCompletions,
  resolveLatteMemberDefinition,
  resolveLatteExpressionVariableType,
  type LatteExpressionResolutionContext,
} from "./latteExpressionIntelligence";
import type {
  LatteProviderFlowCaches,
  LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import type { LatteProviderRequestContext } from "./latteProviderRequestContext";
import { latteExpressionResolutionContext } from "./netteLatteProviderOptions";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

const HOME_TEMPLATE = "app/UI/Home/default.latte";
const ADMIN_TEMPLATE = "app/UI/Admin/default.latte";
const CUSTOM_LATTE_PROVIDER: PhpFrameworkProvider = {
  id: "custom-latte",
  latte: { supportsTemplateIntelligence: true },
};

describe("path-aware Latte expression type resolution", () => {
  it("resolves two template paths in one root without consulting the active document", async () => {
    const root = "/workspace";
    const getActiveDocument = vi.fn(() => ({
      path: `${root}/app/UI/Active/default.latte`,
    }));
    const context = expressionContext(root, {
      [`${root}/app/UI/Admin/AdminPresenter.php`]: presenterSource(
        "Root\\Admin",
        "AdminPresenter",
      ),
      [`${root}/app/UI/Home/HomePresenter.php`]: presenterSource(
        "Root\\Home",
        "HomePresenter",
      ),
    }, getActiveDocument);

    await expect(callerVariableType(context.forTemplate(HOME_TEMPLATE))).resolves.toBe(
      "Root\\Home\\HomeRecord",
    );
    await expect(
      callerVariableType(context.forTemplate(ADMIN_TEMPLATE)),
    ).resolves.toBe("Root\\Admin\\AdminRecord");
    expect(getActiveDocument).not.toHaveBeenCalled();
  });

  it("keeps explicit template resolution isolated by requested root", async () => {
    const rootA = "/workspace-a";
    const rootB = "/workspace-b";
    const files = {
      [`${rootA}/app/UI/Home/HomePresenter.php`]: presenterSource(
        "ProjectA\\Home",
        "HomePresenter",
      ),
      [`${rootB}/app/UI/Home/HomePresenter.php`]: presenterSource(
        "ProjectB\\Home",
        "HomePresenter",
      ),
    };
    const caches = providerCaches();
    const contextA = expressionContext(rootA, files, undefined, undefined, undefined, caches);
    const contextB = expressionContext(rootB, files, undefined, undefined, undefined, caches);

    await expect(
      callerVariableType(contextA.forTemplate(HOME_TEMPLATE)),
    ).resolves.toBe("ProjectA\\Home\\HomeRecord");
    await expect(
      callerVariableType(contextB.forTemplate(HOME_TEMPLATE)),
    ).resolves.toBe("ProjectB\\Home\\HomeRecord");
  });

  it("drops a path-targeted result when its captured root becomes stale", async () => {
    const root = "/workspace";
    const currentWorkspaceRootRef = { current: root as string | null };
    const context = expressionContext(
      root,
      {
        [`${root}/app/UI/Home/HomePresenter.php`]: presenterSource(
          "Root\\Home",
          "HomePresenter",
        ),
      },
      undefined,
      currentWorkspaceRootRef,
      () => {
        currentWorkspaceRootRef.current = "/other";
      },
    );

    await expect(
      callerVariableType(context.forTemplate(HOME_TEMPLATE)),
    ).resolves.toBeNull();
  });

  it("forwards include loading and the current template to type resolution", async () => {
    const context = expressionContext("/workspace", {});
    const loadIncludedTemplateArguments = vi.fn(async () => [
      {
        depth: 0,
        expression: "$record",
        name: "record",
        provenance: [],
        sourceSpan: { end: 10, start: 3 },
        sourceTemplateRelativePath: "app/UI/Home/default.latte",
        targetSpan: { end: 16, start: 10 },
        targetTemplateRelativePath: "active.latte",
        type: "App\\Model\\IncludedRecord",
      },
    ]);
    context.loadIncludedTemplateArguments = loadIncludedTemplateArguments;

    await expect(callerVariableType(context)).resolves.toBe(
      "App\\Model\\IncludedRecord",
    );
    expect(loadIncludedTemplateArguments).toHaveBeenCalledWith("active.latte");
  });

  it("completes and defines User::isAllowed in real-shaped Nette template markup", async () => {
    const context = expressionContext("/workspace", {});
    context.deps.synthesizeTypedReceiverSource = vi.fn(
      (variableName, typeName) => ({
        position: { column: 1, lineNumber: 3 },
        source: `<?php\n/** @var \\${typeName} $${variableName} */\n$${variableName}->`,
      }),
    );
    context.deps.resolvePhpReceiverCompletions = vi.fn(async () => [
      {
        declaringClassName: "Nette\\Security\\User",
        name: "isAllowed",
        parameters: "mixed $resource, mixed $privilege",
        returnType: "bool",
      },
    ]);
    context.deps.openPhpMethodTarget = vi.fn(async () => true);
    const fixture = `<div class="panel-heading">
  <a n:if="$user->isA"
      class="pull-right" target="_blank"
      href="{plink :Admin:AuditLogAdmin:default, table => 'portability_claims', signature => $userPortability['id']}">
    {_portability_claims.admin.component.portability_claims.show_history}
  </a>
</div>`;
    const completionOffset = fixture.indexOf("$user->isA") + "$user->isA".length;

    await expect(
      latteExpressionCompletions(context, fixture, completionOffset),
    ).resolves.toEqual([
      expect.objectContaining({
        insertText: "isAllowed()",
        kind: "member",
        label: "isAllowed",
      }),
    ]);
    expect(context.deps.synthesizeTypedReceiverSource).toHaveBeenCalledWith(
      "user",
      "Nette\\Security\\User",
    );

    const definitionSource = fixture.replace(
      "$user->isA",
      "$user->isAllowed('Admin:AuditLogAdmin', 'default')",
    );
    const definitionOffset = definitionSource.indexOf("isAllowed") + 2;

    await expect(
      resolveLatteMemberDefinition(context, definitionSource, definitionOffset),
    ).resolves.toBe(true);
    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "Nette\\Security\\User",
      "isAllowed",
    );
  });

  it.each([
    {
      label: "generic provider set",
      framework: createPhpFrameworkIntelligence({
        matchedProviderIds: [],
        profile: "generic",
        providers: [],
      }),
    },
    {
      label: "custom Latte provider",
      framework: createPhpFrameworkIntelligence({
        matchedProviderIds: [CUSTOM_LATTE_PROVIDER.id],
        profile: "generic",
        providers: [CUSTOM_LATTE_PROVIDER],
      }),
    },
  ])("does not expose implicit user for a $label", async ({ framework }) => {
    const context = expressionContext("/workspace", {});
    context.deps.frameworkIntelligence = framework;
    context.deps.resolvePhpReceiverCompletions = vi.fn(async () => [
      {
        declaringClassName: "Nette\\Security\\User",
        name: "isAllowed",
        parameters: "",
        returnType: "bool",
      },
    ]);

    await expect(
      resolveLatteExpressionVariableType(context, "{$user}", 3, "user"),
    ).resolves.toBeNull();
    await expect(
      latteExpressionCompletions(context, "{$user->isA}", 11),
    ).resolves.toEqual([]);
    expect(context.deps.resolvePhpReceiverCompletions).not.toHaveBeenCalled();
  });

  it("completes and defines members through a tableRow formal type", async () => {
    const context = expressionContext("/workspace", {});
    context.deps.resolveExpressionType = vi.fn(
      async (_source, _position, expression) =>
        expression.includes("new SubscriptionMigration")
          ? "App\\Domain\\SubscriptionMigration"
          : null,
    );
    context.deps.resolvePhpReceiverCompletions = vi.fn(async () => [
      {
        declaringClassName: "App\\Domain\\SubscriptionMigration",
        kind: "property" as const,
        name: "name",
        parameters: "",
        returnType: "string",
      },
    ]);
    context.deps.openPhpPropertyTarget = vi.fn(async () => true);
    const completionSource = `{define tableRow, $migration}
  <a n:href="SubscriptionMigrationAdmin:show $migration->id">{$migration->na}</a>
{/define}
{var $sourceMigration = new SubscriptionMigration()}
{include tableRow $sourceMigration}`;
    const completionOffset = completionSource.indexOf("->na") + 4;

    await expect(
      latteExpressionCompletions(context, completionSource, completionOffset),
    ).resolves.toEqual([
      expect.objectContaining({
        insertText: "name",
        kind: "member",
        label: "name",
      }),
    ]);

    const definitionSource = completionSource.replace("$migration->na}", "$migration->name}");
    const definitionOffset = definitionSource.indexOf("->name") + 4;

    await expect(
      resolveLatteMemberDefinition(context, definitionSource, definitionOffset),
    ).resolves.toBe(true);
    expect(context.deps.openPhpPropertyTarget).toHaveBeenCalledWith(
      "App\\Domain\\SubscriptionMigration",
      "name",
    );
  });

  it("completes and defines a member on a typed Nette Form array-access field", async () => {
    const root = "/workspace";
    const templatePath =
      "app/modules/apiModule/templates/ApiTokensAdmin/show.latte";
    const presenterPath =
      `${root}/app/modules/apiModule/Presenters/ApiTokensAdminPresenter.php`;
    const presenter = `<?php
namespace App\\Presenters;
use App\\Forms\\ApiTokenMetaFormFactory;
class ApiTokensAdminPresenter
{
    public ApiTokenMetaFormFactory $apiTokenMetaFormFactory;
    protected function createComponentApiTokenMetaForm(): Form
    {
        return $this->apiTokenMetaFormFactory->create($this->apiToken);
    }
}`;
    const factory = `<?php
namespace App\\Forms;
use Nette\\Application\\UI\\Form;
class ApiTokenMetaFormFactory
{
    public function create(): Form
    {
        $form = new Form();
        $form->addText('key');
        return $form;
    }
}`;
    const context = expressionContext(root, { [presenterPath]: presenter })
      .forTemplate(templatePath);
    context.deps.resolveDeclaredType = (_source, typeHint) =>
      typeHint === "ApiTokenMetaFormFactory"
        ? "App\\Forms\\ApiTokenMetaFormFactory"
        : typeHint;
    context.deps.readPhpClassSource = vi.fn(async (className) =>
      className === "App\\Forms\\ApiTokenMetaFormFactory"
        ? { path: `${root}/app/Forms/ApiTokenMetaFormFactory.php`, source: factory }
        : null,
    );
    context.deps.synthesizeTypedReceiverSource = vi.fn(
      (variableName, typeName) => ({
        position: { column: 1, lineNumber: 3 },
        source: `<?php\n/** @var \\${typeName} $${variableName} */\n$${variableName}->`,
      }),
    );
    context.deps.resolvePhpReceiverCompletions = vi.fn(async () => [
      {
        declaringClassName: "Nette\\Forms\\Controls\\BaseControl",
        kind: "property" as const,
        name: "htmlId",
        parameters: "",
        returnType: "string|bool|null",
      },
    ]);
    context.deps.openPhpPropertyTarget = vi.fn(async () => true);
    const completionSource =
      `{$control["apiTokenMetaForm"]['key']->html}`;

    await expect(
      latteExpressionCompletions(
        context,
        completionSource,
        completionSource.indexOf("->html") + "->html".length,
      ),
    ).resolves.toEqual([
      expect.objectContaining({ label: "htmlId", insertText: "htmlId" }),
    ]);
    expect(context.deps.resolvePhpReceiverCompletions).toHaveBeenLastCalledWith(
      expect.stringContaining("Nette\\Forms\\Controls\\TextInput"),
      expect.anything(),
      "$control",
    );

    const definitionSource =
      `{$control["apiTokenMetaForm"]['key']->htmlId}`;

    await expect(
      resolveLatteMemberDefinition(
        context,
        definitionSource,
        definitionSource.indexOf("htmlId") + 2,
      ),
    ).resolves.toBe(true);
    expect(context.deps.openPhpPropertyTarget).toHaveBeenLastCalledWith(
      "Nette\\Forms\\Controls\\BaseControl",
      "htmlId",
    );
  });

  it.each([
    {
      label: "unknown local",
      source: `{define tableRow, $item}
  {var $item = unknownFactory()}
  {$item->na}
{/define}
{var $sourceItem = new SubscriptionMigration()}
{include tableRow $sourceItem}`,
    },
    {
      label: "unknown foreach",
      source: `{define tableRow, $item}
  {foreach $unknownItems as $item}
    {$item->na}
  {/foreach}
{/define}
{var $sourceItem = new SubscriptionMigration()}
{include tableRow $sourceItem}`,
    },
  ])(
    "blocks member completion and definition through an $label shadow",
    async ({ source }) => {
      const context = expressionContext("/workspace", {});
      context.deps.resolveExpressionType = vi.fn(
        async (_source, _position, expression) =>
          expression.includes("new SubscriptionMigration")
            ? "App\\Domain\\SubscriptionMigration"
            : null,
      );
      context.deps.resolvePhpReceiverCompletions = vi.fn(async () => [
        {
          declaringClassName: "App\\Domain\\SubscriptionMigration",
          kind: "property" as const,
          name: "name",
          parameters: "",
          returnType: "string",
        },
      ]);
      context.deps.openPhpPropertyTarget = vi.fn(async () => true);
      const completionOffset = source.indexOf("->na") + 4;

      await expect(
        latteExpressionCompletions(context, source, completionOffset),
      ).resolves.toEqual([]);

      const definitionSource = source.replace("$item->na}", "$item->name}");
      const definitionOffset = definitionSource.indexOf("->name") + 4;

      await expect(
        resolveLatteMemberDefinition(
          context,
          definitionSource,
          definitionOffset,
        ),
      ).resolves.toBe(false);
      expect(context.deps.resolvePhpReceiverCompletions).not.toHaveBeenCalled();
      expect(context.deps.openPhpPropertyTarget).not.toHaveBeenCalled();
    },
  );
});

function callerVariableType(
  context: LatteExpressionResolutionContext,
): Promise<string | null> {
  return resolveLatteExpressionVariableType(
    context,
    "{$record}",
    3,
    "record",
  );
}

function expressionContext(
  root: string,
  files: Record<string, string>,
  getActiveDocument = vi.fn(() => ({ path: `${root}/active.latte` })),
  currentWorkspaceRootRef = { current: root as string | null },
  afterRead?: () => void,
  caches = providerCaches(),
): LatteExpressionResolutionContext {
  const deps = dependencies(
    root,
    files,
    getActiveDocument,
    currentWorkspaceRootRef,
    afterRead,
  );
  const request: LatteProviderRequestContext = {
    currentTemplateRelativePath: "active.latte",
    deps,
    isRequestedRootActive: () => currentWorkspaceRootRef.current === root,
    loadFactoryTemplateOwner: async () => null,
    requestedRoot: root,
  };

  return latteExpressionResolutionContext(options(deps, caches), request);
}

function dependencies(
  root: string,
  files: Record<string, string>,
  getActiveDocument: () => { path: string },
  currentWorkspaceRootRef: { current: string | null },
  afterRead?: () => void,
): LatteIntelligenceDependencies {
  return {
    collectTranslationTargets: vi.fn(async () => []),
    currentWorkspaceRootRef,
    findTranslationTarget: vi.fn(async () => null),
    frameworkIntelligence: createPhpFrameworkIntelligence({
      matchedProviderIds: [phpNetteFrameworkProvider.id],
      profile: "nette",
      providers: [phpNetteFrameworkProvider],
    }),
    getActiveDocument,
    isSemanticIntelligenceActive: true,
    joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
    listDirectory: vi.fn(async () => []),
    openPhpMethodTarget: vi.fn(async () => false),
    openPhpPropertyTarget: vi.fn(async () => false),
    openTarget: vi.fn(async () => false),
    readFileContent: vi.fn(async (path: string) => {
      const source = files[path];

      if (!source) {
        throw new Error(`missing ${path}`);
      }

      afterRead?.();
      return source;
    }),
    resolveDeclaredType: (_source, typeHint) => typeHint,
    resolveExpressionType: vi.fn(async (source, _position, expression) => {
      const namespaceName = /\bnamespace\s+([^;]+);/.exec(source)?.[1];
      const className = /\bnew\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(expression)?.[1];

      return namespaceName && className
        ? `${namespaceName}\\${className}`
        : null;
    }),
    resolvePhpReceiverCompletions: vi.fn(async () => []),
    searchText: vi.fn(async () => []),
    synthesizeTypedReceiverSource: () => ({
      position: { column: 1, lineNumber: 1 },
      source: "<?php",
    }),
    toRelativePath: (rootPath, path) =>
      path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path,
    workspaceRoot: root,
  };
}

function options(
  deps: LatteIntelligenceDependencies,
  caches: LatteProviderFlowCaches,
): LatteProviderFlowFactoryOptions {
  return {
    caches,
    frameworkCapabilities: {
      detectLattePresenterLinkAt: () => null,
      isPresenterSourcePath: () => false,
      lattePresenterLinkCompletionContextAt: () => null,
      parsePresenterLinkTarget: () => null,
      presenterActionMethodCandidates: () => [],
      presenterClassCandidatePathsForLink: () => [],
      presenterLinkTargetsFromSource: () => [],
      presenterScanDirectories: [],
      viewDataEntryFromSource: () => null,
      viewDataSearchQueries: () => [],
    },
    getDependencies: () => deps,
    inFlight: {
      filterInFlight: new Map(),
      factoryTemplateOwnerInFlight: new Map(),
      includeArgumentInFlight: { graphs: new Map(), queries: new Map() },
      presenterInFlight: new Map(),
      presenterMappingInFlight: new Map(),
      templateTypeInFlight: new Map(),
      viewDataInFlight: new Map(),
    },
  };
}

function presenterSource(namespace: string, className: string): string {
  const recordClassName = className.replace(/Presenter$/, "Record");

  return `<?php
namespace ${namespace};
class ${className}
{
    protected function renderDefault(): void
    {
        $this->template->record = new ${recordClassName}();
    }
}`;
}

function providerCaches(): LatteProviderFlowCaches {
  return {
    componentCache: {},
    filterCache: {},
    factoryTemplateOwnerCache: {},
    factoryTemplateOwnerGeneration: { next: 0, roots: {} },
    includeArgumentCache: {},
    includeArgumentGenerationByRoot: {},
    presenterCache: {},
    presenterMappingCache: {},
    presenterMappingGeneration: { next: 0, roots: {} },
    templateCache: {},
    templateTypeCache: {},
    viewDataCache: {},
  };
}
