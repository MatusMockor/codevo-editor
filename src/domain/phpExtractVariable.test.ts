import { describe, expect, it } from "vitest";
import { planExtractVariable } from "./phpExtractVariable";

/**
 * Applies an extract-variable plan to the source so tests can assert on the
 * resulting code rather than only on raw offsets.
 *
 * All plan offsets are expressed in the ORIGINAL document coordinate space, so
 * the two edits (insert declaration, replace selection) are applied highest
 * offset first. That keeps the lower offsets valid no matter the relative
 * ordering of the two edit regions — the standard non-overlapping-edit
 * application strategy an editor adapter would use.
 */
function applyPlan(
  source: string,
  plan: NonNullable<ReturnType<typeof planExtractVariable>>,
): string {
  const replaceEdit = {
    start: plan.replaceStart,
    end: plan.replaceEnd,
    text: plan.replacementText,
  };
  const declarationEdit = {
    start: plan.declarationOffset,
    end: plan.declarationOffset,
    text: plan.declarationText,
  };

  return [replaceEdit, declarationEdit]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, edit) =>
        current.slice(0, edit.start) + edit.text + current.slice(edit.end),
      source,
    );
}

function offsetsOf(source: string, expression: string): [number, number] {
  const start = source.indexOf(expression);

  if (start < 0) {
    throw new Error(`expression not found in source: ${expression}`);
  }

  return [start, start + expression.length];
}

