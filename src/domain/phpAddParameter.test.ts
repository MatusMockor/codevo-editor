import { describe, expect, it } from "vitest";
import { planAddParameter } from "./phpAddParameter";

/**
 * Applies an add-parameter plan to the source so tests can assert on the
 * resulting code rather than only on raw offsets. The plan is a single
 * zero-length insertion expressed in original-document coordinates.
 */
function applyPlan(
  source: string,
  plan: NonNullable<ReturnType<typeof planAddParameter>>,
): string {
  return (
    source.slice(0, plan.insertOffset) +
    plan.insertText +
    source.slice(plan.insertOffset)
  );
}

function cursorOn(source: string, marker: string): number {
  const index = source.indexOf(marker);

  if (index < 0) {
    throw new Error(`marker not found in source: ${marker}`);
  }

  return index;
}

describe("planAddParameter", () => {
  it("appends an optional parameter to a method that already has parameters", () => {
    const source = `<?php

class Greeter
{
    public function greet(string $name): string
    {
        return $name;
    }
}
`;
    const offset = cursorOn(source, "greet(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toBe(`<?php

class Greeter
{
    public function greet(string $name, $parameter = null): string
    {
        return $name;
    }
}
`);
  });

  it("inserts into an empty parameter list", () => {
    const source = `<?php

class Greeter
{
    public function greet(): string
    {
        return "hi";
    }
}
`;
    const offset = cursorOn(source, "greet(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toBe(`<?php

class Greeter
{
    public function greet($parameter = null): string
    {
        return "hi";
    }
}
`);
  });

  it("works on a free function with the cursor inside the body", () => {
    const source = `<?php

function add(int $a, int $b): int
{
    return $a + $b;
}
`;
    const offset = cursorOn(source, "return $a");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toBe(`<?php

function add(int $a, int $b, $parameter = null): int
{
    return $a + $b;
}
`);
  });

  it("preserves a trailing comma in the parameter list", () => {
    const source = `<?php

function many(
    int $a,
    int $b,
): int {
    return $a;
}
`;
    const offset = cursorOn(source, "many(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    expect(result).toContain("$parameter = null");
    expect(result).toContain("int $b,");
    // No double comma corruption.
    expect(result).not.toContain(",,");
    expect(result).not.toContain(", ,");
  });

  it("inserts after a multiline parameter list", () => {
    const source = `<?php

class Service
{
    public function handle(
        Request $request,
        Logger $logger
    ): void {
        //
    }
}
`;
    const offset = cursorOn(source, "handle(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    expect(result).toContain("Logger $logger, $parameter = null");
  });

  it("appends after promoted constructor parameters", () => {
    const source = `<?php

class Account
{
    public function __construct(
        public readonly string $id,
        protected int $balance,
    ) {
    }
}
`;
    const offset = cursorOn(source, "__construct(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    expect(result).toContain("$parameter = null");
    expect(result).not.toContain(",,");
  });

  it("appends when an existing parameter already has a default value", () => {
    const source = `<?php

function greet(string $name = "world"): string
{
    return $name;
}
`;
    const offset = cursorOn(source, "greet(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toContain(
      `greet(string $name = "world", $parameter = null): string`,
    );
  });

  it("appends with nullable and union parameter types present", () => {
    const source = `<?php

function pick(?string $a, A|B $b)
{
    return $a;
}
`;
    const offset = cursorOn(source, "pick(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toContain("A|B $b, $parameter = null");
  });

  it("appends with a by-reference parameter present", () => {
    const source = `<?php

function fill(array &$items)
{
    return $items;
}
`;
    const offset = cursorOn(source, "fill(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toContain("array &$items, $parameter = null");
  });

  it("appends when an existing default value contains a heredoc", () => {
    const source = `<?php

function render(string $template = <<<HTML
<p>hello, ) world</p>
HTML)
{
    return $template;
}
`;
    const offset = cursorOn(source, "render(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    // The `)` inside the heredoc must NOT be mistaken for the param list close.
    expect(result).toContain("HTML, $parameter = null)");
    expect(result).not.toContain(",,");
  });

  it("appends when an existing default value contains nested parentheses", () => {
    // `new Point(0, 0)` is a valid PHP 8.1+ constant default and exercises the
    // depth-tracking that must not mistake the inner `)` for the list close.
    const source = `<?php

function build(array $items = [], Point $origin = new Point(0, 0))
{
    return $items;
}
`;
    const offset = cursorOn(source, "build(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toContain(
      "Point $origin = new Point(0, 0), $parameter = null)",
    );
  });

  it("appends on a method preceded by attributes", () => {
    const source = `<?php

class Controller
{
    #[Route("/users", methods: ["GET"])]
    public function index(Request $request): Response
    {
        return new Response();
    }
}
`;
    const offset = cursorOn(source, "index(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toContain(
      "index(Request $request, $parameter = null): Response",
    );
  });

  it("returns null for an abstract method (declaration only)", () => {
    const source = `<?php

abstract class Base
{
    abstract public function handle(string $name): void;
}
`;
    const offset = cursorOn(source, "handle(");

    expect(planAddParameter(source, offset)).toBeNull();
  });

  it("returns null for an interface method", () => {
    const source = `<?php

interface Handler
{
    public function handle(string $name): void;
}
`;
    const offset = cursorOn(source, "handle(");

    expect(planAddParameter(source, offset)).toBeNull();
  });

  it("returns null when the last parameter is variadic", () => {
    const source = `<?php

function sum(int $first, int ...$rest): int
{
    return $first;
}
`;
    const offset = cursorOn(source, "sum(");

    expect(planAddParameter(source, offset)).toBeNull();
  });

  it("returns null for a spaced variadic last parameter", () => {
    const source = `<?php

function sum(int $first, int ... $rest): int
{
    return $first;
}
`;
    const offset = cursorOn(source, "sum(");

    expect(planAddParameter(source, offset)).toBeNull();
  });

  it("returns null for a by-reference variadic last parameter", () => {
    // `&...$rest` is the only legal PHP spelling of a by-ref variadic; appending
    // a parameter after it would produce "Only the last parameter can be
    // variadic" - the planner must decline.
    const source = `<?php

function collect(int $first, &...$rest): void
{
    //
}
`;
    const offset = cursorOn(source, "collect(");

    expect(planAddParameter(source, offset)).toBeNull();
  });

  it("appends when a non-variadic default value contains an array spread", () => {
    // `[...$base]` is array-spread INSIDE a default value, not a variadic
    // parameter, so the action must still fire and append after it.
    const source = `<?php

function merge(array $base = [], array $all = [...['a']])
{
    return $all;
}
`;
    const offset = cursorOn(source, "merge(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    expect(applyPlan(source, plan!)).toContain(
      "array $all = [...['a']], $parameter = null)",
    );
  });

  it("returns null when the cursor is not inside any function", () => {
    const source = `<?php

class Greeter
{
    public function greet(): void
    {
    }
}
`;
    const offset = cursorOn(source, "class Greeter");

    expect(planAddParameter(source, offset)).toBeNull();
  });

  it("returns null when the parameter list close paren is missing", () => {
    const source = `<?php

function broken(int $a
{
    return $a;
`;
    const offset = cursorOn(source, "broken(");

    expect(planAddParameter(source, offset)).toBeNull();
  });

  it("returns null for an out-of-range offset", () => {
    const source = `<?php

function greet(): void
{
}
`;

    expect(planAddParameter(source, -1)).toBeNull();
    expect(planAddParameter(source, source.length + 5)).toBeNull();
  });

  it("inserts before a trailing `//` line comment, not inside it", () => {
    const source = `<?php

function f(
  int $a,
  int $b
  // trailing note
): void {}
`;
    const offset = cursorOn(source, "f(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    // The new parameter lands AFTER $b and BEFORE the comment, never commented out.
    expect(result).toContain("int $b, $parameter = null");
    expect(result).toContain("// trailing note");
    expect(result).not.toContain("// trailing note, $parameter = null");
  });

  it("inserts before a trailing `#` line comment, not inside it", () => {
    const source = `<?php

function f(
  int $a,
  int $b
  # trailing note
): void {}
`;
    const offset = cursorOn(source, "f(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    expect(result).toContain("int $b, $parameter = null");
    expect(result).toContain("# trailing note");
    expect(result).not.toContain("# trailing note, $parameter = null");
  });

  it("inserts before a same-line trailing comment on the last parameter", () => {
    const source = `<?php

function f(
  int $a,
  int $b // note
): void {}
`;
    const offset = cursorOn(source, "f(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    expect(result).toContain("int $b, $parameter = null");
    expect(result).toContain("// note");
    expect(result).not.toContain("// note, $parameter = null");
  });

  it("inserts before a trailing comment that follows a trailing comma", () => {
    const source = `<?php

function f(
  int $a,
  int $b,
  // trailing note
): void {}
`;
    const offset = cursorOn(source, "f(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    expect(result).toContain("$parameter = null");
    expect(result).toContain("// trailing note");
    expect(result).not.toContain("// trailing note, $parameter = null");
    expect(result).not.toContain("// trailing note $parameter = null");
    // The new param sits after the existing trailing comma, before the comment.
    expect(result).toContain("int $b, $parameter = null");
    expect(result).not.toContain(",,");
  });

  it("inserts before a trailing line comment in a class method", () => {
    const source = `<?php

class Service
{
    public function handle(
        Request $request,
        Logger $logger
        // trailing note
    ): void {
        //
    }
}
`;
    const offset = cursorOn(source, "handle(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    expect(result).toContain("Logger $logger, $parameter = null");
    expect(result).toContain("// trailing note");
    expect(result).not.toContain("// trailing note, $parameter = null");
  });

  it("keeps a string default value insert-after even with a trailing comment", () => {
    // The string default `= "x"` must still receive the param AFTER it, while the
    // trailing line comment must remain untouched.
    const source = `<?php

function f(
  string $name = "x"
  // trailing note
): void {}
`;
    const offset = cursorOn(source, "f(");

    const plan = planAddParameter(source, offset);

    expect(plan).not.toBeNull();
    const result = applyPlan(source, plan!);
    expect(result).toContain('string $name = "x", $parameter = null');
    expect(result).toContain("// trailing note");
    expect(result).not.toContain("// trailing note, $parameter = null");
  });
});
