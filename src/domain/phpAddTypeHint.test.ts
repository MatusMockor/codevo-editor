import { describe, expect, it } from "vitest";
import { planAddParameterType, planAddReturnType } from "./phpAddTypeHint";

/**
 * Applies a single zero-length / replacement insertion plan (offset + text) to
 * the source so each test asserts on the resulting valid PHP rather than raw
 * offsets. The plan's `insertOffset` is a zero-length insertion point.
 */
function applyInsertion(
  source: string,
  plan: { insertOffset: number; insertText: string } | null,
): string {
  if (!plan) {
    throw new Error("expected a plan, received null");
  }

  return (
    source.slice(0, plan.insertOffset) +
    plan.insertText +
    source.slice(plan.insertOffset)
  );
}

describe("planAddReturnType", () => {
  it("uses the PHPDoc @return type when present", () => {
    const source = `<?php

class Greeter
{
    /**
     * @return Foo
     */
    public function make()
    {
        return $this->foo;
    }
}
`;
    const offset = source.indexOf("make(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": Foo");
    expect(applyInsertion(source, plan)).toContain(
      "public function make(): Foo",
    );
  });

  it("infers the return type when every return is `new Foo()`", () => {
    const source = `<?php

class Factory
{
    public function build($flag)
    {
        if ($flag) {
            return new Foo();
        }

        return new Foo();
    }
}
`;
    const offset = source.indexOf("build(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": Foo");
  });

  it("infers void when there is no return value", () => {
    const source = `<?php

class Logger
{
    public function log($message)
    {
        $this->messages[] = $message;
    }
}
`;
    const offset = source.indexOf("log(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": void");
  });

  it("infers void when every return is a bare `return;`", () => {
    const source = `<?php

class Guard
{
    public function check($flag)
    {
        if ($flag) {
            return;
        }

        return;
    }
}
`;
    const offset = source.indexOf("check(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": void");
  });

  it("infers string from a string literal return", () => {
    const source = `<?php

class Greeter
{
    public function greet()
    {
        return 'hello';
    }
}
`;
    const offset = source.indexOf("greet(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": string");
  });

  it("infers int, float, bool and array from scalar literal returns", () => {
    const cases: Array<[string, string]> = [
      ["return 123;", ": int"],
      ["return 1.5;", ": float"],
      ["return true;", ": bool"],
      ["return false;", ": bool"],
      ["return [];", ": array"],
    ];

    for (const [body, expected] of cases) {
      const source = `<?php

class C
{
    public function m()
    {
        ${body}
    }
}
`;
      const offset = source.indexOf("m(");
      const plan = planAddReturnType(source, offset);

      expect(plan?.insertText).toBe(expected);
    }
  });

  it("infers static from `return $this`", () => {
    const source = `<?php

class Builder
{
    public function self()
    {
        return $this;
    }
}
`;
    const offset = source.indexOf("self(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": static");
  });

  it("inserts before the semicolon for an abstract method", () => {
    const source = `<?php

abstract class Base
{
    /**
     * @return Foo
     */
    abstract public function make();
}
`;
    const offset = source.indexOf("make(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": Foo");
    expect(applyInsertion(source, plan)).toContain(
      "abstract public function make(): Foo;",
    );
  });

  it("inserts before the semicolon for an interface method", () => {
    const source = `<?php

interface Maker
{
    /**
     * @return Foo
     */
    public function make();
}
`;
    const offset = source.indexOf("make(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": Foo");
    expect(applyInsertion(source, plan)).toContain(
      "public function make(): Foo;",
    );
  });

  it("keeps a leading namespace separator from the PHPDoc type", () => {
    const source = `<?php

class C
{
    /**
     * @return \\App\\Foo
     */
    public function make()
    {
        return $this->foo;
    }
}
`;
    const offset = source.indexOf("make(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": \\App\\Foo");
  });

  it("preserves a nullable PHPDoc return type", () => {
    const source = `<?php

class C
{
    /**
     * @return ?Foo
     */
    public function find()
    {
        return $this->foo;
    }
}
`;
    const offset = source.indexOf("find(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": ?Foo");
  });

  it("preserves a union PHPDoc return type", () => {
    const source = `<?php

class C
{
    /**
     * @return Foo|Bar
     */
    public function pick()
    {
        return $this->value;
    }
}
`;
    const offset = source.indexOf("pick(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": Foo|Bar");
  });

  it("inserts a return type on a multiline signature before the body brace", () => {
    const source = `<?php

class C
{
    public function build(
        int $a,
        int $b
    ) {
        return new Foo();
    }
}
`;
    const offset = source.indexOf("build(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": Foo");
    expect(applyInsertion(source, plan)).toContain(`    ): Foo {`);
  });

  it("returns null when the method already declares a return type", () => {
    const source = `<?php

class C
{
    public function make(): Foo
    {
        return new Foo();
    }
}
`;
    const offset = source.indexOf("make(");

    expect(planAddReturnType(source, offset)).toBeNull();
  });

  it("returns null when returns mix types", () => {
    const source = `<?php

class C
{
    public function maybe($flag)
    {
        if ($flag) {
            return 'x';
        }

        return 123;
    }
}
`;
    const offset = source.indexOf("maybe(");

    expect(planAddReturnType(source, offset)).toBeNull();
  });

  it("returns null when the only return is a variable", () => {
    const source = `<?php

class C
{
    public function passthrough($value)
    {
        return $value;
    }
}
`;
    const offset = source.indexOf("passthrough(");

    expect(planAddReturnType(source, offset)).toBeNull();
  });

  it("returns null when the only return is a function call", () => {
    const source = `<?php

class C
{
    public function delegate()
    {
        return helper();
    }
}
`;
    const offset = source.indexOf("delegate(");

    expect(planAddReturnType(source, offset)).toBeNull();
  });

  it("returns null when the only return is null (ambiguous nullable)", () => {
    const source = `<?php

class C
{
    public function nothing()
    {
        return null;
    }
}
`;
    const offset = source.indexOf("nothing(");

    expect(planAddReturnType(source, offset)).toBeNull();
  });

  it("returns null when the cursor is not on a function", () => {
    const source = `<?php

class C
{
    public function make()
    {
        return new Foo();
    }
}
`;
    const offset = source.indexOf("class C");

    expect(planAddReturnType(source, offset)).toBeNull();
  });

  it("infers the return type from a typed property when the sole return is `return $this->prop`", () => {
    const source = `<?php

class C
{
    private UserAccount $userAccount;

    public function getUserAccount()
    {
        return $this->userAccount;
    }
}
`;
    const offset = source.indexOf("getUserAccount(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": UserAccount");
    expect(applyInsertion(source, plan)).toContain(
      "public function getUserAccount(): UserAccount",
    );
  });

  it("infers the return type from a property `@var` docblock", () => {
    const source = `<?php

class C
{
    /** @var UserAccount */
    private $userAccount;

    public function getUserAccount()
    {
        return $this->userAccount;
    }
}
`;
    const offset = source.indexOf("getUserAccount(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": UserAccount");
  });

  it("infers the return type from a `@var Type $name` property docblock", () => {
    const source = `<?php

class C
{
    /** @var User $user */
    private $user;

    public function getUser()
    {
        return $this->user;
    }
}
`;
    const offset = source.indexOf("getUser(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": User");
  });

  it("infers the return type from a promoted constructor property", () => {
    const source = `<?php

class C
{
    public function __construct(private UserAccount $userAccount)
    {
    }

    public function getUserAccount()
    {
        return $this->userAccount;
    }
}
`;
    const offset = source.indexOf("getUserAccount(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": UserAccount");
  });

  it("preserves a leading namespace separator on the property type", () => {
    const source = `<?php

class C
{
    private \\App\\Models\\User $user;

    public function getUser()
    {
        return $this->user;
    }
}
`;
    const offset = source.indexOf("getUser(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": \\App\\Models\\User");
  });

  it("infers a nullable property type verbatim", () => {
    const source = `<?php

class C
{
    private ?User $user;

    public function getUser()
    {
        return $this->user;
    }
}
`;
    const offset = source.indexOf("getUser(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": ?User");
  });

  it("returns null when the property type is a union (ambiguous)", () => {
    const source = `<?php

class C
{
    private User|Admin $user;

    public function getUser()
    {
        return $this->user;
    }
}
`;
    const offset = source.indexOf("getUser(");

    expect(planAddReturnType(source, offset)).toBeNull();
  });

  it("returns null when the returned property has no resolvable type", () => {
    const source = `<?php

class C
{
    private $user;

    public function getUser()
    {
        return $this->user;
    }
}
`;
    const offset = source.indexOf("getUser(");

    expect(planAddReturnType(source, offset)).toBeNull();
  });

  it("returns null when the returned property is unknown to the class", () => {
    const source = `<?php

class C
{
    private User $user;

    public function getOther()
    {
        return $this->other;
    }
}
`;
    const offset = source.indexOf("getOther(");

    expect(planAddReturnType(source, offset)).toBeNull();
  });

  it("returns null when a typed-property return mixes with another return type", () => {
    const source = `<?php

class C
{
    private User $user;

    public function getUser($flag)
    {
        if ($flag) {
            return $this->user;
        }

        return null;
    }
}
`;
    const offset = source.indexOf("getUser(");

    expect(planAddReturnType(source, offset)).toBeNull();
  });

  it("returns null for `return $this->prop` when no class encloses the method", () => {
    const source = `<?php

function getUser()
{
    return $this->user;
}
`;
    const offset = source.indexOf("getUser(");

    expect(planAddReturnType(source, offset)).toBeNull();
  });

  it("infers from a typed property declared after the method (order-independent)", () => {
    const source = `<?php

class C
{
    public function getUser()
    {
        return $this->user;
    }

    private User $user;
}
`;
    const offset = source.indexOf("getUser(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": User");
  });

  it("returns null for `return $this->prop->nested` (chained, not a bare property)", () => {
    const source = `<?php

class C
{
    private User $user;

    public function getName()
    {
        return $this->user->name;
    }
}
`;
    const offset = source.indexOf("getName(");

    expect(planAddReturnType(source, offset)).toBeNull();
  });

  it("resolves the property from the method's OWN class, not a same-named sibling", () => {
    const source = `<?php

class C
{
    private int $value;

    public function first()
    {
        return $this->value;
    }
}

class D
{
    private string $value;

    public function second()
    {
        return $this->value;
    }
}
`;
    const first = planAddReturnType(source, source.indexOf("first("));
    const second = planAddReturnType(source, source.indexOf("second("));

    expect(first?.insertText).toBe(": int");
    expect(second?.insertText).toBe(": string");
  });

  it("infers for a direct member but abstains inside a nested anonymous class", () => {
    const source = `<?php

class Outer
{
    private int $value;

    public function build()
    {
        $anon = new class {
            private string $value;

            public function inner()
            {
                return $this->value;
            }
        };

        return $this->value;
    }
}
`;
    // build() is a direct member of Outer -> reads Outer's int property.
    const build = planAddReturnType(source, source.indexOf("build("));
    expect(build?.insertText).toBe(": int");

    // inner() sits inside a nested anonymous class; resolving against Outer's
    // slice would emit a WRONG type, so inference must abstain (null).
    const inner = planAddReturnType(source, source.indexOf("inner("));
    expect(inner).toBeNull();
  });

  it("returns null for `return $this->method()` (a call, not a property)", () => {
    const source = `<?php

class C
{
    private User $user;

    public function getUser()
    {
        return $this->user();
    }
}
`;
    const offset = source.indexOf("getUser(");

    expect(planAddReturnType(source, offset)).toBeNull();
  });

  it("does not let a nested closure's return drive the outer type", () => {
    const source = `<?php

class C
{
    public function build()
    {
        $fn = function () {
            return 'inner';
        };

        return new Foo();
    }
}
`;
    const offset = source.indexOf("build(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": Foo");
  });
});

describe("planAddParameterType", () => {
  it("uses the PHPDoc @param type for the parameter under the cursor", () => {
    const source = `<?php

class C
{
    /**
     * @param Foo $foo
     */
    public function set($foo)
    {
    }
}
`;
    const offset = source.indexOf("$foo)");
    const plan = planAddParameterType(source, offset);

    expect(plan?.insertText).toBe("Foo ");
    expect(applyInsertion(source, plan)).toContain("function set(Foo $foo)");
  });

  it("infers array from an empty-array default", () => {
    const source = `<?php

class C
{
    public function set($items = [])
    {
    }
}
`;
    const offset = source.indexOf("$items");
    const plan = planAddParameterType(source, offset);

    expect(plan?.insertText).toBe("array ");
    expect(applyInsertion(source, plan)).toContain(
      "function set(array $items = [])",
    );
  });

  it("infers scalar types from scalar defaults", () => {
    const cases: Array<[string, string]> = [
      ["$a = 'x'", "string "],
      ["$a = 123", "int "],
      ["$a = 1.5", "float "],
      ["$a = true", "bool "],
      ["$a = false", "bool "],
    ];

    for (const [declaration, expected] of cases) {
      const source = `<?php

class C
{
    public function m(${declaration})
    {
    }
}
`;
      const offset = source.indexOf("$a");
      const plan = planAddParameterType(source, offset);

      expect(plan?.insertText).toBe(expected);
    }
  });

  it("picks the correct parameter in a multi-parameter signature", () => {
    const source = `<?php

class C
{
    /**
     * @param string $name
     * @param Foo $foo
     */
    public function set($name, $foo)
    {
    }
}
`;
    const offset = source.indexOf("$foo)");
    const plan = planAddParameterType(source, offset);

    expect(plan?.insertText).toBe("Foo ");
    expect(applyInsertion(source, plan)).toContain(
      "function set($name, Foo $foo)",
    );
  });

  it("returns null when the parameter already has a type", () => {
    const source = `<?php

class C
{
    public function set(Foo $foo)
    {
    }
}
`;
    const offset = source.indexOf("$foo");

    expect(planAddParameterType(source, offset)).toBeNull();
  });

  it("returns null for a `= null` default (ambiguous nullable)", () => {
    const source = `<?php

class C
{
    public function set($foo = null)
    {
    }
}
`;
    const offset = source.indexOf("$foo");

    expect(planAddParameterType(source, offset)).toBeNull();
  });

  it("returns null when there is no PHPDoc and no inferable default", () => {
    const source = `<?php

class C
{
    public function set($foo)
    {
    }
}
`;
    const offset = source.indexOf("$foo");

    expect(planAddParameterType(source, offset)).toBeNull();
  });

  it("returns null when the cursor is not inside the parameter list", () => {
    const source = `<?php

class C
{
    /**
     * @param Foo $foo
     */
    public function set($foo)
    {
        $foo->save();
    }
}
`;
    const offset = source.indexOf("$foo->save");

    expect(planAddParameterType(source, offset)).toBeNull();
  });

  it("keeps a namespaced PHPDoc param type", () => {
    const source = `<?php

class C
{
    /**
     * @param \\App\\Foo $foo
     */
    public function set($foo)
    {
    }
}
`;
    const offset = source.indexOf("$foo)");
    const plan = planAddParameterType(source, offset);

    expect(plan?.insertText).toBe("\\App\\Foo ");
  });

  it("types a promoted constructor parameter from its PHPDoc", () => {
    const source = `<?php

class C
{
    /**
     * @param Foo $foo
     */
    public function __construct(private $foo)
    {
    }
}
`;
    const offset = source.indexOf("$foo)");
    const plan = planAddParameterType(source, offset);

    expect(plan?.insertText).toBe("Foo ");
    expect(applyInsertion(source, plan)).toContain(
      "__construct(private Foo $foo)",
    );
  });

  it("does not type a by-reference parameter from a default (ambiguous)", () => {
    const source = `<?php

class C
{
    public function set(&$foo)
    {
    }
}
`;
    const offset = source.indexOf("$foo");

    expect(planAddParameterType(source, offset)).toBeNull();
  });

  it("types a by-reference parameter from its PHPDoc before the ampersand", () => {
    const source = `<?php

class C
{
    /**
     * @param Foo $foo
     */
    public function set(&$foo)
    {
    }
}
`;
    const offset = source.indexOf("$foo)");
    const plan = planAddParameterType(source, offset);

    expect(plan?.insertText).toBe("Foo ");
    expect(applyInsertion(source, plan)).toContain("function set(Foo &$foo)");
  });

  // FIX 2: a stale/wrong PHPDoc @param whose type is incompatible with an
  // existing literal default produces a FATAL PHP error
  // ("Cannot use bool as default value for parameter of type Foo"). The plan
  // must stay null (no type hint) rather than corrupt the file.
  it("returns null when a class PHPDoc @param contradicts a bool default", () => {
    const source = `<?php

class C
{
    /**
     * @param Foo $foo
     */
    public function s($foo = true)
    {
    }
}
`;
    const offset = source.indexOf("$foo =");

    expect(planAddParameterType(source, offset)).toBeNull();
  });

  it("returns null when a class PHPDoc @param contradicts an int default", () => {
    const source = `<?php

class C
{
    /**
     * @param Foo $foo
     */
    public function s($foo = 123)
    {
    }
}
`;
    const offset = source.indexOf("$foo =");

    expect(planAddParameterType(source, offset)).toBeNull();
  });

  it("returns null when a class PHPDoc @param contradicts an array default", () => {
    const source = `<?php

class C
{
    /**
     * @param Foo $foo
     */
    public function s($foo = [])
    {
    }
}
`;
    const offset = source.indexOf("$foo =");

    expect(planAddParameterType(source, offset)).toBeNull();
  });

  it("returns null when a scalar PHPDoc @param contradicts a string default", () => {
    const source = `<?php

class C
{
    /**
     * @param int $foo
     */
    public function s($foo = 'x')
    {
    }
}
`;
    const offset = source.indexOf("$foo =");

    expect(planAddParameterType(source, offset)).toBeNull();
  });

  it("returns null when a string PHPDoc @param contradicts an int default", () => {
    const source = `<?php

class C
{
    /**
     * @param string $foo
     */
    public function s($foo = 123)
    {
    }
}
`;
    const offset = source.indexOf("$foo =");

    expect(planAddParameterType(source, offset)).toBeNull();
  });

  it("returns null when a string PHPDoc @param contradicts a bool default", () => {
    const source = `<?php

class C
{
    /**
     * @param string $foo
     */
    public function s($foo = false)
    {
    }
}
`;
    const offset = source.indexOf("$foo =");

    expect(planAddParameterType(source, offset)).toBeNull();
  });

  it("keeps a PHPDoc @param type that AGREES with an int default", () => {
    const source = `<?php

class C
{
    /**
     * @param int $foo
     */
    public function s($foo = 123)
    {
    }
}
`;
    const offset = source.indexOf("$foo =");
    const plan = planAddParameterType(source, offset);

    expect(plan?.insertText).toBe("int ");
    expect(applyInsertion(source, plan)).toContain("s(int $foo = 123)");
  });

  it("keeps a PHPDoc @param type that AGREES with a string default", () => {
    const source = `<?php

class C
{
    /**
     * @param string $foo
     */
    public function s($foo = 'x')
    {
    }
}
`;
    const offset = source.indexOf("$foo =");
    const plan = planAddParameterType(source, offset);

    expect(plan?.insertText).toBe("string ");
  });

  it("keeps a class PHPDoc @param type when the default is null (implicit nullable)", () => {
    const source = `<?php

class C
{
    /**
     * @param Foo $foo
     */
    public function s($foo = null)
    {
    }
}
`;
    const offset = source.indexOf("$foo =");
    const plan = planAddParameterType(source, offset);

    expect(plan?.insertText).toBe("Foo ");
    expect(applyInsertion(source, plan)).toContain("s(Foo $foo = null)");
  });

  it("keeps a float PHPDoc @param type over an int default (PHP widens it)", () => {
    const source = `<?php

class C
{
    /**
     * @param float $foo
     */
    public function s($foo = 123)
    {
    }
}
`;
    const offset = source.indexOf("$foo =");
    const plan = planAddParameterType(source, offset);

    expect(plan?.insertText).toBe("float ");
    expect(applyInsertion(source, plan)).toContain("s(float $foo = 123)");
  });

  it("keeps a PHPDoc @param type when the default is a non-literal constant", () => {
    const source = `<?php

class C
{
    /**
     * @param Foo $foo
     */
    public function s($foo = Foo::DEFAULT)
    {
    }
}
`;
    const offset = source.indexOf("$foo =");
    const plan = planAddParameterType(source, offset);

    expect(plan?.insertText).toBe("Foo ");
  });
});

// FIX 1: PHP forbids mixing the `?` nullable shorthand with a union (`|`) or
// intersection (`&`) type. A PHPDoc token like `?Foo|Bar` is NOT a valid native
// type, and inserting it verbatim is a PARSE ERROR. These tokens must be
// rejected (plan null) for both return and parameter positions; plain `?Foo`,
// `Foo|Bar` and `Foo&Bar` stay usable.
describe("nullable shorthand mixed with union/intersection (parse-error guard)", () => {
  const nullableUnionTokens = ["?Foo|Bar", "Foo|?Bar", "?Foo|?Bar", "Foo&?Bar"];

  for (const token of nullableUnionTokens) {
    it(`returns null for a @return ${token}`, () => {
      const source = `<?php

class C
{
    /**
     * @return ${token}
     */
    public function du()
    {
        return $this->x;
    }
}
`;
      const offset = source.indexOf("du(");

      expect(planAddReturnType(source, offset)).toBeNull();
    });

    it(`returns null for a @param ${token}`, () => {
      const source = `<?php

class C
{
    /**
     * @param ${token} $foo
     */
    public function du($foo)
    {
    }
}
`;
      const offset = source.indexOf("$foo)");

      expect(planAddParameterType(source, offset)).toBeNull();
    });
  }

  it("keeps a plain nullable @return ?Foo", () => {
    const source = `<?php

class C
{
    /**
     * @return ?Foo
     */
    public function du()
    {
        return $this->x;
    }
}
`;
    const offset = source.indexOf("du(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": ?Foo");
  });

  it("keeps a union @return Foo|Bar", () => {
    const source = `<?php

class C
{
    /**
     * @return Foo|Bar
     */
    public function du()
    {
        return $this->x;
    }
}
`;
    const offset = source.indexOf("du(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": Foo|Bar");
  });

  it("keeps an intersection @return Foo&Bar", () => {
    const source = `<?php

class C
{
    /**
     * @return Foo&Bar
     */
    public function du()
    {
        return $this->x;
    }
}
`;
    const offset = source.indexOf("du(");
    const plan = planAddReturnType(source, offset);

    expect(plan?.insertText).toBe(": Foo&Bar");
  });

  it("keeps a plain nullable @param ?Foo", () => {
    const source = `<?php

class C
{
    /**
     * @param ?Foo $foo
     */
    public function du($foo)
    {
    }
}
`;
    const offset = source.indexOf("$foo)");
    const plan = planAddParameterType(source, offset);

    expect(plan?.insertText).toBe("?Foo ");
  });

  it("keeps a union @param Foo|Bar", () => {
    const source = `<?php

class C
{
    /**
     * @param Foo|Bar $foo
     */
    public function du($foo)
    {
    }
}
`;
    const offset = source.indexOf("$foo)");
    const plan = planAddParameterType(source, offset);

    expect(plan?.insertText).toBe("Foo|Bar ");
  });
});
