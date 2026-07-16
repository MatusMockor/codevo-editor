import { describe, expect, it } from "vitest";
import { latteStaticFileIncludes } from "./latteIncludes";

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

describe("latteStaticFileIncludes", () => {
  it("returns quoted and bare static file targets with exact path spans", () => {
    const source = [
      "{include 'parts/card.latte'}",
      "{include partials/@menu.latte}",
      '{include "plain-name"}',
    ].join("\n");

    expect(latteStaticFileIncludes(source)).toEqual([
      {
        arguments: [],
        path: "parts/card.latte",
        pathSpan: spanOf(source, "parts/card.latte"),
      },
      {
        arguments: [],
        path: "partials/@menu.latte",
        pathSpan: spanOf(source, "partials/@menu.latte"),
      },
      {
        arguments: [],
        path: "plain-name",
        pathSpan: spanOf(source, "plain-name"),
      },
    ]);
  });

  it("returns all supported named argument forms with exact name/value spans", () => {
    const source =
      "{include 'card.latte', title => $title, 'tone' => 'quiet', size: 2 + 1}";

    expect(latteStaticFileIncludes(source)).toEqual([
      {
        arguments: [
          {
            name: "title",
            nameSpan: spanOf(source, "title"),
            value: "$title",
            valueSpan: spanOf(source, "$title"),
          },
          {
            name: "tone",
            nameSpan: spanOf(source, "tone"),
            value: "'quiet'",
            valueSpan: spanOf(source, "'quiet'"),
          },
          {
            name: "size",
            nameSpan: spanOf(source, "size"),
            value: "2 + 1",
            valueSpan: spanOf(source, "2 + 1"),
          },
        ],
        path: "card.latte",
        pathSpan: spanOf(source, "card.latte"),
      },
    ]);
  });

  it("keeps nested expressions, strings, comments, and their commas in values", () => {
    const source =
      "{include 'row.latte', " +
      "data: make([1, 2], fn ($x) => ['x' => $x, 'y' => \"},//\"]), " +
      "note => call(/* }, fake: 1, */ $a, ['k' => '{still string}'])}";
    const data = "make([1, 2], fn ($x) => ['x' => $x, 'y' => \"},//\"])";
    const note = "call(/* }, fake: 1, */ $a, ['k' => '{still string}'])";

    expect(latteStaticFileIncludes(source)[0]?.arguments).toEqual([
      {
        name: "data",
        nameSpan: spanOf(source, "data"),
        value: data,
        valueSpan: spanOf(source, data),
      },
      {
        name: "note",
        nameSpan: spanOf(source, "note"),
        value: note,
        valueSpan: spanOf(source, note),
      },
    ]);
  });

  it("supports the legacy whitespace before the first named argument", () => {
    const source = "{include 'submenu.latte' 'group' => $group}";

    expect(latteStaticFileIncludes(source)[0]?.arguments).toEqual([
      {
        name: "group",
        nameSpan: spanOf(source, "group"),
        value: "$group",
        valueSpan: spanOf(source, "$group"),
      },
    ]);
  });

  it("ignores block includes, positional arguments, and dynamic targets", () => {
    const source = [
      "{include sidebar}",
      "{include #sidebar}",
      "{include parent}",
      "{include $template, title: $title}",
      "{include ($mobile ? 'mobile.latte' : 'desktop.latte')}",
      "{include 'base.latte' . $suffix}",
      "{include \"{$kind}.latte\"}",
      "{include 'valid.latte', $positional, named: $value}",
    ].join("\n");

    expect(latteStaticFileIncludes(source)).toEqual([]);
  });

  it("ignores Latte comments, syntax-off regions, and escaped brace text", () => {
    const source = [
      "{* {include 'comment.latte', fake: 1} *}",
      "{syntax off}{include 'off.latte'}{/syntax}",
      "{l}include 'literal.latte'{r}",
      String.raw`\{include 'escaped.latte'}`,
      "{include 'live.latte'}",
    ].join("\n");

    expect(latteStaticFileIncludes(source)).toEqual([
      {
        arguments: [],
        path: "live.latte",
        pathSpan: spanOf(source, "live.latte"),
      },
    ]);
  });

  it("does not leak malformed macros into following valid includes", () => {
    const source = [
      "{include 'unclosed.latte', data: [1, 2}",
      "{include 'quote.latte, fake: 1}",
      "{include 'mismatch.latte', data: (1]}",
      "{include 'ok.latte', value: ['x' => 1]}",
    ].join("\n");

    expect(latteStaticFileIncludes(source)).toEqual([
      {
        arguments: [
          {
            name: "value",
            nameSpan: spanOf(source, "value"),
            value: "['x' => 1]",
            valueSpan: spanOf(source, "['x' => 1]"),
          },
        ],
        path: "ok.latte",
        pathSpan: spanOf(source, "ok.latte"),
      },
    ]);
  });

  it("recovers after an unterminated block comment at the next line", () => {
    const source =
      '{include "bad.latte", data: /*\n{include "ok.latte"}';

    expect(latteStaticFileIncludes(source)).toEqual([
      {
        arguments: [],
        path: "ok.latte",
        pathSpan: spanOf(source, "ok.latte"),
      },
    ]);
  });

  it("bounds unterminated block comment recovery to its malformed line", () => {
    const sameLineDecoy = "{include 'same-line.latte'}";
    const commentBody = "x".repeat(8_000);
    const source = [
      `{include 'bad.latte', data: /* ${commentBody} ${sameLineDecoy}\r`,
      "{include 'after-comment.latte', answer: 42}",
    ].join("\n");

    expect(latteStaticFileIncludes(source)).toEqual([
      {
        arguments: [
          {
            name: "answer",
            nameSpan: spanOf(source, "answer"),
            value: "42",
            valueSpan: spanOf(source, "42"),
          },
        ],
        path: "after-comment.latte",
        pathSpan: spanOf(source, "after-comment.latte"),
      },
    ]);
  });

  it("keeps closed multiline block comments opaque during recovery", () => {
    const source = [
      "{include 'bad.latte', data: /* first line",
      "{include 'inside-comment.latte'}",
      "*/ {include 'after-closed-comment.latte'}",
    ].join("\n");

    expect(latteStaticFileIncludes(source)).toEqual([
      {
        arguments: [],
        path: "after-closed-comment.latte",
        pathSpan: spanOf(source, "after-closed-comment.latte"),
      },
    ]);
  });

  it("preserves exact spans around closed single-line block comments", () => {
    const source =
      "{include 'commented.latte', value: call(/* keep */ $item)}";
    const value = "call(/* keep */ $item)";

    expect(latteStaticFileIncludes(source)).toEqual([
      {
        arguments: [
          {
            name: "value",
            nameSpan: spanOf(source, "value"),
            value,
            valueSpan: spanOf(source, value),
          },
        ],
        path: "commented.latte",
        pathSpan: spanOf(source, "commented.latte"),
      },
    ]);
  });

  it("consumes malformed include ranges without discovering nested includes", () => {
    const source = [
      "{include 'broken-array.latte', data: [ " +
        "{include 'nested-array.latte'} {include 'nested-array-second.latte'}",
      "{include 'after-array.latte'}",
      `{include "broken quote {include 'nested-quote.latte'}`,
      "{include 'after-quote.latte', answer: 42}",
    ].join("\n");

    expect(latteStaticFileIncludes(source)).toEqual([
      {
        arguments: [],
        path: "after-array.latte",
        pathSpan: spanOf(source, "after-array.latte"),
      },
      {
        arguments: [
          {
            name: "answer",
            nameSpan: spanOf(source, "answer"),
            value: "42",
            valueSpan: spanOf(source, "42"),
          },
        ],
        path: "after-quote.latte",
        pathSpan: spanOf(source, "after-quote.latte"),
      },
    ]);
  });

  it("stays structurally bounded across an 8k malformed include", () => {
    const malformedBody = "[".repeat(8_000);
    const source = [
      `{include 'broken.latte', data: ${malformedBody}{include 'nested.latte'}`,
      "{include 'after-large.latte', value: ['ok' => true]}",
    ].join("\n");

    expect(latteStaticFileIncludes(source)).toEqual([
      {
        arguments: [
          {
            name: "value",
            nameSpan: spanOf(source, "value"),
            value: "['ok' => true]",
            valueSpan: spanOf(source, "['ok' => true]"),
          },
        ],
        path: "after-large.latte",
        pathSpan: spanOf(source, "after-large.latte"),
      },
    ]);
  });

  it("skips include-looking text inside every non-include Latte tag range", () => {
    const source = [
      `{if check("{include 'if-string.latte'}", [1, 2])}`,
      `{var $sample = '{include \'var-string.latte\'}'}`,
      "{foreach /* {include 'comment.latte'} */ $rows as $row}",
      "{$value ?? \"{include 'echo-string.latte'}\"}",
      "{include 'top-level.latte'}",
    ].join("\n");

    expect(latteStaticFileIncludes(source)).toEqual([
      {
        arguments: [],
        path: "top-level.latte",
        pathSpan: spanOf(source, "top-level.latte"),
      },
    ]);
  });

  it("skips malformed non-include tags without exposing nested include text", () => {
    const source = [
      "{if [ {include 'nested-in-if.latte'}",
      "{include 'after-if.latte'}",
    ].join("\n");

    expect(latteStaticFileIncludes(source)).toEqual([
      {
        arguments: [],
        path: "after-if.latte",
        pathSpan: spanOf(source, "after-if.latte"),
      },
    ]);
  });

  it("accepts a filter-only include without treating the filter as an argument", () => {
    const source = "{include 'x.latte' |stripHtml}";

    expect(latteStaticFileIncludes(source)).toEqual([
      {
        arguments: [],
        path: "x.latte",
        pathSpan: spanOf(source, "x.latte"),
      },
    ]);
  });

  it("cuts filters from the final value span but preserves nested pipes", () => {
    const source =
      `{include 'x.latte', data: combine(($left | $right), "a|b"), ` +
      `visible: ($a || $b) |stripHtml}`;
    const data = `combine(($left | $right), "a|b")`;
    const visible = "($a || $b)";

    expect(latteStaticFileIncludes(source)[0]?.arguments).toEqual([
      {
        name: "data",
        nameSpan: spanOf(source, "data"),
        value: data,
        valueSpan: spanOf(source, data),
      },
      {
        name: "visible",
        nameSpan: spanOf(source, "visible"),
        value: visible,
        valueSpan: spanOf(source, visible),
      },
    ]);
  });

  it("ignores incomplete and malformed named arguments conservatively", () => {
    const source = "{include 'card.latte', missing:, nope, good: foo(1, 2)}";

    expect(latteStaticFileIncludes(source)[0]?.arguments).toEqual([
      {
        name: "good",
        nameSpan: spanOf(source, "good"),
        value: "foo(1, 2)",
        valueSpan: spanOf(source, "foo(1, 2)"),
      },
    ]);
  });
});
