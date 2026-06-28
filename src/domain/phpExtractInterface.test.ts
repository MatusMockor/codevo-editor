import { describe, expect, it } from "vitest";

import { planExtractInterface } from "./phpExtractInterface";

function cursorOn(source: string, marker: string): number {
  const offset = source.indexOf(marker);

  if (offset < 0) {
    throw new Error(`marker not found: ${marker}`);
  }

  return offset;
}

describe("planExtractInterface", () => {
  it("extracts an interface from a class with two public methods", () => {
    const source = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(string $name): string
    {
        return "Hi {$name}";
    }

    public function farewell(string $name): string
    {
        return "Bye {$name}";
    }
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Greeter"),
      "/workspace/app/Services/Greeter.php",
    );

    expect(plan).not.toBeNull();
    expect(plan?.interfaceName).toBe("GreeterInterface");
    expect(plan?.interfaceFilePath).toBe(
      "/workspace/app/Services/GreeterInterface.php",
    );
    expect(plan?.interfaceText).toContain("namespace App\\Services;");
    expect(plan?.interfaceText).toContain("interface GreeterInterface");
    expect(plan?.interfaceText).toContain(
      "public function greet(string $name): string;",
    );
    expect(plan?.interfaceText).toContain(
      "public function farewell(string $name): string;",
    );
    // Signatures only - no method bodies.
    expect(plan?.interfaceText).not.toContain("{\n        return");
    expect(plan?.interfaceText).not.toContain('"Hi ');
  });

  it("adds an implements clause to a class with no implements", () => {
    const source = `<?php

namespace App\\Services;

class Greeter
{
    public function greet(): string
    {
        return "Hi";
    }
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Greeter"),
      "/workspace/app/Services/Greeter.php",
    );

    expect(plan).not.toBeNull();
    const edited =
      source.slice(0, plan!.implementsEdit.offset) +
      plan!.implementsEdit.text +
      source.slice(plan!.implementsEdit.offset);
    expect(edited).toContain("class Greeter implements GreeterInterface");
  });

  it("extends an existing implements list", () => {
    const source = `<?php

namespace App\\Services;

class Greeter extends Base implements Countable
{
    public function greet(): string
    {
        return "Hi";
    }
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Greeter"),
      "/workspace/app/Services/Greeter.php",
    );

    expect(plan).not.toBeNull();
    const edited =
      source.slice(0, plan!.implementsEdit.offset) +
      plan!.implementsEdit.text +
      source.slice(plan!.implementsEdit.offset);
    expect(edited).toContain(
      "implements Countable, GreeterInterface",
    );
  });

  it("omits private, protected, constructor, magic and static methods", () => {
    const source = `<?php

namespace App\\Services;

class Service
{
    public function __construct(private int $count) {}

    public function run(): void {}

    protected function helper(): void {}

    private function secret(): void {}

    public function __get(string $name) {}

    public static function make(): self {}
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Service"),
      "/workspace/app/Services/Service.php",
    );

    expect(plan).not.toBeNull();
    expect(plan?.interfaceText).toContain("public function run(): void;");
    expect(plan?.interfaceText).not.toContain("__construct");
    expect(plan?.interfaceText).not.toContain("helper");
    expect(plan?.interfaceText).not.toContain("secret");
    expect(plan?.interfaceText).not.toContain("__get");
    expect(plan?.interfaceText).not.toContain("make");
    expect(plan?.interfaceText).not.toContain("static");
  });

  it("preserves parameter types, defaults and return type in the signature", () => {
    const source = `<?php

namespace App\\Services;

class Calc
{
    public function add(int $a, int $b = 0): int
    {
        return $a + $b;
    }
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Calc"),
      "/workspace/app/Services/Calc.php",
    );

    expect(plan?.interfaceText).toContain(
      "public function add(int $a, int $b = 0): int;",
    );
  });

  it("returns null for an abstract class", () => {
    const source = `<?php

namespace App\\Services;

abstract class Base
{
    public function run(): void {}
}
`;

    expect(
      planExtractInterface(
        source,
        cursorOn(source, "class Base"),
        "/workspace/app/Services/Base.php",
      ),
    ).toBeNull();
  });

  it("returns null for an interface declaration", () => {
    const source = `<?php

namespace App\\Services;

interface Existing
{
    public function run(): void;
}
`;

    expect(
      planExtractInterface(
        source,
        cursorOn(source, "interface Existing"),
        "/workspace/app/Services/Existing.php",
      ),
    ).toBeNull();
  });

  it("returns null for a trait", () => {
    const source = `<?php

namespace App\\Services;

trait Helper
{
    public function run(): void {}
}
`;

    expect(
      planExtractInterface(
        source,
        cursorOn(source, "trait Helper"),
        "/workspace/app/Services/Helper.php",
      ),
    ).toBeNull();
  });

  it("returns null when the class has no public instance methods", () => {
    const source = `<?php

namespace App\\Services;

class OnlyPrivate
{
    private function secret(): void {}

    protected function helper(): void {}
}
`;

    expect(
      planExtractInterface(
        source,
        cursorOn(source, "class OnlyPrivate"),
        "/workspace/app/Services/OnlyPrivate.php",
      ),
    ).toBeNull();
  });

  it("returns null when the cursor is outside any class", () => {
    const source = `<?php

namespace App\\Services;

function freeFunction(): void {}

class Greeter
{
    public function greet(): void {}
}
`;

    expect(
      planExtractInterface(
        source,
        cursorOn(source, "function freeFunction"),
        "/workspace/app/Services/Greeter.php",
      ),
    ).toBeNull();
  });

  it("returns null when parsing fails (no class brace)", () => {
    const source = `<?php

namespace App\\Services;

class Broken
`;

    expect(
      planExtractInterface(
        source,
        cursorOn(source, "class Broken"),
        "/workspace/app/Services/Broken.php",
      ),
    ).toBeNull();
  });

  it("supports the global namespace (no namespace line)", () => {
    const source = `<?php

class Greeter
{
    public function greet(): void {}
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Greeter"),
      "/workspace/Greeter.php",
    );

    expect(plan).not.toBeNull();
    expect(plan?.interfaceFilePath).toBe("/workspace/GreeterInterface.php");
    expect(plan?.interfaceText).not.toContain("namespace");
    expect(plan?.interfaceText).toContain("interface GreeterInterface");
  });
});

describe("planExtractInterface - adversarial signature sweep", () => {
  function interfaceBody(source: string): string {
    const plan = planExtractInterface(
      source,
      source.indexOf("class "),
      "/workspace/X.php",
    );

    return plan?.interfaceText ?? "";
  }

  it("preserves nullable and union return types", () => {
    const source = `<?php
class X
{
    public function a(): ?string {}
    public function b(): int|false {}
}
`;
    const body = interfaceBody(source);
    expect(body).toContain("public function a(): ?string;");
    expect(body).toContain("public function b(): int|false;");
  });

  it("preserves self / static / never return types", () => {
    const source = `<?php
class X
{
    public function a(): self {}
    public function b(): static {}
    public function c(): never { throw new \\Exception(); }
}
`;
    const body = interfaceBody(source);
    expect(body).toContain("public function a(): self;");
    expect(body).toContain("public function b(): static;");
    expect(body).toContain("public function c(): never;");
  });

  it("preserves nullable and union parameter types", () => {
    const source = `<?php
class X
{
    public function a(?int $x, A|B $y): void {}
}
`;
    expect(interfaceBody(source)).toContain(
      "public function a(?int $x, A|B $y): void;",
    );
  });

  it("preserves variadic parameters", () => {
    const source = `<?php
class X
{
    public function a(int ...$nums): int {}
}
`;
    expect(interfaceBody(source)).toContain(
      "public function a(int ...$nums): int;",
    );
  });

  it("preserves by-reference parameters", () => {
    const source = `<?php
class X
{
    public function a(int &$ref): void {}
}
`;
    expect(interfaceBody(source)).toContain(
      "public function a(int &$ref): void;",
    );
  });

  it("preserves array and null default parameter values", () => {
    const source = `<?php
class X
{
    public function a(array $items = [], ?string $name = null): void {}
}
`;
    expect(interfaceBody(source)).toContain(
      "public function a(array $items = [], ?string $name = null): void;",
    );
  });

  it("ignores attributes on the method when building the signature", () => {
    const source = `<?php
class X
{
    #[Deprecated]
    public function a(int $x): void {}
}
`;
    const body = interfaceBody(source);
    expect(body).toContain("public function a(int $x): void;");
    expect(body).not.toContain("#[Deprecated]");
  });

  it("normalizes a multiline signature into one interface line", () => {
    const source = `<?php
class X
{
    public function a(
        int $x,
        string $y
    ): bool {
        return true;
    }
}
`;
    expect(interfaceBody(source)).toContain(
      "public function a(int $x, string $y): bool;",
    );
  });

  it("preserves a multiline (wrapped) return type so the interface stays covariant", () => {
    const source = `<?php
class X
{
    public function find(int $id): User
        |null
    {
        return null;
    }
}
`;
    const body = interfaceBody(source);
    expect(body).toContain("public function find(int $id): User|null;");
    expect(body).not.toContain("public function find(int $id): User;");
  });

  it("preserves a return type that starts on the line after the colon", () => {
    const source = `<?php
class X
{
    public function a():
        ?User
    {}
}
`;
    expect(interfaceBody(source)).toContain("public function a(): ?User;");
  });

  it("keeps a method with no return type unsuffixed", () => {
    const source = `<?php
class X
{
    public function a(int $x) {}
}
`;
    const body = interfaceBody(source);
    expect(body).toContain("public function a(int $x);");
    expect(body).not.toContain("public function a(int $x):");
  });
});

describe("planExtractInterface - use imports for signature types", () => {
  it("copies a `use` for an imported parameter type", () => {
    const source = `<?php

namespace App\\Services;

use App\\Models\\UserAccount;

class Repo
{
    public function save(UserAccount $account): void {}
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Repo"),
      "/workspace/app/Services/Repo.php",
    );

    expect(plan?.interfaceText).toContain("use App\\Models\\UserAccount;");
    expect(plan?.interfaceText).toContain(
      "public function save(UserAccount $account): void;",
    );
    // The use block sits between the namespace and the interface declaration.
    const text = plan?.interfaceText ?? "";
    expect(text.indexOf("use App\\Models\\UserAccount;")).toBeGreaterThan(
      text.indexOf("namespace App\\Services;"),
    );
    expect(text.indexOf("use App\\Models\\UserAccount;")).toBeLessThan(
      text.indexOf("interface RepoInterface"),
    );
  });

  it("copies a `use` for an imported return type", () => {
    const source = `<?php

namespace App\\Services;

use App\\Models\\User;

class Repo
{
    public function find(int $id): User {}
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Repo"),
      "/workspace/app/Services/Repo.php",
    );

    expect(plan?.interfaceText).toContain("use App\\Models\\User;");
    expect(plan?.interfaceText).toContain(
      "public function find(int $id): User;",
    );
  });

  it("copies an aliased `use` when the alias appears in a signature", () => {
    const source = `<?php

namespace App\\Services;

use App\\Models\\Account as Acc;

class Repo
{
    public function load(Acc $account): Acc {}
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Repo"),
      "/workspace/app/Services/Repo.php",
    );

    expect(plan?.interfaceText).toContain("use App\\Models\\Account as Acc;");
    expect(plan?.interfaceText).toContain(
      "public function load(Acc $account): Acc;",
    );
  });

  it("does not emit a `use` for a fully-qualified type in the signature", () => {
    const source = `<?php

namespace App\\Services;

class Repo
{
    public function find(): \\App\\Models\\User {}
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Repo"),
      "/workspace/app/Services/Repo.php",
    );

    expect(plan?.interfaceText).not.toContain("use ");
    expect(plan?.interfaceText).toContain(
      "public function find(): \\App\\Models\\User;",
    );
  });

  it("does not emit a `use` for a type in the same namespace (no import in source)", () => {
    const source = `<?php

namespace App\\Services;

class Repo
{
    public function make(): Helper {}
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Repo"),
      "/workspace/app/Services/Repo.php",
    );

    expect(plan?.interfaceText).not.toContain("use ");
    expect(plan?.interfaceText).toContain("public function make(): Helper;");
  });

  it("does not emit a `use` for built-in scalar / pseudo types", () => {
    const source = `<?php

namespace App\\Services;

class Repo
{
    public function calc(int $a, string $b, ?bool $c): array {}

    public function self2(): self {}
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Repo"),
      "/workspace/app/Services/Repo.php",
    );

    expect(plan?.interfaceText).not.toContain("use ");
  });

  it("copies each component of a union / nullable signature type that is imported", () => {
    const source = `<?php

namespace App\\Services;

use App\\Models\\User;
use App\\Models\\Admin;

class Repo
{
    public function pick(?User $u): User|Admin {}
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Repo"),
      "/workspace/app/Services/Repo.php",
    );

    expect(plan?.interfaceText).toContain("use App\\Models\\User;");
    expect(plan?.interfaceText).toContain("use App\\Models\\Admin;");
    expect(plan?.interfaceText).toContain(
      "public function pick(?User $u): User|Admin;",
    );
  });

  it("emits each distinct imported type once and sorts them", () => {
    const source = `<?php

namespace App\\Services;

use App\\Models\\User;
use App\\Models\\Account;

class Repo
{
    public function a(User $u): User {}

    public function b(Account $a): Account {}
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Repo"),
      "/workspace/app/Services/Repo.php",
    );

    const text = plan?.interfaceText ?? "";
    expect(text.match(/use App\\Models\\User;/g)?.length).toBe(1);
    expect(text.match(/use App\\Models\\Account;/g)?.length).toBe(1);
    // Alphabetical: Account before User.
    expect(text.indexOf("use App\\Models\\Account;")).toBeLessThan(
      text.indexOf("use App\\Models\\User;"),
    );
  });

  it("does not emit a `use` for a type with no import in the source (conservative)", () => {
    const source = `<?php

namespace App\\Services;

class Repo
{
    public function save(UnknownType $x): void {}
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Repo"),
      "/workspace/app/Services/Repo.php",
    );

    expect(plan?.interfaceText).not.toContain("use ");
    expect(plan?.interfaceText).toContain(
      "public function save(UnknownType $x): void;",
    );
  });

  it("emits no use block when no signature type is imported (global namespace)", () => {
    const source = `<?php

class Repo
{
    public function a(int $x): void {}
}
`;

    const plan = planExtractInterface(
      source,
      cursorOn(source, "class Repo"),
      "/workspace/Repo.php",
    );

    expect(plan?.interfaceText).not.toContain("use ");
  });
});
