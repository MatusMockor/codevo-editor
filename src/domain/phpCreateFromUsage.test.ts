import { describe, expect, it } from "vitest";
import {
  detectMissingThisMember,
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
