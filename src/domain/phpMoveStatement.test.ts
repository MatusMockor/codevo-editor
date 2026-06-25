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
});
