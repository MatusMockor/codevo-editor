import { describe, expect, it } from "vitest";
import {
  detectMissingThisMember,
  planPhpCreateFromUsage,
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

  it("detects the method when the diagnostic range starts on $this", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $§this->handle('x');\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      argTypes: ["string"],
      kind: "method",
      name: "handle",
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

  it.each([
    ["single argument", "$this->§send(1,);", ["int"]],
    ["multiple arguments", "$this->§send(1, 'x',);", ["int", "string"]],
    [
      "multi-line arguments",
      "$this->§send(\n            1,\n            'x',\n        );",
      ["int", "string"],
    ],
  ])("ignores a trailing comma with %s", (_name, call, argTypes) => {
    const { source, offset } = withMarker(
      `    public function run(): void\n    {\n        ${call}\n    }`,
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      argTypes,
      kind: "method",
      name: "send",
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

  it("detects a missing parent:: method when the cursor sits after the method name", () => {
    const source = [
      "<?php",
      "",
      "class Child extends Base",
      "{",
      "    public function run(): void",
      "    {",
      "        parent::handle();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("parent::handle") + "parent::handle".length;

    expect(detectMissingThisMember(source, offset)).toEqual({
      argTypes: [],
      kind: "method",
      name: "handle",
      parentClass: "Base",
      target: "parent",
    });
  });

  it("detects a missing parent:: method when the diagnostic range starts on parent", () => {
    const source = [
      "<?php",
      "",
      "class Child extends Base",
      "{",
      "    public function run(): void",
      "    {",
      "        parent::handle();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("parent::handle");

    expect(detectMissingThisMember(source, offset)).toEqual({
      argTypes: [],
      kind: "method",
      name: "handle",
      parentClass: "Base",
      target: "parent",
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
  it.each([["SELF"], ["Static"], ["Parent"], ["PARENT"]])(
    "does not surface an external candidate for the case-variant keyword receiver %s::",
    (receiver) => {
      const { source, offset } = withMarker(
        `    public function run(): void\n    {\n        ${receiver}::§foo();\n    }`,
      );

      expect(detectMissingThisMember(source, offset)).toBeNull();
    },
  );

  it("does not mistake `Myself::foo` for a self:: receiver", () => {
    const { source, offset } = withMarker(
      "    public function run(): void\n    {\n        $obj = Myself::§foo();\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      argTypes: [],
      isStatic: true,
      kind: "method",
      name: "foo",
      target: "external",
      targetClass: "Myself",
    });
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

describe("planPhpCreateFromUsage — same-file external ClassName:: members", () => {
  it("plans a public static method for a static call on a same-file class", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        OtherClass::missing('x');",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("OtherClass::missing") + "OtherClass::".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      argTypes: ["string"],
      isStatic: true,
      kind: "method",
      name: "missing",
      target: "external",
      targetClass: "OtherClass",
    });
    expect(plan?.owner?.name).toBe("Service");
    expect(plan?.sameFileExternal).toMatchObject({
      kind: "class",
      name: "OtherClass",
      namespace: null,
    });
    expect(plan?.sameFileExternal?.bodyStartOffset).toBe(source.indexOf("{"));
  });

  it("plans a constant for a non-call constant access on a same-file class", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): string",
      "    {",
      "        return OtherClass::MISSING;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("OtherClass::MISSING") + "OtherClass::".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      kind: "constant",
      name: "MISSING",
      target: "external",
      targetClass: "OtherClass",
    });
    expect(plan?.sameFileExternal?.name).toBe("OtherClass");
  });

  it("surfaces a cross-file candidate when the receiver class is not in the file", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        Unknown::missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("Unknown::missing") + "Unknown::".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      argTypes: [],
      isStatic: true,
      kind: "method",
      name: "missing",
      target: "external",
      targetClass: "Unknown",
    });
    expect(plan?.owner?.name).toBe("Service");
    expect(plan?.sameFileExternal).toBeUndefined();
  });

  it("surfaces a cross-file constant candidate when the receiver class is not in the file", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(): string",
      "    {",
      "        return Unknown::MISSING;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("Unknown::MISSING") + "Unknown::".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      kind: "constant",
      name: "MISSING",
      target: "external",
      targetClass: "Unknown",
    });
    expect(plan?.sameFileExternal).toBeUndefined();
  });

  it("surfaces a cross-file candidate when the receiver resolves to an imported class outside the file", () => {
    const source = [
      "<?php",
      "",
      "namespace App;",
      "",
      "use Vendor\\OtherClass;",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        OtherClass::missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("OtherClass::missing") + "OtherClass::".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toMatchObject({
      target: "external",
      targetClass: "OtherClass",
    });
    expect(plan?.sameFileExternal).toBeUndefined();
  });

  it("surfaces a cross-file candidate when an unqualified receiver only matches a class in another namespace", () => {
    const source = [
      "<?php",
      "",
      "namespace A {",
      "    class OtherClass",
      "    {",
      "    }",
      "}",
      "",
      "namespace B {",
      "    class Service",
      "    {",
      "        public function run(): void",
      "        {",
      "            OtherClass::missing();",
      "        }",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("OtherClass::missing") + "OtherClass::".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toMatchObject({
      target: "external",
      targetClass: "OtherClass",
    });
    expect(plan?.sameFileExternal).toBeUndefined();
  });

  it("returns null when the same-file sibling class extends another class", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass extends Model",
      "{",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        OtherClass::missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("OtherClass::missing") + "OtherClass::".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null when the same-file sibling class declares __callStatic", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "    public static function __callStatic($name, $arguments)",
      "    {",
      "    }",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        OtherClass::missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("OtherClass::missing") + "OtherClass::".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null when the static method already exists on the sibling class", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "    public static function missing(): void",
      "    {",
      "    }",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        OtherClass::missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("OtherClass::missing()") + "OtherClass::".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null when the constant already exists on the sibling class", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "    public const MISSING = 'x';",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): string",
      "    {",
      "        return OtherClass::MISSING;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.lastIndexOf("OtherClass::MISSING") + "OtherClass::".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it.each([
    ["interface", "interface Sibling\n{\n}"],
    ["enum", "enum Sibling\n{\n}"],
    ["trait", "trait Sibling\n{\n}"],
  ])("returns null when the same-file receiver is an %s", (_kind, sibling) => {
    const source = [
      "<?php",
      "",
      sibling,
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        Sibling::missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("Sibling::missing") + "Sibling::".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null for the ::class constant", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): string",
      "    {",
      "        return OtherClass::class;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("OtherClass::class") + "OtherClass::".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null for a static property access", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        OtherClass::$items = [];",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$items") + "$".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null for a qualified receiver", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        \\OtherClass::missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("\\OtherClass::missing") + "\\OtherClass::".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("ignores a ClassName:: usage inside a heredoc", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): string",
      "    {",
      "        return <<<EOT",
      "        value OtherClass::missing()",
      "        EOT;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("OtherClass::missing") + "OtherClass::".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("ignores a ClassName:: usage inside a string literal", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "}",
      "",
      "class Service",
      "{",
      '    public $note = "OtherClass::missing()";',
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("OtherClass::missing") + "OtherClass::".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("folds a class calling itself by name into the self target", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        Service::missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("Service::missing") + "Service::".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      argTypes: [],
      isStatic: true,
      kind: "method",
      name: "missing",
      target: "self",
    });
    expect(plan?.owner?.name).toBe("Service");
    expect(plan?.sameFileExternal).toBeUndefined();
  });

  it("keeps self:: resolution on the enclosing class untouched", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        self::missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("self::missing") + "self::".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      argTypes: [],
      isStatic: true,
      kind: "method",
      name: "missing",
      target: "self",
    });
    expect(plan?.sameFileExternal).toBeUndefined();
  });
});

