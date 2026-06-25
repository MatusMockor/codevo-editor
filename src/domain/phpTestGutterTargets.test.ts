import { describe, expect, it } from "vitest";
import {
  phpTestGutterTargets,
  runAllTestsTarget,
} from "./phpTestGutterTargets";

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
        match: "identifier",
        position: { column: 7, lineNumber: 7 },
      },
      {
        filter: "testItCalculatesTotals",
        kind: "method",
        label: "Run testItCalculatesTotals",
        match: "identifier",
        position: { column: 21, lineNumber: 9 },
      },
      {
        filter: "testItAppliesDiscounts",
        kind: "method",
        label: "Run testItAppliesDiscounts",
        match: "identifier",
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
        match: "description",
        position: { column: 1, lineNumber: 3 },
      },
      {
        filter: "applies discounts",
        kind: "method",
        label: "Run applies discounts",
        match: "description",
        position: { column: 1, lineNumber: 6 },
      },
    ]);
  });

  it("marks PHPUnit class and method targets as identifier matches", () => {
    const targets = phpTestGutterTargets(`<?php

class SampleTest extends TestCase
{
    public function testItRuns(): void
    {
    }
}
`);

    expect(targets.map((target) => target.match)).toEqual([
      "identifier",
      "identifier",
    ]);
  });

  it("preserves Pest descriptions verbatim so they can be safely quoted", () => {
    const targets = phpTestGutterTargets(`<?php

it("it's a tricky $name; rm -rf /", function () {
});
`);

    expect(targets).toEqual([
      {
        filter: "it's a tricky $name; rm -rf /",
        kind: "method",
        label: "Run it's a tricky $name; rm -rf /",
        match: "description",
        position: { column: 1, lineNumber: 3 },
      },
    ]);
  });

  it("does not emit run glyphs for an abstract test class", () => {
    const targets = phpTestGutterTargets(`<?php

abstract class FeatureTest extends TestCase
{
    public function testSharedBehaviour(): void
    {
    }
}
`);

    expect(targets).toEqual([]);
  });

  it("skips an abstract test class but still finds a following concrete one", () => {
    const targets = phpTestGutterTargets(`<?php

abstract class BaseFeatureTest extends TestCase
{
    public function testShared(): void
    {
    }
}

class RealFeatureTest extends BaseFeatureTest
{
    public function testItWorks(): void
    {
    }
}
`);

    expect(targets.map((target) => target.filter)).toEqual([
      "RealFeatureTest",
      "testItWorks",
    ]);
  });

  it("still emits glyphs for a concrete class whose comment mentions abstract", () => {
    const targets = phpTestGutterTargets(`<?php

// This base is intentionally not abstract
class PaymentGatewayTest extends TestCase
{
    public function testItCharges(): void
    {
    }
}
`);

    expect(targets.map((target) => target.filter)).toEqual([
      "PaymentGatewayTest",
      "testItCharges",
    ]);
  });

  it("skips an abstract test class declared with other modifiers", () => {
    const targets = phpTestGutterTargets(`<?php

abstract readonly class BaseFeatureTest extends TestCase
{
    public function testShared(): void
    {
    }
}
`);

    expect(targets).toEqual([]);
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

describe("runAllTestsTarget", () => {
  it("returns the class target for a pure PHPUnit file", () => {
    const targets = phpTestGutterTargets(`<?php

class InvoiceServiceTest extends TestCase
{
    public function test_totals(): void
    {
    }
}
`);

    const target = runAllTestsTarget(targets);

    expect(target?.kind).toBe("class");
    expect(target?.filter).toBe("InvoiceServiceTest");
  });

  it("runs the whole suite (no target) for a pure Pest file", () => {
    const targets = phpTestGutterTargets(`<?php

it('calculates totals', function () {
});
`);

    expect(runAllTestsTarget(targets)).toBeNull();
  });

  it("runs the whole suite (no target) for a mixed Pest + class file", () => {
    // A file with a concrete *Test class AND Pest it()/test() calls: filtering
    // by the class name would skip the Pest tests, so prefer the whole suite.
    const targets = phpTestGutterTargets(`<?php

class FeatureTest extends TestCase
{
    public function test_legacy(): void
    {
    }
}

it('also runs as pest', function () {
});
`);

    expect(runAllTestsTarget(targets)).toBeNull();
  });

  it("returns null when there are no targets at all", () => {
    expect(runAllTestsTarget([])).toBeNull();
  });
});
