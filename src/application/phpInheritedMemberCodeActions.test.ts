import { describe, expect, it } from "vitest";
import { parsePhpClassStructure } from "../domain/phpClassStructure";
import type { PhpCodeActionDescriptor } from "./phpCodeActionTypes";
import {
  isPhpOverridableParentMethod,
  phpImplementMethodsCodeAction,
  planPhpInheritedMethodSignatureSynchronization,
  type AbstractMemberToImplement,
  type PhpAbstractMembersCollection,
} from "./phpInheritedMemberCodeActions";

function inheritedContract(
  source: string,
  typeName = "HandlerContract",
): AbstractMemberToImplement {
  const member = parsePhpClassStructure(source, typeName).methods[0];

  if (!member) {
    throw new Error("contract method not parsed");
  }

  return { declaringSource: source, declaringTypeName: typeName, member };
}

function collection(
  contract: AbstractMemberToImplement,
  conflictingNames: string[] = [],
): PhpAbstractMembersCollection {
  return {
    abstractMembers: new Map([[contract.member.name.toLowerCase(), contract]]),
    conflictingNames: new Set(conflictingNames),
    satisfiedNames: new Set(),
  };
}

function plan(
  source: string,
  contract: AbstractMemberToImplement,
  cursor = source.indexOf("function"),
  conflictingNames: string[] = [],
  typeName?: string,
) {
  return planPhpInheritedMethodSignatureSynchronization(
    source,
    { end: cursor, start: cursor },
    parsePhpClassStructure(source, typeName),
    collection(contract, conflictingNames),
  );
}

function applyAction(source: string, action: PhpCodeActionDescriptor): string {
  const edits = action.edits
    .map((edit) => ({
      end: offsetAt(source, edit.range.endLineNumber, edit.range.endColumn),
      start: offsetAt(
        source,
        edit.range.startLineNumber,
        edit.range.startColumn,
      ),
      text: edit.text,
    }))
    .sort((left, right) => right.start - left.start);

  return edits.reduce(
    (result, edit) =>
      result.slice(0, edit.start) + edit.text + result.slice(edit.end),
    source,
  );
}

function offsetAt(source: string, lineNumber: number, column: number): number {
  const lines = source.split("\n");
  let offset = 0;

  for (let line = 1; line < lineNumber; line += 1) {
    offset += (lines[line - 1]?.length ?? 0) + 1;
  }

  return offset + column - 1;
}

