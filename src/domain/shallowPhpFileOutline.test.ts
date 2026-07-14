import { describe, expect, it } from "vitest";
import { shallowPhpFileOutline } from "./shallowPhpFileOutline";
import type { PhpFileOutlineNode } from "./phpFileOutline";

const PATH = "/workspace/app/Huge.php";

function labels(nodes: PhpFileOutlineNode[]): string[] {
  return nodes.map((node) => node.label);
}

describe("shallowPhpFileOutline", () => {
  it("extracts top-level type declarations with members", () => {
    const outline = shallowPhpFileOutline(
      PATH,
      `<?php

namespace App\\Domain;

class User
{
    public const STATUS_ACTIVE = 'active';

    private string $name = 'default';

    public static ?int $count;

    public function rename(string $name): void
    {
        $callback = function (string $inner): string {
            return $inner;
        };
    }

    public static function make(): static
    {
        return new static();
    }
}
`,
    );

    expect(outline.nodes).toHaveLength(1);

    const classNode = outline.nodes[0];

    expect(classNode?.kind).toBe("class");
    expect(classNode?.label).toBe("User");
    expect(classNode?.fullyQualifiedName).toBe("App\\Domain\\User");
    expect(classNode?.path).toBe(PATH);
    expect(classNode?.relativePath).toBe("Huge.php");
    expect(classNode?.lineNumber).toBe(5);
    expect(classNode?.column).toBe(1);
    expect(labels(classNode?.children ?? [])).toEqual([
      "STATUS_ACTIVE",
      "$name",
      "$count",
      "rename",
      "make",
    ]);

    const method = classNode?.children.find((node) => node.label === "rename");

    expect(method?.kind).toBe("method");
    expect(method?.fullyQualifiedName).toBe("App\\Domain\\User::rename");
    expect(method?.lineNumber).toBe(13);
    expect(method?.path).toBe(PATH);

    const property = classNode?.children.find((node) => node.label === "$name");

    expect(property?.kind).toBe("property");
    expect(property?.fullyQualifiedName).toBe("App\\Domain\\User::$name");

    const constant = classNode?.children.find(
      (node) => node.label === "STATUS_ACTIVE",
    );

    expect(constant?.kind).toBe("constant");
  });

  it("lists interfaces, traits, enums and top-level functions in file order", () => {
    const outline = shallowPhpFileOutline(
      PATH,
      `<?php

interface Speaks
{
    public function speak(): string;
}

trait HasName
{
    public function name(): string
    {
        return 'name';
    }
}

enum Status: string
{
    case Active = 'active';

    public function label(): string
    {
        return $this->value;
    }
}

function helper(int $value): int
{
    return $value;
}

const TOP_LEVEL = 1;
`,
    );

    expect(
      outline.nodes.map((node) => [node.kind, node.label]),
    ).toEqual([
      ["interface", "Speaks"],
      ["trait", "HasName"],
      ["enum", "Status"],
      ["function", "helper"],
      ["constant", "TOP_LEVEL"],
    ]);
    expect(labels(outline.nodes[0]?.children ?? [])).toEqual(["speak"]);
    expect(labels(outline.nodes[1]?.children ?? [])).toEqual(["name"]);
    expect(labels(outline.nodes[2]?.children ?? [])).toEqual(["label"]);
    expect(outline.nodes[3]?.fullyQualifiedName).toBe("helper");
  });

  it("skips deep and disguised constructs", () => {
    const outline = shallowPhpFileOutline(
      PATH,
      `<?php

namespace App;

class Outer
{
    public function __construct(private int $promoted = 0)
    {
    }

    public function run(): void
    {
        function nestedNamed(): void
        {
        }

        $anonymous = new class {
            public function hidden(): void
            {
            }

            private string $hiddenProperty = '';
        };

        $closure = function () {
            return 'public function fromString(string $x)';
        };
    }
}

// class Commented {}
/* function commentedOut() {} */
$template = 'class InString { public function inString() {} }';
`,
    );

    expect(outline.nodes).toHaveLength(1);
    expect(outline.nodes[0]?.label).toBe("Outer");
    expect(labels(outline.nodes[0]?.children ?? [])).toEqual([
      "__construct",
      "run",
    ]);
  });

  it("qualifies members inside braced namespaces", () => {
    const outline = shallowPhpFileOutline(
      PATH,
      `<?php

namespace App\\First {
    class Alpha
    {
        public function go(): void
        {
        }
    }
}

namespace {
    function bare(): void
    {
    }
}
`,
    );

    expect(outline.nodes.map((node) => node.label)).toEqual(["Alpha", "bare"]);
    expect(outline.nodes[0]?.fullyQualifiedName).toBe("App\\First\\Alpha");
    expect(labels(outline.nodes[0]?.children ?? [])).toEqual(["go"]);
    expect(outline.nodes[1]?.fullyQualifiedName).toBe("bare");
  });

  it("lists every symbol of grouped property and constant declarations", () => {
    const outline = shallowPhpFileOutline(
      PATH,
      `<?php
namespace App;

class Config
{
    public int $a, $b, $c;

    const A = 1, B = 2;
}
`,
    );

    const children = outline.nodes[0]?.children ?? [];

    expect(labels(children)).toEqual(["$a", "$b", "$c", "A", "B"]);
    expect(children[1]?.fullyQualifiedName).toBe("App\\Config::$b");
    expect(children[1]?.lineNumber).toBe(6);
    expect(children[4]?.fullyQualifiedName).toBe("App\\Config::B");
  });

  it("keeps array initializer commas out of grouped declaration segments", () => {
    const outline = shallowPhpFileOutline(
      PATH,
      `<?php
class Config
{
    const A = [1, 2], B = 3;

    public array $x = [1, 2], $y = [];
}
`,
    );

    expect(labels(outline.nodes[0]?.children ?? [])).toEqual([
      "A",
      "B",
      "$x",
      "$y",
    ]);
  });

  it("stops a hooked property scan at its hook body instead of spilling into later declarations", () => {
    const outline = shallowPhpFileOutline(
      PATH,
      `<?php
namespace App;

class Config
{
    public int $x { get => 1; }
    public int $a, $b;
}
`,
    );

    const children = outline.nodes[0]?.children ?? [];

    expect(labels(children)).toEqual(["$x", "$a", "$b"]);
    expect(children[0]?.lineNumber).toBe(6);
    expect(children[1]?.lineNumber).toBe(7);
    expect(children[2]?.lineNumber).toBe(7);
  });

  it("does not emit phantom members from grouped promoted constructor parameters", () => {
    const outline = shallowPhpFileOutline(
      PATH,
      `<?php
class C
{
    public function __construct(public int $a, public int $b)
    {
    }
}
`,
    );

    expect(labels(outline.nodes[0]?.children ?? [])).toEqual(["__construct"]);
  });

  it("lists every symbol of a typed grouped constant declaration", () => {
    const outline = shallowPhpFileOutline(
      PATH,
      `<?php
class C
{
    const int A = 1, B = 2;
}
`,
    );

    expect(labels(outline.nodes[0]?.children ?? [])).toEqual(["A", "B"]);
  });

  it("groups constants whose initializers reference class constants", () => {
    const outline = shallowPhpFileOutline(
      PATH,
      `<?php
class C
{
    const A = self::B, C = 2;
}
`,
    );

    expect(labels(outline.nodes[0]?.children ?? [])).toEqual(["A", "C"]);
  });

  it("keeps outline node ids aligned with the full pipeline's symbol ids", () => {
    const outline = shallowPhpFileOutline(
      PATH,
      `<?php
namespace App;

class Thing
{
    public function act(): void
    {
    }
}
`,
    );

    expect(outline.nodes[0]?.id).toBe("symbol:App\\Thing");
    expect(outline.nodes[0]?.children[0]?.id).toBe("symbol:App\\Thing::act");
  });

  it("returns an empty outline for sources without declarations", () => {
    const outline = shallowPhpFileOutline(PATH, "x".repeat(64));

    expect(outline.nodes).toEqual([]);
  });

  it("stays fast on a CarbonInterface-sized file", () => {
    // The full TS structural parser (parsePhpClassStructure) measures 735ms at
    // 256KB and grows quadratically (3s at 512KB, minutes at 5MB), which is why
    // large files previously lost their outline entirely. The shallow pass must
    // stay a single linear scan: generous absolute bound for slow CI machines.
    const methods = Array.from(
      { length: 200 },
      (_, index) => `    /**
     * Does thing number ${index} with a 'quoted' payload // not a comment.
     * @param string $value the value ${index}
     */
    public function doThing${index}(string $value = 'default ${index}', int $count = ${index}): static
    {
        $closure${index} = function () use ($value) {
            return $value . ' ${index}';
        };

        return $this;
    }
`,
    ).join("\n");
    const padding = Array.from(
      { length: 3600 },
      (_, index) => `// filler line ${index} keeping the file over the line limit`,
    ).join("\n");
    const source = `<?php

namespace App\\Generated;

class HugeGenerated
{
${methods}}

${padding}
`;

    expect(source.length).toBeGreaterThan(256 * 1024);
    expect(source.split("\n").length).toBeGreaterThan(5_000);

    const start = performance.now();
    const outline = shallowPhpFileOutline(PATH, source);
    const elapsed = performance.now() - start;

    expect(outline.nodes).toHaveLength(1);
    expect(outline.nodes[0]?.children).toHaveLength(200);
    expect(elapsed).toBeLessThan(200);
  });
});
