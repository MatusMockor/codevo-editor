import { describe, expect, it } from "vitest";
import {
  detectMissingThisMember,
  renderCreateConstantStub,
  renderCreateMethodStub,
  renderCreatePropertyStub,
} from "./phpCreateFromUsage";

/**
 * Build a PHP class body and return the source plus the offset of a `$this->...`
 * usage marked by `§` in the body fragment. The marker is removed from the
 * final source; the returned `offset` points at the character that followed it.
 */
function withMarker(body: string): { source: string; offset: number } {
  const markerIndex = body.indexOf("§");

  if (markerIndex < 0) {
    throw new Error("test fixture must contain a § marker");
  }

  const cleaned = body.replace("§", "");
  const source = `<?php\n\nclass Service\n{\n${cleaned}\n}\n`;
  const offset = source.indexOf(cleaned) + markerIndex;

  return { source, offset };
}

describe("detectMissingThisMember — method calls", () => {
  it("detects a missing method call and infers literal argument types", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $this->§handle('x', 123);\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "method",
      name: "handle",
      argTypes: ["string", "int"],
    });
  });

  it("detects the method when the offset is on the member name itself", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $this->ha§ndle('x', 123);\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "method",
      name: "handle",
      argTypes: ["string", "int"],
    });
  });

  it("infers float, bool and array literal argument types", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $this->§calc(1.5, true, false, [1, 2]);\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "method",
      name: "calc",
      argTypes: ["float", "bool", "bool", "array"],
    });
  });

  it("infers `new Foo()` as Foo and `Foo::class` as string", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $this->§save(new User(), User::class);\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "method",
      name: "save",
      argTypes: ["User", "string"],
    });
  });

  it("uses null (unknown) for variable arguments and unrecognised expressions", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $this->§process($value, strlen('x'));\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "method",
      name: "process",
      argTypes: [null, null],
    });
  });

  it("returns an empty argTypes array for a no-argument method call", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $this->§boot();\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "method",
      name: "boot",
      argTypes: [],
    });
  });

  it("returns null when the called method already exists on the class", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        $this->handle();",
      "    }",
      "",
      "    private function handle(): void",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$this->handle();") + "$this->".length;

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });
});

describe("detectMissingThisMember — property access", () => {
  it("detects a missing property access", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        return $this->§repository;\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "property",
      name: "repository",
    });
  });

  it("returns null when the accessed property already exists on the class", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    private $repository;",
      "",
      "    public function run()",
      "    {",
      "        return $this->repository;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.lastIndexOf("$this->repository") + "$this->".length;

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });

  it("returns null when the accessed property exists as a promoted constructor property", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function __construct(private UserRepository $repository)",
      "    {",
      "    }",
      "",
      "    public function run()",
      "    {",
      "        return $this->repository;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.lastIndexOf("$this->repository") + "$this->".length;

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });
});

describe("detectMissingThisMember — negative / guard cases", () => {
  it("returns null when the offset is not on a `$this->` member", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $other->§handle();\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });

  it("returns null when the offset is inside a string literal", () => {
    const source = '<?php\n\nclass Service\n{\n    public $note = "$this->handle";\n}\n';
    const offset = source.indexOf("handle");

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });

  it("returns null when the `$this->` usage is inside a heredoc", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(): string",
      "    {",
      "        return <<<EOT",
      "        value $this->handle()",
      "        EOT;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$this->handle") + "$this->".length;

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });

  it("returns null for out-of-range offsets", () => {
    const source = "<?php\n\nclass Service\n{\n}\n";

    expect(detectMissingThisMember(source, -1)).toBeNull();
    expect(detectMissingThisMember(source, source.length + 50)).toBeNull();
  });
});