describe("planExtractVariable", () => {
  it("extracts a simple arithmetic expression", () => {
    const source = "<?php\n$total = 1 + 2;\n";
    const [start, end] = offsetsOf(source, "1 + 2");

    const plan = planExtractVariable(source, start, end);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toBe(
      "<?php\n$extracted = 1 + 2;\n$total = $extracted;\n",
    );
  });

  it("extracts a method chain", () => {
    const source =
      "<?php\nfunction handle() {\n    $name = $user->getProfile()->getName();\n}\n";
    const [start, end] = offsetsOf(source, "$user->getProfile()->getName()");

    const plan = planExtractVariable(source, start, end);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toBe(
      "<?php\nfunction handle() {\n" +
        "    $extracted = $user->getProfile()->getName();\n" +
        "    $name = $extracted;\n}\n",
    );
  });

  it("extracts the right-hand side of an assignment", () => {
    const source = "<?php\n$x = config('app.name');\n";
    const [start, end] = offsetsOf(source, "config('app.name')");

    const plan = planExtractVariable(source, start, end);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toBe(
      "<?php\n$extracted = config('app.name');\n$x = $extracted;\n",
    );
  });

  it("preserves the indentation of the enclosing statement", () => {
    const source =
      "<?php\nclass A {\n    public function b() {\n        return 1 + 2;\n    }\n}\n";
    const [start, end] = offsetsOf(source, "1 + 2");

    const plan = planExtractVariable(source, start, end);

    expect(plan).not.toBeNull();
    expect(plan!.declarationText).toBe("        $extracted = 1 + 2;\n");
    expect(applyPlan(source, plan!)).toBe(
      "<?php\nclass A {\n    public function b() {\n" +
        "        $extracted = 1 + 2;\n" +
        "        return $extracted;\n    }\n}\n",
    );
  });

  it("replaces the selection with the variable reference", () => {
    const source = "<?php\n$total = 1 + 2;\n";
    const [start, end] = offsetsOf(source, "1 + 2");

    const plan = planExtractVariable(source, start, end);

    expect(plan).not.toBeNull();
    expect(plan!.replacementText).toBe("$extracted");
    expect(plan!.replaceStart).toBe(start);
    expect(plan!.replaceEnd).toBe(end);
  });

  it("inserts the declaration at the start of the statement line", () => {
    const source = "<?php\n$total = 1 + 2;\n";
    const [start] = offsetsOf(source, "1 + 2");

    const plan = planExtractVariable(source, start, start + "1 + 2".length);

    expect(plan).not.toBeNull();
    // Declaration is inserted at the start of the line containing the selection.
    expect(plan!.declarationOffset).toBe(source.indexOf("$total"));
    expect(plan!.declarationText).toBe("$extracted = 1 + 2;\n");
  });

  it("uses a custom variable name when provided", () => {
    const source = "<?php\n$total = 1 + 2;\n";
    const [start, end] = offsetsOf(source, "1 + 2");

    const plan = planExtractVariable(source, start, end, "$sum");

    expect(plan).not.toBeNull();
    expect(plan!.declarationText).toBe("$sum = 1 + 2;\n");
    expect(plan!.replacementText).toBe("$sum");
  });

  it("normalizes a custom variable name without a leading dollar sign", () => {
    const source = "<?php\n$total = 1 + 2;\n";
    const [start, end] = offsetsOf(source, "1 + 2");

    const plan = planExtractVariable(source, start, end, "sum");

    expect(plan).not.toBeNull();
    expect(plan!.replacementText).toBe("$sum");
  });

  it("returns null for an empty selection", () => {
    const source = "<?php\n$total = 1 + 2;\n";
    const start = source.indexOf("1 + 2");

    expect(planExtractVariable(source, start, start)).toBeNull();
  });

  it("returns null for a whitespace-only selection", () => {
    const source = "<?php\n$total = 1 + 2;\n";
    const start = source.indexOf(" + ");

    expect(planExtractVariable(source, start, start + 3)).toBeNull();
  });

  it("returns null when the selection contains a statement terminator", () => {
    const source = "<?php\n$a = 1; $b = 2;\n";
    const [start, end] = offsetsOf(source, "1; $b = 2");

    expect(planExtractVariable(source, start, end)).toBeNull();
  });

  it("returns null when the selection has unbalanced parentheses", () => {
    const source = "<?php\n$x = foo(1, 2);\n";
    const [start, end] = offsetsOf(source, "foo(1, 2");

    expect(planExtractVariable(source, start, end)).toBeNull();
  });

  it("returns null when the selection has unbalanced brackets", () => {
    const source = "<?php\n$x = $items[0];\n";
    const [start, end] = offsetsOf(source, "$items[0");

    expect(planExtractVariable(source, start, end)).toBeNull();
  });

  it("allows a string literal that contains a semicolon", () => {
    const source = "<?php\n$x = 'a;b';\n";
    const [start, end] = offsetsOf(source, "'a;b'");

    const plan = planExtractVariable(source, start, end);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toBe(
      "<?php\n$extracted = 'a;b';\n$x = $extracted;\n",
    );
  });

  it("returns null for out-of-range offsets", () => {
    const source = "<?php\n$x = 1;\n";

    expect(planExtractVariable(source, -1, 3)).toBeNull();
    expect(planExtractVariable(source, 3, source.length + 10)).toBeNull();
    expect(planExtractVariable(source, 8, 4)).toBeNull();
  });

  it("returns null when the selection trims down to nothing usable", () => {
    const source = "<?php\n$total = 1 + 2;\n";
    const eq = source.indexOf("=");

    // Selecting just an operator is not a usable expression.
    expect(planExtractVariable(source, eq, eq + 1)).toBeNull();
  });

  describe("trailing operator guard", () => {
    it("returns null for a selection ending with a binary plus", () => {
      // Corruption: "$extracted = $a +;" / "$r = $extracted $b;" (syntax error).
      const source = "<?php\n$r = $a + $b;\n";
      const [start, end] = offsetsOf(source, "$a +");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });

    it("returns null for a selection ending with a binary minus", () => {
      const source = "<?php\n$r = $a - $b;\n";
      const [start, end] = offsetsOf(source, "$a -");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });

    it("returns null for a selection ending with an arrow accessor", () => {
      // Corruption: "$extracted = $a->;" / "return $extractedb;"
      // (syntax error + identifier merge).
      const source = "<?php\nreturn $a->b;\n";
      const [start, end] = offsetsOf(source, "$a->");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });

    it("returns null for a selection ending with a null-coalescing operator", () => {
      const source = "<?php\n$r = $a ?? $b;\n";
      const [start, end] = offsetsOf(source, "$a ??");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });

    it("returns null for a selection ending with a concatenation dot", () => {
      const source = "<?php\n$r = $a . $b;\n";
      const [start, end] = offsetsOf(source, "$a .");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });

    it("returns null for a selection ending with a nullsafe operator", () => {
      const source = "<?php\nreturn $a?->b;\n";
      const [start, end] = offsetsOf(source, "$a?->");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });

    it("returns null for a selection ending with a static accessor", () => {
      const source = "<?php\nreturn Foo::BAR;\n";
      const [start, end] = offsetsOf(source, "Foo::");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });
  });

  describe("leading operator guard", () => {
    it("returns null for a selection starting with a binary plus", () => {
      const source = "<?php\n$r = $a + $b;\n";
      const [start, end] = offsetsOf(source, "+ $b");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });

    it("returns null for a selection starting with a concatenation dot", () => {
      const source = "<?php\n$r = $a . $b;\n";
      const [start, end] = offsetsOf(source, ". $b");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });

    it("returns null for a selection starting with an arrow accessor", () => {
      const source = "<?php\nreturn $a->b;\n";
      const [start, end] = offsetsOf(source, "->b");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });

    it("extracts a selection starting with a unary logical-not prefix", () => {
      const source = "<?php\n$r = !$x;\n";
      const [start, end] = offsetsOf(source, "!$x");

      const plan = planExtractVariable(source, start, end);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\n$extracted = !$x;\n$r = $extracted;\n",
      );
    });

    it("extracts a selection starting with a unary minus prefix", () => {
      const source = "<?php\n$r = -$x;\n";
      const [start, end] = offsetsOf(source, "-$x");

      const plan = planExtractVariable(source, start, end);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\n$extracted = -$x;\n$r = $extracted;\n",
      );
    });
  });

  describe("precedence safety", () => {
    it("returns null when a lower-precedence selection is masked by a higher-precedence neighbour", () => {
      // Original parses as ($base + $a) ?? $b. Extracting "$a ?? $b" would
      // silently re-parse to $base + ($a ?? $b): a behaviour change.
      const source = "<?php\n$r = $base + $a ?? $b;\n";
      const [start, end] = offsetsOf(source, "$a ?? $b");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });

    it("returns null when an additive selection is masked by a multiplicative neighbour", () => {
      // Original parses as $base * ($a + $b)? No: as ($base * $a) + ... no.
      // $base * $a + $b parses as ($base * $a) + $b; selecting "$a + $b"
      // changes it to $base * ($a + $b).
      const source = "<?php\n$r = $base * $a + $b;\n";
      const [start, end] = offsetsOf(source, "$a + $b");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });

    it("extracts a complete additive expression that spans the whole right-hand side", () => {
      const source = "<?php\n$r = $a + $b;\n";
      const [start, end] = offsetsOf(source, "$a + $b");

      const plan = planExtractVariable(source, start, end);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\n$extracted = $a + $b;\n$r = $extracted;\n",
      );
    });

    it("returns null when extracting the right operands of a left-associative subtraction chain", () => {
      // $a - $b - $c parses as ($a - $b) - $c. Extracting "$b - $c" would
      // re-associate it to $a - ($b - $c): a silent value change.
      const source = "<?php\n$r = $a - $b - $c;\n";
      const [start, end] = offsetsOf(source, "$b - $c");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });

    it("returns null when extracting the right operands of a left-associative division chain", () => {
      const source = "<?php\n$r = $a / $b / $c;\n";
      const [start, end] = offsetsOf(source, "$b / $c");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });

    it("extracts a higher-precedence selection surrounded by a lower-precedence neighbour", () => {
      // $base + $a * $b parses as $base + ($a * $b); extracting "$a * $b" is a
      // clean sub-expression and is safe.
      const source = "<?php\n$r = $base + $a * $b;\n";
      const [start, end] = offsetsOf(source, "$a * $b");

      const plan = planExtractVariable(source, start, end);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\n$extracted = $a * $b;\n$r = $base + $extracted;\n",
      );
    });

    it("extracts a bitwise-OR sub-expression that binds tighter than a logical-AND neighbour", () => {
      // $a && $b | $c parses as $a && ($b | $c) because `|` binds tighter than
      // `&&`; extracting "$b | $c" is a clean sub-expression and is safe.
      const source = "<?php\n$r = $a && $b | $c;\n";
      const [start, end] = offsetsOf(source, "$b | $c");

      const plan = planExtractVariable(source, start, end);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\n$extracted = $b | $c;\n$r = $a && $extracted;\n",
      );
    });

    it("returns null for a logical-AND sub-expression masked by a tighter bitwise-OR neighbour", () => {
      // $a | $b && $c parses as ($a | $b) && $c; extracting "$b && $c" would
      // re-parse it to $a | ($b && $c): a silent behaviour change.
      const source = "<?php\n$r = $a | $b && $c;\n";
      const [start, end] = offsetsOf(source, "$b && $c");

      expect(planExtractVariable(source, start, end)).toBeNull();
    });
  });

  describe("string-literal boundaries", () => {
    it("extracts a concatenation that ends with a single-quoted string", () => {
      const source = "<?php\n$x = $a . 'foo';\n";
      const [start, end] = offsetsOf(source, "$a . 'foo'");

      const plan = planExtractVariable(source, start, end);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\n$extracted = $a . 'foo';\n$x = $extracted;\n",
      );
    });

    it("extracts a concatenation that starts with a single-quoted string", () => {
      const source = "<?php\n$x = 'foo' . $a;\n";
      const [start, end] = offsetsOf(source, "'foo' . $a");

      const plan = planExtractVariable(source, start, end);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\n$extracted = 'foo' . $a;\n$x = $extracted;\n",
      );
    });

    it("extracts a concatenation that ends with a double-quoted string", () => {
      const source = '<?php\n$x = $a . "bar";\n';
      const [start, end] = offsetsOf(source, '$a . "bar"');

      const plan = planExtractVariable(source, start, end);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        '<?php\n$extracted = $a . "bar";\n$x = $extracted;\n',
      );
    });
  });

  describe("safe single primaries and complete expressions", () => {
    it("extracts a method call surrounded by operators", () => {
      const source = "<?php\n$r = 1 + $obj->method() + 2;\n";
      const [start, end] = offsetsOf(source, "$obj->method()");

      const plan = planExtractVariable(source, start, end);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\n$extracted = $obj->method();\n$r = 1 + $extracted + 2;\n",
      );
    });

    it("extracts a parenthesised group surrounded by operators", () => {
      const source = "<?php\n$r = 1 + ($x + $y) + 2;\n";
      const [start, end] = offsetsOf(source, "($x + $y)");

      const plan = planExtractVariable(source, start, end);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\n$extracted = ($x + $y);\n$r = 1 + $extracted + 2;\n",
      );
    });

    it("extracts a numeric literal surrounded by operators", () => {
      const source = "<?php\n$r = 1 + 42 * 3;\n";
      const [start, end] = offsetsOf(source, "42");

      const plan = planExtractVariable(source, start, end);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\n$extracted = 42;\n$r = 1 + $extracted * 3;\n",
      );
    });

    it("extracts a single variable surrounded by operators", () => {
      const source = "<?php\n$r = $base + $a * $b;\n";
      const [start, end] = offsetsOf(source, "$a");

      const plan = planExtractVariable(source, start, end);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\n$extracted = $a;\n$r = $base + $extracted * $b;\n",
      );
    });

    it("extracts an array literal surrounded by operators", () => {
      const source = "<?php\n$r = foo([1, 2, 3]);\n";
      const [start, end] = offsetsOf(source, "[1, 2, 3]");

      const plan = planExtractVariable(source, start, end);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\n$extracted = [1, 2, 3];\n$r = foo($extracted);\n",
      );
    });
  });
});
