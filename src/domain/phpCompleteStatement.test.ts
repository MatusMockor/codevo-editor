import { describe, expect, it } from "vitest";

import { completePhpStatement } from "./phpCompleteStatement";

describe("completePhpStatement", () => {
  it("appends a semicolon to a bare assignment and moves the caret past it", () => {
    const result = completePhpStatement("$x = 5", 7);

    expect(result).toEqual({
      caretColumn: 8,
      kind: "replaceLine",
      newText: "$x = 5;",
    });
  });

  it("preserves leading indentation when appending a semicolon", () => {
    const result = completePhpStatement("    $name = $user->name", 24);

    expect(result).toEqual({
      caretColumn: 25,
      kind: "replaceLine",
      newText: "    $name = $user->name;",
    });
  });

  it("closes an unbalanced call paren before appending the semicolon", () => {
    const result = completePhpStatement("foo(1, 2", 9);

    expect(result).toEqual({
      caretColumn: 11,
      kind: "replaceLine",
      newText: "foo(1, 2);",
    });
  });

  it("closes nested unbalanced parens in order", () => {
    const result = completePhpStatement("foo(bar(1, 2", 13);

    expect(result).toEqual({
      caretColumn: 16,
      kind: "replaceLine",
      newText: "foo(bar(1, 2));",
    });
  });

  it("closes an unbalanced subscript without appending a semicolon", () => {
    const result = completePhpStatement("$arr[0", 7);

    expect(result).toEqual({
      caretColumn: 8,
      kind: "replaceLine",
      newText: "$arr[0]",
    });
  });

  it("closes a subscript and still terminates a trailing assignment", () => {
    const result = completePhpStatement("$value = $arr[0", 16);

    expect(result).toEqual({
      caretColumn: 18,
      kind: "replaceLine",
      newText: "$value = $arr[0];",
    });
  });

  it("does not invent a closing paren inside a string literal", () => {
    const result = completePhpStatement('$x = "a("', 10);

    expect(result).toEqual({
      caretColumn: 11,
      kind: "replaceLine",
      newText: '$x = "a(";',
    });
  });

  it("leaves an already terminated statement untouched", () => {
    expect(completePhpStatement("$x = 5;", 8)).toBeNull();
  });

  it("ignores a trailing line comment when terminating the statement", () => {
    const result = completePhpStatement("$x = 5 // total", 16);

    expect(result).toEqual({
      caretColumn: 8,
      kind: "replaceLine",
      newText: "$x = 5; // total",
    });
  });

  it("expands an if header into a block with the caret inside", () => {
    const result = completePhpStatement("if ($x)", 8);

    expect(result).toEqual({
      indent: "",
      kind: "insertBlock",
      keepHeader: "if ($x) {",
    });
  });

  it("closes an unbalanced condition before opening the if block", () => {
    const result = completePhpStatement("if ($x", 7);

    expect(result).toEqual({
      indent: "",
      kind: "insertBlock",
      keepHeader: "if ($x) {",
    });
  });

  it("expands a foreach header into a block", () => {
    const result = completePhpStatement("    foreach ($a as $b)", 23);

    expect(result).toEqual({
      indent: "    ",
      kind: "insertBlock",
      keepHeader: "    foreach ($a as $b) {",
    });
  });

  it("expands while and for headers into blocks", () => {
    expect(completePhpStatement("while ($ok)", 12)).toEqual({
      indent: "",
      kind: "insertBlock",
      keepHeader: "while ($ok) {",
    });

    expect(completePhpStatement("for ($i = 0; $i < 3; $i++)", 27)).toEqual({
      indent: "",
      kind: "insertBlock",
      keepHeader: "for ($i = 0; $i < 3; $i++) {",
    });
  });

  it("expands a function header into a block", () => {
    const result = completePhpStatement("function foo()", 15);

    expect(result).toEqual({
      indent: "",
      kind: "insertBlock",
      keepHeader: "function foo() {",
    });
  });

  it("expands an elseif header into a block", () => {
    const result = completePhpStatement("elseif ($y)", 12);

    expect(result).toEqual({
      indent: "",
      kind: "insertBlock",
      keepHeader: "elseif ($y) {",
    });
  });

  it("leaves a control header that already opens a block untouched", () => {
    expect(completePhpStatement("if ($x) {", 10)).toBeNull();
  });

  it("leaves an alternative-syntax control header ending in a colon untouched", () => {
    expect(completePhpStatement("if ($x):", 9)).toBeNull();
    expect(completePhpStatement("foreach ($a as $b):", 20)).toBeNull();
  });

  it("does not treat a method call named for() as a control header", () => {
    const result = completePhpStatement("$this->whilst(1", 16);

    expect(result).toEqual({
      caretColumn: 18,
      kind: "replaceLine",
      newText: "$this->whilst(1);",
    });
  });

  it("returns null for an empty or whitespace-only line", () => {
    expect(completePhpStatement("", 1)).toBeNull();
    expect(completePhpStatement("    ", 5)).toBeNull();
  });

  it("returns null when the statement is just a closing brace", () => {
    expect(completePhpStatement("}", 2)).toBeNull();
  });
});