describe("detectMissingThisMember — self:: / static:: static members", () => {
  it("detects a missing self:: method call as a static method in the current class", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        self::§make('x', 123);\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "method",
      name: "make",
      argTypes: ["string", "int"],
      isStatic: true,
      target: "self",
    });
  });

  it("detects a missing static:: method call as a static method in the current class", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        static::§build();\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "method",
      name: "build",
      argTypes: [],
      isStatic: true,
      target: "self",
    });
  });

  it("detects a missing self::CONST access as a constant in the current class", () => {
    const { source, offset } = withMarker(
      "    public function run(): string\n    {\n        return self::§DEFAULT_NAME;\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "constant",
      name: "DEFAULT_NAME",
      target: "self",
    });
  });

  it("returns null when the self:: method already exists on the class", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        self::make();",
      "    }",
      "",
      "    private static function make(): void",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("self::make();") + "self::".length;

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });

  it("returns null when the self::CONST constant already exists on the class", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    private const DEFAULT_NAME = 'x';",
      "",
      "    public function run(): string",
      "    {",
      "        return self::DEFAULT_NAME;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.lastIndexOf("self::DEFAULT_NAME") + "self::".length;

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });
});

describe("detectMissingThisMember — parent:: cross-class members", () => {
  it("detects a missing parent:: method call as a method targeting the parent class", () => {
    const source = [
      "<?php",
      "",
      "class Child extends Base",
      "{",
      "    public function run(): void",
      "    {",
      "        parent::handle('x');",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("parent::handle") + "parent::".length;

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "method",
      name: "handle",
      argTypes: ["string"],
      target: "parent",
      parentClass: "Base",
    });
  });

  it("detects a non-call parent::CONST as a constant on the parent class", () => {
    const source = [
      "<?php",
      "",
      "class Child extends Base",
      "{",
      "    public function run(): string",
      "    {",
      "        return parent::DEFAULT_LABEL;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("parent::DEFAULT_LABEL") + "parent::".length;

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "constant",
      name: "DEFAULT_LABEL",
      target: "parent",
      parentClass: "Base",
    });
  });

  it("returns null for parent:: when the class has no extends clause", () => {
    const source = [
      "<?php",
      "",
      "class Orphan",
      "{",
      "    public function run(): void",
      "    {",
      "        parent::handle();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("parent::handle") + "parent::".length;

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });

  it("uses the extends clause of the class containing the cursor", () => {
    const source = [
      "<?php",
      "",
      "class Earlier extends WrongBase",
      "{",
      "}",
      "",
      "class Child extends RightBase",
      "{",
      "    public function run(): void",
      "    {",
      "        parent::handle();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("parent::handle") + "parent::".length;

    expect(detectMissingThisMember(source, offset)).toEqual({
      argTypes: [],
      kind: "method",
      name: "handle",
      parentClass: "RightBase",
      target: "parent",
    });
  });

  it("does not borrow an earlier class's extends clause", () => {
    const source = [
      "<?php",
      "",
      "class Earlier extends WrongBase",
      "{",
      "}",
      "",
      "class Orphan",
      "{",
      "    public function run(): void",
      "    {",
      "        parent::handle();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("parent::handle") + "parent::".length;

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });

  it("does not treat an interface extends clause as a parent class", () => {
    const source = [
      "<?php",
      "",
      "interface ChildContract extends BaseContract",
      "{",
      "    public function run(): void;",
      "",
      "    public function invalid(): void",
      "    {",
      "        parent::handle();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("parent::handle") + "parent::".length;

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });
});

describe("detectMissingThisMember — multi-class cursor scope", () => {
  it("does not let an earlier class member suppress creation", () => {
    const source = [
      "<?php",
      "",
      "class Earlier",
      "{",
      "    private function handle(): void {}",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        $this->handle();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.lastIndexOf("$this->handle") + "$this->".length;

    expect(detectMissingThisMember(source, offset)).toEqual({
      argTypes: [],
      kind: "method",
      name: "handle",
    });
  });

  it("checks existing members on the class containing the cursor", () => {
    const source = [
      "<?php",
      "",
      "class Earlier",
      "{",
      "}",
      "",
      "class Service",
      "{",
      "    private function handle(): void {}",
      "",
      "    public function run(): void",
      "    {",
      "        $this->handle();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.lastIndexOf("$this->handle") + "$this->".length;

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });
});

describe("detectMissingThisMember — typed property inference on assignment", () => {
  it("infers the property type from a `= new Foo()` assignment", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $this->§client = new HttpClient();\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "property",
      name: "client",
      propertyType: "HttpClient",
    });
  });

  it("infers the property type from a string literal assignment", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $this->§label = 'ready';\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "property",
      name: "label",
      propertyType: "string",
    });
  });

  it("infers array for a `= []` assignment", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $this->§items = [];\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "property",
      name: "items",
      propertyType: "array",
    });
  });

  it("leaves the property untyped when the assigned expression is uncertain", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $this->§value = $input;\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "property",
      name: "value",
    });
  });

  it("leaves the property untyped for a plain read (no assignment)", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        return $this->§repository;\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "property",
      name: "repository",
    });
  });

  it("does not treat an equality comparison as an assignment", () => {
    const { source, offset } = withMarker(
      "    public function run(): bool\n    {\n        return $this->§flag == true;\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "property",
      name: "flag",
    });
  });
});

