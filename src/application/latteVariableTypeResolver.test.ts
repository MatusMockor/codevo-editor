import { describe, expect, it, vi } from "vitest";
import type { NetteIncludedTemplateArgument } from "./netteIncludedTemplateArguments";
import type { LatteVariableResolutionContext } from "./latteVariableContracts";
import { resolveLatteVariableType } from "./latteVariableTypeResolver";

function includedArgument(
  name: string,
  type: string | null,
): NetteIncludedTemplateArgument {
  return {
    depth: 0,
    expression: "$source",
    name,
    provenance: [],
    sourceSpan: { end: 1, start: 0 },
    sourceTemplateRelativePath: "caller.latte",
    targetSpan: { end: 1, start: 0 },
    targetTemplateRelativePath: "partial.latte",
    type,
  };
}

function context({
  active = () => true,
  included = [],
  presenterType = null,
  resolveExpressionTypeAt,
}: {
  active?: () => boolean;
  included?: readonly NetteIncludedTemplateArgument[];
  presenterType?: string | null;
  resolveExpressionTypeAt?: LatteVariableResolutionContext["resolveExpressionTypeAt"];
} = {}): LatteVariableResolutionContext {
  return {
    currentControlClassName: vi.fn(async () => null),
    currentPresenterClassName: vi.fn(async () => null),
    currentTemplateRelativePath: "partial.latte",
    deps: {
      resolveDeclaredType: (_source, typeHint) => typeHint,
      resolveExpressionType: vi.fn(async () => null),
    },
    isRequestedRootActive: active,
    loadIncludedTemplateArguments: vi.fn(async () => included),
    loadTemplateTypePropertySightings: vi.fn(async () => []),
    loadViewDataEntries: vi.fn(async () =>
      presenterType
        ? [
            {
              bindings: [
                {
                  variables: [
                    {
                      detail: "presenter data",
                      name: "$value",
                      typeHint: presenterType,
                      valueExpression: null,
                      valueOffset: null,
                    },
                  ],
                  viewName: "Home:default",
                },
              ],
              source: "<?php",
            },
          ]
        : [],
    ),
    maxTypeResolutionDepth: 5,
    resolveExpressionTypeAt,
    viewNames: vi.fn(async () => ["Home:default"]),
  } as LatteVariableResolutionContext;
}

describe("Latte include argument type resolution", () => {
  it("uses a merged include type before presenter data", async () => {
    const resolutionContext = context({
      included: [
        includedArgument("value", "App\\Model\\Invoice"),
        includedArgument("value", "\\App\\Model\\Invoice"),
      ],
      presenterType: "App\\Model\\PresenterValue",
    });

    await expect(
      resolveLatteVariableType(resolutionContext, "{$value}", 3, "value"),
    ).resolves.toBe("App\\Model\\Invoice");
  });

  it("treats conflicting caller types as unknown", async () => {
    const resolutionContext = context({
      included: [
        includedArgument("value", "App\\Model\\Invoice"),
        includedArgument("value", "App\\Model\\Order"),
      ],
    });

    await expect(
      resolveLatteVariableType(resolutionContext, "{$value}", 3, "value"),
    ).resolves.toBeNull();
  });

  it("does not fall through to presenter data for conflicting caller types", async () => {
    const resolutionContext = context({
      included: [
        includedArgument("value", "App\\Model\\Invoice"),
        includedArgument("value", "App\\Model\\Order"),
      ],
      presenterType: "App\\Model\\PresenterValue",
    });

    await expect(
      resolveLatteVariableType(resolutionContext, "{$value}", 3, "value"),
    ).resolves.toBeNull();
  });

  it("does not load include arguments beyond the resolution depth", async () => {
    const resolutionContext = context({
      included: [includedArgument("value", "string")],
    });

    await expect(
      resolveLatteVariableType(
        resolutionContext,
        "{$value}",
        3,
        "value",
        resolutionContext.maxTypeResolutionDepth,
      ),
    ).resolves.toBeNull();
    expect(
      (resolutionContext as LatteVariableResolutionContext & {
        loadIncludedTemplateArguments: ReturnType<typeof vi.fn>;
      }).loadIncludedTemplateArguments,
    ).not.toHaveBeenCalled();
  });

  it("drops include results when the project becomes stale", async () => {
    let active = true;
    const resolutionContext = context({ active: () => active });
    const includeContext = resolutionContext as LatteVariableResolutionContext & {
      loadIncludedTemplateArguments: ReturnType<typeof vi.fn>;
    };
    includeContext.loadIncludedTemplateArguments = vi.fn(async () => {
      active = false;
      return [includedArgument("value", "string")];
    });

    await expect(
      resolveLatteVariableType(resolutionContext, "{$value}", 3, "value"),
    ).resolves.toBeNull();
  });
});

