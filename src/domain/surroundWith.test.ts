import { describe, expect, it } from "vitest";
import {
  surroundWithSnippet,
  surroundWithTemplates,
  type SurroundWithTemplateId,
} from "./surroundWith";

describe("surroundWithSnippet", () => {
  it("exposes the supported templates in a stable order", () => {
    expect(surroundWithTemplates.map((template) => template.id)).toEqual([
      "if",
      "foreach",
      "for",
      "while",
      "try-catch",
      "try-finally",
    ]);
  });

  it("wraps a single line in an if block and re-indents the body one level", () => {
    const snippet = surroundWithSnippet({
      id: "if",
      indent: "",
      indentUnit: "    ",
      eol: "\n",
      text: "doStuff();",
    });

    expect(snippet).toBe(
      ["if (${1:condition}) {", "    doStuff();$0", "}"].join("\n"),
    );
  });

  it("preserves the indentation taken from the first selected line", () => {
    const snippet = surroundWithSnippet({
      id: "if",
      indent: "    ",
      indentUnit: "    ",
      eol: "\n",
      text: "doStuff();",
    });

    expect(snippet).toBe(
      [
        "    if (${1:condition}) {",
        "        doStuff();$0",
        "    }",
      ].join("\n"),
    );
  });

  it("re-indents every line of a multi-line selection", () => {
    const snippet = surroundWithSnippet({
      id: "if",
      indent: "",
      indentUnit: "    ",
      eol: "\n",
      text: "first();\nsecond();",
    });

    expect(snippet).toBe(
      [
        "if (${1:condition}) {",
        "    first();",
        "    second();$0",
        "}",
      ].join("\n"),
    );
  });

  it("keeps the relative indentation of nested selected lines", () => {
    const snippet = surroundWithSnippet({
      id: "if",
      indent: "",
      indentUnit: "    ",
      eol: "\n",
      text: "outer();\n    inner();",
    });

    expect(snippet).toBe(
      [
        "if (${1:condition}) {",
        "    outer();",
        "        inner();$0",
        "}",
      ].join("\n"),
    );
  });

  it("builds a PHP foreach block with item placeholders", () => {
    const snippet = surroundWithSnippet({
      id: "foreach",
      indent: "",
      indentUnit: "    ",
      eol: "\n",
      text: "echo $item;",
    });

    expect(snippet).toBe(
      [
        "foreach (${1:\\$items} as ${2:\\$item}) {",
        "    echo \\$item;$0",
        "}",
      ].join("\n"),
    );
  });

  it("builds a PHP for block with the standard clauses", () => {
    const snippet = surroundWithSnippet({
      id: "for",
      indent: "",
      indentUnit: "    ",
      eol: "\n",
      text: "doStuff();",
    });

    expect(snippet).toBe(
      [
        "for (${1:\\$i = 0}; ${2:\\$i < \\$count}; ${3:\\$i++}) {",
        "    doStuff();$0",
        "}",
      ].join("\n"),
    );
  });

  it("builds a PHP while block", () => {
    const snippet = surroundWithSnippet({
      id: "while",
      indent: "",
      indentUnit: "    ",
      eol: "\n",
      text: "doStuff();",
    });

    expect(snippet).toBe(
      ["while (${1:condition}) {", "    doStuff();$0", "}"].join("\n"),
    );
  });

  it("builds a PHP try/catch block with an exception placeholder", () => {
    const snippet = surroundWithSnippet({
      id: "try-catch",
      indent: "",
      indentUnit: "    ",
      eol: "\n",
      text: "doStuff();",
    });

    expect(snippet).toBe(
      [
        "try {",
        "    doStuff();",
        "} catch (${1:\\Exception} ${2:\\$e}) {",
        "    $0",
        "}",
      ].join("\n"),
    );
  });

  it("builds a PHP try/finally block", () => {
    const snippet = surroundWithSnippet({
      id: "try-finally",
      indent: "",
      indentUnit: "    ",
      eol: "\n",
      text: "doStuff();",
    });

    expect(snippet).toBe(
      ["try {", "    doStuff();", "} finally {", "    $0", "}"].join("\n"),
    );
  });

  it("honours a tab-based indent unit", () => {
    const snippet = surroundWithSnippet({
      id: "if",
      indent: "\t",
      indentUnit: "\t",
      eol: "\n",
      text: "doStuff();",
    });

    expect(snippet).toBe(
      ["\tif (${1:condition}) {", "\t\tdoStuff();$0", "\t}"].join("\n"),
    );
  });

  it("honours a custom end-of-line sequence", () => {
    const snippet = surroundWithSnippet({
      id: "if",
      indent: "",
      indentUnit: "    ",
      eol: "\r\n",
      text: "first();\r\nsecond();",
    });

    expect(snippet).toBe(
      [
        "if (${1:condition}) {",
        "    first();",
        "    second();$0",
        "}",
      ].join("\r\n"),
    );
  });

  it("escapes dollar signs in the selected text so they survive snippet expansion", () => {
    const snippet = surroundWithSnippet({
      id: "if",
      indent: "",
      indentUnit: "    ",
      eol: "\n",
      text: "$total = $price * 2;",
    });

    expect(snippet).toBe(
      [
        "if (${1:condition}) {",
        "    \\$total = \\$price * 2;$0",
        "}",
      ].join("\n"),
    );
  });

  it("escapes closing braces in the selected text", () => {
    const snippet = surroundWithSnippet({
      id: "if",
      indent: "",
      indentUnit: "    ",
      eol: "\n",
      text: "array_map(fn ($x) => $x, $items);",
    });

    expect(snippet).toContain("\\$items");
    expect(snippet).toContain("array_map(fn (\\$x) => \\$x, \\$items);");
  });

  it("treats empty selected text as a single empty body line", () => {
    const snippet = surroundWithSnippet({
      id: "if",
      indent: "",
      indentUnit: "    ",
      eol: "\n",
      text: "",
    });

    expect(snippet).toBe(["if (${1:condition}) {", "    $0", "}"].join("\n"));
  });

  it("rejects an unknown template id", () => {
    expect(() =>
      surroundWithSnippet({
        id: "switch" as unknown as SurroundWithTemplateId,
        indent: "",
        indentUnit: "    ",
        eol: "\n",
        text: "doStuff();",
      }),
    ).toThrow(/unknown surround-with template/i);
  });
});
