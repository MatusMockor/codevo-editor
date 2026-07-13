import { describe, expect, it } from "vitest";
import {
  innermostLatteExpressionContextAt,
  innermostLatteExpressionSpanAt,
  innermostLatteNAttributeExpressionSpanAt,
  LATTE_BUILTIN_FILTERS,
  latteExpressionPhpSource,
  latteForeachLoopBindingsAt,
  latteVariableDeclarations,
  parseLatteForeachCollection,
  stripLatteFilterChain,
} from "./latteSyntax";

/** Offset of the character right after `needle` in `source` (start + length). */
function offsetAfter(source: string, needle: string): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`fixture missing marker: ${needle}`);
  }

  return index + needle.length;
}

describe("innermostLatteExpressionSpanAt", () => {
  it("returns the span of a `{$var->}` echo expression", () => {
    const source = "<p>{$user->}</p>";
    const span = innermostLatteExpressionSpanAt(source, offsetAfter(source, "->"));

    expect(span).not.toBeNull();
    expect(span?.tagName).toBeNull();
    expect(source.slice(span!.expressionStart, span!.contentEnd)).toBe("$user->");
  });

  it("returns the span of an `{if $var->}` control tag", () => {
    const source = "{if $order->}\n{/if}";
    const span = innermostLatteExpressionSpanAt(source, offsetAfter(source, "->"));

    expect(span?.tagName).toBe("if");
    expect(source.slice(span!.expressionStart, span!.contentEnd)).toBe("$order->");
  });

  it("returns the span of a `{= expr}` echo, expression start after `=`", () => {
    const source = "{= $product->}";
    const span = innermostLatteExpressionSpanAt(source, offsetAfter(source, "->"));

    expect(span?.tagName).toBeNull();
    expect(source.slice(span!.expressionStart, span!.contentEnd)).toBe("$product->");
  });

  it("returns the span of a `{foreach ...}` header", () => {
    const source = "{foreach $items as $item}";
    const span = innermostLatteExpressionSpanAt(source, offsetAfter(source, "$items"));

    expect(span?.tagName).toBe("foreach");
  });

  it("returns null for a JS object literal `{foo: 1}` (name not on allowlist)", () => {
    const source = "<script>const o = {foo: 1, bar: 2};</script>";
    const span = innermostLatteExpressionSpanAt(source, offsetAfter(source, "{foo"));

    expect(span).toBeNull();
  });

  it("returns null inside a `{* comment *}`", () => {
    const source = "{* $user->name should not complete *}";
    const span = innermostLatteExpressionSpanAt(source, offsetAfter(source, "$user->"));

    expect(span).toBeNull();
  });

  it("returns null inside a `{syntax off}` block", () => {
    const source = "{syntax off}{$user->name}{/syntax}";
    const span = innermostLatteExpressionSpanAt(source, offsetAfter(source, "$user->"));

    expect(span).toBeNull();
  });

  it("returns null inside a `{l}` literal-brace escape", () => {
    const source = "prefix {l} suffix";
    const span = innermostLatteExpressionSpanAt(source, offsetAfter(source, "{l"));

    expect(span).toBeNull();
  });

  it("returns null for a closing `{/foreach}` tag", () => {
    const source = "{foreach $a as $b}{/foreach}";
    const span = innermostLatteExpressionSpanAt(source, offsetAfter(source, "{/for"));

    expect(span).toBeNull();
  });

  it("returns null in plain HTML outside any Latte tag", () => {
    const source = "<div class=\"box\">hello</div>";
    const span = innermostLatteExpressionSpanAt(source, source.indexOf("hello"));

    expect(span).toBeNull();
  });

  it("returns a span for an unclosed `{$var->` at end of document (typing)", () => {
    const source = "<p>{$user->";
    const span = innermostLatteExpressionSpanAt(source, source.length);

    expect(span).not.toBeNull();
    expect(span?.tagName).toBeNull();
  });

  it("allows member completion inside a Latte tag within a <script> block", () => {
    const source = "<script>{$config->}</script>";
    const span = innermostLatteExpressionSpanAt(source, offsetAfter(source, "$config->"));

    expect(span).not.toBeNull();
  });

  it("handles a document that begins with a lone `{`", () => {
    const source = "{ not a tag";
    const span = innermostLatteExpressionSpanAt(source, 1);

    expect(span).toBeNull();
  });
});