describe("same-document define parameter type resolution", () => {
  const source = `{varType App\\Root\\Migration $migration}
{define tableRow, $migration, $iterator}
  <tr>
    <td><a n:href="SubscriptionMigrationAdmin:show $migration->id">{$migration->name}</a></td>
    <td>{$iterator->counter}</td>
    <td>{$presenterOnly}</td>
  </tr>
{/define}

{foreach $migrations as $migration}
  {include tableRow $migration, $iterator}
{/foreach}`;

  it("resolves tableRow formals from the exact include expression offset", async () => {
    const includeOffset = source.indexOf(
      "$migration",
      source.indexOf("{include tableRow"),
    );
    const resolveExpressionTypeAt = vi.fn(
      async (_source, expression, offset) =>
        expression === "$migration" && offset === includeOffset
          ? "App\\Domain\\SubscriptionMigration"
          : null,
    );
    const resolutionContext = context({
      presenterType: "App\\Presenter\\LeakedMigration",
      resolveExpressionTypeAt,
    });

    await expect(
      resolveLatteVariableType(
        resolutionContext,
        source,
        source.indexOf("$migration->name"),
        "migration",
      ),
    ).resolves.toBe("App\\Domain\\SubscriptionMigration");
    expect(resolveExpressionTypeAt).toHaveBeenCalledWith(
      source,
      "$migration",
      includeOffset,
      1,
    );
  });

  it("blocks root, include, implicit, and presenter fallback inside define", async () => {
    const resolutionContext = context({
      included: [includedArgument("presenterOnly", "App\\Included\\Leak")],
      presenterType: "App\\Presenter\\Leak",
      resolveExpressionTypeAt: vi.fn(async () => null),
    });
    const bodyOffset = source.indexOf("$presenterOnly");

    await expect(
      resolveLatteVariableType(
        resolutionContext,
        source,
        bodyOffset,
        "presenterOnly",
      ),
    ).resolves.toBeNull();
    await expect(
      resolveLatteVariableType(
        resolutionContext,
        source,
        source.indexOf("$iterator->counter"),
        "iterator",
      ),
    ).resolves.toBeNull();
    await expect(
      resolveLatteVariableType(
        resolutionContext,
        source,
        source.indexOf("$migration->name"),
        "migration",
      ),
    ).resolves.toBeNull();
  });

  it("uses the nearest visible local declaration over a define formal", async () => {
    const localSource = `{define tableRow, $migration}
  {var $migration = $first}
  {var $migration = $decorated}
  {$migration->name}
{/define}
{include tableRow $source}`;
    const resolveExpressionType = vi.fn(async (_source, _position, expression) =>
      expression === "$decorated" ? "App\\View\\DecoratedMigration" : null,
    );
    const resolutionContext = context({
      resolveExpressionTypeAt: vi.fn(async () => "App\\Domain\\SubscriptionMigration"),
    });
    resolutionContext.deps.resolveExpressionType = resolveExpressionType;

    await expect(
      resolveLatteVariableType(
        resolutionContext,
        localSource,
        localSource.indexOf("$migration->name"),
        "migration",
      ),
    ).resolves.toBe("App\\View\\DecoratedMigration");
    expect(resolveExpressionType).toHaveBeenCalledOnce();
  });

  it("does not leak a formal type through an unknown local shadow", async () => {
    const localSource = `{define tableRow, $item}
  {var $item = unknownFactory()}
  {$item->name}
{/define}
{include tableRow $sourceItem}`;
    const resolveExpressionTypeAt = vi.fn(
      async () => "App\\Domain\\SubscriptionMigration",
    );
    const resolutionContext = context({ resolveExpressionTypeAt });

    await expect(
      resolveLatteVariableType(
        resolutionContext,
        localSource,
        localSource.indexOf("$item->name"),
        "item",
      ),
    ).resolves.toBeNull();
    expect(resolveExpressionTypeAt).not.toHaveBeenCalled();
  });

  it("does not leak a formal type through an unknown foreach shadow", async () => {
    const foreachSource = `{define tableRow, $item}
  {foreach $unknownItems as $item}
    {$item->name}
  {/foreach}
{/define}
{include tableRow $sourceItem}`;
    const resolveExpressionTypeAt = vi.fn(
      async () => "App\\Domain\\SubscriptionMigration",
    );
    const resolutionContext = context({ resolveExpressionTypeAt });

    await expect(
      resolveLatteVariableType(
        resolutionContext,
        foreachSource,
        foreachSource.indexOf("$item->name"),
        "item",
      ),
    ).resolves.toBeNull();
    expect(resolveExpressionTypeAt).not.toHaveBeenCalled();
  });

  it("keeps a known foreach shadow ahead of the formal type", async () => {
    const foreachSource = `{define tableRow, $item, $items}
  {foreach $items as $item}
    {$item->name}
  {/foreach}
{/define}
{include tableRow $sourceItem, $sourceItems}`;
    const resolveExpressionTypeAt = vi.fn(async (_source, expression) => {
      if (expression === "$sourceItems") {
        return "array<int, App\\View\\DecoratedMigration>";
      }

      return expression === "$sourceItem"
        ? "App\\Domain\\SubscriptionMigration"
        : null;
    });
    const resolutionContext = context({ resolveExpressionTypeAt });

    await expect(
      resolveLatteVariableType(
        resolutionContext,
        foreachSource,
        foreachSource.indexOf("$item->name"),
        "item",
      ),
    ).resolves.toBe("App\\View\\DecoratedMigration");
    expect(resolveExpressionTypeAt).not.toHaveBeenCalledWith(
      foreachSource,
      "$sourceItem",
      expect.any(Number),
      expect.any(Number),
    );
  });
});
