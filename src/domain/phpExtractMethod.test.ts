import { describe, expect, it } from "vitest";
import { planExtractMethod } from "./phpExtractMethod";

/**
 * Applies an extract-method plan to the source so tests can assert on the
 * resulting code rather than only on raw offsets.
 *
 * All plan offsets are expressed in the ORIGINAL document coordinate space, so
 * the two edits (replace the selection with the call, insert the new method)
 * are applied highest offset first. That keeps the lower offsets valid no
 * matter the relative ordering of the two edit regions - the standard
 * non-overlapping-edit application strategy an editor adapter would use.
 */
function applyPlan(
  source: string,
  plan: NonNullable<ReturnType<typeof planExtractMethod>>,
): string {
  const edits = [
    {
      start: plan.replaceStart,
      end: plan.replaceEnd,
      text: plan.replacementText,
    },
    {
      start: plan.methodInsertionOffset,
      end: plan.methodInsertionOffset,
      text: plan.methodText,
    },
  ];

  return edits
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, edit) =>
        current.slice(0, edit.start) + edit.text + current.slice(edit.end),
      source,
    );
}

function spanOf(source: string, fragment: string): [number, number] {
  const start = source.indexOf(fragment);

  if (start < 0) {
    throw new Error(`fragment not found in source: ${fragment}`);
  }

  return [start, start + fragment.length];
}

/**
 * Selects whole lines: from the start of the line containing `from` to the end
 * of the line containing the end of `to` (the trailing newline excluded). This
 * mirrors how an editor "select these lines" gesture lands on statement
 * boundaries.
 */
function lineSpanOf(source: string, from: string, to: string): [number, number] {
  const fromIndex = source.indexOf(from);
  const toIndex = source.indexOf(to);

  if (fromIndex < 0 || toIndex < 0) {
    throw new Error(`fragment not found: ${from} / ${to}`);
  }

  const lineStart = source.lastIndexOf("\n", fromIndex - 1) + 1;
  const lineEndNewline = source.indexOf("\n", toIndex + to.length);
  const end = lineEndNewline < 0 ? source.length : lineEndNewline;

  return [lineStart, end];
}