describe("innermostLatteNAttributeExpressionSpanAt", () => {
  it.each([
    ["n:if", "$user->isActive()"],
    ["n:elseif", "$user->isBanned()"],
    ["n:ifset", "$user->avatar"],
    ["n:foreach", "$items as $item"],
    ["n:inner-foreach", "$rows as $row"],
    ["n:inner-if", "$row->visible"],
    ["n:class", "$active ? active"],
    ["n:show", "$visible"],
    ["n:tag", "$heading ? h1 : div"],
    ["n:tag-if", "$linkable"],
    ["n:attr", "title: $tooltip"],
    ["n:for", "$i = 0; $i < 5; $i++"],
    ["n:while", "$row = $rows->fetch()"],
    ["n:ifchanged", "$item->group"],
  ])("returns the value span of an expression-bearing %s attribute", (name, value) => {
    const source = `<div ${name}="${value}">x</div>`;
    const span = innermostLatteNAttributeExpressionSpanAt(
      source,
      offsetAfter(source, "$"),
    );

    expect(span).not.toBeNull();
    expect(span?.attributeName).toBe(name);
    expect(source.slice(span!.expressionStart, span!.contentEnd)).toBe(value);
  });

  it("handles a single-quoted attribute value", () => {
    const source = "<div n:show='$flag->enabled'>x</div>";
    const span = innermostLatteNAttributeExpressionSpanAt(
      source,
      offsetAfter(source, "->"),
    );

    expect(span?.attributeName).toBe("n:show");
    expect(source.slice(span!.expressionStart, span!.contentEnd)).toBe(
      "$flag->enabled",
    );
  });

  it("keeps quotes of the other kind inside the value", () => {
    const source = `<span n:if="$user->getName('admin') === 'a'">x</span>`;
    const span = innermostLatteNAttributeExpressionSpanAt(
      source,
      offsetAfter(source, "->get"),
    );

    expect(source.slice(span!.expressionStart, span!.contentEnd)).toBe(
      "$user->getName('admin') === 'a'",
    );
  });

  it("covers the `as $x` tail of an n:foreach header", () => {
    const source = '<tr n:foreach="$repo->findAll() as $x">x</tr>';
    const span = innermostLatteNAttributeExpressionSpanAt(
      source,
      offsetAfter(source, "as $x"),
    );

    expect(source.slice(span!.expressionStart, span!.contentEnd)).toBe(
      "$repo->findAll() as $x",
    );
  });

  it("returns the span at both value edges", () => {
    const source = '<div n:if="$ok">x</div>';
    const valueStart = source.indexOf("$ok");
    const valueEnd = valueStart + "$ok".length;

    expect(innermostLatteNAttributeExpressionSpanAt(source, valueStart)).not.toBeNull();
    expect(innermostLatteNAttributeExpressionSpanAt(source, valueEnd)).not.toBeNull();
  });

  it("returns the innermost attribute when several sit on one line", () => {
    const source = '<div n:if="$a" n:class="$b->cls">x</div>';
    const span = innermostLatteNAttributeExpressionSpanAt(
      source,
      offsetAfter(source, "$b->"),
    );

    expect(span?.attributeName).toBe("n:class");
    expect(source.slice(span!.expressionStart, span!.contentEnd)).toBe("$b->cls");
  });

  it("returns null outside the attribute value", () => {
    const source = '<div n:if="$ok">text</div>';

    expect(
      innermostLatteNAttributeExpressionSpanAt(source, source.indexOf("text")),
    ).toBeNull();
    expect(
      innermostLatteNAttributeExpressionSpanAt(source, source.indexOf("n:if")),
    ).toBeNull();
  });

  it("returns null for excluded n:href and n:name attributes", () => {
    const hrefSource = '<a n:href="Product:show">x</a>';
    const nameSource = '<form n:name="signInForm">x</form>';

    expect(
      innermostLatteNAttributeExpressionSpanAt(
        hrefSource,
        offsetAfter(hrefSource, "Product"),
      ),
    ).toBeNull();
    expect(
      innermostLatteNAttributeExpressionSpanAt(
        nameSource,
        offsetAfter(nameSource, "signIn"),
      ),
    ).toBeNull();
  });

  it("returns null for a regular HTML attribute", () => {
    const source = '<div class="box wide">x</div>';

    expect(
      innermostLatteNAttributeExpressionSpanAt(source, offsetAfter(source, "box")),
    ).toBeNull();
  });

  it("returns null for a lookalike prefixed attribute", () => {
    const source = '<div data-n:if="$a">x</div>';

    expect(
      innermostLatteNAttributeExpressionSpanAt(source, offsetAfter(source, "$a")),
    ).toBeNull();
  });

  it("returns null for an unterminated attribute value", () => {
    const source = '<div n:if="$user->';

    expect(
      innermostLatteNAttributeExpressionSpanAt(source, source.length),
    ).toBeNull();
  });

  it("returns null when the value runs past the end of the line", () => {
    const source = '<div n:if="$user->\n">x</div>';

    expect(
      innermostLatteNAttributeExpressionSpanAt(source, offsetAfter(source, "->")),
    ).toBeNull();
  });

  it("returns null inside a `{* comment *}`", () => {
    const source = '{* <div n:if="$user->name"> *}';

    expect(
      innermostLatteNAttributeExpressionSpanAt(source, offsetAfter(source, "->")),
    ).toBeNull();
  });

  it("rejects an opener masked by a comment even when the cursor sits after it", () => {
    const source = '{* <div n:if="$cond> *} hello $world <div class="box">';

    expect(
      innermostLatteNAttributeExpressionSpanAt(source, offsetAfter(source, "$wor")),
    ).toBeNull();
  });

  it("rejects an opener inside a `{syntax off}` block with the cursor after it", () => {
    const source = '{syntax off} n:if="x {/syntax} $world "';

    expect(
      innermostLatteNAttributeExpressionSpanAt(source, offsetAfter(source, "$wor")),
    ).toBeNull();
  });

  it("keeps an n:if span after a closed comment on the same line", () => {
    const source = '{* note *} <div n:if="$user->name">x</div>';
    const span = innermostLatteNAttributeExpressionSpanAt(
      source,
      offsetAfter(source, "->"),
    );

    expect(span?.attributeName).toBe("n:if");
    expect(source.slice(span!.expressionStart, span!.contentEnd)).toBe(
      "$user->name",
    );
  });

  it("leaves `{...}` expression spans to the curly detector (regression)", () => {
    const source = '<div n:if="$a">{$user->name}</div>';
    const curlyOffset = offsetAfter(source, "{$user->");

    expect(innermostLatteNAttributeExpressionSpanAt(source, curlyOffset)).toBeNull();
    expect(innermostLatteExpressionSpanAt(source, curlyOffset)).not.toBeNull();
    expect(
      innermostLatteExpressionSpanAt(source, offsetAfter(source, "$a")),
    ).toBeNull();
  });
});

