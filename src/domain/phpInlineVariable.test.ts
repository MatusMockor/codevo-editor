import { describe, expect, it } from "vitest";
import { planInlineVariable } from "./phpInlineVariable";

/**
 * Applies an inline-variable plan to the source so tests can assert on the
 * resulting code rather than only on raw offsets.
 *
 * All plan edits are expressed in the ORIGINAL document coordinate space and are
 * non-overlapping, so they are applied highest-offset-first. That keeps the
 * lower offsets valid regardless of edit ordering, matching the strategy an
 * editor adapter uses for a multi-edit refactor.
 */
function applyPlan(
  source: string,
  plan: NonNullable<ReturnType<typeof planInlineVariable>>,
): string {
  return [...plan.edits]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, edit) =>
        current.slice(0, edit.start) + edit.text + current.slice(edit.end),
      source,
    );
}

function cursorOn(source: string, token: string): number {
  const index = source.indexOf(token);

  if (index < 0) {
    throw new Error(`token not found in source: ${token}`);
  }

  return index;
}

describe("planInlineVariable", () => {
  it("inlines a simple atom into a single usage and deletes the declaration", () => {
    const source =
      "<?php\nfunction handle() {\n    $name = $user->getName();\n    return $name;\n}\n";
    const offset = cursorOn(source, "$name");

    const plan = planInlineVariable(source, offset);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toBe(
      "<?php\nfunction handle() {\n    return $user->getName();\n}\n",
    );
  });

  it("inlines all usages of the variable in scope", () => {
    const source =
      "<?php\nfunction handle() {\n    $name = $user->name;\n    echo $name;\n    return $name;\n}\n";
    const offset = cursorOn(source, "$name");

    const plan = planInlineVariable(source, offset);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toBe(
      "<?php\nfunction handle() {\n    echo $user->name;\n    return $user->name;\n}\n",
    );
  });

  it("inlines a literal value into multiple usages", () => {
    const source =
      "<?php\nfunction handle() {\n    $limit = 10;\n    foo($limit);\n    bar($limit);\n}\n";
    const offset = cursorOn(source, "$limit");

    const plan = planInlineVariable(source, offset);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toBe(
      "<?php\nfunction handle() {\n    foo(10);\n    bar(10);\n}\n",
    );
  });

  it("works when the cursor is on a usage rather than the declaration", () => {
    const source =
      "<?php\nfunction handle() {\n    $name = $user->name;\n    return $name;\n}\n";
    const offset = source.lastIndexOf("$name");

    const plan = planInlineVariable(source, offset);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toBe(
      "<?php\nfunction handle() {\n    return $user->name;\n}\n",
    );
  });

  describe("parenthesization by precedence", () => {
    it("wraps a compound additive expression inlined into multiplication", () => {
      const source =
        "<?php\nfunction handle() {\n    $sum = $a + $b;\n    $x = $sum * 2;\n}\n";
      const offset = cursorOn(source, "$sum");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction handle() {\n    $x = ($a + $b) * 2;\n}\n",
      );
    });

    it("does not wrap a simple atom inlined into an operator context", () => {
      const source =
        "<?php\nfunction handle() {\n    $factor = $a;\n    $x = $factor * 2;\n}\n";
      const offset = cursorOn(source, "$factor");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction handle() {\n    $x = $a * 2;\n}\n",
      );
    });

    it("does not wrap when the compound expression is the whole statement", () => {
      const source =
        "<?php\nfunction handle() {\n    $sum = $a + $b;\n    return $sum;\n}\n";
      const offset = cursorOn(source, "$sum");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction handle() {\n    return $a + $b;\n}\n",
      );
    });

    it("does not wrap a function call inlined into an operator context", () => {
      const source =
        "<?php\nfunction handle() {\n    $value = compute();\n    return $value + 1;\n}\n";
      const offset = cursorOn(source, "$value");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction handle() {\n    return compute() + 1;\n}\n",
      );
    });
  });

  describe("conservative rejections", () => {
    it("declines when the variable is assigned more than once", () => {
      const source =
        "<?php\nfunction handle() {\n    $name = $a;\n    $name = $b;\n    return $name;\n}\n";
      const offset = cursorOn(source, "$name");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines a compound assignment declaration (.=)", () => {
      const source =
        "<?php\nfunction handle() {\n    $name .= $a;\n    return $name;\n}\n";
      const offset = cursorOn(source, "$name");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines a compound assignment declaration (+=)", () => {
      const source =
        "<?php\nfunction handle() {\n    $total += $a;\n    return $total;\n}\n";
      const offset = cursorOn(source, "$total");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines a foreach 'as $var' binding", () => {
      const source =
        "<?php\nfunction handle() {\n    foreach ($items as $item) {\n        echo $item;\n    }\n}\n";
      const offset = source.indexOf("$item", source.indexOf("as "));

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines when the variable is reassigned after use", () => {
      const source =
        "<?php\nfunction handle() {\n    $name = $a;\n    echo $name;\n    $name = $b;\n}\n";
      const offset = cursorOn(source, "$name");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines a multi-use call expression to avoid duplicating side effects", () => {
      const source =
        "<?php\nfunction handle() {\n    $x = next($arr);\n    echo $x;\n    echo $x;\n}\n";
      const offset = cursorOn(source, "$x");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines when the only declaration uses the variable on its right-hand side", () => {
      const source =
        "<?php\nfunction handle() {\n    $count = $count + 1;\n    return $count;\n}\n";
      const offset = cursorOn(source, "$count");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines when there is no assignment declaration in scope (parameter)", () => {
      const source =
        "<?php\nfunction handle($name) {\n    return $name;\n}\n";
      const offset = source.lastIndexOf("$name");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines $this", () => {
      const source =
        "<?php\nclass A {\n    function b() {\n        return $this->x;\n    }\n}\n";
      const offset = cursorOn(source, "$this");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines when the cursor is not on a variable", () => {
      const source =
        "<?php\nfunction handle() {\n    $name = $a;\n    return $name;\n}\n";
      const offset = cursorOn(source, "return");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines for out-of-range offsets", () => {
      const source = "<?php\nfunction handle() {\n    $a = 1;\n    return $a;\n}\n";

      expect(planInlineVariable(source, -1)).toBeNull();
      expect(planInlineVariable(source, source.length + 10)).toBeNull();
    });

    it("declines when the variable is used before its declaration", () => {
      const source =
        "<?php\nfunction handle() {\n    echo $name;\n    $name = $a;\n}\n";
      const offset = source.lastIndexOf("$name");

      expect(planInlineVariable(source, offset)).toBeNull();
    });
  });

  describe("single-use call expressions", () => {
    it("allows inlining a call used exactly once (no duplication risk)", () => {
      const source =
        "<?php\nfunction handle() {\n    $x = next($arr);\n    return $x;\n}\n";
      const offset = cursorOn(source, "$x");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction handle() {\n    return next($arr);\n}\n",
      );
    });

    it("allows inlining a pure property-access used multiple times", () => {
      const source =
        "<?php\nfunction handle() {\n    $name = $user->name;\n    echo $name;\n    echo $name;\n}\n";
      const offset = cursorOn(source, "$name");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction handle() {\n    echo $user->name;\n    echo $user->name;\n}\n",
      );
    });
  });

  describe("string-literal and complex right-hand sides", () => {
    it("keeps a trailing string literal in a concatenation", () => {
      const source =
        "<?php\nfunction h() {\n    $x = $a . 'suffix';\n    return $x;\n}\n";
      const offset = cursorOn(source, "$x");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction h() {\n    return $a . 'suffix';\n}\n",
      );
    });

    it("keeps a trailing string in a ternary expression", () => {
      const source =
        "<?php\nfunction h() {\n    $x = $a ? 'y' : 'n';\n    return $x;\n}\n";
      const offset = cursorOn(source, "$x");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction h() {\n    return $a ? 'y' : 'n';\n}\n",
      );
    });

    it("inlines a plain string literal value used multiple times", () => {
      const source =
        "<?php\nfunction h() {\n    $x = 'hello';\n    echo $x;\n    return $x;\n}\n";
      const offset = cursorOn(source, "$x");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction h() {\n    echo 'hello';\n    return 'hello';\n}\n",
      );
    });
  });

  describe("mutation forms are declined", () => {
    it("declines an array-element write", () => {
      const source =
        "<?php\nfunction h() {\n    $a = [];\n    $a[0] = 1;\n    return $a;\n}\n";
      const offset = cursorOn(source, "$a");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines a property write on the variable", () => {
      const source =
        "<?php\nfunction h() {\n    $o = $factory;\n    $o->p = 1;\n    return $o;\n}\n";
      const offset = cursorOn(source, "$o");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines a reference-assignment declaration ($x =& $y)", () => {
      const source =
        "<?php\nfunction h() {\n    $x =& $y;\n    return $x;\n}\n";
      const offset = cursorOn(source, "$x");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines a reference-assignment declaration ($x = &$y)", () => {
      const source =
        "<?php\nfunction h() {\n    $x = &$y;\n    return $x;\n}\n";
      const offset = cursorOn(source, "$x");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines a static declaration", () => {
      const source =
        "<?php\nfunction h() {\n    static $x = 0;\n    return $x;\n}\n";
      const offset = cursorOn(source, "$x");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines an explicit by-reference argument pass (&$var)", () => {
      const source =
        "<?php\nfunction h() {\n    $x = 1;\n    mutate(&$x);\n    return $x;\n}\n";
      const offset = cursorOn(source, "$x");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines when the value is mutated by a by-reference builtin (sort)", () => {
      const source =
        "<?php\nfunction h() {\n    $x = [3, 1, 2];\n    sort($x);\n    return $x;\n}\n";
      const offset = cursorOn(source, "$x");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("declines when the value feeds a by-reference output param (preg_match)", () => {
      const source =
        "<?php\nfunction h() {\n    $m = [];\n    preg_match('/x/', $s, $m);\n    return $m;\n}\n";
      const offset = cursorOn(source, "$m");

      expect(planInlineVariable(source, offset)).toBeNull();
    });

    it("still inlines a plain read argument (not by-reference)", () => {
      const source =
        "<?php\nfunction h() {\n    $x = $items;\n    return count($x);\n}\n";
      const offset = cursorOn(source, "$x");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction h() {\n    return count($items);\n}\n",
      );
    });
  });

  describe("precedence with word operators", () => {
    it("wraps a logical 'or' value inlined into '&&'", () => {
      const source =
        "<?php\nfunction h() {\n    $x = $a or $b;\n    return $x && $c;\n}\n";
      const offset = cursorOn(source, "$x");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction h() {\n    return ($a or $b) && $c;\n}\n",
      );
    });

    it("wraps a ternary value inlined before 'instanceof'", () => {
      const source =
        "<?php\nfunction h() {\n    $x = $a ? $b : $c;\n    return $x instanceof Foo;\n}\n";
      const offset = cursorOn(source, "$x");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction h() {\n    return ($a ? $b : $c) instanceof Foo;\n}\n",
      );
    });

    it("wraps an additive value inlined after 'clone'", () => {
      const source =
        "<?php\nfunction h() {\n    $x = $a + $b;\n    return clone $x;\n}\n";
      const offset = cursorOn(source, "$x");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction h() {\n    return clone ($a + $b);\n}\n",
      );
    });
  });

  describe("declaration deletion on shared lines", () => {
    it("removes only the declaration when another statement shares the line", () => {
      const source =
        "<?php\nfunction h() {\n    $a = 1; $b = $a;\n    return $b;\n}\n";
      const offset = cursorOn(source, "$a");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      expect(applyPlan(source, plan!)).toBe(
        "<?php\nfunction h() {\n    $b = 1;\n    return $b;\n}\n",
      );
    });
  });

  describe("scope isolation", () => {
    it("does not touch a same-named variable in a different function", () => {
      const source =
        "<?php\nfunction a() {\n    $v = 1;\n    return $v;\n}\nfunction b() {\n    return $v;\n}\n";
      const offset = cursorOn(source, "$v");

      const plan = planInlineVariable(source, offset);

      expect(plan).not.toBeNull();
      const result = applyPlan(source, plan!);
      expect(result).toBe(
        "<?php\nfunction a() {\n    return 1;\n}\nfunction b() {\n    return $v;\n}\n",
      );
    });
  });
});