describe("planPhpInheritedMethodSignatureSynchronization", () => {
  it("synchronizes modifiers, types, defaults and return type without replacing decorators or body", () => {
    const contractSource = `<?php
namespace App\\Contracts;

use Vendor\\Package\\Model as Entity;

interface HandlerContract
{
    public static function handle(?Entity $entity = null, (\\Countable&\\Iterator)|null $items = null): Entity|false;
}
`;
    const source = `<?php
namespace App\\Services;

/** class docs */
class Handler implements \\App\\Contracts\\HandlerContract
{
    /** keep this PHPDoc byte-for-byte */
    #[Audit('keep')]
    private function handle(mixed $entity = [], array $items = []): bool
    {
        $payload = "body { bytes; stay }";
        return false;
    }
}
`;
    const body = source.slice(source.indexOf("    {", source.indexOf("function")));
    const action = plan(source, inheritedContract(contractSource));

    expect(action?.title).toBe(
      "Synchronize signature with HandlerContract::handle",
    );
    expect(action?.edits.some((edit) => edit.text.includes("use Vendor\\Package\\Model as Entity;"))).toBe(true);

    const updated = applyAction(source, action!);

    expect(updated).toContain(
      "public static function handle(mixed $entity = [], (\\Countable&\\Iterator)|null $items = []): Entity|false",
    );
    expect(updated).toContain("/** keep this PHPDoc byte-for-byte */");
    expect(updated).toContain("#[Audit('keep')]");
    expect(updated.slice(updated.indexOf("    {", updated.indexOf("function")))).toBe(body);
  });

  it.each([
    ["parameter count", "public function handle(string $name, int $extra): void"],
    ["parameter name", "public function handle(string $other): void"],
    ["by-reference shape", "public function handle(string &$name): void"],
    ["variadic shape", "public function handle(string ...$name): void"],
  ])("suppresses a mismatched %s", (_label, declaration) => {
    const contractSource = `<?php
interface HandlerContract { public function handle(string $name): void; }
`;
    const source = `<?php
class Handler implements HandlerContract
{
    ${declaration}
    {
    }
}
`;

    expect(plan(source, inheritedContract(contractSource))).toBeNull();
  });

  it("offers no action for an alias-aware exact match", () => {
    const contractSource = `<?php
use Vendor\\Package\\Model as Entity;
interface HandlerContract { public function handle(?Entity $entity = null): Entity; }
`;
    const source = `<?php
use Vendor\\Package\\Model as Entity;
class Handler implements HandlerContract
{
    public function handle(?Entity $entity = null): Entity
    {
        return $entity;
    }
}
`;

    expect(plan(source, inheritedContract(contractSource))).toBeNull();
  });

  it("imports a qualified alias used only by an inherited new-expression default", () => {
    const contractSource = `<?php
use Vendor\\Time as ClockPackage;
interface HandlerContract
{
    public function handle($clock = new ClockPackage\\Clock()): void;
}
`;
    const source = `<?php
class Handler implements HandlerContract
{
    public function handle($clock): void
    {
    }
}
`;
    const action = plan(source, inheritedContract(contractSource));
    const updated = applyAction(source, action!);

    expect(updated).toContain(
      "use Vendor\\Time as ClockPackage;",
    );
    expect(updated).toContain(
      "public function handle($clock = new ClockPackage\\Clock()): void",
    );
  });

  it("imports an unqualified class used by an inherited new-expression default", () => {
    const contractSource = `<?php
namespace App\\Contracts;
use Vendor\\Time\\Clock;
interface HandlerContract
{
    public function handle($clock = new Clock()): void;
}
`;
    const source = `<?php
namespace App\\Services;
class Handler implements HandlerContract
{
    public function handle($clock): void
    {
    }
}
`;
    const action = plan(source, inheritedContract(contractSource));
    const updated = applyAction(source, action!);

    expect(updated).toContain("use Vendor\\Time\\Clock;");
    expect(updated).toContain(
      "public function handle($clock = new Clock()): void",
    );
  });

  it("does not treat new text inside a string default as a class reference", () => {
    const contractSource = `<?php
interface HandlerContract
{
    public function handle($label = 'new Clock'): void;
}
`;
    const source = `<?php
class Handler implements HandlerContract
{
    public function handle($label): void
    {
    }
}
`;
    const action = plan(source, inheritedContract(contractSource));
    const updated = applyAction(source, action!);

    expect(updated).toContain("public function handle($label = 'new Clock'): void");
    expect(updated).not.toContain("use Clock;");
  });

  it("suppresses namespace-relative class constants instead of generating an invalid import", () => {
    const contractSource = `<?php
namespace App\\Contracts;
interface HandlerContract
{
    public static function handle($value = namespace\\Defaults::VALUE): void;
}
`;
    const source = `<?php
namespace App\\Services;
class Handler implements HandlerContract
{
    public function handle($value): void
    {
    }
}
`;
    const action = plan(source, inheritedContract(contractSource));
    const output = action ? applyAction(source, action) : source;

    expect(action).toBeNull();
    expect(output).toBe(source);
    expect(output).not.toContain("use App\\Contracts\\namespace;");
  });

  it("suppresses a new-expression alias that collides with an existing import", () => {
    const contractSource = `<?php
use Vendor\\Time as ClockPackage;
interface HandlerContract
{
    public function handle($clock = new ClockPackage\\Clock()): void;
}
`;
    const source = `<?php
use Other\\Time as ClockPackage;
class Handler implements HandlerContract
{
    public function handle($clock): void
    {
    }
}
`;

    expect(plan(source, inheritedContract(contractSource))).toBeNull();
  });

  it("imports a global inherited return type into a namespaced target", () => {
    const contractSource = `<?php
interface HandlerContract
{
    public function create(): DateTime;
}
`;
    const source = `<?php
namespace App;
class Handler implements HandlerContract
{
    public function create()
    {
        return new \\DateTime();
    }
}
`;
    const action = plan(source, inheritedContract(contractSource));
    const updated = applyAction(source, action!);

    expect(updated).toContain("use DateTime;");
    expect(updated).toContain("public function create(): DateTime");
    expect(updated).not.toContain("App\\DateTime");
  });

  it("imports a global inherited parameter type into a namespaced target", () => {
    const contractSource = `<?php
interface HandlerContract
{
    public function accept(DateTime $value): void;
}
`;
    const source = `<?php
namespace App;
class Handler implements HandlerContract
{
    public function accept(int $value): void
    {
    }
}
`;
    const action = plan(source, inheritedContract(contractSource));
    const updated = applyAction(source, action!);

    expect(updated).toContain("use DateTime;");
    expect(updated).toContain("public function accept(DateTime $value): void");
  });

  it("suppresses a global inherited type when the target short name collides", () => {
    const contractSource = `<?php
interface HandlerContract
{
    public function create(): DateTime;
}
`;
    const source = `<?php
namespace App;
use App\\DateTime;
class Handler implements HandlerContract
{
    public function create()
    {
        return new DateTime();
    }
}
`;

    expect(plan(source, inheritedContract(contractSource))).toBeNull();
  });

  it.each([
    ["class", "before"],
    ["class", "after"],
    ["interface", "before"],
    ["interface", "after"],
    ["trait", "before"],
    ["trait", "after"],
    ["enum", "before"],
    ["enum", "after"],
  ])(
    "suppresses a global import colliding with a %s declared %s the target",
    (kind, position) => {
      const contractSource = `<?php
interface HandlerContract
{
    public function create(): DateTime;
}
`;
      const collidingDeclaration = `${kind} DateTime {}`;
      const handlerDeclaration = `class Handler implements HandlerContract
{
    public function create()
    {
        return new \\DateTime();
    }
}`;
      const declarations =
        position === "before"
          ? `${collidingDeclaration}\n${handlerDeclaration}`
          : `${handlerDeclaration}\n${collidingDeclaration}`;
      const source = `<?php
namespace App;
${declarations}
`;
      const cursor = source.indexOf("function create");

      expect(
        plan(
          source,
          inheritedContract(contractSource),
          cursor,
          [],
          "Handler",
        ),
      ).toBeNull();
    },
  );

  it("suppresses PHP-compatible variance, visibility and optional-default differences", () => {
    const contractSource = `<?php
abstract class HandlerContract
{
    abstract protected function handle(?Foo $value = null): Foo|Bar;
}
`;
    const source = `<?php
class Handler extends HandlerContract
{
    public function handle(Foo|null $value = new Foo()): Foo
    {
        return new Foo();
    }
}
`;

    expect(plan(source, inheritedContract(contractSource))).toBeNull();
  });

  it("treats reordered nullable unions as equivalent", () => {
    const contractSource = `<?php
interface HandlerContract
{
    public function handle(?Foo $value): Foo|Bar|null;
}
`;
    const source = `<?php
class Handler implements HandlerContract
{
    public function handle(Foo|null $value): null|Bar|Foo
    {
        return $value;
    }
}
`;

    expect(plan(source, inheritedContract(contractSource))).toBeNull();
  });

  it("preserves a provably covariant standalone DNF return arm", () => {
    const contractSource = `<?php
interface HandlerContract
{
    public function handle(): (First&Second)|null;
}
`;
    const source = `<?php
class Handler implements HandlerContract
{
    public function handle(): null
    {
        return null;
    }
}
`;

    expect(plan(source, inheritedContract(contractSource))).toBeNull();
  });

  it("accepts array returns as covariant with iterable", () => {
    const contractSource = `<?php
interface HandlerContract { public function handle(): iterable; }
`;
    const source = `<?php
class Handler implements HandlerContract
{
    public function handle(): array { return []; }
}
`;

    expect(plan(source, inheritedContract(contractSource))).toBeNull();
  });

  it("accepts iterable parameters as contravariant with array", () => {
    const contractSource = `<?php
interface HandlerContract { public function handle(array $value): void; }
`;
    const source = `<?php
class Handler implements HandlerContract
{
    public function handle(iterable $value): void {}
}
`;

    expect(plan(source, inheritedContract(contractSource))).toBeNull();
  });

  it("accepts never as covariant with every inherited return", () => {
    const contractSource = `<?php
interface HandlerContract { public function handle(): Result; }
`;
    const source = `<?php
class Handler implements HandlerContract
{
    public function handle(): never { throw new \\RuntimeException(); }
}
`;

    expect(plan(source, inheritedContract(contractSource))).toBeNull();
  });

  it("repairs static and void together when the inherited return is mixed", () => {
    const contractSource = `<?php
interface HandlerContract { public static function handle(): mixed; }
`;
    const source = `<?php
class Handler implements HandlerContract
{
    public function handle(): void {}
}
`;
    const action = plan(source, inheritedContract(contractSource));
    const updated = applyAction(source, action!);

    expect(updated).toContain("public static function handle(): mixed");
    expect(updated).not.toContain("public static function handle(): void");
  });

  it("repairs a static mismatch while preserving compatible API differences", () => {
    const contractSource = `<?php
abstract class HandlerContract
{
    abstract protected static function handle(?Foo $value = null): Foo|Bar;
}
`;
    const source = `<?php
class Handler extends HandlerContract
{
    public function handle(Foo|null $value = new Foo()): Foo
    {
        return new Foo();
    }
}
`;
    const action = plan(source, inheritedContract(contractSource));
    const updated = applyAction(source, action!);

    expect(action?.isPreferred).toBeUndefined();
    expect(action?.kind).toBe("refactor.rewrite");
    expect(updated).toContain(
      "public static function handle(Foo|null $value = new Foo()): Foo",
    );
  });

  it.each([
    ["file start", 0],
    ["method body", -1],
    ["unrelated property", -2],
  ])("does not offer the sole candidate at %s", (_label, requestedOffset) => {
    const contractSource = `<?php
interface HandlerContract { public static function handle(string $value): void; }
`;
    const source = `<?php
class Handler implements HandlerContract
{
    private int $count = 0;

    public function handle(string $value): void
    {
        echo $value;
    }
}
`;
    const offset =
      requestedOffset === -1
        ? source.indexOf("echo")
        : requestedOffset === -2
          ? source.indexOf("$count")
          : requestedOffset;

    expect(
      plan(source, inheritedContract(contractSource), offset),
    ).toBeNull();
  });

  it("suppresses conflicting inherited declarations", () => {
    const contractSource = `<?php
interface HandlerContract { public function handle(string $name): void; }
`;
    const source = `<?php
class Handler implements HandlerContract
{
    private function handle(int $name): bool
    {
        return false;
    }
}
`;

    expect(
      plan(
        source,
        inheritedContract(contractSource),
        source.indexOf("function"),
        ["handle"],
      ),
    ).toBeNull();
  });

  it("suppresses ambiguous class-level synchronization candidates", () => {
    const contractSource = `<?php
interface HandlerContract
{
    public function first(string $value): void;
    public function second(string $value): void;
}
`;
    const parsed = parsePhpClassStructure(contractSource, "HandlerContract");
    const source = `<?php
class Handler implements HandlerContract
{
    private function first(int $value): bool { return false; }
    private function second(int $value): bool { return false; }
}
`;
    const entries = parsed.methods.map((member) => [
      member.name,
      {
        declaringSource: contractSource,
        declaringTypeName: "HandlerContract",
        member,
      },
    ] as const);

    expect(
      planPhpInheritedMethodSignatureSynchronization(
        source,
        { end: 0, start: 0 },
        parsePhpClassStructure(source),
        {
          abstractMembers: new Map(entries),
          conflictingNames: new Set(),
          satisfiedNames: new Set(),
        },
      ),
    ).toBeNull();
  });
});