describe("innermostLatteExpressionContextAt", () => {
  it("returns a tag context matching the tag-specific detector", () => {
    const source = "<p>{$user->}</p>";
    const offset = offsetAfter(source, "->");
    const context = innermostLatteExpressionContextAt(source, offset);

    expect(context?.kind).toBe("tag");
    expect(context?.span).toEqual(innermostLatteExpressionSpanAt(source, offset));
  });

  it("falls back to an n-attribute context matching the attribute detector", () => {
    const source = '<div n:if="$user->name">x</div>';
    const offset = offsetAfter(source, "->");
    const context = innermostLatteExpressionContextAt(source, offset);

    expect(context?.kind).toBe("nAttribute");
    expect(context?.span).toEqual(
      innermostLatteNAttributeExpressionSpanAt(source, offset),
    );
  });

  it("prefers the `{...}` tag over an enclosing n-attribute element", () => {
    const source = '<div n:if="$a">{$user->name}</div>';
    const context = innermostLatteExpressionContextAt(
      source,
      offsetAfter(source, "{$user->"),
    );

    expect(context?.kind).toBe("tag");
  });

  it("returns null in plain HTML", () => {
    const source = "<p>hello</p>";

    expect(
      innermostLatteExpressionContextAt(source, source.indexOf("hello")),
    ).toBeNull();
  });

  it("returns null inside a `{* comment *}`", () => {
    const source = "{* {$user->name} *}";

    expect(
      innermostLatteExpressionContextAt(source, offsetAfter(source, "->")),
    ).toBeNull();
  });
});

