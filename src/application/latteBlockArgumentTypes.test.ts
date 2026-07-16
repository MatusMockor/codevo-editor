import { describe, expect, it, vi } from "vitest";
import {
  type LatteBlockArgumentTypeContext,
  resolveLatteBlockArgumentType,
} from "./latteBlockArgumentTypes";

function context(
  types: Readonly<Record<string, string | null>> = {},
  isRequestedRootActive: () => boolean = () => true,
): LatteBlockArgumentTypeContext & {
  resolveExpressionType: ReturnType<typeof vi.fn>;
} {
  return {
    isRequestedRootActive,
    resolveExpressionType: vi.fn(async (expression: string) =>
      Object.prototype.hasOwnProperty.call(types, expression)
        ? (types[expression] ?? null)
        : null,
    ),
  };
}

function bodyOffset(source: string, marker: string, occurrence = 0): number {
  let offset = -1;

  for (let index = 0; index <= occurrence; index += 1) {
    offset = source.indexOf(marker, offset + 1);
  }

  if (offset < 0) {
    throw new Error(`missing marker: ${marker}`);
  }

  return offset;
}

describe("resolveLatteBlockArgumentType", () => {
  it("resolves the exact tableRow fixture without guessing iterator scope", async () => {
    const source = `{block #title}{_subscription_migration.admin.title}{/block}

{define tableRow, $migration, $iterator}
<tr>
    <td><small>{$migration->id}</td>
    <td><a n:href="SubscriptionMigrationAdmin:show $migration->id">{$migration->name}</a></td>
    <td>{ifset $migrationData[$migration->id]['groups']}{$iterator->counter}{/ifset}</td>
</tr>
{/define}

{block #content}
    {foreach $subscriptionMigrations as $migration}
        {include tableRow $migration, $iterator}
    {/foreach}
{/block}`;
    const resolver = context({ $migration: "App\\SubscriptionMigration" });
    const offset = bodyOffset(source, "{$migration->id}");

    await expect(
      resolveLatteBlockArgumentType(source, offset, "migration", resolver),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: "App\\SubscriptionMigration",
    });
    await expect(
      resolveLatteBlockArgumentType(source, offset, "$iterator", resolver),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: null,
    });
    expect(resolver.resolveExpressionType).toHaveBeenCalledWith(
      "$iterator",
      source.indexOf("$iterator", source.indexOf("{include tableRow")),
    );
  });

  it("binds positional before named before default", async () => {
    const source = [
      "{define row, $first = fallback(), $second = secondDefault()}",
      "  {$first}{$second}",
      "{/define}",
      "{include row namedFirst(), first: ignoredNamed(), second: namedSecond()}",
      "{include row first: namedOnly()}",
    ].join("\n");
    const resolver = context({
      "namedFirst()": "PositionalType",
      "namedOnly()": "PositionalType",
      "namedSecond()": "NamedType",
      "secondDefault()": "NamedType",
    });
    const offset = bodyOffset(source, "{$first}");

    await expect(
      resolveLatteBlockArgumentType(source, offset, "first", resolver),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: "PositionalType",
    });
    await expect(
      resolveLatteBlockArgumentType(source, offset, "second", resolver),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: "NamedType",
    });
    expect(resolver.resolveExpressionType).not.toHaveBeenCalledWith(
      "ignoredNamed()",
      expect.any(Number),
    );
  });

  it("falls through null positional and named arguments", async () => {
    const source = [
      "{define row, $item = defaultValue()}{$item}{/define}",
      "{include row null, item: namedValue()}",
      "{include row item: null}",
    ].join("\n");
    const resolver = context({
      "defaultValue()": "SelectedType",
      "namedValue()": "SelectedType",
      null: "NullMustNotResolve",
    });

    await expect(
      resolveLatteBlockArgumentType(
        source,
        bodyOffset(source, "{$item}"),
        "item",
        resolver,
      ),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: "SelectedType",
    });
    expect(resolver.resolveExpressionType).not.toHaveBeenCalledWith(
      "null",
      expect.any(Number),
    );
  });

  it("merges equal callers and preserves conflicts and unknown results", async () => {
    const equalSource =
      "{define row, $item}{$item}{/define}\n" +
      "{include row first()}\n{include row second()}";
    const equalContext = context({
      "first()": "\\App\\Row",
      "second()": "app\\row",
    });

    await expect(
      resolveLatteBlockArgumentType(
        equalSource,
        bodyOffset(equalSource, "{$item}"),
        "item",
        equalContext,
      ),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: "\\App\\Row",
    });

    const conflictContext = context({ first: "First", second: "Second" });
    const conflictSource =
      "{define row, $item}{$item}{/define}\n" +
      "{include row first}\n{include row second}";

    await expect(
      resolveLatteBlockArgumentType(
        conflictSource,
        bodyOffset(conflictSource, "{$item}"),
        "item",
        conflictContext,
      ),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: null,
    });

    const unknownSource =
      "{define row, $item}{$item}{/define}\n{include row unknown()}";
    await expect(
      resolveLatteBlockArgumentType(
        unknownSource,
        bodyOffset(unknownSource, "{$item}"),
        "item",
        context(),
      ),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: null,
    });

    const partialContext = context({ "known()": "KnownType" });
    const partialSource =
      "{define row, $item}{$item}{/define}\n" +
      "{include row known()}\n{include row unknown()}";
    await expect(
      resolveLatteBlockArgumentType(
        partialSource,
        bodyOffset(partialSource, "{$item}"),
        "item",
        partialContext,
      ),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: "KnownType",
    });
  });

  it("keeps the innermost formal scope isolated from outer and root data", async () => {
    const source = [
      "{define outer, $value}",
      "  {$value}",
      "  {define inner, $other}{$value}{$other}{/define}",
      "{/define}",
      "{$value}",
      "{include outer rootValue()}",
    ].join("\n");
    const resolver = context({
      rootValue: "RootType",
      "rootValue()": "OuterType",
    });

    await expect(
      resolveLatteBlockArgumentType(
        source,
        bodyOffset(source, "{$value}"),
        "value",
        resolver,
      ),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: "OuterType",
    });
    await expect(
      resolveLatteBlockArgumentType(
        source,
        bodyOffset(source, "{$value}", 1),
        "value",
        resolver,
      ),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: false,
      type: null,
    });
    await expect(
      resolveLatteBlockArgumentType(
        source,
        source.lastIndexOf("{$value}"),
        "value",
        resolver,
      ),
    ).resolves.toEqual({
      blocksOuterScope: false,
      found: false,
      type: null,
    });
    expect(resolver.resolveExpressionType).toHaveBeenCalledTimes(1);
  });

  it("forwards A to B recursively and skips cyclic branches", async () => {
    const source = [
      "{define A, $value}{$value}{include C $value}{/define}",
      "{define B, $forwarded}{include A $forwarded}{/define}",
      "{define C, $cycle}{include A $cycle}{/define}",
      "{include B leaf()}",
      "{include A independent()}",
    ].join("\n");
    const resolver = context({
      "independent()": "LeafType",
      "leaf()": "LeafType",
    });

    await expect(
      resolveLatteBlockArgumentType(
        source,
        bodyOffset(source, "{$value}"),
        "value",
        resolver,
      ),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: "LeafType",
    });
  });

  it("lets an explicit iterator formal shadow include-site inference", async () => {
    const source = [
      "{define row, $iterator}{$iterator}{/define}",
      "{define wrapper, $iterator}",
      "  {foreach $items as $item}{include row $iterator}{/foreach}",
      "{/define}",
      "{include wrapper explicitIterator()}",
    ].join("\n");
    const resolver = context({ "explicitIterator()": "App\\ExplicitIterator" });

    await expect(
      resolveLatteBlockArgumentType(
        source,
        bodyOffset(source, "{$iterator}"),
        "iterator",
        resolver,
      ),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: "App\\ExplicitIterator",
    });
    expect(resolver.resolveExpressionType).not.toHaveBeenCalledWith(
      "$iterator",
      expect.any(Number),
    );
  });

  it("bounds forwarding depth and total traversal states", async () => {
    const depthDefinitions = Array.from(
      { length: 11 },
      (_, index) =>
        `{define D${index}, $value}${index === 0 ? "{$value}" : `{include D${index - 1} $value}`}{/define}`,
    );
    const depthSource = [...depthDefinitions, "{include D10 tooDeep()}"].join(
      "\n",
    );

    await expect(
      resolveLatteBlockArgumentType(
        depthSource,
        bodyOffset(depthSource, "{$value}"),
        "value",
        context({ "tooDeep()": "TooDeep" }),
      ),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: null,
    });

    const directCallers = Array.from(
      { length: 2_500 },
      (_, index) => `{include target value${index}()}`,
    );
    const capSource = [
      "{define target, $value}{$value}{/define}",
      ...directCallers,
    ].join("\n");
    const cappedContext = context();
    cappedContext.resolveExpressionType.mockResolvedValue("BoundedType");

    await expect(
      resolveLatteBlockArgumentType(
        capSource,
        bodyOffset(capSource, "{$value}"),
        "value",
        cappedContext,
      ),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: null,
    });
    expect(cappedContext.resolveExpressionType).toHaveBeenCalledTimes(1_999);
    expect(cappedContext.resolveExpressionType).not.toHaveBeenCalledWith(
      "value1999()",
      expect.any(Number),
    );
  });

  it("drops an async result after the root becomes stale", async () => {
    let active = true;
    const resolver = context({}, () => active);
    resolver.resolveExpressionType.mockImplementation(async () => {
      active = false;
      return "StaleType";
    });
    const source = "{define row, $item}{$item}{/define}\n{include row value()}";

    await expect(
      resolveLatteBlockArgumentType(
        source,
        bodyOffset(source, "{$item}"),
        "item",
        resolver,
      ),
    ).resolves.toEqual({
      blocksOuterScope: false,
      found: false,
      type: null,
    });
  });

  it("accepts resolver and root-active callbacks directly", async () => {
    const source = "{define row, $item}{$item}{/define}\n{include row value()}";
    const resolve = vi.fn(async () => "DirectType");

    await expect(
      resolveLatteBlockArgumentType(
        source,
        bodyOffset(source, "{$item}"),
        "item",
        resolve,
        () => true,
      ),
    ).resolves.toEqual({
      blocksOuterScope: true,
      found: true,
      type: "DirectType",
    });
  });
});
