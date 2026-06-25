import { describe, expect, it } from "vitest";
import {
  renderImplementMethodsStubs,
  renderMethodStub,
  renderOverrideMethodStub,
  renderOverrideMethodsStubs,
  renderUseImports,
} from "./phpCodeGen";
import type {
  PhpMethodMember,
  PhpStructuredParameter,
} from "./phpClassStructure";

function param(
  overrides: Partial<PhpStructuredParameter> & { name: string },
): PhpStructuredParameter {
  return {
    defaultValue: null,
    isByRef: false,
    isOptional: false,
    isVariadic: false,
    type: null,
    ...overrides,
  };
}

function method(
  overrides: Partial<PhpMethodMember> & { name: string },
): PhpMethodMember {
  return {
    declarationOffset: 0,
    isAbstract: true,
    isFinal: false,
    isStatic: false,
    parameters: [],
    phpDoc: null,
    returnType: null,
    visibility: "public",
    ...overrides,
  };
}

describe("renderMethodStub", () => {
  it("renders a simple parameterless method with a throw body", () => {
    const stub = renderMethodStub(method({ name: "boot" }));

    expect(stub).toBe(
      [
        "    public function boot()",
        "    {",
        "        throw new \\RuntimeException('Not implemented');",
        "    }",
      ].join("\n"),
    );
  });

  it("renders a void method body without a return (TODO only)", () => {
    const stub = renderMethodStub(
      method({ name: "handle", returnType: "void" }),
    );

    expect(stub).toBe(
      [
        "    public function handle(): void",
        "    {",
        "        // TODO: Implement handle().",
        "    }",
      ].join("\n"),
    );
  });

  it("renders a never return type with a TODO-only body", () => {
    const stub = renderMethodStub(
      method({ name: "fail", returnType: "never" }),
    );

    expect(stub).toBe(
      [
        "    public function fail(): never",
        "    {",
        "        // TODO: Implement fail().",
        "    }",
      ].join("\n"),
    );
  });

  it("renders a non-void return type with a safe throw body", () => {
    const stub = renderMethodStub(
      method({ name: "all", returnType: "array" }),
    );

    expect(stub).toBe(
      [
        "    public function all(): array",
        "    {",
        "        throw new \\RuntimeException('Not implemented');",
        "    }",
      ].join("\n"),
    );
  });

  it("renders nullable, union and intersection parameter types verbatim", () => {
    const stub = renderMethodStub(
      method({
        name: "go",
        parameters: [
          param({ name: "$a", type: "?User" }),
          param({ name: "$b", type: "int|string" }),
          param({ name: "$c", type: "Countable&Traversable" }),
        ],
        returnType: "void",
      }),
    );

    expect(stub).toContain(
      "public function go(?User $a, int|string $b, Countable&Traversable $c): void",
    );
  });

  it("renders a variadic parameter", () => {
    const stub = renderMethodStub(
      method({
        name: "sum",
        parameters: [param({ name: "$nums", type: "int", isVariadic: true })],
        returnType: "int",
      }),
    );

    expect(stub).toContain("public function sum(int ...$nums): int");
  });

  it("renders a by-reference parameter", () => {
    const stub = renderMethodStub(
      method({
        name: "fill",
        parameters: [param({ name: "$ref", type: "array", isByRef: true })],
        returnType: "void",
      }),
    );

    expect(stub).toContain("public function fill(array &$ref): void");
  });

  it("renders a by-reference variadic parameter", () => {
    const stub = renderMethodStub(
      method({
        name: "collect",
        parameters: [
          param({
            name: "$rest",
            type: "string",
            isByRef: true,
            isVariadic: true,
          }),
        ],
        returnType: "void",
      }),
    );

    expect(stub).toContain("public function collect(string &...$rest): void");
  });

  it("renders default values verbatim", () => {
    const stub = renderMethodStub(
      method({
        name: "go",
        parameters: [
          param({ name: "$x", type: "array", defaultValue: "[]" }),
          param({ name: "$y", type: "int", defaultValue: "self::CONST" }),
          param({ name: "$z", type: "?string", defaultValue: "null" }),
        ],
        returnType: "void",
      }),
    );

    expect(stub).toContain(
      "public function go(array $x = [], int $y = self::CONST, ?string $z = null): void",
    );
  });

  it("renders an untyped parameter without a leading space", () => {
    const stub = renderMethodStub(
      method({
        name: "go",
        parameters: [param({ name: "$x" })],
      }),
    );

    expect(stub).toContain("public function go($x)");
  });

  it("preserves the static modifier", () => {
    const stub = renderMethodStub(
      method({ name: "make", isStatic: true, returnType: "static" }),
    );

    expect(stub).toContain("public static function make(): static");
  });

  it("forces public visibility for the generated implementation", () => {
    const stub = renderMethodStub(
      method({ name: "go", visibility: "protected", returnType: "void" }),
    );

    expect(stub).toContain("public function go(): void");
    expect(stub).not.toContain("protected");
  });

  it("does not emit abstract or final keywords on the concrete stub", () => {
    const stub = renderMethodStub(
      method({
        name: "go",
        isAbstract: true,
        isFinal: true,
        returnType: "void",
      }),
    );

    expect(stub).not.toContain("abstract");
    expect(stub).not.toContain("final");
    expect(stub).toContain("public function go(): void");
  });

  it("emits a PHPDoc block when phpDoc types are richer than the signature", () => {
    const stub = renderMethodStub(
      method({
        name: "go",
        parameters: [param({ name: "$users", type: "array" })],
        returnType: "Collection",
        phpDoc: {
          raw: "/**\n * @param array<int, User> $users\n * @return Collection<int, User>\n */",
          params: { users: "array<int, User>" },
          returnType: "Collection<int, User>",
        },
      }),
    );

    expect(stub).toBe(
      [
        "    /**",
        "     * @param array<int, User> $users",
        "     * @return Collection<int, User>",
        "     */",
        "    public function go(array $users): Collection",
        "    {",
        "        throw new \\RuntimeException('Not implemented');",
        "    }",
      ].join("\n"),
    );
  });

  it("emits a PHPDoc block when only the @return is richer than native", () => {
    const stub = renderMethodStub(
      method({
        name: "all",
        parameters: [param({ name: "$id", type: "int" })],
        returnType: "array",
        phpDoc: {
          raw: "/**\n * @param int $id\n * @return array<int, User>\n */",
          params: { id: "int" },
          returnType: "array<int, User>",
        },
      }),
    );

    expect(stub).toContain("@return array<int, User>");
  });

  it("emits a PHPDoc block when only a @param is richer than native", () => {
    const stub = renderMethodStub(
      method({
        name: "save",
        parameters: [param({ name: "$key", type: "string" })],
        returnType: "void",
        phpDoc: {
          raw: "/**\n * @param non-empty-string $key\n */",
          params: { key: "non-empty-string" },
          returnType: null,
        },
      }),
    );

    expect(stub).toContain("@param non-empty-string $key");
  });

  it("emits a PHPDoc block when phpDoc types a parameter that has no native type", () => {
    const stub = renderMethodStub(
      method({
        name: "go",
        parameters: [param({ name: "$users" })],
        returnType: "void",
        phpDoc: {
          raw: "/**\n * @param User[] $users\n */",
          params: { users: "User[]" },
          returnType: null,
        },
      }),
    );

    expect(stub).toContain("@param User[] $users");
  });

  it("treats types as equivalent regardless of case", () => {
    const stub = renderMethodStub(
      method({
        name: "go",
        parameters: [param({ name: "$id", type: "int" })],
        returnType: "Array",
        phpDoc: {
          raw: "/**\n * @param INT $id\n * @return array\n */",
          params: { id: "INT" },
          returnType: "array",
        },
      }),
    );

    expect(stub).not.toContain("/**");
    expect(stub).toContain("public function go(int $id): Array");
  });

  it("does not emit a PHPDoc block when it adds nothing over the signature", () => {
    const stub = renderMethodStub(
      method({
        name: "go",
        parameters: [param({ name: "$id", type: "int" })],
        returnType: "User",
        phpDoc: {
          raw: "/**\n * @param int $id\n * @return User\n */",
          params: { id: "int" },
          returnType: "User",
        },
      }),
    );

    expect(stub).not.toContain("/**");
    expect(stub).not.toContain("@param");
    expect(stub).toContain("public function go(int $id): User");
  });

  it("honours a custom indent for the stub, with a fixed 4-space body step", () => {
    const stub = renderMethodStub(method({ name: "boot" }), { indent: "  " });

    expect(stub).toBe(
      [
        "  public function boot()",
        "  {",
        "      throw new \\RuntimeException('Not implemented');",
        "  }",
      ].join("\n"),
    );
  });

  it("supports an explicit todo body style for a returning method", () => {
    const stub = renderMethodStub(
      method({ name: "all", returnType: "array" }),
      { bodyStyle: "todo" },
    );

    expect(stub).toContain("// TODO: Implement all().");
    expect(stub).not.toContain("throw new");
  });
});