describe("detectMissingThisMember — adversarial edges", () => {
  it("does not mistake `myself::foo` for a self:: receiver", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $obj = Myself::§foo();\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });

  it("infers a single string-literal method argument type (regression)", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $this->§handle('only');\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "method",
      name: "handle",
      argTypes: ["string"],
    });
  });

  it("ignores a `self::` usage inside a string literal", () => {
    const source =
      '<?php\n\nclass Service\n{\n    public $note = "self::make()";\n}\n';
    const offset = source.indexOf("make");

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });

  it("treats a `=` with a semicolon inside a string as a single assignment", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $this->§label = 'a;b';\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      kind: "property",
      name: "label",
      propertyType: "string",
    });
  });

  it("does not offer self:: const when an enum case of that name exists", () => {
    const source = [
      "<?php",
      "",
      "enum Status",
      "{",
      "    case ACTIVE;",
      "",
      "    public function label(): string",
      "    {",
      "        return self::ACTIVE->name;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("self::ACTIVE") + "self::".length;

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });

  it("does not offer self:: method when it already exists with extra modifiers", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        self::make();",
      "    }",
      "",
      "    final public static function make(): void",
      "    {",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("self::make();") + "self::".length;

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });
});

describe("renderCreateConstantStub", () => {
  it("renders a private constant with a placeholder value", () => {
    expect(renderCreateConstantStub("DEFAULT_NAME")).toBe(
      "    private const DEFAULT_NAME = null;",
    );
  });

  it("honours custom indent and visibility options", () => {
    expect(
      renderCreateConstantStub("LIMIT", { indent: "  ", visibility: "public" }),
    ).toBe("  public const LIMIT = null;");
  });
});

describe("renderCreateMethodStub — static", () => {
  it("renders a static method when the static option is set", () => {
    expect(
      renderCreateMethodStub("make", ["string"], { isStatic: true }),
    ).toBe(
      [
        "    private static function make(string $arg0)",
        "    {",
        "    }",
      ].join("\n"),
    );
  });
});

describe("renderCreateMethodStub", () => {
  it("renders a private method with typed params and an empty body", () => {
    expect(renderCreateMethodStub("handle", ["string", "int"])).toBe(
      ["    private function handle(string $arg0, int $arg1)", "    {", "    }"].join(
        "\n",
      ),
    );
  });

  it("omits the type when an argument type is unknown (null)", () => {
    expect(renderCreateMethodStub("process", [null, "bool"])).toBe(
      ["    private function process($arg0, bool $arg1)", "    {", "    }"].join("\n"),
    );
  });

  it("renders a no-argument method", () => {
    expect(renderCreateMethodStub("boot", [])).toBe(
      ["    private function boot()", "    {", "    }"].join("\n"),
    );
  });

  it("honours custom indent and visibility options", () => {
    expect(
      renderCreateMethodStub("handle", ["string"], {
        indent: "        ",
        visibility: "protected",
      }),
    ).toBe(
      [
        "        protected function handle(string $arg0)",
        "        {",
        "        }",
      ].join("\n"),
    );
  });
});