describe("stripLatteFilterChain", () => {
  it("cuts the whole filter chain after the first filter pipe", () => {
    expect(stripLatteFilterChain("$var|upper|truncate:10")).toBe("$var");
  });

  it("keeps a `||` logical-or operator", () => {
    expect(stripLatteFilterChain("$x || $y")).toBe("$x || $y");
  });

  it("does not cut a bitwise `|` followed by a non-identifier", () => {
    expect(stripLatteFilterChain("$a | $b")).toBe("$a | $b");
  });

  it("ignores a pipe inside a string literal", () => {
    expect(stripLatteFilterChain("'a|b'")).toBe("'a|b'");
  });

  it("ignores a pipe inside brackets and cuts the outer filter", () => {
    expect(stripLatteFilterChain("$arr[0]|first")).toBe("$arr[0]");
  });

  it("returns a bare variable unchanged", () => {
    expect(stripLatteFilterChain("$user->name")).toBe("$user->name");
  });
});

describe("latteExpressionPhpSource", () => {
  it("returns the cleaned PHP expression of a filtered echo", () => {
    const source = "{$count|number}";
    const span = innermostLatteExpressionSpanAt(source, offsetAfter(source, "$count"));

    expect(latteExpressionPhpSource(source, span!)).toBe("$count");
  });

  it("cleans the expression part of a `{= expr|filter}` echo", () => {
    const source = "{= $total|number:2}";
    const span = innermostLatteExpressionSpanAt(source, offsetAfter(source, "$total"));

    expect(latteExpressionPhpSource(source, span!)).toBe("$total");
  });
});

describe("latteForeachLoopBindingsAt", () => {
  it("binds the loop variable inside a `{foreach}` body", () => {
    const source = "{foreach $items as $item}\n  {$item->}\n{/foreach}";
    const bindings = latteForeachLoopBindingsAt(source, offsetAfter(source, "$item->"));

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.loopVariableName).toBe("item");
    expect(bindings[0]?.collectionExpression).toBe("$items");
    expect(bindings[0]?.keyVariableName).toBeNull();
  });

  it("captures the key variable of a `$k => $v` foreach", () => {
    const source = "{foreach $map as $key => $value}\n  {$value->}\n{/foreach}";
    const bindings = latteForeachLoopBindingsAt(source, offsetAfter(source, "$value->"));

    expect(bindings[0]?.loopVariableName).toBe("value");
    expect(bindings[0]?.keyVariableName).toBe("key");
  });

  it("returns nested bindings outermost first", () => {
    const source =
      "{foreach $entity->orders as $order}\n" +
      "  {foreach $order->lines as $line}\n" +
      "    {$line->}\n" +
      "  {/foreach}\n" +
      "{/foreach}";
    const bindings = latteForeachLoopBindingsAt(source, offsetAfter(source, "$line->"));

    expect(bindings.map((binding) => binding.loopVariableName)).toEqual([
      "order",
      "line",
    ]);
  });

  it("keeps the binding inside the `{else}` branch of a foreach", () => {
    const source = "{foreach $items as $item}\n{else}\n  no {$item->}\n{/foreach}";
    const bindings = latteForeachLoopBindingsAt(source, offsetAfter(source, "no {$item->"));

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.loopVariableName).toBe("item");
  });

  it("does not bind after `{/foreach}`", () => {
    const source = "{foreach $items as $item}{/foreach}\n{$item->}";
    const bindings = latteForeachLoopBindingsAt(source, offsetAfter(source, "\n{$item->"));

    expect(bindings).toHaveLength(0);
  });

  it("binds an `n:foreach` attribute for the following markup", () => {
    const source = '<ul n:foreach="$items as $item">\n  <li>{$item->}</li>\n</ul>';
    const bindings = latteForeachLoopBindingsAt(source, offsetAfter(source, "$item->"));

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.loopVariableName).toBe("item");
    expect(bindings[0]?.collectionExpression).toBe("$items");
  });

  it("binds an `n:inner-foreach` attribute", () => {
    const source = '<div n:inner-foreach="$rows as $row">{$row->}</div>';
    const bindings = latteForeachLoopBindingsAt(source, offsetAfter(source, "$row->"));

    expect(bindings[0]?.loopVariableName).toBe("row");
  });

  it("does not bind a foreach whose header is still being typed", () => {
    const source = "{foreach $items as ";
    const bindings = latteForeachLoopBindingsAt(source, source.length);

    expect(bindings).toHaveLength(0);
  });
});