describe("renderImplementMethodsStubs", () => {
  it("joins multiple stubs with a single blank line between them", () => {
    const stubs = renderImplementMethodsStubs([
      method({ name: "first", returnType: "void" }),
      method({ name: "second", returnType: "void" }),
    ]);

    expect(stubs).toBe(
      [
        "    public function first(): void",
        "    {",
        "        // TODO: Implement first().",
        "    }",
        "",
        "    public function second(): void",
        "    {",
        "        // TODO: Implement second().",
        "    }",
      ].join("\n"),
    );
  });

  it("returns an empty string for no members", () => {
    expect(renderImplementMethodsStubs([])).toBe("");
  });
});

describe("renderUseImports", () => {
  it("renders sorted, deduplicated use lines with no leading backslash", () => {
    const imports = renderUseImports([
      "\\App\\Models\\User",
      "App\\Support\\Collection",
      "App\\Models\\User",
    ]);

    expect(imports).toBe(
      ["use App\\Models\\User;", "use App\\Support\\Collection;"].join("\n"),
    );
  });

  it("ignores blank entries and returns an empty string when nothing remains", () => {
    expect(renderUseImports(["", "   ", "\\"])).toBe("");
  });

  it("sorts mixed-case FQNs with a stable, case-insensitive collation", () => {
    const imports = renderUseImports([
      "App\\Zebra",
      "App\\apple",
      "App\\Banana",
    ]);

    expect(imports).toBe(
      ["use App\\apple;", "use App\\Banana;", "use App\\Zebra;"].join("\n"),
    );
  });
});