describe("planPhpCreateFromUsage — typed parameter $var-> instance members", () => {
  it("surfaces a cross-file instance method candidate for a typed method parameter", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(User $user): void",
      "    {",
      "        $user->missing('x');",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      argTypes: ["string"],
      kind: "method",
      name: "missing",
      target: "external",
      targetClass: "User",
    });
    expect(plan?.owner?.name).toBe("Service");
    expect(plan?.sameFileExternal).toBeUndefined();
  });

  it("plans an instance method on a same-file sibling class", () => {
    const source = [
      "<?php",
      "",
      "class User",
      "{",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(User $user): void",
      "    {",
      "        $user->missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      argTypes: [],
      kind: "method",
      name: "missing",
      target: "external",
      targetClass: "User",
    });
    expect(plan?.sameFileExternal).toMatchObject({
      kind: "class",
      name: "User",
    });
  });

  it("offers the instance method from a free function with a typed parameter", () => {
    const source = [
      "<?php",
      "",
      "function run(User $user)",
      "{",
      "    $user->missing();",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      argTypes: [],
      kind: "method",
      name: "missing",
      target: "external",
      targetClass: "User",
    });
    expect(plan?.owner).toBeUndefined();
    expect(plan?.sameFileExternal).toBeUndefined();
  });

  it("resolves a same-file sibling from a free function usage", () => {
    const source = [
      "<?php",
      "",
      "class User",
      "{",
      "}",
      "",
      "function run(User $user)",
      "{",
      "    $user->missing();",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      argTypes: [],
      kind: "method",
      name: "missing",
      target: "external",
      targetClass: "User",
    });
    expect(plan?.owner).toBeUndefined();
    expect(plan?.sameFileExternal?.name).toBe("User");
  });

  it("folds a typed parameter of the enclosing class into a non-static self member", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(Service $other): void",
      "    {",
      "        $other->missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$other->missing") + "$other->".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      argTypes: [],
      kind: "method",
      name: "missing",
    });
    expect(plan?.owner?.name).toBe("Service");
    expect(plan?.sameFileExternal).toBeUndefined();
  });

  it("resolves a promoted constructor parameter typehint", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function __construct(private LoggerContract $logger)",
      "    {",
      "        $logger->missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$logger->missing") + "$logger->".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      argTypes: [],
      kind: "method",
      name: "missing",
      target: "external",
      targetClass: "LoggerContract",
    });
  });

  it("resolves a typed closure parameter as the enclosing signature", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        $callback = function (User $user) {",
      "            $user->missing();",
      "        };",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      argTypes: [],
      kind: "method",
      name: "missing",
      target: "external",
      targetClass: "User",
    });
  });

  it("resolves a typed arrow function parameter", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        $callback = fn (User $user) => $user->missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      argTypes: [],
      kind: "method",
      name: "missing",
      target: "external",
      targetClass: "User",
    });
  });

  it("returns null when the same-file sibling class extends another class", () => {
    const source = [
      "<?php",
      "",
      "class User extends Model",
      "{",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(User $user): void",
      "    {",
      "        $user->missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null when the same-file sibling class declares __call", () => {
    const source = [
      "<?php",
      "",
      "class User",
      "{",
      "    public function __call($name, $arguments)",
      "    {",
      "    }",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(User $user): void",
      "    {",
      "        $user->missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null when the method already exists on the same-file sibling", () => {
    const source = [
      "<?php",
      "",
      "class User",
      "{",
      "    public function missing(): void",
      "    {",
      "    }",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(User $user): void",
      "    {",
      "        $user->missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.lastIndexOf("$user->missing") + "$user->".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it.each([
    ["an untyped parameter", "$user"],
    ["a nullable typehint", "?User $user"],
    ["a union typehint", "User|Admin $user"],
    ["an intersection typehint", "Countable&Stringable $user"],
    ["a builtin string typehint", "string $user"],
    ["a builtin array typehint", "array $user"],
    ["an object typehint", "object $user"],
    ["a mixed typehint", "mixed $user"],
    ["a self typehint", "self $user"],
    ["a static typehint", "static $user"],
    ["a variadic typehint", "User ...$user"],
    ["a defaulted nullable parameter", "User $user = null"],
  ])("returns null for %s", (_name, parameter) => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      `    public function run(${parameter}): void`,
      "    {",
      "        $user->missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null for a local variable that is not a parameter", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        $user = new User();",
      "        $user->missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null for an outer parameter captured inside an arrow function", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(User $user): void",
      "    {",
      "        $callback = fn () => $user->missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null for an outer parameter used inside a closure via use", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(User $user): void",
      "    {",
      "        $callback = function () use ($user) {",
      "            $user->missing();",
      "        };",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null for a non-call property access on a typed parameter", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(User $user): void",
      "    {",
      "        $user->missing = 1;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("keeps rejecting a static call on a variable receiver", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(User $user): void",
      "    {",
      "        $user::missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user::missing") + "$user::".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null for a nullsafe access on a typed parameter", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(User $user): void",
      "    {",
      "        $user?->missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user?->missing") + "$user?->".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null for a dynamic property receiver", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(User $user): void",
      "    {",
      "        $this->$user->missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("missing");

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("ignores a typed-parameter usage inside a heredoc", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(User $user): string",
      "    {",
      "        return <<<EOT",
      "        value $user->missing()",
      "        EOT;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$user->missing") + "$user->".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("keeps `$this->` usages on the self path", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(User $user): void",
      "    {",
      "        $this->missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("$this->missing") + "$this->".length;

    const plan = planPhpCreateFromUsage(source, offset);

    expect(plan?.member).toEqual({
      argTypes: [],
      kind: "method",
      name: "missing",
    });
    expect(plan?.owner?.name).toBe("Service");
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

describe("planPhpCreateFromUsage — case-insensitive method existence", () => {
  it("returns null when the method exists with different casing on $this", () => {
    const { source, offset } = withMarker(
      "    public function missing(): void\n    {\n    }\n\n    public function run(): void\n    {\n        $this->§MISSING();\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toBeNull();
  });

  it("returns null when the sibling class declares the static method with different casing", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "    public static function missing(): void",
      "    {",
      "    }",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        OtherClass::MISSING();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("OtherClass::MISSING") + "OtherClass::".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("returns null when the sibling class declares __CALL with different casing", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "    public function __CALL($name, $arguments)",
      "    {",
      "    }",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        OtherClass::missing();",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("OtherClass::missing") + "OtherClass::".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("keeps constants case-sensitive: exact-case constant access stays suppressed", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "    public const FOO = 'x';",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): string",
      "    {",
      "        return OtherClass::FOO;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.lastIndexOf("OtherClass::FOO") + "OtherClass::".length;

    expect(planPhpCreateFromUsage(source, offset)).toBeNull();
  });

  it("keeps constants case-sensitive: differently-cased constant access is still offered", () => {
    const source = [
      "<?php",
      "",
      "class OtherClass",
      "{",
      "    public const FOO = 'x';",
      "}",
      "",
      "class Service",
      "{",
      "    public function run(): string",
      "    {",
      "        return OtherClass::foo;",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset =
      source.indexOf("OtherClass::foo") + "OtherClass::".length;

    expect(planPhpCreateFromUsage(source, offset)?.member).toEqual({
      kind: "constant",
      name: "foo",
      target: "external",
      targetClass: "OtherClass",
    });
  });
});

describe("planPhpCreateFromUsage — first-class callable syntax", () => {
  it("infers zero parameters for a $this-> first-class callable reference", () => {
    const { source, offset } = withMarker(
      "    public function run(): callable\n    {\n        return $this->§handler(...);\n    }",
    );

    expect(detectMissingThisMember(source, offset)).toEqual({
      argTypes: [],
      kind: "method",
      name: "handler",
    });
  });

  it("infers zero parameters for a static first-class callable reference", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(): callable",
      "    {",
      "        return Registry::factory(...);",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("Registry::factory") + "Registry::".length;

    expect(planPhpCreateFromUsage(source, offset)?.member).toEqual({
      argTypes: [],
      isStatic: true,
      kind: "method",
      name: "factory",
      target: "external",
      targetClass: "Registry",
    });
  });

  it("still infers one parameter for a normal single-argument static call", () => {
    const source = [
      "<?php",
      "",
      "class Service",
      "{",
      "    public function run(): void",
      "    {",
      "        Registry::bar($x);",
      "    }",
      "}",
      "",
    ].join("\n");
    const offset = source.indexOf("Registry::bar") + "Registry::".length;

    expect(planPhpCreateFromUsage(source, offset)?.member).toEqual({
      argTypes: [null],
      isStatic: true,
      kind: "method",
      name: "bar",
      target: "external",
      targetClass: "Registry",
    });
  });
});