describe("comment-separated inherited modifiers", () => {
  it("keeps abstract methods implementable and final/private methods non-overridable", async () => {
    const parentSource = `<?php
abstract class ParentHandler
{
    abstract /* contract */ protected function required(): void;
    final /* sealed */ public function sealed(): void {}
    private /* helper */ static function hidden(): void {}
}
`;
    const structure = parsePhpClassStructure(parentSource, "ParentHandler");
    const required = structure.methods.find((method) => method.name === "required")!;
    const sealed = structure.methods.find((method) => method.name === "sealed")!;
    const hidden = structure.methods.find((method) => method.name === "hidden")!;
    const childSource = `<?php
class ChildHandler extends ParentHandler
{
}
`;
    const action = await phpImplementMethodsCodeAction(
      childSource,
      new Set(),
      async () => ({
        abstractMembers: new Map([
          [
            "required",
            {
              declaringSource: parentSource,
              declaringTypeName: "ParentHandler",
              member: required,
            },
          ],
        ]),
        conflictingNames: new Set(),
        satisfiedNames: new Set(),
      }),
      () => true,
    );

    expect(action?.edits[0]?.text).toContain(
      "protected function required(): void",
    );
    expect(isPhpOverridableParentMethod(sealed)).toBe(false);
    expect(isPhpOverridableParentMethod(hidden)).toBe(false);
  });
});

describe("phpImplementMethodsCodeAction conflicts", () => {
  it.each([
    ["A then B", ["string", "int"]],
    ["B then A", ["int", "string"]],
  ])(
    "excludes conflicting methods for %s traversal while retaining other methods",
    async (_label, runTypes) => {
      const sources = runTypes.map(
        (type, index) => `<?php
interface Contract${index}
{
    public function run(${type} $value): void;
}
`,
      );
      const retainedSource = `<?php
interface OtherContract
{
    public function retained(): void;
}
`;
      const retained = inheritedContract(retainedSource, "OtherContract");
      const firstRun = inheritedContract(sources[0]!, "Contract0");
      const action = await phpImplementMethodsCodeAction(
        `<?php
class Handler implements Contract0, Contract1, OtherContract
{
}
`,
        new Set(),
        async () => ({
          abstractMembers: new Map([
            ["run", firstRun],
            ["retained", retained],
          ]),
          conflictingNames: new Set(["run"]),
          satisfiedNames: new Set(),
        }),
        () => true,
      );
      const output = action?.edits.map((edit) => edit.text).join("\n") ?? "";

      expect(output).toContain("public function retained(): void");
      expect(output).not.toContain("function run(");
    },
  );
});
