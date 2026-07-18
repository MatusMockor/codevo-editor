import { describe, expect, it } from "vitest";
import { formatLatteSource } from "./latteFormatting";

const format = (source: string, indentUnit = "  ") =>
  formatLatteSource(source, { indentUnit });

const doc = (...lines: string[]) => lines.join("\n");

describe("formatLatteSource", () => {
  it("reindents nested HTML block elements", () => {
    const source = doc(
      "<div>",
      "<section>",
      "<p>text</p>",
      "</section>",
      "</div>",
    );

    expect(format(source)).toBe(
      doc(
        "<div>",
        "  <section>",
        "    <p>text</p>",
        "  </section>",
        "</div>",
      ),
    );
  });

  it("indents Latte pair tags and keeps {else}/{elseif} at parent level", () => {
    const source = doc(
      "{if $ok}",
      "<p>yes</p>",
      "{elseif $maybe}",
      "<p>maybe</p>",
      "{else}",
      "<p>no</p>",
      "{/if}",
    );

    expect(format(source)).toBe(
      doc(
        "{if $ok}",
        "  <p>yes</p>",
        "{elseif $maybe}",
        "  <p>maybe</p>",
        "{else}",
        "  <p>no</p>",
        "{/if}",
      ),
    );
  });

  it("keeps {elseifset} at the {ifset} parent level", () => {
    const source = doc(
      "{ifset $user}",
      "<p>a</p>",
      "{elseifset $guest}",
      "<p>b</p>",
      "{/ifset}",
    );

    expect(format(source)).toBe(
      doc(
        "{ifset $user}",
        "  <p>a</p>",
        "{elseifset $guest}",
        "  <p>b</p>",
        "{/ifset}",
      ),
    );
  });

  it("nests mixed HTML and Latte structures", () => {
    const source = doc(
      "<ul>",
      "{foreach $items as $item}",
      "<li>{$item->name}</li>",
      "{/foreach}",
      "</ul>",
    );

    expect(format(source)).toBe(
      doc(
        "<ul>",
        "  {foreach $items as $item}",
        "    <li>{$item->name}</li>",
        "  {/foreach}",
        "</ul>",
      ),
    );
  });

  it("does not indent after void elements", () => {
    const source = doc(
      "<div>",
      "<br>",
      "<img src=\"a.png\">",
      "<input type=\"text\">",
      "<meta charset=\"utf-8\">",
      "<hr/>",
      "<p>after</p>",
      "</div>",
    );

    expect(format(source)).toBe(
      doc(
        "<div>",
        "  <br>",
        "  <img src=\"a.png\">",
        "  <input type=\"text\">",
        "  <meta charset=\"utf-8\">",
        "  <hr/>",
        "  <p>after</p>",
        "</div>",
      ),
    );
  });

  it("treats a multi-line inline element as a block", () => {
    const source = doc("<span>", "text", "</span>");

    expect(format(source)).toBe(doc("<span>", "  text", "</span>"));
  });

  it("leaves script content byte-identical while reindenting its tags", () => {
    const source = doc(
      "<div>",
      "<script>",
      "function x() {",
      "      if (a) { b(); }",
      "}",
      "</script>",
      "</div>",
    );

    expect(format(source)).toBe(
      doc(
        "<div>",
        "  <script>",
        "function x() {",
        "      if (a) { b(); }",
        "}",
        "  </script>",
        "</div>",
      ),
    );
  });

  it("leaves style, pre and textarea content byte-identical", () => {
    const source = doc(
      "<div>",
      "<style>",
      ".a { color: red; }",
      "</style>",
      "<pre>",
      "   keep   me",
      "</pre>",
      "<textarea>",
      "  raw <div> text",
      "</textarea>",
      "</div>",
    );

    expect(format(source)).toBe(
      doc(
        "<div>",
        "  <style>",
        ".a { color: red; }",
        "  </style>",
        "  <pre>",
        "   keep   me",
        "  </pre>",
        "  <textarea>",
        "  raw <div> text",
        "  </textarea>",
        "</div>",
      ),
    );
  });

  it("keeps multi-line Latte comment interior byte-identical", () => {
    const source = doc(
      "<div>",
      "{* first",
      "second",
      "last *}",
      "<p>x</p>",
      "</div>",
    );

    expect(format(source)).toBe(
      doc(
        "<div>",
        "  {* first",
        "second",
        "last *}",
        "  <p>x</p>",
        "</div>",
      ),
    );
  });

  it("keeps {syntax off} body byte-identical and reindents {/syntax}", () => {
    const source = doc(
      "<div>",
      "{syntax off}",
      "   {rawContent}",
      "{/syntax}",
      "</div>",
    );

    expect(format(source)).toBe(
      doc(
        "<div>",
        "  {syntax off}",
        "   {rawContent}",
        "  {/syntax}",
        "</div>",
      ),
    );
  });

  it("ignores n:attributes for indentation", () => {
    const source = doc(
      "<div n:if=\"$user\">",
      "<span n:foreach=\"$items as $item\">{$item}</span>",
      "</div>",
    );

    expect(format(source)).toBe(
      doc(
        "<div n:if=\"$user\">",
        "  <span n:foreach=\"$items as $item\">{$item}</span>",
        "</div>",
      ),
    );
  });

  it("treats non-paired Latte tags as neutral", () => {
    const source = doc(
      "{extends 'layout.latte'}",
      "{var $count = 1}",
      "<div>",
      "{include 'partials/card'}",
      "{control cart}",
      "</div>",
    );

    expect(format(source)).toBe(
      doc(
        "{extends 'layout.latte'}",
        "{var $count = 1}",
        "<div>",
        "  {include 'partials/card'}",
        "  {control cart}",
        "</div>",
      ),
    );
  });

  it("treats self-closed Latte pair tags as neutral", () => {
    const source = doc("<div>", "{label email /}", "<p>x</p>", "</div>");

    expect(format(source)).toBe(
      doc("<div>", "  {label email /}", "  <p>x</p>", "</div>"),
    );
  });

  it("indents {block} and {snippet} bodies", () => {
    const source = doc(
      "{block content}",
      "{snippet list}",
      "<p>x</p>",
      "{/snippet}",
      "{/block}",
    );

    expect(format(source)).toBe(
      doc(
        "{block content}",
        "  {snippet list}",
        "    <p>x</p>",
        "  {/snippet}",
        "{/block}",
      ),
    );
  });

  it("keeps {case}/{default} and their content at the switch body level", () => {
    const source = doc(
      "{switch $type}",
      "{case article}",
      "<p>a</p>",
      "{default}",
      "<p>d</p>",
      "{/switch}",
    );

    expect(format(source)).toBe(
      doc(
        "{switch $type}",
        "  {case article}",
        "  <p>a</p>",
        "  {default}",
        "  <p>d</p>",
        "{/switch}",
      ),
    );
  });

  it("does not open an HTML scope for comparison operators in Latte expressions", () => {
    const source = doc("{if $a < 5}", "<p>x</p>", "{/if}");

    expect(format(source)).toBe(doc("{if $a < 5}", "  <p>x</p>", "{/if}"));
  });

  it("keeps a same-line open and close pair neutral", () => {
    const source = doc("<div>", "{if $ok}yes{/if}", "</div>");

    expect(format(source)).toBe(
      doc("<div>", "  {if $ok}yes{/if}", "</div>"),
    );
  });

  it("handles a quoted '>' inside an attribute value", () => {
    const source = doc("<div title=\"a > b\">", "<p>x</p>", "</div>");

    expect(format(source)).toBe(
      doc("<div title=\"a > b\">", "  <p>x</p>", "</div>"),
    );
  });

  it("ignores tags inside HTML comments", () => {
    const source = doc(
      "<div>",
      "<!-- <section> -->",
      "<p>x</p>",
      "</div>",
    );

    expect(format(source)).toBe(
      doc("<div>", "  <!-- <section> -->", "  <p>x</p>", "</div>"),
    );
  });

  it("matches HTML tags case-insensitively and skips uppercase voids", () => {
    const source = doc("<DIV>", "<BR>", "<p>x</p>", "</div>");

    expect(format(source)).toBe(
      doc("<DIV>", "  <BR>", "  <p>x</p>", "</div>"),
    );
  });

  it("realigns consecutive unclosed <li> siblings", () => {
    const source = doc("<ul>", "<li>one", "<li>two", "</ul>");

    expect(format(source)).toBe(
      doc("<ul>", "  <li>one", "  <li>two", "</ul>"),
    );
  });

  it("converts tab indentation to the configured indent unit", () => {
    const source = doc("<div>", "\t<p>x</p>", "</div>");

    expect(format(source, "    ")).toBe(
      doc("<div>", "    <p>x</p>", "</div>"),
    );
  });

  it("emits tab indentation when the indent unit is a tab", () => {
    const source = doc("<div>", "  <p>x</p>", "</div>");

    expect(format(source, "\t")).toBe(doc("<div>", "\t<p>x</p>", "</div>"));
  });

  it("keeps blank lines empty without trailing whitespace", () => {
    const source = doc("<div>", "   ", "<p>x</p>", "", "</div>");

    expect(format(source)).toBe(
      doc("<div>", "", "  <p>x</p>", "", "</div>"),
    );
  });

  it("preserves trailing whitespace inside line content", () => {
    const source = doc("<div>", "<p>x</p>   ", "</div>");

    expect(format(source)).toBe(doc("<div>", "  <p>x</p>   ", "</div>"));
  });

  it("preserves a trailing newline", () => {
    expect(format("<div>\n<p>x</p>\n</div>\n")).toBe(
      "<div>\n  <p>x</p>\n</div>\n",
    );
  });

  it("returns an empty document unchanged", () => {
    expect(format("")).toBe("");
  });

  it("clamps stray closers at column zero instead of underflowing", () => {
    const source = doc("{/if}", "</div>", "{/foreach}", "<p>ok</p>");

    expect(format(source)).toBe(
      doc("{/if}", "</div>", "{/foreach}", "<p>ok</p>"),
    );
  });

  it("continues deterministically after an unclosed opener", () => {
    const source = doc("{if $a}", "<p>x</p>", "<p>y</p>");

    expect(format(source)).toBe(doc("{if $a}", "  <p>x</p>", "  <p>y</p>"));
  });

  it("ignores a stray {/syntax} without an opener", () => {
    const source = doc("<div>", "{/syntax}", "<p>x</p>", "</div>");

    expect(format(source)).toBe(
      doc("<div>", "  {/syntax}", "  <p>x</p>", "</div>"),
    );
  });

  it("protects the rest of the document after an unclosed script", () => {
    const source = doc("<div>", "<script>", "   var x = 1;", "   var y = 2;");

    expect(format(source)).toBe(
      doc("<div>", "  <script>", "   var x = 1;", "   var y = 2;"),
    );
  });

  it("is idempotent on a kitchen-sink document", () => {
    const source = doc(
      "{extends 'layout.latte'}",
      "{block content}",
      "<div class=\"wrap\" n:if=\"$items\">",
      "<ul>",
      "{foreach $items as $item}",
      "<li>",
      "{if $item->isNew()}",
      "<strong>{$item->name|upper}</strong>",
      "{else}",
      "{$item->name}",
      "{/if}",
      "</li>",
      "{/foreach}",
      "</ul>",
      "{* a note",
      "spanning lines *}",
      "<script>",
      "  const x = { a: 1 };",
      "</script>",
      "</div>",
      "{/block}",
      "",
    );
    const once = format(source);

    expect(format(once)).toBe(once);
  });

  it("produces the expected kitchen-sink layout", () => {
    const source = doc(
      "{block content}",
      "<div>",
      "{foreach $items as $item}",
      "{if $item}",
      "{$item}",
      "{/if}",
      "{/foreach}",
      "</div>",
      "{/block}",
    );

    expect(format(source)).toBe(
      doc(
        "{block content}",
        "  <div>",
        "    {foreach $items as $item}",
        "      {if $item}",
        "        {$item}",
        "      {/if}",
        "    {/foreach}",
        "  </div>",
        "{/block}",
      ),
    );
  });
});
