import { describe, expect, it } from "vitest";
import {
  latteBlockSyntax,
  parseLatteBlockSyntax,
} from "./latteBlockSyntax";

function spanOf(source: string, text: string, occurrence = 0) {
  let start = -1;

  for (let index = 0; index <= occurrence; index += 1) {
    start = source.indexOf(text, start + 1);
  }

  if (start < 0) {
    throw new Error(`text not found in source: ${text}`);
  }

  return { end: start + text.length, start };
}

function textAt(source: string, span: { end: number; start: number }): string {
  return source.slice(span.start, span.end);
}

describe("parseLatteBlockSyntax", () => {
  it("parses typed/default define parameters and exact definition spans", () => {
    const source =
      "before {define render, $plain, ?Foo\\Bar $item = null, " +
      "int|string $count = max(1, fn($x) => $x, [2, 3])}" +
      "<b>{$item}</b>{/define} after";
    const syntax = parseLatteBlockSyntax(source);
    const definition = syntax.definitions[0];

    expect(definition).toBeDefined();
    expect(definition?.kind).toBe("define");
    expect(definition?.name).toBe("render");
    expect(definition?.nameSpan).toEqual(spanOf(source, "render"));
    expect(definition && textAt(source, definition.tagSpan)).toBe(
      "{define render, $plain, ?Foo\\Bar $item = null, " +
        "int|string $count = max(1, fn($x) => $x, [2, 3])}",
    );
    expect(definition && textAt(source, definition.bodySpan)).toBe(
      "<b>{$item}</b>",
    );
    expect(definition?.parameters).toEqual([
      {
        defaultValue: null,
        defaultValueSpan: null,
        name: "plain",
        nameSpan: spanOf(source, "plain"),
        span: spanOf(source, "$plain"),
        type: null,
        typeSpan: null,
      },
      {
        defaultValue: "null",
        defaultValueSpan: spanOf(source, "null"),
        name: "item",
        nameSpan: spanOf(source, "item"),
        span: spanOf(source, "?Foo\\Bar $item = null"),
        type: "?Foo\\Bar",
        typeSpan: spanOf(source, "?Foo\\Bar"),
      },
      {
        defaultValue: "max(1, fn($x) => $x, [2, 3])",
        defaultValueSpan: spanOf(source, "max(1, fn($x) => $x, [2, 3])"),
        name: "count",
        nameSpan: spanOf(source, "count"),
        span: spanOf(
          source,
          "int|string $count = max(1, fn($x) => $x, [2, 3])",
        ),
        type: "int|string",
        typeSpan: spanOf(source, "int|string"),
      },
    ]);
  });

  it("accepts parameters without a comma after the definition name", () => {
    const source = [
      "{define hello $name}<p>{$name}</p>{/define hello}",
      "{define explicit, string $name = 'Latte'}{/define explicit}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(
      syntax.definitions.map((definition) => ({
        name: definition.name,
        parameters: definition.parameters.map((parameter) => parameter.name),
      })),
    ).toEqual([
      { name: "hello", parameters: ["name"] },
      { name: "explicit", parameters: ["name"] },
    ]);
  });

  it("keeps advanced Latte types and their internal commas intact", () => {
    const source = `{define advanced
    array<int, array<string, mixed>> $generic,
    array{foo: int, nested: array{bar?: string, ids: list<int>}} $shape,
    (?Foo&Bar)|Baz|null $mixed,
    Item[][] $matrix = []
}<p />{/define advanced}`;
    const syntax = parseLatteBlockSyntax(source);
    const definition = syntax.definitions[0];

    expect(definition?.parameters.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: "generic", type: "array<int, array<string, mixed>>" },
      {
        name: "shape",
        type: "array{foo: int, nested: array{bar?: string, ids: list<int>}}",
      },
      { name: "mixed", type: "(?Foo&Bar)|Baz|null" },
      { name: "matrix", type: "Item[][]" },
    ]);
    expect(definition?.parameters[0]?.span).toEqual(
      spanOf(source, "array<int, array<string, mixed>> $generic"),
    );
    expect(definition?.parameters[1]?.typeSpan).toEqual(
      spanOf(
        source,
        "array{foo: int, nested: array{bar?: string, ids: list<int>}}",
      ),
    );
    expect(definition?.parameters[3]?.defaultValue).toBe("[]");
  });

  it("supports local definitions and normalized #block/block includes", () => {
    const source = [
      "{block local helper}<i />{/block}",
      "{define card, $x}{include #helper, $x}{/define}",
      "{include card, value: 1}",
    ].join("\n");
    const syntax = latteBlockSyntax(source);

    expect(syntax.definitions.map(({ kind, name }) => ({ kind, name }))).toEqual([
      { kind: "local", name: "helper" },
      { kind: "define", name: "card" },
    ]);
    expect(syntax.includes.map(({ name }) => name)).toEqual(["helper", "card"]);
    expect(syntax.includes[0]?.nameSpan).toEqual(spanOf(source, "helper", 1));
    expect(syntax.includes[1]?.nameSpan).toEqual(spanOf(source, "card", 1));
    expect(syntax.includes[0]?.ownerDefinition?.name).toBe("card");
    expect(syntax.includes[1]?.ownerDefinition).toBeNull();
  });

  it("supports define local while keeping block definitions parameterless", () => {
    const source = [
      "{define local helper string $label, array<int> $ids = []}",
      "  {include leaf, $label}",
      "{/define helper}",
      "{block local valid}<i />{/block valid}",
      "{block local invalid, $value}<b />{/block invalid}",
      "{block local alsoInvalid $value}<u />{/block alsoInvalid}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(
      syntax.definitions.map((definition) => ({
        kind: definition.kind,
        name: definition.name,
        parameters: definition.parameters.map((parameter) => parameter.name),
      })),
    ).toEqual([
      { kind: "define", name: "helper", parameters: ["label", "ids"] },
      { kind: "local", name: "valid", parameters: [] },
    ]);
    expect(syntax.includes[0]?.ownerDefinition?.name).toBe("helper");
  });

  it("parses positional and both named argument forms with exact spans", () => {
    const source =
      "{define row, $a, $b, $options}" +
      "{/define}" +
      "{include row make(1, [2, 3]), tone: call('a,b', ['x' => 1]), " +
      "'options' => ['cell' => fn($x) => [$x, '}']]}";
    const syntax = parseLatteBlockSyntax(source);
    const args = syntax.includes[0]?.arguments;
    const positional = "make(1, [2, 3])";
    const tone = "call('a,b', ['x' => 1])";
    const options = "['cell' => fn($x) => [$x, '}']]";

    expect(args).toEqual([
      {
        kind: "positional",
        name: null,
        nameSpan: null,
        span: spanOf(source, positional),
        value: positional,
        valueSpan: spanOf(source, positional),
      },
      {
        kind: "named",
        name: "tone",
        nameSpan: spanOf(source, "tone"),
        span: spanOf(source, `tone: ${tone}`),
        value: tone,
        valueSpan: spanOf(source, tone),
      },
      {
        kind: "named",
        name: "options",
        nameSpan: spanOf(source, "options", 1),
        span: spanOf(source, `'options' => ${options}`),
        value: options,
        valueSpan: spanOf(source, options),
      },
    ]);
  });

  it("assigns nested includes to the innermost closed definition", () => {
    const source = [
      "{define outer, $value}",
      "  {include before, $value}",
      "  {define inner, $nested}",
      "    {include deepest, payload: [$nested, call(1, 2)]}",
      "  {/define}",
      "  {include after, $value}",
      "{/define}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(
      syntax.includes.map((include) => [
        include.name,
        include.ownerDefinition?.name ?? null,
      ]),
    ).toEqual([
      ["before", "outer"],
      ["deepest", "inner"],
      ["after", "outer"],
    ]);
    expect(textAt(source, syntax.definitions[1]!.bodySpan)).toContain(
      "{include deepest",
    );
  });

  it("uses generic closers for the innermost definition without breaking nesting", () => {
    const source = [
      "{define outer $value}",
      "  {define local middle string $label}",
      "    {block local inner}",
      "      {include block leaf, $label, tone: call(1, [2, 3])}",
      "    {/}",
      "    {include block middleLeaf, $label}",
      "  {/}",
      "  {include block after, $value}",
      "{/}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(syntax.definitions.map(({ name }) => name)).toEqual([
      "outer",
      "middle",
      "inner",
    ]);
    expect(
      syntax.includes.map((include) => [
        include.name,
        include.ownerDefinition?.name ?? null,
      ]),
    ).toEqual([
      ["leaf", "inner"],
      ["middleLeaf", "middle"],
      ["after", "outer"],
    ]);
    expect(syntax.includes[0]?.arguments.map(({ value }) => value)).toEqual([
      "$label",
      "call(1, [2, 3])",
    ]);
  });

  it("uses a generic closer for an inner control before its owner definition", () => {
    const source = [
      "{define outer $value}",
      "  {if true}",
      "    {include block inside, $value}",
      "  {/}",
      "  {include block after, $value}",
      "{/}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(syntax.definitions.map(({ name }) => name)).toEqual(["outer"]);
    expect(
      syntax.includes.map((include) => [
        include.name,
        include.ownerDefinition?.name ?? null,
      ]),
    ).toEqual([
      ["inside", "outer"],
      ["after", "outer"],
    ]);
    expect(textAt(source, syntax.definitions[0]!.bodySpan)).toContain(
      "{include block after",
    );
  });

  it("tracks formContext as paired before applying a generic closer", () => {
    const source = [
      "{define outer $form}",
      "  {formContext $form}",
      "    {include field, $form}",
      "  {/}",
      "  {include afterContext, $form}",
      "{/}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(syntax.definitions.map(({ name }) => name)).toEqual(["outer"]);
    expect(
      syntax.includes.map((include) => [
        include.name,
        include.ownerDefinition?.name ?? null,
      ]),
    ).toEqual([
      ["field", "outer"],
      ["afterContext", "outer"],
    ]);
  });

  it("preserves explicit paired closers around generic nested controls", () => {
    const source = [
      "{define named $rows}",
      "  {foreach $rows as $row}",
      "    {ifset $row}",
      "      {include row, $row}",
      "    {/}",
      "    {include fallback, $row}",
      "  {/foreach}",
      "{/define named}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(syntax.definitions.map(({ name }) => name)).toEqual(["named"]);
    expect(syntax.includes.map(({ name }) => name)).toEqual([
      "row",
      "fallback",
    ]);
    expect(
      syntax.includes.every(
        (include) => include.ownerDefinition?.name === "named",
      ),
    ).toBe(true);
  });

  it("accepts a static block marker but still excludes dynamic block targets", () => {
    const source = [
      "{include block card, $item, size: 2}",
      "{include block legacy, payload => make(1, 2)}",
      "{include block $dynamic, ignored: 1}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(syntax.includes.map(({ name }) => name)).toEqual(["card", "legacy"]);
    expect(syntax.includes[0]?.nameSpan).toEqual(spanOf(source, "card"));
    expect(syntax.includes[1]?.nameSpan).toEqual(spanOf(source, "legacy"));
    expect(syntax.includes[1]?.arguments[0]?.value).toBe("make(1, 2)");
  });

  it("requires # or block before dotted same-file block names", () => {
    const source = [
      "{include partial.latte, ignored: 1}",
      "{include #price.total, $price}",
      "{include block card.compact, item: $item}",
      "{include plain, $value}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(syntax.includes.map(({ name }) => name)).toEqual([
      "price.total",
      "card.compact",
      "plain",
    ]);
    expect(syntax.includes[0]?.nameSpan).toEqual(spanOf(source, "price.total"));
    expect(syntax.includes[1]?.nameSpan).toEqual(
      spanOf(source, "card.compact"),
    );
  });

  it("accepts matching named closers and rejects mismatched names", () => {
    const source = [
      "{define good}<i />{/define good}",
      "{block local helper}<b />{/block helper}",
      "{define wrong}<u />{/define other}",
      "{block local nope}<s />{/block different}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(syntax.definitions.map(({ kind, name }) => ({ kind, name }))).toEqual([
      { kind: "define", name: "good" },
      { kind: "local", name: "helper" },
    ]);
    expect(textAt(source, syntax.definitions[0]!.bodySpan)).toBe("<i />");
    expect(textAt(source, syntax.definitions[1]!.bodySpan)).toBe("<b />");
  });

  it("rejects # markers in named definition closers", () => {
    const define = parseLatteBlockSyntax(
      "{define foo}<i />{/define #foo}",
    );
    const block = parseLatteBlockSyntax(
      "{block local foo}<b />{/block #foo}",
    );

    expect(define.definitions).toEqual([]);
    expect(block.definitions).toEqual([]);
  });

  it("does not let malformed nested definitions close a valid outer owner", () => {
    const source = [
      "{define outer, $value}",
      "  {define malformed string nested}",
      "    {include hidden, $nested}",
      "  {/define}",
      "  {include owned, $value}",
      "{/define}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(syntax.definitions.map(({ name }) => name)).toEqual(["outer"]);
    expect(
      syntax.includes.map((include) => [
        include.name,
        include.ownerDefinition?.name ?? null,
      ]),
    ).toEqual([
      ["hidden", null],
      ["owned", "outer"],
    ]);
  });

  it("excludes dynamic, external, reserved, file, filtered decoy, and malformed includes", () => {
    const source = [
      "{include $dynamic, value: 1}",
      "{include block $dynamic, value: 1}",
      "{include parent}",
      "{include this}",
      "{include remote from 'blocks.latte', value: 1}",
      "{include 'partial.latte', value: 1}",
      "{include partials/@menu.latte}",
      "{include broken, missing:}",
      "{include broken, value: [1, 2}",
      "{include broken, value: (1]}",
      "{include live, text: call('from', ['a,b']) |trim}",
    ].join("\n");

    expect(parseLatteBlockSyntax(source).includes.map(({ name }) => name)).toEqual([
      "live",
    ]);
  });

  it("excludes comments, syntax-off regions, escaped braces, and malformed definitions", () => {
    const source = [
      "{* {define fake, $x}{include fake, $x}{/define} *}",
      "{syntax off}{define off, $x}{include off, $x}{/define}{/syntax}",
      String.raw`\{define escaped, $x}{/define}`,
      "{define missingVariable string}{/define}",
      "{define bad, string value}{/define}",
      "{define badDefault, $x =}{/define}",
      "{define live, $x}<p />{/define}",
      "{include live, 1}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(syntax.definitions.map(({ name }) => name)).toEqual(["live"]);
    expect(syntax.includes.map(({ name }) => name)).toEqual(["live"]);
  });

  it("recovers at line boundaries and remains bounded on unterminated input", () => {
    const huge = "x".repeat(40_000);
    const source = [
      `{define broken, $value = '${huge}`,
      "{include broken, [1, 2}",
      "{define unterminated, $x}",
      "{include inside, $x}",
      "{define live, $ok}<span />{/define}",
      "{include live, $ok}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(syntax.definitions.map(({ name }) => name)).toEqual(["live"]);
    expect(syntax.includes.map(({ name }) => name)).toEqual(["inside", "live"]);
    expect(syntax.includes[0]?.ownerDefinition).toBeNull();
  });

  it("bounds unterminated multiline headers and recovers later definitions", () => {
    const hugeType = `array<${"VeryLongType,".repeat(6_000)}`;
    const source = [
      `{define abandoned ${hugeType} $value`,
      "{* {define masked $x}{/define masked} *}",
      "{syntax off}{define off $x}{/define off}{/syntax}",
      "{define recovered",
      "    array{items: list<int>, label?: string} $data = ['items' => []]",
      "}<p />{/define recovered}",
    ].join("\n");
    const syntax = parseLatteBlockSyntax(source);

    expect(syntax.definitions.map(({ name }) => name)).toEqual(["recovered"]);
    expect(syntax.definitions[0]?.parameters[0]?.name).toBe("data");
  });

  it("accepts only a final top-level local block without a closer", () => {
    const source =
      "{block local helper}<i>{include leaf, value: 1}</i>";
    const syntax = parseLatteBlockSyntax(source);
    const definition = syntax.definitions[0];

    expect(definition?.name).toBe("helper");
    expect(definition && textAt(source, definition.bodySpan)).toBe(
      "<i>{include leaf, value: 1}</i>",
    );
    expect(syntax.includes[0]?.ownerDefinition?.name).toBe("helper");

    expect(parseLatteBlockSyntax("{define nope}<i />").definitions).toEqual([]);
    expect(
      parseLatteBlockSyntax(
        "{define outer}{block local nested}<i />",
      ).definitions,
    ).toEqual([]);
    expect(
      parseLatteBlockSyntax("{if true}{block local nested}<i />").definitions,
    ).toEqual([]);
    expect(
      parseLatteBlockSyntax("{block local broken, $value}<i />").definitions,
    ).toEqual([]);
  });

  it("handles the real tableRow define/include shape", () => {
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
    const syntax = parseLatteBlockSyntax(source);
    const definition = syntax.definitions[0];
    const include = syntax.includes[0];

    expect(definition?.name).toBe("tableRow");
    expect(definition?.parameters.map(({ name }) => name)).toEqual([
      "migration",
      "iterator",
    ]);
    expect(definition && textAt(source, definition.bodySpan)).toContain(
      "{$migration->id}",
    );
    expect(include?.name).toBe("tableRow");
    expect(include?.arguments.map(({ value }) => value)).toEqual([
      "$migration",
      "$iterator",
    ]);
    expect(include?.ownerDefinition).toBeNull();
  });
});
