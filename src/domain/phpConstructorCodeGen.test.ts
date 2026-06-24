import { describe, expect, it } from "vitest";
import {
  propertyToParameter,
  renderConstructor,
} from "./phpConstructorCodeGen";
import type { PhpPropertyMember } from "./phpClassStructure";

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
      { promotion: true },
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
      { promotion: true },
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
      { promotion: true },
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

  it("renders an empty constructor for an empty property list (classic)", () => {
    const result = renderConstructor([]);

    expect(result).toBe(
      ["public function __construct()", "{", "}"].join("\n"),
    );
  });

  it("renders an empty constructor when only static properties exist (promotion)", () => {
    const result = renderConstructor(
      [property({ name: "instances", type: "int", isStatic: true })],
      { promotion: true },
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
      { promotion: true, indent: "  " },
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
