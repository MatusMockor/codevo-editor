import { describe, expect, it } from "vitest";
import { phpTestGutterTargets } from "./phpTestGutterTargets";

describe("phpTestGutterTargets", () => {
  it("emits a class target plus a method target per PHPUnit test* method", () => {
    expect(
      phpTestGutterTargets(`<?php

namespace Tests\\Unit;

use Tests\\TestCase;

class InvoiceServiceTest extends TestCase
{
    public function testItCalculatesTotals(): void
    {
    }

    public function testItAppliesDiscounts(): void
    {
    }
}
`),
    ).toEqual([
      {
        filter: "InvoiceServiceTest",
        kind: "class",
        label: "Run InvoiceServiceTest",
        position: { column: 7, lineNumber: 7 },
      },
      {
        filter: "testItCalculatesTotals",
        kind: "method",
        label: "Run testItCalculatesTotals",
        position: { column: 21, lineNumber: 9 },
      },
      {
        filter: "testItAppliesDiscounts",
        kind: "method",
        label: "Run testItAppliesDiscounts",
        position: { column: 21, lineNumber: 13 },
      },
    ]);
  });

  it("detects methods annotated with the #[Test] attribute", () => {
    const targets = phpTestGutterTargets(`<?php

class SampleTest extends TestCase
{
    #[Test]
    public function calculatesTotals(): void
    {
    }
}
`);

    expect(targets.map((target) => target.filter)).toEqual([
      "SampleTest",
      "calculatesTotals",
    ]);
  });

  it("detects methods annotated with the @test docblock", () => {
    const targets = phpTestGutterTargets(`<?php

class SampleTest extends TestCase
{
    /** @test */
    public function it_does_something(): void
    {
    }
}
`);

    expect(targets.map((target) => target.filter)).toEqual([
      "SampleTest",
      "it_does_something",
    ]);
  });

  it("does not emit targets for non-test public methods", () => {
    const targets = phpTestGutterTargets(`<?php

class SampleTest extends TestCase
{
    public function setUp(): void
    {
    }

    public function helperMethod(): void
    {
    }
}
`);

    // Only the class target; neither helper is a recognised test method.
    expect(targets.map((target) => target.kind)).toEqual(["class"]);
  });

  it("detects Pest it() and test() calls", () => {
    const targets = phpTestGutterTargets(`<?php

it('calculates totals', function () {
});

test('applies discounts', function () {
});
`);

    expect(targets).toEqual([
      {
        filter: "calculates totals",
        kind: "method",
        label: "Run calculates totals",
        position: { column: 1, lineNumber: 3 },
      },
      {
        filter: "applies discounts",
        kind: "method",
        label: "Run applies discounts",
        position: { column: 1, lineNumber: 6 },
      },
    ]);
  });

  it("returns no targets when there is no test class or Pest call", () => {
    expect(
      phpTestGutterTargets(`<?php

class InvoiceService
{
    public function total(): int
    {
        return 0;
    }
}
`),
    ).toEqual([]);
  });
});