describe("parseLatteForeachCollection", () => {
  it("parses a bare collection variable", () => {
    expect(parseLatteForeachCollection("$items")).toEqual({
      relationNames: [],
      rootVariableName: "items",
    });
  });

  it("parses a property/relation chain", () => {
    expect(parseLatteForeachCollection("$order->lines")).toEqual({
      relationNames: ["lines"],
      rootVariableName: "order",
    });
  });

  it("parses a deep relation chain", () => {
    expect(parseLatteForeachCollection("$a->b->c")).toEqual({
      relationNames: ["b", "c"],
      rootVariableName: "a",
    });
  });

  it("rejects a method call", () => {
    expect(parseLatteForeachCollection("$items->all()")).toBeNull();
  });

  it("rejects array access", () => {
    expect(parseLatteForeachCollection("$items[0]")).toBeNull();
  });

  it("rejects a non-variable receiver", () => {
    expect(parseLatteForeachCollection("getItems()")).toBeNull();
  });
});

describe("latteVariableDeclarations", () => {
  it("parses a `{var $x = expr}` declaration", () => {
    const declarations = latteVariableDeclarations("{var $count = 5}");

    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({
      expression: "5",
      kind: "var",
      typeName: null,
      variableName: "count",
    });
  });

  it("parses multiple comma-separated `{var}` declarations", () => {
    const declarations = latteVariableDeclarations("{var $x = 1, $y = 2}");

    expect(declarations.map((declaration) => declaration.variableName)).toEqual([
      "x",
      "y",
    ]);
    expect(declarations.map((declaration) => declaration.expression)).toEqual([
      "1",
      "2",
    ]);
  });

  it("does not split a comma inside an array literal", () => {
    const declarations = latteVariableDeclarations("{var $list = [1, 2, 3]}");

    expect(declarations).toHaveLength(1);
    expect(declarations[0]?.expression).toBe("[1, 2, 3]");
  });

  it("parses a `{default $x = expr}` declaration", () => {
    const declarations = latteVariableDeclarations("{default $lang = 'en'}");

    expect(declarations[0]).toMatchObject({
      expression: "'en'",
      kind: "default",
      variableName: "lang",
    });
  });

  it("parses a `{varType Type $x}` declaration", () => {
    const declarations = latteVariableDeclarations("{varType App\\Model\\Product $product}");

    expect(declarations[0]).toMatchObject({
      kind: "varType",
      typeName: "App\\Model\\Product",
      variableName: "product",
    });
  });

  it("parses a `{parameters Type $a, Type $b}` declaration", () => {
    const declarations = latteVariableDeclarations(
      "{parameters string $name, App\\Product $product}",
    );

    expect(declarations).toHaveLength(2);
    expect(declarations[0]).toMatchObject({
      kind: "parameters",
      typeName: "string",
      variableName: "name",
    });
    expect(declarations[1]).toMatchObject({
      kind: "parameters",
      typeName: "App\\Product",
      variableName: "product",
    });
  });

  it("parses a typed parameter with a default value", () => {
    const declarations = latteVariableDeclarations("{parameters ?App\\Product $product = null}");

    expect(declarations[0]).toMatchObject({
      expression: "null",
      kind: "parameters",
      typeName: "?App\\Product",
      variableName: "product",
    });
  });

  it("keeps a `{varType}` array-shape type intact despite the nested brace (F4)", () => {
    const declarations = latteVariableDeclarations("{varType array{id: int} $row}");

    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({
      kind: "varType",
      typeName: "array{id: int}",
      variableName: "row",
    });
  });

  it("still splits `{parameters}` on the comma when an earlier type has an unclosed `<` (F5 conservative fallback)", () => {
    const declarations = latteVariableDeclarations(
      "{parameters Collection<int $a, string $b}",
    );

    expect(declarations).toHaveLength(2);
    expect(declarations.map((declaration) => declaration.variableName)).toEqual([
      "a",
      "b",
    ]);
    expect(declarations[1]).toMatchObject({ typeName: "string" });
  });

  it("does not split a `{parameters}` generic type on its internal comma (F5)", () => {
    const declarations = latteVariableDeclarations(
      "{parameters Collection<int, Product> $items}",
    );

    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({
      kind: "parameters",
      typeName: "Collection<int, Product>",
      variableName: "items",
    });
  });

  it("parses a `{templateType ClassName}` declaration", () => {
    const declarations = latteVariableDeclarations("{templateType App\\ProductTemplate}");

    expect(declarations[0]).toMatchObject({
      kind: "templateType",
      typeName: "App\\ProductTemplate",
      variableName: null,
    });
  });

  it("ignores declarations inside a comment", () => {
    expect(latteVariableDeclarations("{* {var $x = 1} *}")).toEqual([]);
  });

  it("ignores declarations inside a `{syntax off}` block", () => {
    expect(
      latteVariableDeclarations("{syntax off}{var $x = 1}{/syntax}"),
    ).toEqual([]);
  });

  it("records the source offset of each declaration", () => {
    const source = "hi {var $x = 1}";
    const declarations = latteVariableDeclarations(source);

    expect(declarations[0]?.offset).toBe(source.indexOf("{var"));
  });
});

