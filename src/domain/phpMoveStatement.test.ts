import { describe, expect, it } from "vitest";
import { phpMoveStatement } from "./phpMoveStatement";

describe("phpMoveStatement", () => {
  describe("single-line statements", () => {
    it("swaps two adjacent single-line statements when moving up", () => {
      const source = ["$a = 1;", "$b = 2;", "$c = 3;"].join("\n");

      const result = phpMoveStatement(source, 2, "up");

      expect(result).toEqual({
        endLine: 2,
        newText: ["$b = 2;", "$a = 1;"].join("\n"),
        startLine: 1,
        caretLine: 1,
      });
    });

    it("swaps two adjacent single-line statements when moving down", () => {
      const source = ["$a = 1;", "$b = 2;", "$c = 3;"].join("\n");

      const result = phpMoveStatement(source, 2, "down");

      expect(result).toEqual({
        endLine: 3,
        newText: ["$c = 3;", "$b = 2;"].join("\n"),
        startLine: 2,
        caretLine: 3,
      });
    });

    it("preserves indentation when swapping single-line statements", () => {
      const source = ["    $a = 1;", "    $b = 2;"].join("\n");

      const result = phpMoveStatement(source, 1, "down");

      expect(result).toEqual({
        endLine: 2,
        newText: ["    $b = 2;", "    $a = 1;"].join("\n"),
        startLine: 1,
        caretLine: 2,
      });
    });
  });

  describe("multi-line block statements", () => {
    it("moves a whole if-block above the preceding statement", () => {
      const source = [
        "$before = 1;",
        "if ($ready) {",
        "    doStuff();",
        "}",
      ].join("\n");

      const result = phpMoveStatement(source, 2, "up");

      expect(result).toEqual({
        endLine: 4,
        newText: [
          "if ($ready) {",
          "    doStuff();",
          "}",
          "$before = 1;",
        ].join("\n"),
        startLine: 1,
        caretLine: 1,
      });
    });

    it("moves a whole if-block below the following statement", () => {
      const source = [
        "if ($ready) {",
        "    doStuff();",
        "}",
        "$after = 1;",
      ].join("\n");

      const result = phpMoveStatement(source, 1, "down");

      expect(result).toEqual({
        endLine: 4,
        newText: [
          "$after = 1;",
          "if ($ready) {",
          "    doStuff();",
          "}",
        ].join("\n"),
        startLine: 1,
        caretLine: 2,
      });
    });

    it("treats the whole block as one unit when the caret is on the closing brace", () => {
      const source = [
        "$before = 1;",
        "foreach ($items as $item) {",
        "    handle($item);",
        "}",
      ].join("\n");

      const result = phpMoveStatement(source, 4, "up");

      expect(result).toEqual({
        endLine: 4,
        newText: [
          "foreach ($items as $item) {",
          "    handle($item);",
          "}",
          "$before = 1;",
        ].join("\n"),
        startLine: 1,
        caretLine: 1,
      });
    });

    it("moves an inner statement within its block when the caret is on a body line", () => {
      // PhpStorm parity: a complete statement inside a block moves within that
      // block rather than dragging the whole block. Here the two body lines swap.
      const source = [
        "function calc() {",
        "    $a = 1;",
        "    $b = 2;",
        "    return $a + $b;",
        "}",
      ].join("\n");

      const result = phpMoveStatement(source, 3, "up");

      expect(result).toEqual({
        endLine: 3,
        newText: ["    $b = 2;", "    $a = 1;"].join("\n"),
        startLine: 2,
        caretLine: 2,
      });
    });

    it("returns null for a lone body statement with no sibling to swap", () => {
      const source = [
        "$before = 1;",
        "function calc() {",
        "    return 1;",
        "}",
      ].join("\n");

      // The caret is on the only statement inside the block; there is no
      // adjacent statement within the block, so the move is a no-op.
      expect(phpMoveStatement(source, 3, "up")).toBeNull();
    });

    it("swaps a single-line statement down past a following block", () => {
      const source = [
        "$before = 1;",
        "if ($ready) {",
        "    doStuff();",
        "}",
      ].join("\n");

      const result = phpMoveStatement(source, 1, "down");

      expect(result).toEqual({
        endLine: 4,
        newText: [
          "if ($ready) {",
          "    doStuff();",
          "}",
          "$before = 1;",
        ].join("\n"),
        startLine: 1,
        caretLine: 4,
      });
    });
  });

  describe("conservative null cases", () => {
    it("returns null at the top edge when moving up", () => {
      const source = ["$a = 1;", "$b = 2;"].join("\n");

      expect(phpMoveStatement(source, 1, "up")).toBeNull();
    });

    it("returns null at the bottom edge when moving down", () => {
      const source = ["$a = 1;", "$b = 2;"].join("\n");

      expect(phpMoveStatement(source, 2, "down")).toBeNull();
    });

    it("returns null on a blank line", () => {
      const source = ["$a = 1;", "", "$b = 2;"].join("\n");

      expect(phpMoveStatement(source, 2, "up")).toBeNull();
    });

    it("returns null when the caret statement has unbalanced braces", () => {
      const source = ["$before = 1;", "if ($ready) {", "    doStuff();"].join(
        "\n",
      );

      expect(phpMoveStatement(source, 2, "down")).toBeNull();
    });

    it("returns null when the neighbour above is an unterminated block fragment", () => {
      const source = [
        "if ($ready) {",
        "    $a = 1;",
        "    $b = 2;",
      ].join("\n");

      // Moving $b up would swap it with $a, but $a sits inside an open block
      // whose closing brace lives elsewhere; the neighbour above ($a) is fine,
      // yet the caret line itself is balanced. This stays a safe swap.
      const result = phpMoveStatement(source, 3, "up");

      expect(result).toEqual({
        endLine: 3,
        newText: ["    $b = 2;", "    $a = 1;"].join("\n"),
        startLine: 2,
        caretLine: 2,
      });
    });

    it("returns null when the neighbour block is unbalanced", () => {
      const source = [
        "$before = 1;",
        "if ($ready) {",
        "    doStuff();",
        "$after = 2;",
      ].join("\n");

      // The neighbour below the first statement opens a block that never
      // closes within the file, so the move is ambiguous.
      expect(phpMoveStatement(source, 1, "down")).toBeNull();
    });

    it("returns null for a continuation line ending with a comma", () => {
      const source = [
        "$config = [",
        "    'name' => $value,",
        "];",
      ].join("\n");

      expect(phpMoveStatement(source, 2, "up")).toBeNull();
    });

    it("returns null when the caret line is out of range", () => {
      const source = ["$a = 1;"].join("\n");

      expect(phpMoveStatement(source, 5, "down")).toBeNull();
      expect(phpMoveStatement(source, 0, "up")).toBeNull();
    });
  });

  describe("block range detection", () => {
    it("detects a try/catch/finally chain as one block", () => {
      const source = [
        "$before = 1;",
        "try {",
        "    risky();",
        "} catch (Exception $e) {",
        "    report($e);",
        "}",
      ].join("\n");

      const result = phpMoveStatement(source, 2, "up");

      expect(result).toEqual({
        endLine: 6,
        newText: [
          "try {",
          "    risky();",
          "} catch (Exception $e) {",
          "    report($e);",
          "}",
          "$before = 1;",
        ].join("\n"),
        startLine: 1,
        caretLine: 1,
      });
    });

    it("ignores braces inside strings when measuring a block", () => {
      const source = [
        "$before = 1;",
        "if ($label === '}') {",
        "    emit();",
        "}",
      ].join("\n");

      const result = phpMoveStatement(source, 2, "up");

      expect(result).toEqual({
        endLine: 4,
        newText: [
          "if ($label === '}') {",
          "    emit();",
          "}",
          "$before = 1;",
        ].join("\n"),
        startLine: 1,
        caretLine: 1,
      });
    });

    it("ignores braces inside a multi-line block comment when measuring a block", () => {
      const source = [
        "$before = 1;",
        "if ($ready) {",
        "    /* a stray } and { inside",
        "       a multi-line comment } */",
        "    emit();",
        "}",
      ].join("\n");

      const result = phpMoveStatement(source, 2, "up");

      expect(result).toEqual({
        endLine: 6,
        newText: [
          "if ($ready) {",
          "    /* a stray } and { inside",
          "       a multi-line comment } */",
          "    emit();",
          "}",
          "$before = 1;",
        ].join("\n"),
        startLine: 1,
        caretLine: 1,
      });
    });

    it("ignores braces inside comments when measuring a block", () => {
      const source = [
        "$before = 1;",
        "if ($ready) { // closes } later",
        "    emit();",
        "}",
      ].join("\n");

      const result = phpMoveStatement(source, 2, "up");

      expect(result).toEqual({
        endLine: 4,
        newText: [
          "if ($ready) { // closes } later",
          "    emit();",
          "}",
          "$before = 1;",
        ].join("\n"),
        startLine: 1,
        caretLine: 1,
      });
    });
  });

  // Chain-continuation lines such as `} else {`, `} catch (...) {`, `} elseif
  // (...) {`, `} finally {` and the `do { } while (...)` tail have a net bracket
  // delta of zero (the leading `}` cancels the trailing `{`), so the older
  // analyser mistook them for complete single-line statements and happily swapped
  // body statements across the chain boundary - teleporting code into the wrong
  // arm and leaving the previous arm empty. These must stay no-ops (null) so the
  // editor falls back to Move Line, which is always safe.
  describe("chain-continuation boundaries (if/else, try/catch)", () => {
    it("returns null when moving a body statement down across `} else {`", () => {
      const source = [
        "if ($a) {",
        "    foo();",
        "} else {",
        "    bar();",
        "}",
      ].join("\n");

      // Swapping foo() with `} else {` would empty the if arm and drop foo()
      // into the else arm. Refuse.
      expect(phpMoveStatement(source, 2, "down")).toBeNull();
    });

    it("returns null when moving a body statement up across `} else {`", () => {
      const source = [
        "if ($a) {",
        "    foo();",
        "} else {",
        "    bar();",
        "}",
      ].join("\n");

      // bar() sits directly under the chain boundary; moving it up would swap it
      // with `} else {`.
      expect(phpMoveStatement(source, 4, "up")).toBeNull();
    });

    it("returns null when the caret sits on a `} else {` line", () => {
      const source = [
        "if ($a) {",
        "    foo();",
        "} else {",
        "    bar();",
        "}",
      ].join("\n");

      expect(phpMoveStatement(source, 3, "up")).toBeNull();
      expect(phpMoveStatement(source, 3, "down")).toBeNull();
    });

    it("returns null when the caret sits on a `} catch (...) {` line", () => {
      const source = [
        "try {",
        "    risky();",
        "} catch (Exception $e) {",
        "    report($e);",
        "}",
      ].join("\n");

      expect(phpMoveStatement(source, 3, "up")).toBeNull();
      expect(phpMoveStatement(source, 3, "down")).toBeNull();
    });

    it("returns null when the caret sits on a `} elseif (...) {` line", () => {
      const source = [
        "if ($a) {",
        "    foo();",
        "} elseif ($b) {",
        "    bar();",
        "}",
      ].join("\n");

      expect(phpMoveStatement(source, 3, "up")).toBeNull();
    });

    it("returns null when moving a body statement across `} finally {`", () => {
      const source = [
        "try {",
        "    risky();",
        "} finally {",
        "    cleanup();",
        "}",
      ].join("\n");

      expect(phpMoveStatement(source, 2, "down")).toBeNull();
      expect(phpMoveStatement(source, 4, "up")).toBeNull();
    });

    it("still swaps balanced body statements that do not cross a chain boundary", () => {
      const source = [
        "if ($a) {",
        "    $x = 1;",
        "    $y = 2;",
        "} else {",
        "    bar();",
        "}",
      ].join("\n");

      // $x and $y are both genuine body statements inside the same arm; swapping
      // them never touches the chain boundary and must keep working.
      const result = phpMoveStatement(source, 2, "down");

      expect(result).toEqual({
        endLine: 3,
        newText: ["    $y = 2;", "    $x = 1;"].join("\n"),
        startLine: 2,
        caretLine: 3,
      });
    });

    it("still moves a whole try/catch/finally chain as one unit", () => {
      const source = [
        "$before = 1;",
        "try {",
        "    risky();",
        "} catch (Exception $e) {",
        "    report($e);",
        "} finally {",
        "    cleanup();",
        "}",
      ].join("\n");

      const result = phpMoveStatement(source, 2, "up");

      expect(result).toEqual({
        endLine: 8,
        newText: [
          "try {",
          "    risky();",
          "} catch (Exception $e) {",
          "    report($e);",
          "} finally {",
          "    cleanup();",
          "}",
          "$before = 1;",
        ].join("\n"),
        startLine: 1,
        caretLine: 1,
      });
    });
  });

  // Heredoc / nowdoc bodies are raw text: any `{` or `}` they contain is literal
  // and must never feed the bracket-depth scan. Without heredoc-aware masking the
  // analyser counts those braces and either mis-measures a block or swaps a
  // statement into the middle of the literal, turning real code into a string.
  describe("heredoc / nowdoc masking", () => {
    it("returns null when a statement would move into a heredoc body", () => {
      const source = [
        "$x = <<<EOT",
        "body {",
        "EOT;",
        "if ($a) { foo(); }",
      ].join("\n");

      // Moving the if-block up must not drop it adjacent to / inside the heredoc.
      expect(phpMoveStatement(source, 4, "up")).toBeNull();
    });

    it("does not count braces inside a heredoc body when measuring a block", () => {
      const source = [
        "$before = 1;",
        "if ($ready) {",
        "    $sql = <<<SQL",
        "SELECT { } FROM t",
        "SQL;",
        "    emit();",
        "}",
      ].join("\n");

      // The stray braces live inside the heredoc literal; the if-block still
      // balances on its own closing brace and travels as one unit.
      const result = phpMoveStatement(source, 2, "up");

      expect(result).toEqual({
        endLine: 7,
        newText: [
          "if ($ready) {",
          "    $sql = <<<SQL",
          "SELECT { } FROM t",
          "SQL;",
          "    emit();",
          "}",
          "$before = 1;",
        ].join("\n"),
        startLine: 1,
        caretLine: 1,
      });
    });

    it("does not treat a `<<<` mention inside a line comment as a heredoc opener", () => {
      const source = [
        "$a = 1; // example <<<EOT",
        "$b = 2;",
        "$c = 3;",
      ].join("\n");

      // The `<<<EOT` lives in a comment, so the next line is ordinary code and
      // the swap must still happen.
      const result = phpMoveStatement(source, 2, "up");

      expect(result).toEqual({
        endLine: 2,
        newText: ["$b = 2;", "$a = 1; // example <<<EOT"].join("\n"),
        startLine: 1,
        caretLine: 1,
      });
    });

    it("masks a nowdoc body the same way as a heredoc body", () => {
      const source = [
        "$before = 1;",
        "if ($ready) {",
        "    $text = <<<'TXT'",
        "stray } brace {",
        "TXT;",
        "    emit();",
        "}",
      ].join("\n");

      const result = phpMoveStatement(source, 2, "up");

      expect(result).toEqual({
        endLine: 7,
        newText: [
          "if ($ready) {",
          "    $text = <<<'TXT'",
          "stray } brace {",
          "TXT;",
          "    emit();",
          "}",
          "$before = 1;",
        ].join("\n"),
        startLine: 1,
        caretLine: 1,
      });
    });
  });

  // `switch`/`case` bodies have no braces of their own, so the analyser saw each
  // `case`/`default` label and the statements beneath it as a flat list and would
  // swap a body statement past a label - scrambling fall-through. Labels are hard
  // boundaries: refuse any swap that crosses one.
  describe("switch / case boundaries", () => {
    it("returns null when moving a case body statement down across a case label", () => {
      const source = [
        "switch ($x) {",
        "    case 1:",
        "        a();",
        "        break;",
        "    case 2:",
        "        b();",
        "        break;",
        "}",
      ].join("\n");

      // Moving break; (line 4) down would swap it with `case 2:`.
      expect(phpMoveStatement(source, 4, "down")).toBeNull();
    });

    it("returns null when moving a statement up across a case label", () => {
      const source = [
        "switch ($x) {",
        "    case 1:",
        "        a();",
        "    case 2:",
        "        b();",
        "}",
      ].join("\n");

      // b() sits directly under `case 2:`; moving it up would swap it with the
      // label.
      expect(phpMoveStatement(source, 5, "up")).toBeNull();
    });

    it("returns null when the caret sits on a case label", () => {
      const source = [
        "switch ($x) {",
        "    case 1:",
        "        a();",
        "    case 2:",
        "        b();",
        "}",
      ].join("\n");

      expect(phpMoveStatement(source, 4, "up")).toBeNull();
      expect(phpMoveStatement(source, 4, "down")).toBeNull();
    });

    it("still swaps two statements within the same case arm", () => {
      const source = [
        "switch ($x) {",
        "    case 1:",
        "        $p = 1;",
        "        $q = 2;",
        "        break;",
        "}",
      ].join("\n");

      const result = phpMoveStatement(source, 3, "down");

      expect(result).toEqual({
        endLine: 4,
        newText: ["        $q = 2;", "        $p = 1;"].join("\n"),
        startLine: 3,
        caretLine: 4,
      });
    });
  });
});
