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

  describe("multiline continuation safety", () => {
    it("does nothing when the caret line is an array key/value continuation", () => {
      const preceding = "$config = [\n";
      const result = completePhpStatement("    'name' => $value", 21, preceding);

      expect(result).toBeNull();
    });

    it("does nothing when the caret sits inside an unclosed array from a prior line", () => {
      const preceding = "$config = [\n    'a' => 1,\n";
      const result = completePhpStatement("    'b' => 2", 13, preceding);

      expect(result).toBeNull();
    });

    it("does nothing when the caret sits inside an unclosed call from a prior line", () => {
      const preceding = "$result = collect([\n";
      const result = completePhpStatement("    1, 2, 3", 12, preceding);

      expect(result).toBeNull();
    });

    it("does not close a closure brace opened on the caret line", () => {
      const result = completePhpStatement("$x = function () {", 19, "");

      expect(result).toBeNull();
    });

    it("does not close a match body opened on the caret line", () => {
      const result = completePhpStatement("$result = match($x) {", 22, "");

      expect(result).toBeNull();
    });

    it("does not terminate a match arm continuation inside an unclosed match", () => {
      const preceding = "$result = match($x) {\n";
      const result = completePhpStatement("    1 => 'a',", 14, preceding);

      expect(result).toBeNull();
    });

    it("does not terminate a string-keyed match arm continuation", () => {
      const preceding = "$result = match($x) {\n";
      const result = completePhpStatement("    'one' => 'a'", 17, preceding);

      expect(result).toBeNull();
    });

    it("does nothing for a line that merely ends with a comma continuation", () => {
      const result = completePhpStatement("$callback(1, 2,", 16, "");

      expect(result).toBeNull();
    });

    it("does nothing for a line that ends with a fat-arrow continuation", () => {
      const result = completePhpStatement("    'name' =>", 14, "$arr = [");

      expect(result).toBeNull();
    });

    it("still terminates a balanced single-line statement when preceding code is balanced", () => {
      const preceding = "$config = [\n    'a' => 1,\n];\n";
      const result = completePhpStatement("$x = 5", 7, preceding);

      expect(result).toEqual({
        caretColumn: 8,
        kind: "replaceLine",
        newText: "$x = 5;",
      });
    });

    it("still closes a balanced single-line call when preceding code is balanced", () => {
      const result = completePhpStatement("foo(1, 2", 9, "$ready = true;\n");

      expect(result).toEqual({
        caretColumn: 11,
        kind: "replaceLine",
        newText: "foo(1, 2);",
      });
    });

    it("still opens a control block when preceding code is balanced", () => {
      const result = completePhpStatement("if ($x)", 8, "$ready = true;\n");

      expect(result).toEqual({
        indent: "",
        kind: "insertBlock",
        keepHeader: "if ($x) {",
      });
    });

    it("ignores stray brackets inside a preceding line `//` comment", () => {
      const preceding = "$x = foo(); // see array[0\n";
      const result = completePhpStatement("$y = 1", 7, preceding);

      expect(result).toEqual({
        caretColumn: 8,
        kind: "replaceLine",
        newText: "$y = 1;",
      });
    });

    it("ignores stray brackets inside a preceding line `#` comment", () => {
      const preceding = "$x = 1; # TODO handle ( case\n";
      const result = completePhpStatement("$y = 2", 7, preceding);

      expect(result).toEqual({
        caretColumn: 8,
        kind: "replaceLine",
        newText: "$y = 2;",
      });
    });

    it("ignores brackets inside a preceding single-line string literal", () => {
      const preceding = '$label = "items[ (count)";\n';
      const result = completePhpStatement("$y = 3", 7, preceding);

      expect(result).toEqual({
        caretColumn: 8,
        kind: "replaceLine",
        newText: "$y = 3;",
      });
    });
  });

  describe("heredoc / nowdoc safety", () => {
    it("declines on a top-level heredoc opener line (would terminate the opener)", () => {
      const result = completePhpStatement("$x = <<<EOT", 12, "");

      expect(result).toBeNull();
    });

    it("declines on a top-level nowdoc opener line", () => {
      const result = completePhpStatement("$x = <<<'EOT'", 14, "");

      expect(result).toBeNull();
    });

    it("declines on a heredoc body line (would inject `;` into string content)", () => {
      const preceding = "$x = <<<EOT\n";
      const result = completePhpStatement("heredoc body line", 18, preceding);

      expect(result).toBeNull();
    });

    it("declines on a heredoc body line that holds an unbalanced call", () => {
      const preceding = "$x = <<<EOT\n";
      const result = completePhpStatement("call(arg in body", 17, preceding);

      expect(result).toBeNull();
    });

    it("declines on a nowdoc body line", () => {
      const preceding = "$x = <<<'EOT'\n";
      const result = completePhpStatement("nowdoc body $not->interpolated", 31, preceding);

      expect(result).toBeNull();
    });

    it("declines on an in-method heredoc opener line", () => {
      const preceding = "class Foo {\n    public function bar() {\n";
      const result = completePhpStatement("        $sql = <<<SQL", 22, preceding);

      expect(result).toBeNull();
    });

    it("declines on an in-method heredoc body line", () => {
      const preceding =
        "class Foo {\n    public function bar() {\n        $sql = <<<SQL\n";
      const result = completePhpStatement("        SELECT * FROM users", 28, preceding);

      expect(result).toBeNull();
    });

    it("declines on the heredoc closing-identifier line", () => {
      const preceding = "$x = <<<EOT\nbody line\n";
      const result = completePhpStatement("EOT", 4, preceding);

      expect(result).toBeNull();
    });

    it("still completes a normal statement that follows a closed heredoc", () => {
      const preceding = "$x = <<<EOT\nbody line\nEOT;\n";
      const result = completePhpStatement("$y = 5", 7, preceding);

      expect(result).toEqual({
        caretColumn: 8,
        kind: "replaceLine",
        newText: "$y = 5;",
      });
    });

    it("ignores a `<<<` mention inside a preceding line comment", () => {
      const preceding = "$x = 1; // not a heredoc <<<EOT\n";
      const result = completePhpStatement("$y = 2", 7, preceding);

      expect(result).toEqual({
        caretColumn: 8,
        kind: "replaceLine",
        newText: "$y = 2;",
      });
    });

    it("declines when a real opener follows a `<<<` inside a string on the same line", () => {
      const result = completePhpStatement("$a = '<<<FAKE'; $b = <<<SQL", 28, "");

      expect(result).toBeNull();
    });

    it("ignores a `<<<` that only appears inside a string literal (no real opener)", () => {
      const result = completePhpStatement("$label = 'see <<<NOTE here'", 28, "");

      expect(result).toEqual({
        caretColumn: 29,
        kind: "replaceLine",
        newText: "$label = 'see <<<NOTE here';",
      });
    });
  });
});