describe("renderOverrideMethodStub", () => {
  it("renders a returning override that delegates to parent::", () => {
    const stub = renderOverrideMethodStub(
      method({ name: "handle", isAbstract: false, returnType: "string" }),
    );

    expect(stub).toBe(
      [
        "    /**",
        "     * @inheritDoc",
        "     */",
        "    public function handle(): string",
        "    {",
        "        return parent::handle();",
        "    }",
      ].join("\n"),
    );
  });

  it("renders a void override that calls parent:: without returning", () => {
    const stub = renderOverrideMethodStub(
      method({ name: "boot", isAbstract: false, returnType: "void" }),
    );

    expect(stub).toBe(
      [
        "    /**",
        "     * @inheritDoc",
        "     */",
        "    public function boot(): void",
        "    {",
        "        parent::boot();",
        "    }",
      ].join("\n"),
    );
  });

  it("treats a never return type as a non-returning parent call", () => {
    const stub = renderOverrideMethodStub(
      method({ name: "fail", isAbstract: false, returnType: "never" }),
    );

    expect(stub).toContain("        parent::fail();");
    expect(stub).not.toContain("return parent::fail();");
  });

  it("returns from parent:: when the method has no declared return type", () => {
    const stub = renderOverrideMethodStub(
      method({ name: "value", isAbstract: false, returnType: null }),
    );

    expect(stub).toContain("        return parent::value();");
  });

  it("preserves protected visibility on the override", () => {
    const stub = renderOverrideMethodStub(
      method({
        name: "guarded",
        isAbstract: false,
        visibility: "protected",
        returnType: "void",
      }),
    );

    expect(stub).toContain("    protected function guarded(): void");
    expect(stub).toContain("        parent::guarded();");
    expect(stub).not.toContain("public function guarded");
  });

  it("preserves the static modifier and calls parent:: statically", () => {
    const stub = renderOverrideMethodStub(
      method({
        name: "make",
        isAbstract: false,
        isStatic: true,
        returnType: "static",
      }),
    );

    expect(stub).toContain("    public static function make(): static");
    expect(stub).toContain("        return parent::make();");
  });

  it("never emits abstract or final keywords on the override", () => {
    const stub = renderOverrideMethodStub(
      method({
        name: "go",
        isAbstract: false,
        isFinal: true,
        returnType: "void",
      }),
    );

    expect(stub).not.toContain("abstract");
    expect(stub).not.toContain("final");
    expect(stub).toContain("    public function go(): void");
  });

  it("reproduces parameters verbatim and forwards them to parent::", () => {
    const stub = renderOverrideMethodStub(
      method({
        name: "go",
        isAbstract: false,
        parameters: [
          param({ name: "$a", type: "?User" }),
          param({ name: "$b", type: "int|string", defaultValue: "0" }),
        ],
        returnType: "void",
      }),
    );

    expect(stub).toContain(
      "    public function go(?User $a, int|string $b = 0): void",
    );
    expect(stub).toContain("        parent::go($a, $b);");
  });

  it("spreads a variadic argument into the parent:: call", () => {
    const stub = renderOverrideMethodStub(
      method({
        name: "sum",
        isAbstract: false,
        parameters: [param({ name: "$nums", type: "int", isVariadic: true })],
        returnType: "int",
      }),
    );

    expect(stub).toContain("    public function sum(int ...$nums): int");
    expect(stub).toContain("        return parent::sum(...$nums);");
  });

  it("forwards a by-reference parameter as a plain argument", () => {
    const stub = renderOverrideMethodStub(
      method({
        name: "fill",
        isAbstract: false,
        parameters: [param({ name: "$ref", type: "array", isByRef: true })],
        returnType: "void",
      }),
    );

    expect(stub).toContain("    public function fill(array &$ref): void");
    expect(stub).toContain("        parent::fill($ref);");
  });

  it("spreads a by-reference variadic parameter into the parent:: call", () => {
    const stub = renderOverrideMethodStub(
      method({
        name: "collect",
        isAbstract: false,
        parameters: [
          param({
            name: "$rest",
            type: "string",
            isByRef: true,
            isVariadic: true,
          }),
        ],
        returnType: "void",
      }),
    );

    expect(stub).toContain("    public function collect(string &...$rest): void");
    expect(stub).toContain("        parent::collect(...$rest);");
  });

  it("honours a custom indent with a fixed 4-space body step", () => {
    const stub = renderOverrideMethodStub(
      method({ name: "boot", isAbstract: false, returnType: "void" }),
      { indent: "  " },
    );

    expect(stub).toBe(
      [
        "  /**",
        "   * @inheritDoc",
        "   */",
        "  public function boot(): void",
        "  {",
        "      parent::boot();",
        "  }",
      ].join("\n"),
    );
  });
});

describe("renderOverrideMethodsStubs", () => {
  it("joins multiple override stubs with a single blank line between them", () => {
    const stubs = renderOverrideMethodsStubs([
      method({ name: "first", isAbstract: false, returnType: "void" }),
      method({ name: "second", isAbstract: false, returnType: "void" }),
    ]);

    expect(stubs).toBe(
      [
        "    /**",
        "     * @inheritDoc",
        "     */",
        "    public function first(): void",
        "    {",
        "        parent::first();",
        "    }",
        "",
        "    /**",
        "     * @inheritDoc",
        "     */",
        "    public function second(): void",
        "    {",
        "        parent::second();",
        "    }",
      ].join("\n"),
    );
  });

  it("returns an empty string for no members", () => {
    expect(renderOverrideMethodsStubs([])).toBe("");
  });
});