describe("renderCreatePropertyStub", () => {
  it("renders a private untyped property", () => {
    expect(renderCreatePropertyStub("repository")).toBe(
      "    private $repository;",
    );
  });

  it("renders a typed property", () => {
    expect(
      renderCreatePropertyStub("repository", { type: "UserRepository" }),
    ).toBe("    private UserRepository $repository;");
  });

  it("honours custom indent and visibility options", () => {
    expect(
      renderCreatePropertyStub("count", {
        indent: "  ",
        visibility: "protected",
        type: "int",
      }),
    ).toBe("  protected int $count;");
  });
});

describe("create-from-usage target rendering", () => {
  it("uses protected members for a same-file parent class", () => {
    const target = { kind: "class", relationship: "parent" } as const;

    expect(renderCreateMethodStub("handle", ["string"], { target })).toContain(
      "protected function handle(string $arg0)",
    );
    expect(renderCreateConstantStub("LIMIT", { target })).toBe(
      "    protected const LIMIT = null;",
    );
    expect(
      renderCreateMethodStub("forced", [], {
        target,
        visibility: "private",
      }),
    ).toContain("protected function forced()");
  });

  it("uses public members for an ordinary external class", () => {
    const target = { kind: "class", relationship: "external" } as const;

    expect(renderCreateMethodStub("handle", [], { target })).toContain(
      "public function handle()",
    );
    expect(renderCreatePropertyStub("value", { target, type: "string" })).toBe(
      "    public string $value;",
    );
  });

  it("renders legal interface methods and suppresses interface properties", () => {
    const target = { kind: "interface", relationship: "external" } as const;

    expect(renderCreateMethodStub("handle", ["string", null], { target })).toBe(
      "    public function handle(string $arg0, $arg1);",
    );
    expect(renderCreatePropertyStub("value", { target })).toBeNull();
  });

  it.each(["readonly-class", "trait", "enum", "unsupported"] as const)(
    "suppresses unsupported %s targets",
    (kind) => {
      const target = { kind, relationship: "external" } as const;

      expect(renderCreateMethodStub("handle", [], { target })).toBeNull();
      expect(renderCreatePropertyStub("value", { target })).toBeNull();
      expect(renderCreateConstantStub("VALUE", { target })).toBeNull();
    },
  );

  it("allows legal self members while suppressing unsafe properties", () => {
    expect(
      renderCreateMethodStub("run", [], {
        target: { kind: "enum", relationship: "self" },
      }),
    ).toContain("private function run()");
    expect(
      renderCreatePropertyStub("value", {
        target: { kind: "enum", relationship: "self" },
        type: "string",
      }),
    ).toBeNull();
    expect(
      renderCreatePropertyStub("value", {
        target: { kind: "readonly-class", relationship: "self" },
      }),
    ).toBeNull();
    expect(
      renderCreatePropertyStub("value", {
        target: { kind: "readonly-class", relationship: "self" },
        type: "string",
      }),
    ).toBe("    private string $value;");
  });

  it("keeps portable types and drops unresolved short types across namespaces", () => {
    const target = {
      kind: "class",
      relationship: "external",
    } as const;

    expect(
      renderCreateMethodStub("handle", ["string", "User", "\\App\\Dto\\Id"], {
        target,
      }),
    ).toContain(
      "public function handle(string $arg0, $arg1, \\App\\Dto\\Id $arg2)",
    );
    expect(renderCreatePropertyStub("user", { target, type: "User" })).toBe(
      "    public $user;",
    );
    expect(
      renderCreatePropertyStub("id", { target, type: "\\App\\Dto\\Id" }),
    ).toBe("    public \\App\\Dto\\Id $id;");
    expect(
      renderCreatePropertyStub("user", {
        target: { ...target, typeContext: "same-namespace" },
        type: "User",
      }),
    ).toBe("    public User $user;");
  });
});