describe("LATTE_BUILTIN_FILTERS", () => {
  it("contains conservative Latte 3 core filters", () => {
    for (const filter of ["upper", "lower", "truncate", "date", "number"]) {
      expect(LATTE_BUILTIN_FILTERS).toContain(filter);
    }
  });

  it("has no duplicate entries", () => {
    expect(new Set(LATTE_BUILTIN_FILTERS).size).toBe(LATTE_BUILTIN_FILTERS.length);
  });
});

describe("hang-safety", () => {
  it("handles a very large document in linear time", () => {
    const source = `${"x".repeat(100000)}{$user->}`;
    const span = innermostLatteExpressionSpanAt(source, source.length - 1);

    expect(span).not.toBeNull();
  });

  it("handles deeply nested foreach blocks", () => {
    const depth = 50;
    let source = "";

    for (let level = 0; level < depth; level += 1) {
      source += `{foreach $c${level} as $v${level}}`;
    }

    source += "{$v49->}";
    const bindings = latteForeachLoopBindingsAt(source, offsetAfter(source, "$v49->"));

    expect(bindings).toHaveLength(depth);
    expect(bindings[0]?.loopVariableName).toBe("v0");
  });

  it("does not hang on an unterminated comment", () => {
    const source = "{* never closed $user->name";
    expect(innermostLatteExpressionSpanAt(source, source.length)).toBeNull();
  });

  it("does not hang on an unterminated tag", () => {
    const source = `${"a\n".repeat(5000)}{$user->`;
    expect(innermostLatteExpressionSpanAt(source, source.length)).not.toBeNull();
  });

  it("does not hang on a `{varType}` with many unbalanced nested braces (F4 depth tracking)", () => {
    const source = `{varType array${"{".repeat(20000)}int $row}`;

    const started = Date.now();
    const declarations = latteVariableDeclarations(source);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(1000);
    expect(declarations).toEqual([]);
  });

  it("does not hang on a `{parameters}` type with a long run of unmatched `<` (F5 angle tracking)", () => {
    const source = `{parameters Collection${"<".repeat(20000)}int $items}`;

    const started = Date.now();
    const declarations = latteVariableDeclarations(source);
    const elapsed = Date.now() - started;

    // The type itself is pathologically long, so the existing >500-char part
    // guard rejects it (unrelated to angle-bracket tracking) - the point of
    // this test is that the split scan over 20000 `<` characters completes
    // quickly rather than hanging.
    expect(elapsed).toBeLessThan(1000);
    expect(declarations).toEqual([]);
  });

  it("keeps a realistic generic type intact under a moderately long unmatched `<` run (F5 angle tracking)", () => {
    const source = `{parameters Collection${"<".repeat(50)}int $items}`;

    const declarations = latteVariableDeclarations(source);

    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({
      typeName: `Collection${"<".repeat(50)}int`,
      variableName: "items",
    });
  });

  it("ignores a `{foreach` written inside a comment", () => {
    const source = "{* {foreach $x as $y} *}\n{$z->}";
    const bindings = latteForeachLoopBindingsAt(source, offsetAfter(source, "$z->"));

    expect(bindings).toHaveLength(0);
  });
});
