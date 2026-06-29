import { describe, expect, it } from "vitest";
import {
  propertyToParameter,
  renderConstructor,
} from "./phpConstructorCodeGen";
import {
  parsePhpClassStructure,
  type PhpPropertyMember,
} from "./phpClassStructure";
import { insertGeneratedClassMemberForTest } from "./phpCodeGenTestUtils";

function property(
  overrides: Partial<PhpPropertyMember> & { name: string },
): PhpPropertyMember {
  return {
    defaultValue: null,
    isReadonly: false,
    isStatic: false,
    phpDoc: null,
    type: null,
    visibility: "private",
    ...overrides,
  };
}

describe("renderConstructor (classic)", () => {
  it("renders a single typed property as a constructor parameter + assignment", () => {
    const result = renderConstructor([
      property({ name: "name", type: "string" }),
    ]);

    expect(result).toBe(
      [
        "public function __construct(string $name)",
        "{",
        "    $this->name = $name;",
        "}",
      ].join("\n"),
    );
  });

  it("renders multiple properties with mixed nullable / typed params", () => {
    const result = renderConstructor([
      property({ name: "name", type: "string" }),
      property({ name: "other", type: "?Other" }),
    ]);

    expect(result).toBe(
      [
        "public function __construct(string $name, ?Other $other)",
        "{",
        "    $this->name = $name;",
        "    $this->other = $other;",
        "}",
      ].join("\n"),
    );
  });

  it("carries the property default value onto the parameter", () => {
    const result = renderConstructor([
      property({ name: "other", type: "?Other", defaultValue: "null" }),
    ]);

    expect(result).toBe(
      [
        "public function __construct(?Other $other = null)",
        "{",
        "    $this->other = $other;",
        "}",
      ].join("\n"),
    );
  });

  it("renders an untyped property without a leading type", () => {
    const result = renderConstructor([property({ name: "value", type: null })]);

    expect(result).toBe(
      [
        "public function __construct($value)",
        "{",
        "    $this->value = $value;",
        "}",
      ].join("\n"),
    );
  });

  it("never emits readonly on a classic (non-promoted) parameter", () => {
    const result = renderConstructor([
      property({
        name: "name",
        type: "string",
        visibility: "private",
        isReadonly: true,
      }),
    ]);

    expect(result).toBe(
      [
        "public function __construct(string $name)",
        "{",
        "    $this->name = $name;",
        "}",
      ].join("\n"),
    );
  });

  it("renders a mix of typed and untyped properties", () => {
    const result = renderConstructor([
      property({ name: "id", type: "int" }),
      property({ name: "payload", type: null }),
    ]);

    expect(result).toBe(
      [
        "public function __construct(int $id, $payload)",
        "{",
        "    $this->id = $id;",
        "    $this->payload = $payload;",
        "}",
      ].join("\n"),
    );
  });
});

describe("renderConstructor (promotion)", () => {
  it("promotes a single property keeping its visibility and renders an empty body", () => {
    const result = renderConstructor(
      [property({ name: "name", type: "string", visibility: "public" })],
      { mode: "promoted" },
    );

    expect(result).toBe(
      [
        "public function __construct(",
        "    public string $name,",
        ") {}",
      ].join("\n"),
    );
  });

  it("promotes an untyped property without a stray double space", () => {
    const result = renderConstructor(
      [property({ name: "value", type: null, visibility: "protected" })],
      { mode: "promoted" },
    );

    expect(result).toBe(
      [
        "public function __construct(",
        "    protected $value,",
        ") {}",
      ].join("\n"),
    );
  });

  it("preserves readonly and visibility per promoted property", () => {
    const result = renderConstructor(
      [
        property({ name: "name", type: "string", visibility: "public" }),
        property({
          name: "other",
          type: "?Other",
          visibility: "private",
          isReadonly: true,
          defaultValue: "null",
        }),
      ],
      { mode: "promoted" },
    );

    expect(result).toBe(
      [
        "public function __construct(",
        "    public string $name,",
        "    private readonly ?Other $other = null,",
        ") {}",
      ].join("\n"),
    );
  });
});

describe("renderConstructor (filtering and edge cases)", () => {
  it("omits static properties from the constructor", () => {
    const result = renderConstructor([
      property({ name: "instances", type: "int", isStatic: true }),
      property({ name: "name", type: "string" }),
    ]);

    expect(result).toBe(
      [
        "public function __construct(string $name)",
        "{",
        "    $this->name = $name;",
        "}",
      ].join("\n"),
    );
  });

  it("generates valid constructor output inside a namespaced Laravel class without moving imports", () => {
    const source = `<?php

namespace App\\Services;

use App\\Models\\User;
use Illuminate\\Contracts\\Cache\\Repository;

class UserCache
{
    private Repository $cache;

    private ?User $fallback = null;
}
`;
    const { properties } = parsePhpClassStructure(source);
    const block = renderConstructor(properties);

    expect(insertGeneratedClassMemberForTest(source, block)).toBe(`<?php

namespace App\\Services;

use App\\Models\\User;
use Illuminate\\Contracts\\Cache\\Repository;

class UserCache
{
    private Repository $cache;

    private ?User $fallback = null;

    public function __construct(Repository $cache, ?User $fallback = null)
    {
        $this->cache = $cache;
        $this->fallback = $fallback;
    }
}
`);
  });

  it("keeps declared properties and renders safe assignments when legacy promotion is requested", () => {
    const source = `<?php

class Account
{
    private string $name;

    private int $balance;
}
`;
    const { properties } = parsePhpClassStructure(source);
    const block = renderConstructor(properties, { promotion: true });

    expect(block).toBe(
      [
        "public function __construct(string $name, int $balance)",
        "{",
        "    $this->name = $name;",
        "    $this->balance = $balance;",
        "}",
      ].join("\n"),
    );
    expect(insertGeneratedClassMemberForTest(source, block)).toBe(`<?php

class Account
{
    private string $name;

    private int $balance;

    public function __construct(string $name, int $balance)
    {
        $this->name = $name;
        $this->balance = $balance;
    }
}
`);
  });

  it("renders an empty constructor for an empty property list (classic)", () => {
    const result = renderConstructor([]);

    expect(result).toBe(
      ["public function __construct()", "{", "}"].join("\n"),
    );
  });

  it("renders an empty constructor when only static properties exist (promotion)", () => {
    const result = renderConstructor(
      [property({ name: "instances", type: "int", isStatic: true })],
      { mode: "promoted" },
    );

    expect(result).toBe("public function __construct() {}");
  });

  it("honours a custom base indent (classic)", () => {
    const result = renderConstructor(
      [property({ name: "name", type: "string" })],
      { indent: "  " },
    );

    expect(result).toBe(
      [
        "  public function __construct(string $name)",
        "  {",
        "      $this->name = $name;",
        "  }",
      ].join("\n"),
    );
  });

  it("honours a custom base indent (promotion)", () => {
    const result = renderConstructor(
      [property({ name: "name", type: "string", visibility: "public" })],
      { mode: "promoted", indent: "  " },
    );

    expect(result).toBe(
      [
        "  public function __construct(",
        "      public string $name,",
        "  ) {}",
      ].join("\n"),
    );
  });
});