describe("planExtractMethod", () => {
  it("extracts a simple sequential selection with no external variables", () => {
    const source = `<?php

class Greeter
{
    public function run(): void
    {
        $a = 1;
        $b = 2;
        echo $a + $b;
    }
}
`;
    const [start, end] = lineSpanOf(source, "$a = 1;", "echo $a + $b;");

    const plan = planExtractMethod(source, start, end);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toBe(`<?php

class Greeter
{
    public function run(): void
    {
        $this->extracted();
    }

    private function extracted(): void
    {
        $a = 1;
        $b = 2;
        echo $a + $b;
    }
}
`);
  });

  it("turns a variable defined before the selection into a parameter", () => {
    const source = `<?php

class Calculator
{
    public function run(int $seed): void
    {
        $base = $seed * 2;
        $total = $base + 10;
        echo $total;
    }
}
`;
    const [start, end] = lineSpanOf(source, "$total = $base + 10;", "echo $total;");

    const plan = planExtractMethod(source, start, end);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    // `$base` is read but defined before the selection => parameter.
    // `$total` is defined and used only inside => stays local, no return.
    expect(result).toContain("$this->extracted($base);");
    expect(result).toContain("private function extracted($base): void");
    expect(result).toContain("$total = $base + 10;");
  });

  it("covers extract method with padded statement selections in a namespaced Laravel service without touching imports", () => {
    const source = `<?php

namespace App\\Services;

use App\\Models\\Order;
use Illuminate\\Support\\Facades\\Log;

class OrderReporter
{
    public function report(Order $order): void
    {
        $prefix = 'order';
        $message = $prefix . ':' . $order->number;
        Log::info($message);
    }
}
`;
    const [lineStart, lineEnd] = lineSpanOf(
      source,
      "$message = $prefix . ':' . $order->number;",
      "Log::info($message);",
    );

    const plan = planExtractMethod(source, lineStart - 1, lineEnd + 1);

    expect(plan).not.toBeNull();
    expect(plan!.replaceStart).toBe(
      source.indexOf("$message = $prefix . ':' . $order->number;"),
    );
    expect(plan!.replaceEnd).toBe(lineEnd);
    expect(applyPlan(source, plan!)).toBe(`<?php

namespace App\\Services;

use App\\Models\\Order;
use Illuminate\\Support\\Facades\\Log;

class OrderReporter
{
    public function report(Order $order): void
    {
        $prefix = 'order';
        $this->extracted($prefix, $order);
    }

    private function extracted($prefix, $order): void
    {
        $message = $prefix . ':' . $order->number;
        Log::info($message);
    }
}
`);
  });

  it("returns the single variable defined inside and used after the selection", () => {
    const source = `<?php

class Calculator
{
    public function run(int $seed): int
    {
        $doubled = $seed * 2;
        $result = $doubled + 1;
        return $result;
    }
}
`;
    const [start, end] = lineSpanOf(
      source,
      "$doubled = $seed * 2;",
      "$result = $doubled + 1;",
    );

    const plan = planExtractMethod(source, start, end);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    // `$result` is defined inside and used after (`return $result;`) => returned.
    expect(result).toContain("$result = $this->extracted($seed);");
    expect(result).toContain("private function extracted($seed)");
    expect(result).toContain("return $result;");
  });

  it("inserts the new method immediately after the enclosing method", () => {
    const source = `<?php

class Greeter
{
    public function run(): void
    {
        $a = 1;
        echo $a;
    }

    public function other(): void
    {
        echo 'x';
    }
}
`;
    const [start, end] = spanOf(source, "        $a = 1;\n");

    const plan = planExtractMethod(source, start, end);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    // The extracted method sits between `run` and `other`, not after `other`.
    const extractedIndex = result.indexOf("private function extracted");
    const otherIndex = result.indexOf("public function other");
    expect(extractedIndex).toBeGreaterThan(-1);
    expect(extractedIndex).toBeLessThan(otherIndex);
  });

  it("extracts ordinary statements from inside a case body", () => {
    // Statements that follow a `case`/`default` label are ordinary code; a bare
    // call replacing them is valid inside the case body, so extraction proceeds.
    const source = `<?php

class C
{
    public function run(int $v): void
    {
        switch ($v) {
            case 1:
                $a = 0;
                $x = $a + 1;
                echo $x;
                break;
        }
    }
}
`;
    const [start, end] = lineSpanOf(source, "$x = $a + 1;", "echo $x;");

    const plan = planExtractMethod(source, start, end);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    // The selected statements moved into the new method; the call replaces them
    // inside the case body, and no bare `case`/`default` label was lifted.
    expect(result).toContain("                $this->extracted($a);");
    expect(result).toContain("        $x = $a + 1;\n        echo $x;");
    expect(result).not.toContain("private function extracted($a): void\n    {\n        case");
  });

  it("extracts a call that uses a `default:` named argument", () => {
    // A PHP 8 named argument `default:` at line start is NOT a switch label; the
    // statement-boundary anchoring must let this selection extract.
    const source = `<?php

class C
{
    public function run(): void
    {
        $v = $this->config(
            'app.key',
            default: 5,
        );
        echo $v;
    }
}
`;
    const [start, end] = lineSpanOf(source, "$v = $this->config(", "echo $v;");

    const plan = planExtractMethod(source, start, end);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toContain("default: 5,");
  });

  describe("conservative null guards", () => {
    it("returns null for an empty / whitespace selection", () => {
      const source = `<?php

class Greeter
{
    public function run(): void
    {
        $a = 1;
    }
}
`;
      expect(planExtractMethod(source, 0, 0)).toBeNull();
      const blankStart = source.indexOf("    public");
      expect(planExtractMethod(source, blankStart - 1, blankStart)).toBeNull();
    });

    it("returns null when the selection is outside any method (class body)", () => {
      const source = `<?php

class Greeter
{
    private int $count = 0;
}
`;
      const [start, end] = spanOf(source, "private int $count = 0;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection spans a method boundary", () => {
      const source = `<?php

class Greeter
{
    public function a(): void
    {
        echo 1;
    }

    public function b(): void
    {
        echo 2;
    }
}
`;
      const [start, end] = lineSpanOf(source, "echo 1;", "echo 2;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection cuts through an if/else block", () => {
      const source = `<?php

class Greeter
{
    public function run(int $x): void
    {
        if ($x > 0) {
            echo 'positive';
        } else {
            echo 'other';
        }
    }
}
`;
      // Select from inside the `if` body through the `else` keyword: partial block.
      const [start, end] = lineSpanOf(source, "echo 'positive';", "} else {");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection opens a block it does not close", () => {
      const source = `<?php

class Greeter
{
    public function run(int $x): void
    {
        foreach ($items as $item) {
            echo $item;
        }
    }
}
`;
      // Select only the `foreach (...) {` opener line: unbalanced brace.
      const [start, end] = spanOf(source, "        foreach ($items as $item) {\n");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when more than one variable must be returned", () => {
      const source = `<?php

class Calculator
{
    public function run(): int
    {
        $a = 1;
        $b = 2;
        return $a + $b;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$a = 1;", "$b = 2;");
      // Both $a and $b are used after the selection => two outputs => null.
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection contains a return statement", () => {
      const source = `<?php

class Greeter
{
    public function run(int $x): int
    {
        $y = $x + 1;
        return $y;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$y = $x + 1;", "return $y;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when a variable is both read and reassigned inside the selection", () => {
      // `$x` is defined before, then both READ and WRITTEN inside the selection
      // (`$x = $x + 5`). Modelling this needs `$x` as a parameter AND possibly a
      // return; the conservative planner declines rather than risk dropping the
      // parameter (which would reference an undefined `$x` in the new method).
      const source = `<?php

class Calculator
{
    public function run(): int
    {
        $x = 1;
        $x = $x + 5;
        return $x;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$x = $x + 5;", "$x = $x + 5;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when a compound assignment mutates a variable used after", () => {
      // `$x += 5` reads-and-writes `$x`; passing it by value would silently drop
      // the mutation seen by `return $x;` after the selection => corruption.
      // The planner must decline.
      const source = `<?php

class Calculator
{
    public function run(): int
    {
        $x = 1;
        $x += 5;
        return $x;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$x += 5;", "$x += 5;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when a compound assignment mutates a variable defined before", () => {
      // `$x .= 'a'` reads-and-writes `$x`; even when not used after, the safe
      // behaviour is to decline this read-and-write local rather than guess.
      const source = `<?php

class Calculator
{
    public function run(): void
    {
        $x = '';
        $x .= 'a';
        echo strlen($x);
    }
}
`;
      const [start, end] = lineSpanOf(source, "$x .= 'a';", "echo strlen($x);");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection post-increments a variable used after", () => {
      // `$x++` reads-and-writes `$x`; passing it by value would silently drop the
      // increment seen by `return $x;` after the selection (the method would
      // return 1 instead of 2) => semantic corruption. The planner must decline.
      const source = `<?php

class C
{
    public function run(): int
    {
        $x = 1;
        $x++;
        return $x;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$x++;", "$x++;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection pre-increments a variable used after", () => {
      // `++$x` is the prefix form of the same read-and-write mutation: declining.
      const source = `<?php

class C
{
    public function run(): int
    {
        $x = 1;
        ++$x;
        return $x;
    }
}
`;
      const [start, end] = lineSpanOf(source, "++$x;", "++$x;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection post-decrements a variable used after", () => {
      // `$x--` reads-and-writes `$x`; same mutation hazard as `$x++` => decline.
      const source = `<?php

class C
{
    public function run(): int
    {
        $x = 5;
        $x--;
        return $x;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$x--;", "$x--;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection pre-decrements a variable used after", () => {
      // `--$x` prefix decrement: same read-and-write mutation hazard => decline.
      const source = `<?php

class C
{
    public function run(): int
    {
        $x = 5;
        --$x;
        return $x;
    }
}
`;
      const [start, end] = lineSpanOf(source, "--$x;", "--$x;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when a subscript element of an array used after is assigned", () => {
      // `$a[$i] = 5` mutates the array `$a` in place. PHP arrays are value types,
      // so passing `$a` by value into the new method would discard the write the
      // `echo $a[$i];` after the selection depends on => silent corruption.
      const source = `<?php

class C
{
    public function run(array $a, int $i): void
    {
        $a[$i] = 5;
        echo $a[$i];
    }
}
`;
      const [start, end] = lineSpanOf(source, "$a[$i] = 5;", "$a[$i] = 5;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when an element is appended to an array used after", () => {
      // `$a[] = 9` appends to the array in place; by-value extraction drops it.
      const source = `<?php

class C
{
    public function run(array $a): array
    {
        $a[] = 9;
        return $a;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$a[] = 9;", "$a[] = 9;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when a string-keyed element of an array used after is assigned", () => {
      const source = `<?php

class C
{
    public function run(array $a): array
    {
        $a['k'] = 5;
        return $a;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$a['k'] = 5;", "$a['k'] = 5;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when a string offset of a string used after is assigned", () => {
      // `$s[0] = 'X'` mutates the string in place; strings are value types too.
      const source = `<?php

class C
{
    public function run(string $s): string
    {
        $s[0] = 'X';
        return $s;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$s[0] = 'X';", "$s[0] = 'X';");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when a subscript element of an array used after is incremented", () => {
      const source = `<?php

class C
{
    public function run(array $a, int $i): int
    {
        $a[$i]++;
        return $a[$i];
    }
}
`;
      const [start, end] = lineSpanOf(source, "$a[$i]++;", "$a[$i]++;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when a subscript element of an array used after is compound-assigned", () => {
      const source = `<?php

class C
{
    public function run(array $a, int $i): int
    {
        $a[$i] += 5;
        return $a[$i];
    }
}
`;
      const [start, end] = lineSpanOf(source, "$a[$i] += 5;", "$a[$i] += 5;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when a reference is bound to a variable used after", () => {
      // `$ref = &$x;` makes `$ref` an alias of `$x`; the later `$ref = 5;` then
      // mutates `$x` through the alias. A by-value extraction severs the alias and
      // drops the mutation that `return $x;` depends on => corruption.
      const source = `<?php

class C
{
    public function run(): int
    {
        $x = 1;
        $ref = &$x;
        $ref = 5;
        return $x;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$ref = &$x;", "$ref = 5;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when an object property of an object used after is assigned", () => {
      // Conservative decline: even though objects are passed by handle (so the
      // property write would propagate), the planner declines a property write of
      // an object referenced after the selection rather than reason about handles.
      const source = `<?php

class C
{
    public function run(object $obj): object
    {
        $obj->prop = 5;
        return $obj;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$obj->prop = 5;", "$obj->prop = 5;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection writes a `self::$prop` static property", () => {
      // The `$identifier` scan matches `$s` (the property NAME after `self::`),
      // not a plain `$s` variable. `assignmentAccessAt` sees the `=` and tags it a
      // write, and the `$s` in `return self::$s;` after the selection makes the
      // planner emit a phantom `$s = $this->extracted(); ... return $s;` where
      // `$s` is undefined inside the new method => corruption. Decline.
      const source = `<?php

class C
{
    public static $s = 0;

    public function run(): int
    {
        self::$s = 5;
        return self::$s;
    }
}
`;
      const [start, end] = lineSpanOf(source, "self::$s = 5;", "self::$s = 5;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection writes a `static::$prop` static property", () => {
      const source = `<?php

class C
{
    public static $s = 0;

    public function run(): int
    {
        static::$s = 5;
        return static::$s;
    }
}
`;
      const [start, end] = lineSpanOf(source, "static::$s = 5;", "static::$s = 5;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection writes a `C::$prop` static property", () => {
      const source = `<?php

class C
{
    public static $s = 0;

    public function run(): int
    {
        C::$s = 5;
        return C::$s;
    }
}
`;
      const [start, end] = lineSpanOf(source, "C::$s = 5;", "C::$s = 5;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection writes a `$cls::$prop` static property", () => {
      const source = `<?php

class C
{
    public static $s = 0;

    public function run(string $cls): int
    {
        $cls::$s = 5;
        return $cls::$s;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$cls::$s = 5;", "$cls::$s = 5;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection reads a variable-variable `$$name`", () => {
      // `$$name` reads the variable WHOSE NAME is in `$name`; the `$identifier`
      // scan only sees `$name` and silently drops the indirection, so the
      // extracted method would no longer read the intended variable. Decline.
      const source = `<?php

class C
{
    public function run(string $name): mixed
    {
        $val = $$name;
        return $val;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$val = $$name;", "$val = $$name;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection reads a `${$name}` variable-variable", () => {
      const source = `<?php

class C
{
    public function run(string $name): mixed
    {
        $val = \${$name};
        return $val;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$val = ${$name};", "$val = ${$name};");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection writes a dynamic property `$this->$prop`", () => {
      // `$this->$prop = 5;` writes the property NAMED by `$prop`. The scan sees
      // `$prop` as a fresh-local write and drops it, so the extracted method
      // references an undefined `$prop` => corruption. Decline.
      const source = `<?php

class C
{
    public function run(string $prop): void
    {
        $this->$prop = 5;
        echo 'done';
    }
}
`;
      const [start, end] = lineSpanOf(source, "$this->$prop = 5;", "echo 'done';");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection writes a dynamic property `$obj->$p`", () => {
      const source = `<?php

class C
{
    public function run(object $obj, string $p): void
    {
        $obj->$p = 5;
        echo 'done';
    }
}
`;
      const [start, end] = lineSpanOf(source, "$obj->$p = 5;", "echo 'done';");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("extracts a `Foo::BAR` class constant read (not flagged as static property)", () => {
      const source = `<?php

class C
{
    public function run(): void
    {
        $x = Foo::BAR + 1;
        echo $x;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$x = Foo::BAR + 1;", "echo $x;");

      const plan = planExtractMethod(source, start, end);

      expect(plan).not.toBeNull();
      const result = applyPlan(source, plan!);
      expect(result).toContain("$this->extracted();");
      expect(result).toContain("$x = Foo::BAR + 1;");
    });

    it("extracts a `self::make()` static method call", () => {
      const source = `<?php

class C
{
    public function run(): void
    {
        $y = self::make();
        echo $y;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$y = self::make();", "echo $y;");

      const plan = planExtractMethod(source, start, end);

      expect(plan).not.toBeNull();
      const result = applyPlan(source, plan!);
      expect(result).toContain("$this->extracted();");
      expect(result).toContain("$y = self::make();");
    });

    it("extracts a `$obj->prop` static property read", () => {
      const source = `<?php

class C
{
    public function run(object $obj): void
    {
        $z = $obj->prop;
        echo $z;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$z = $obj->prop;", "echo $z;");

      const plan = planExtractMethod(source, start, end);

      expect(plan).not.toBeNull();
      const result = applyPlan(source, plan!);
      expect(result).toContain("$this->extracted($obj);");
      expect(result).toContain("$z = $obj->prop;");
    });

    it("extracts a `$a->b()->c()` method chain", () => {
      const source = `<?php

class C
{
    public function run(object $a): void
    {
        $w = $a->b()->c();
        echo $w;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$w = $a->b()->c();", "echo $w;");

      const plan = planExtractMethod(source, start, end);

      expect(plan).not.toBeNull();
      const result = applyPlan(source, plan!);
      expect(result).toContain("$this->extracted($a);");
      expect(result).toContain("$w = $a->b()->c();");
    });

    it("extracts a fresh-local subscript write that is not used after the selection", () => {
      // `$b` is born inside the selection (`$b = []`), mutated via `$b[0] = 1`, and
      // never read after it. The discarded local is identical whether it lives in
      // the original method or the extracted one, so extraction is safe.
      const source = `<?php

class C
{
    public function run(): void
    {
        $b = [];
        $b[0] = 1;
        echo count($b);
    }
}
`;
      const [start, end] = lineSpanOf(source, "$b = [];", "echo count($b);");

      const plan = planExtractMethod(source, start, end);

      expect(plan).not.toBeNull();
      const result = applyPlan(source, plan!);
      expect(result).toContain("$this->extracted();");
      expect(result).toContain("$b[0] = 1;");
    });

    it("returns null for a partial switch/case selection", () => {
      // Selecting a `case` label and its body lifts the bare `case` into the new
      // method (a parse error) and leaves a bare call directly in the `switch`
      // body (invalid). No safe extraction exists => decline.
      const source = `<?php

class C
{
    public function run(int $x): void
    {
        switch ($x) {
            case 1:
                echo 'a';
            case 2:
                echo 'b';
                break;
        }
    }
}
`;
      const [start, end] = lineSpanOf(source, "case 1:", "echo 'a';");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null for a selection of a default: label inside switch", () => {
      const source = `<?php

class C
{
    public function run(int $x): void
    {
        switch ($x) {
            default:
                echo 'd';
                break;
        }
    }
}
`;
      const [start, end] = lineSpanOf(source, "default:", "echo 'd';");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null for a bare statement directly under switch before any label", () => {
      // The selection sits immediately inside the `switch(){}` body BEFORE the
      // first `case`/`default` label, where a bare `$this->extracted();` is a PHP
      // parse error (only labels are allowed at that position).
      const source = `<?php

class C
{
    public function run(int $x): void
    {
        switch ($x) {
            $a = compute($x);
            echo $a;
            case 1:
                break;
        }
    }
}
`;
      const [start, end] = lineSpanOf(source, "$a = compute($x);", "echo $a;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection contains a goto label", () => {
      // A bare `start:` label lifted into the new method breaks the `goto start;`
      // that targets it. Labels are rare but share the statement-boundary root.
      const source = `<?php

class C
{
    public function run(): void
    {
        start:
        echo 'x';
        goto start;
    }
}
`;
      const [start, end] = lineSpanOf(source, "start:", "echo 'x';");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null for array destructuring whose targets are used after", () => {
      // `[$a, $b] = $pair;` writes `$a`/`$b`; the lexical analysis does not model
      // destructuring targets as writes, so the planner conservatively declines
      // rather than risk dropping a needed return.
      const source = `<?php

class C
{
    public function run(array $pair): int
    {
        [$a, $b] = $pair;
        $tmp = $a;
        return $a + $b;
    }
}
`;
      const [start, end] = lineSpanOf(source, "[$a, $b] = $pair;", "$tmp = $a;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null for a foreach whose loop variables are not defined before", () => {
      const source = `<?php

class C
{
    public function run(array $items): void
    {
        foreach ($items as $k => $v) {
            echo $v;
        }
    }
}
`;
      const [start, end] = lineSpanOf(
        source,
        "foreach ($items as $k => $v) {",
        "}",
      );
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection contains break or continue", () => {
      const source = `<?php

class Greeter
{
    public function run(array $items): void
    {
        foreach ($items as $item) {
            $double = $item * 2;
            break;
        }
    }
}
`;
      const [start, end] = lineSpanOf(source, "$double = $item * 2;", "break;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection contains a yield", () => {
      const source = `<?php

class Greeter
{
    public function run(): iterable
    {
        $value = 1;
        yield $value;
    }
}
`;
      const [start, end] = lineSpanOf(source, "$value = 1;", "yield $value;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection interpolates a variable in a double-quoted string", () => {
      // `$name` is read ONLY inside the interpolated string, which the structural
      // mask blanks out. Extracting would emit a method referencing an undefined
      // `$name` (the parameter would be missed) - corruption. Decline instead.
      const source = `<?php

class Greeter
{
    public function run(string $name): void
    {
        $greeting = "Hello $name!";
        echo $greeting;
    }
}
`;
      const [start, end] = lineSpanOf(
        source,
        '$greeting = "Hello $name!";',
        "echo $greeting;",
      );
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection interpolates a variable with braces", () => {
      const source = `<?php

class Greeter
{
    public function run(string $name): void
    {
        $greeting = "Hi {$name} there";
        echo $greeting;
    }
}
`;
      const [start, end] = lineSpanOf(
        source,
        '$greeting = "Hi {$name} there";',
        "echo $greeting;",
      );
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("extracts when a double-quoted string has no interpolation", () => {
      // A plain double-quoted literal with no `$`/`{$` is safe to extract.
      const source = `<?php

class Greeter
{
    public function run(): void
    {
        $greeting = "Hello world";
        echo $greeting;
    }
}
`;
      const [start, end] = lineSpanOf(
        source,
        '$greeting = "Hello world";',
        "echo $greeting;",
      );
      expect(planExtractMethod(source, start, end)).not.toBeNull();
    });

    it("returns null when the selection contains a heredoc", () => {
      const source = [
        "<?php",
        "",
        "class Greeter",
        "{",
        "    public function run(): void",
        "    {",
        "        $text = <<<EOT",
        "        hello; world}",
        "        EOT;",
        "        echo $text;",
        "    }",
        "}",
        "",
      ].join("\n");
      const [start, end] = lineSpanOf(source, "$text = <<<EOT", "echo $text;");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection is not aligned to whole statements", () => {
      const source = `<?php

class Greeter
{
    public function run(): void
    {
        $a = compute();
        echo $a;
    }
}
`;
      // Select only `compute()` inside the assignment: a partial statement.
      const [start, end] = spanOf(source, "compute()");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection sits inside a free function (no class)", () => {
      const source = `<?php

function run(): void
{
    $a = 1;
    echo $a;
}
`;
      const [start, end] = spanOf(source, "    $a = 1;\n");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });

    it("returns null when the selection contains a closure with use()", () => {
      const source = `<?php

class Greeter
{
    public function run(): void
    {
        $factor = 2;
        $fn = function ($x) use ($factor) {
            return $x * $factor;
        };
        echo $fn(3);
    }
}
`;
      const [start, end] = lineSpanOf(source, "$fn = function", "};");
      expect(planExtractMethod(source, start, end)).toBeNull();
    });
  });

  describe("adversarial edge sweep (extract or null, never corruption)", () => {
    /**
     * For each crafted edge case the planner must EITHER produce a plan whose
     * applied output is still syntactically balanced (braces/parens) and never
     * drops or duplicates characters, OR return null. The one thing it must
     * never do is emit corrupt code.
     */
    const cases: { name: string; source: string; from: string; to: string }[] = [
      {
        name: "selection inside a loop body (whole statements)",
        source: `<?php
class C {
    public function run(array $items): void {
        foreach ($items as $item) {
            $a = $item;
            $b = $a + 1;
            echo $b;
        }
    }
}
`,
        from: "$a = $item;",
        to: "$b = $a + 1;",
      },
      {
        name: "selection is a whole nested block",
        source: `<?php
class C {
    public function run(int $x): void {
        if ($x > 0) {
            echo 'yes';
        }
        echo 'done';
    }
}
`,
        from: "if ($x > 0) {",
        to: "}",
      },
      {
        name: "selection over match arms (partial)",
        source: `<?php
class C {
    public function run(int $x): string {
        return match ($x) {
            1 => 'one',
            2 => 'two',
        };
    }
}
`,
        from: "1 => 'one',",
        to: "2 => 'two',",
      },
      {
        name: "selection with trailing partial statement",
        source: `<?php
class C {
    public function run(): void {
        $a = 1;
        $b = 2; $c =
    }
}
`,
        from: "$a = 1;",
        to: "$b = 2; $c =",
      },
      {
        name: "selection is the entire method body",
        source: `<?php
class C {
    public function run(): void {
        $a = 1;
        echo $a;
    }
}
`,
        from: "$a = 1;",
        to: "echo $a;",
      },
      {
        name: "selection using $this and static",
        source: `<?php
class C {
    public function run(): void {
        $a = $this->value();
        $b = self::CONST + $a;
        echo $b;
    }
}
`,
        from: "$a = $this->value();",
        to: "$b = self::CONST + $a;",
      },
      {
        name: "selection touching a heredoc body brace",
        source: [
          "<?php",
          "class C {",
          "    public function run(): void {",
          "        $a = 1;",
          "        $t = <<<EOT",
          "        } not a brace",
          "        EOT;",
          "        echo $t;",
          "    }",
          "}",
          "",
        ].join("\n"),
        from: "$a = 1;",
        to: "$t = <<<EOT",
      },
      {
        name: "selection with continue inside loop",
        source: `<?php
class C {
    public function run(array $items): void {
        foreach ($items as $item) {
            $v = $item;
            continue;
        }
    }
}
`,
        from: "$v = $item;",
        to: "continue;",
      },
    ];

    for (const testCase of cases) {
      it(`does not corrupt: ${testCase.name}`, () => {
        const fromIndex = testCase.source.indexOf(testCase.from);
        const toIndex = testCase.source.indexOf(testCase.to);
        const lineStart = testCase.source.lastIndexOf("\n", fromIndex - 1) + 1;
        const lineEndNewline = testCase.source.indexOf(
          "\n",
          toIndex + testCase.to.length,
        );
        const end =
          lineEndNewline < 0 ? testCase.source.length : lineEndNewline;

        const plan = planExtractMethod(testCase.source, lineStart, end);

        if (plan === null) {
          // Conservative no-op is always acceptable.
          return;
        }

        const result = applyPlan(testCase.source, plan);
        // Balanced braces / parens preserved, and a call site was produced.
        expectBalanced(result);
        expect(result).toContain("$this->extracted(");
        expect(result).toContain("private function extracted");
      });
    }
  });
});

function expectBalanced(source: string): void {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const opens = new Set(["(", "[", "{"]);
  const stack: string[] = [];
  let quote: string | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (opens.has(character)) {
      stack.push(character);
      continue;
    }

    const expected = pairs[character];

    if (expected) {
      expect(stack.pop()).toBe(expected);
    }
  }

  expect(stack).toHaveLength(0);
}
