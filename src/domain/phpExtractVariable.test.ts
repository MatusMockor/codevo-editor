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
});