describe("renderConstructor (required-before-optional ordering)", () => {
  it("reorders a defaulted property after a later required one (classic)", () => {
    const result = renderConstructor([
      property({ name: "name", type: "string", defaultValue: "'default'" }),
      property({ name: "timeout", type: "int" }),
    ]);

    expect(result).toBe(
      [
        "public function __construct(int $timeout, string $name = 'default')",
        "{",
        "    $this->timeout = $timeout;",
        "    $this->name = $name;",
        "}",
      ].join("\n"),
    );
  });

  it("reorders a defaulted property after a later required one (promotion)", () => {
    const result = renderConstructor(
      [
        property({
          name: "name",
          type: "string",
          visibility: "public",
          defaultValue: "'default'",
        }),
        property({ name: "timeout", type: "int", visibility: "public" }),
      ],
      { mode: "promoted" },
    );

    expect(result).toBe(
      [
        "public function __construct(",
        "    public int $timeout,",
        "    public string $name = 'default',",
        ") {}",
      ].join("\n"),
    );
  });

  it("preserves declaration order when every property is required", () => {
    const result = renderConstructor([
      property({ name: "first", type: "int" }),
      property({ name: "second", type: "string" }),
      property({ name: "third", type: "bool" }),
    ]);

    expect(result).toBe(
      [
        "public function __construct(int $first, string $second, bool $third)",
        "{",
        "    $this->first = $first;",
        "    $this->second = $second;",
        "    $this->third = $third;",
        "}",
      ].join("\n"),
    );
  });

  it("preserves declaration order when every property is optional", () => {
    const result = renderConstructor([
      property({ name: "first", type: "int", defaultValue: "1" }),
      property({ name: "second", type: "string", defaultValue: "'x'" }),
      property({ name: "third", type: "bool", defaultValue: "false" }),
    ]);

    expect(result).toBe(
      [
        "public function __construct(int $first = 1, string $second = 'x', bool $third = false)",
        "{",
        "    $this->first = $first;",
        "    $this->second = $second;",
        "    $this->third = $third;",
        "}",
      ].join("\n"),
    );
  });

  it("stably groups required before optional for a mixed list (classic)", () => {
    const result = renderConstructor([
      property({ name: "reqA", type: "int" }),
      property({ name: "optA", type: "string", defaultValue: "'a'" }),
      property({ name: "reqB", type: "bool" }),
      property({ name: "optB", type: "float", defaultValue: "1.0" }),
    ]);

    expect(result).toBe(
      [
        "public function __construct(int $reqA, bool $reqB, string $optA = 'a', float $optB = 1.0)",
        "{",
        "    $this->reqA = $reqA;",
        "    $this->reqB = $reqB;",
        "    $this->optA = $optA;",
        "    $this->optB = $optB;",
        "}",
      ].join("\n"),
    );
  });

  it("stably groups required before optional for a mixed list (promotion)", () => {
    const result = renderConstructor(
      [
        property({ name: "reqA", type: "int", visibility: "public" }),
        property({
          name: "optA",
          type: "string",
          visibility: "public",
          defaultValue: "'a'",
        }),
        property({ name: "reqB", type: "bool", visibility: "private" }),
        property({
          name: "optB",
          type: "float",
          visibility: "protected",
          defaultValue: "1.0",
        }),
      ],
      { mode: "promoted" },
    );

    expect(result).toBe(
      [
        "public function __construct(",
        "    public int $reqA,",
        "    private bool $reqB,",
        "    public string $optA = 'a',",
        "    protected float $optB = 1.0,",
        ") {}",
      ].join("\n"),
    );
  });
});

describe("propertyToParameter", () => {
  it("renders a classic parameter (no visibility, no readonly)", () => {
    expect(
      propertyToParameter(
        property({ name: "name", type: "string", visibility: "public" }),
        false,
      ),
    ).toBe("string $name");
  });

  it("renders a promoted parameter with visibility and readonly", () => {
    expect(
      propertyToParameter(
        property({
          name: "other",
          type: "?Other",
          visibility: "private",
          isReadonly: true,
          defaultValue: "null",
        }),
        true,
      ),
    ).toBe("private readonly ?Other $other = null");
  });
});
