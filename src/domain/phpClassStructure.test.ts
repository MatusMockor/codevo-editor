import { describe, expect, it } from "vitest";
import {
  parsePhpClassStructure,
  type PhpMethodMember,
  type PhpPropertyMember,
} from "./phpClassStructure";

function methodNamed(
  methods: readonly PhpMethodMember[],
  name: string,
): PhpMethodMember {
  const method = methods.find((candidate) => candidate.name === name);

  if (!method) {
    throw new Error(`Missing method: ${name}`);
  }

  return method;
}

function propertyNamed(
  properties: readonly PhpPropertyMember[],
  name: string,
): PhpPropertyMember {
  const property = properties.find((candidate) => candidate.name === name);

  if (!property) {
    throw new Error(`Missing property: ${name}`);
  }

  return property;
}

describe("parsePhpClassStructure", () => {
  it("detects the kind of the declared type", () => {
    expect(parsePhpClassStructure("<?php class Foo {}").kind).toBe("class");
    expect(parsePhpClassStructure("<?php interface Foo {}").kind).toBe(
      "interface",
    );
    expect(parsePhpClassStructure("<?php trait Foo {}").kind).toBe("trait");
    expect(parsePhpClassStructure("<?php enum Foo {}").kind).toBe("enum");
    expect(parsePhpClassStructure("<?php abstract class Foo {}").kind).toBe(
      "abstract-class",
    );
    expect(parsePhpClassStructure("<?php $x = 1;").kind).toBeNull();
  });

  it("captures methods of all visibilities, not just public", () => {
    const source = `<?php
      class Foo {
        public function a(): void {}
        protected function b(): void {}
        private function c(): void {}
      }
    `;

    const { methods } = parsePhpClassStructure(source);

    expect(methods.map((method) => method.name).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(methodNamed(methods, "a").visibility).toBe("public");
    expect(methodNamed(methods, "b").visibility).toBe("protected");
    expect(methodNamed(methods, "c").visibility).toBe("private");
  });

  it("records the declaration offset at the method's function keyword", () => {
    const source = `<?php
class Foo {
    public function bar(): void {}
}
`;

    const { methods } = parsePhpClassStructure(source);
    const bar = methodNamed(methods, "bar");

    expect(source.startsWith("function", bar.declarationOffset)).toBe(true);
    expect(source.slice(bar.declarationOffset, bar.declarationOffset + 12)).toBe(
      "function bar",
    );
  });

  it("records a member-start offset that covers leading modifiers", () => {
    const source = `<?php
class Foo {
    public function bar(): void {}
}
`;

    const { methods } = parsePhpClassStructure(source);
    const bar = methodNamed(methods, "bar");

    // The member start sits at the `public` modifier, not the `function`
    // keyword, so a cursor on the modifier line still resolves to this method.
    expect(bar.memberStartOffset).toBe(source.indexOf("public function bar"));
    expect(bar.memberStartOffset).toBeLessThan(bar.declarationOffset);
  });

  it("extends the member-start offset above leading attributes", () => {
    const source = `<?php
class Foo {
    #[Route('/x')]
    #[Other]
    public function bar(): void {}
}
`;

    const { methods } = parsePhpClassStructure(source);
    const bar = methodNamed(methods, "bar");

    // The member start sits at the first attribute, above the modifiers.
    expect(bar.memberStartOffset).toBe(source.indexOf("#[Route('/x')]"));
    expect(bar.memberStartOffset).toBeLessThan(bar.declarationOffset);
  });

  it("does not swallow a preceding member into the member-start offset", () => {
    const source = `<?php
class Foo {
    public function first(): void {}

    #[Route('/x')]
    public function second(): void {}
}
`;

    const { methods } = parsePhpClassStructure(source);
    const second = methodNamed(methods, "second");

    // The member start of `second` stops after `first`'s closing brace, at its
    // own first attribute - it must not reach back into `first`.
    expect(second.memberStartOffset).toBe(source.indexOf("#[Route('/x')]"));
    expect(second.memberStartOffset).toBeGreaterThan(
      source.indexOf("public function first"),
    );
  });

  it("sets member-start to the function keyword when no modifiers precede it", () => {
    const source = `<?php
interface Foo {
    function bar(): void;
}
`;

    const { methods } = parsePhpClassStructure(source);
    const bar = methodNamed(methods, "bar");

    expect(bar.memberStartOffset).toBe(bar.declarationOffset);
  });

  it("covers attributes carrying nested array arguments", () => {
    const source = `<?php
class Foo {
    #[Attr([1, [2, 3]])]
    public function bar(): void {}
}
`;

    const { methods } = parsePhpClassStructure(source);
    const bar = methodNamed(methods, "bar");

    expect(bar.memberStartOffset).toBe(source.indexOf("#[Attr"));
  });

  it("does not let a leading PHPDoc bleed into the member-start offset", () => {
    const source = `<?php
class Foo {
    /** does stuff */
    public function bar(): void {}
}
`;

    const { methods } = parsePhpClassStructure(source);
    const bar = methodNamed(methods, "bar");

    // The member start stops at the `public` modifier; the docblock above it is
    // not part of the member span (insertion still anchors above `function`).
    expect(bar.memberStartOffset).toBe(source.indexOf("public function bar"));
  });

  it("defaults visibility to public when no modifier is present", () => {
    const source = `<?php
      class Foo {
        function noModifier(): void {}
      }
    `;

    const method = methodNamed(parsePhpClassStructure(source).methods, "noModifier");

    expect(method.visibility).toBe("public");
  });

  it("captures static, abstract and final modifiers", () => {
    const source = `<?php
      abstract class Foo {
        final public function a(): void {}
        public static function b(): void {}
        abstract protected function c(): void;
      }
    `;

    const { methods } = parsePhpClassStructure(source);

    expect(methodNamed(methods, "a").isFinal).toBe(true);
    expect(methodNamed(methods, "a").isStatic).toBe(false);
    expect(methodNamed(methods, "a").isAbstract).toBe(false);
    expect(methodNamed(methods, "b").isStatic).toBe(true);
    expect(methodNamed(methods, "c").isAbstract).toBe(true);
    expect(methodNamed(methods, "c").visibility).toBe("protected");
  });

  it("treats interface methods as implicitly public and abstract", () => {
    const source = `<?php
      interface Repository {
        public function find(int $id): ?User;
        public function all(): array;
      }
    `;

    const { kind, methods } = parsePhpClassStructure(source);

    expect(kind).toBe("interface");
    expect(methodNamed(methods, "find").visibility).toBe("public");
    expect(methodNamed(methods, "find").isAbstract).toBe(true);
    expect(methodNamed(methods, "all").isAbstract).toBe(true);
  });

  it("parses a variadic parameter", () => {
    const source = `<?php
      class Foo {
        public function sum(int ...$nums): int {}
      }
    `;

    const method = methodNamed(parsePhpClassStructure(source).methods, "sum");
    const [param] = method.parameters;

    expect(param?.name).toBe("$nums");
    expect(param?.type).toBe("int");
    expect(param?.isVariadic).toBe(true);
    expect(param?.isByRef).toBe(false);
  });

  it("parses a by-reference parameter", () => {
    const source = `<?php
      class Foo {
        public function fill(array &$ref): void {}
      }
    `;

    const method = methodNamed(parsePhpClassStructure(source).methods, "fill");
    const [param] = method.parameters;

    expect(param?.name).toBe("$ref");
    expect(param?.type).toBe("array");
    expect(param?.isByRef).toBe(true);
    expect(param?.isVariadic).toBe(false);
  });

  it("parses nullable, union and intersection parameter types", () => {
    const source = `<?php
      class Foo {
        public function go(?User $a, int|string $b, Countable&Traversable $c) {}
      }
    `;

    const { parameters } = methodNamed(
      parsePhpClassStructure(source).methods,
      "go",
    );

    expect(parameters[0]?.type).toBe("?User");
    expect(parameters[1]?.type).toBe("int|string");
    expect(parameters[2]?.type).toBe("Countable&Traversable");
  });

  it("parses default values without confusing them with the type", () => {
    const source = `<?php
      class Foo {
        public function go(array $x = [], int $y = self::CONST, ?string $z = null) {}
      }
    `;

    const { parameters } = methodNamed(
      parsePhpClassStructure(source).methods,
      "go",
    );

    expect(parameters[0]?.defaultValue).toBe("[]");
    expect(parameters[0]?.isOptional).toBe(true);
    expect(parameters[1]?.defaultValue).toBe("self::CONST");
    expect(parameters[2]?.defaultValue).toBe("null");
    expect(parameters[2]?.type).toBe("?string");
  });

  it("parses multi-line signatures", () => {
    const source = `<?php
      class Foo {
        public function create(
          string $name,
          ?int $age = null,
          bool $active = true
        ): User {}
      }
    `;

    const method = methodNamed(parsePhpClassStructure(source).methods, "create");

    expect(method.parameters.map((param) => param.name)).toEqual([
      "$name",
      "$age",
      "$active",
    ]);
    expect(method.returnType).toBe("User");
  });

  it("reads a return type that wraps onto the next line", () => {
    const source = `<?php
      class Repo {
        public function find(int $id): User
          |null
        { return null; }
      }
    `;

    const method = methodNamed(parsePhpClassStructure(source).methods, "find");

    expect(method.returnType).toBe("User|null");
  });

  it("reads a return type that starts on the line after the colon", () => {
    const source = `<?php
      class Repo {
        public function a():
          ?User
        {}
      }
    `;

    const method = methodNamed(parsePhpClassStructure(source).methods, "a");

    expect(method.returnType).toBe("?User");
  });

  it("reads a multiline DNF return type without truncating it", () => {
    const source = `<?php
      class Repo {
        public function a(): (A&B)
          |C
        {}
      }
    `;

    const method = methodNamed(parsePhpClassStructure(source).methods, "a");

    expect(method.returnType).toBe("(A&B)|C");
  });

  it("reads a multiline return type before an abstract method semicolon", () => {
    const source = `<?php
      abstract class Repo {
        abstract public function a(): User
          |null;
      }
    `;

    const method = methodNamed(parsePhpClassStructure(source).methods, "a");

    expect(method.returnType).toBe("User|null");
  });

  it("ignores attributes before a method and between modifiers", () => {
    const source = `<?php
      class Foo {
        #[Override]
        public function a(): void {}

        #[Route('/x')]
        #[Deprecated]
        protected function b(): void {}
      }
    `;

    const { methods } = parsePhpClassStructure(source);

    expect(methodNamed(methods, "a").name).toBe("a");
    expect(methodNamed(methods, "a").visibility).toBe("public");
    expect(methodNamed(methods, "b").visibility).toBe("protected");
  });

  it("parses nullable, union, void, never, static and self return types", () => {
    const source = `<?php
      class Foo {
        public function a(): ?User {}
        public function b(): int|string {}
        public function c(): void {}
        public function d(): never {}
        public function e(): static {}
        public function f(): self {}
        public function g(): Countable&Traversable {}
      }
    `;

    const { methods } = parsePhpClassStructure(source);

    expect(methodNamed(methods, "a").returnType).toBe("?User");
    expect(methodNamed(methods, "b").returnType).toBe("int|string");
    expect(methodNamed(methods, "c").returnType).toBe("void");
    expect(methodNamed(methods, "d").returnType).toBe("never");
    expect(methodNamed(methods, "e").returnType).toBe("static");
    expect(methodNamed(methods, "f").returnType).toBe("self");
    expect(methodNamed(methods, "g").returnType).toBe("Countable&Traversable");
  });

  it("captures the raw PHPDoc and parsed @param / @return tokens", () => {
    const source = `<?php
      class Foo {
        /**
         * @param array<int, User> $users
         * @return Collection<int, User>
         */
        public function go(array $users): Collection {}
      }
    `;

    const method = methodNamed(parsePhpClassStructure(source).methods, "go");

    expect(method.phpDoc?.raw).toContain("@param array<int, User> $users");
    expect(method.phpDoc?.returnType).toBe("Collection<int, User>");
    expect(method.phpDoc?.params.users).toBe("array<int, User>");
  });

  it("does not produce a return type for methods without one", () => {
    const source = `<?php
      class Foo {
        public function go($x) {}
      }
    `;

    const method = methodNamed(parsePhpClassStructure(source).methods, "go");

    expect(method.returnType).toBeNull();
    expect(method.parameters[0]?.type).toBeNull();
  });

  it("does not treat the constructor body or nested calls as members", () => {
    const source = `<?php
      class Foo {
        public function __construct() {
          $this->boot();
        }

        private function boot(): void {}
      }
    `;

    const { methods } = parsePhpClassStructure(source);

    expect(methods.map((method) => method.name).sort()).toEqual([
      "__construct",
      "boot",
    ]);
  });

  it("parses the type requested by className when several types are present", () => {
    const source = `<?php
      interface First {
        public function fromFirst(): void;
      }

      class Second {
        public function fromSecond(): void {}
      }
    `;

    const second = parsePhpClassStructure(source, "Second");

    expect(second.kind).toBe("class");
    expect(second.methods.map((method) => method.name)).toEqual([
      "fromSecond",
    ]);

    const first = parsePhpClassStructure(source, "First");

    expect(first.kind).toBe("interface");
    expect(first.methods.map((method) => method.name)).toEqual(["fromFirst"]);
  });

  it("parses typed and readonly properties", () => {
    const source = `<?php
      class Foo {
        public int $count = 0;
        protected ?string $name;
        private readonly User $owner;
        public static array $registry = [];
        /** @var array<int, string> */
        public array $tags = [];
      }
    `;

    const { properties } = parsePhpClassStructure(source);

    const count = propertyNamed(properties, "count");
    expect(count.type).toBe("int");
    expect(count.visibility).toBe("public");
    expect(count.defaultValue).toBe("0");

    const name = propertyNamed(properties, "name");
    expect(name.type).toBe("?string");
    expect(name.visibility).toBe("protected");

    const owner = propertyNamed(properties, "owner");
    expect(owner.isReadonly).toBe(true);
    expect(owner.visibility).toBe("private");
    expect(owner.type).toBe("User");

    const registry = propertyNamed(properties, "registry");
    expect(registry.isStatic).toBe(true);

    const tags = propertyNamed(properties, "tags");
    expect(tags.phpDoc?.varType).toBe("array<int, string>");
  });

  it("does not treat promoted constructor parameters as class properties", () => {
    const source = `<?php
      class Foo {
        public function __construct(
          private readonly Bar $bar,
          public int $count = 0,
        ) {}
      }
    `;

    const { properties, methods } = parsePhpClassStructure(source);

    expect(properties).toHaveLength(0);
    const constructor = methodNamed(methods, "__construct");
    expect(constructor.parameters.map((param) => param.name)).toEqual([
      "$bar",
      "$count",
    ]);
  });

  it("ignores an attribute placed on the same line as the method", () => {
    const source = `<?php
      class Foo {
        #[Route('/x')] public function go(): void {}
      }
    `;

    const method = methodNamed(parsePhpClassStructure(source).methods, "go");

    expect(method.name).toBe("go");
    expect(method.visibility).toBe("public");
    expect(method.returnType).toBe("void");
  });

  it("does not produce phantom members from heredoc / nowdoc bodies", () => {
    const source = `<?php
      class Foo {
        public function real(): void {
          $tpl = <<<EOT
          public function ghost(): void {}
          EOT;
        }
        const NOW = <<<'TXT'
        private function nowGhost() {}
        TXT;
      }
    `;

    const { methods } = parsePhpClassStructure(source);

    expect(methods.map((method) => method.name)).toEqual(["real"]);
  });

  it("strips trailing noise from a by-reference variadic parameter type", () => {
    const source = `<?php
      class Foo {
        public function collect(string &...$rest): void {}
      }
    `;

    const method = methodNamed(parsePhpClassStructure(source).methods, "collect");
    const [param] = method.parameters;

    expect(param?.name).toBe("$rest");
    expect(param?.type).toBe("string");
    expect(param?.isVariadic).toBe(true);
    expect(param?.isByRef).toBe(true);
  });

  it("does not corrupt the default of a comma-separated untyped property", () => {
    const source = `<?php
      class Foo {
        public $a = 1, $b = 2;
      }
    `;

    const { properties } = parsePhpClassStructure(source);
    const a = propertyNamed(properties, "a");

    expect(a.defaultValue).toBe("1");
  });

  it("captures fully-qualified return types", () => {
    const source = `<?php
      class Foo {
        public function user(): \\App\\Models\\User {}
      }
    `;

    const method = methodNamed(parsePhpClassStructure(source).methods, "user");

    expect(method.returnType).toBe("\\App\\Models\\User");
  });

  it("does not treat enum cases or class constants as properties", () => {
    const source = `<?php
      enum Suit: string {
        case Hearts = 'H';
        case Spades = 'S';
        const DECK_SIZE = 52;

        public function label(): string {}
      }
    `;

    const { kind, methods, properties } = parsePhpClassStructure(source);

    expect(kind).toBe("enum");
    expect(properties).toHaveLength(0);
    expect(methods.map((method) => method.name)).toEqual(["label"]);
  });

  it("ignores method-like keywords appearing inside strings and comments", () => {
    const source = `<?php
      class Foo {
        // public function commented(): void {}
        public function real(): void {
          $sql = "public function fake() {}";
        }
      }
    `;

    const { methods } = parsePhpClassStructure(source);

    expect(methods.map((method) => method.name)).toEqual(["real"]);
  });
});
