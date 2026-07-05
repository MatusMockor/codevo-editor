import { describe, expect, it } from "vitest";
import { phpTraitThisCompletionContextAt } from "./phpTraitThisCompletionContext";

function positionAfter(source: string, needle: string) {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`Needle not found: ${needle}`);
  }

  const offset = index + needle.length;
  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");

  return {
    column: lines[lines.length - 1].length + 1,
    lineNumber: lines.length,
  };
}

describe("phpTraitThisCompletionContextAt", () => {
  it("returns null for trait-only sources", () => {
    const source = `<?php
namespace App\\Models;

trait HasHostHooks
{
    public function bootHooks(): void
    {
        $this->host
    }
}
`;

    expect(
      phpTraitThisCompletionContextAt(source, positionAfter(source, "$this")),
    ).toBeNull();
  });

  it("returns the same-source host context for one host", () => {
    const source = `<?php
namespace App\\Models;

trait HasHostHooks
{
    public function bootHooks(): void
    {
        $this->host
    }
}

class User
{
    use HasHostHooks;

    public function hostHook(): void {}
}
`;

    const context = phpTraitThisCompletionContextAt(
      source,
      positionAfter(source, "$this"),
    );

    expect(context).toMatchObject({
      contextualThisClassName: "App\\Models\\User",
      declaringClassName: "App\\Models\\User",
    });
    expect(context?.memberSource).toContain("function bootHooks");
    expect(context?.memberSource).toContain("function hostHook");
  });

  it("returns null when two same-source hosts use the trait", () => {
    const source = `<?php
namespace App\\Models;

trait HasHostHooks
{
    public function bootHooks(): void
    {
        $this->host
    }
}

class User
{
    use HasHostHooks;
}

class Admin
{
    use HasHostHooks;
}
`;

    expect(
      phpTraitThisCompletionContextAt(source, positionAfter(source, "$this")),
    ).toBeNull();
  });

  it("matches namespace-qualified trait use statements", () => {
    const source = `<?php
namespace App\\Models;

trait HasHostHooks
{
    public function bootHooks(): void
    {
        $this->host
    }
}

class User
{
    use \\App\\Models\\HasHostHooks;

    public function hostHook(): void {}
}
`;

    expect(
      phpTraitThisCompletionContextAt(source, positionAfter(source, "$this")),
    ).toMatchObject({
      contextualThisClassName: "App\\Models\\User",
      declaringClassName: "App\\Models\\User",
    });
  });

  it("keeps type bodies intact through nested braces and strings", () => {
    const source = `<?php
namespace App\\Models;

trait HasHostHooks
{
    public function bootHooks(): void
    {
        $payload = "{ not a type body end }";
        if (true) {
            $this->host
        }
    }
}

class User
{
    use HasHostHooks;

    public function hostHook(): void
    {
        $payload = "{ still not a type body end }";
    }
}
`;

    const context = phpTraitThisCompletionContextAt(
      source,
      positionAfter(source, "$this"),
    );

    expect(context?.memberSource).toContain('$payload = "{ not a type body end }";');
    expect(context?.memberSource).toContain("function hostHook");
  });
});
