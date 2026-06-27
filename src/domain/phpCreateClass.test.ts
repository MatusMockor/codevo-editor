import { describe, expect, it } from "vitest";

import {
  detectUnknownClassReference,
  phpCreateClassDestination,
  renderPhpTypeSkeleton,
  type PhpCreatableKind,
} from "./phpCreateClass";
import type { Psr4Root } from "./workspace";

function cursorOn(source: string, marker: string, inner = 0): number {
  const offset = source.indexOf(marker);

  if (offset < 0) {
    throw new Error(`marker not found: ${marker}`);
  }

  return offset + inner;
}

const appRoot: Psr4Root[] = [{ dev: false, namespace: "App\\", paths: ["app/"] }];

describe("detectUnknownClassReference", () => {
  it("detects a `new UnknownClass()` reference under the cursor", () => {
    const source = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        $service = new UnknownService();
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "UnknownService"),
    );

    expect(reference).toEqual({ kind: "class", reference: "UnknownService" });
  });

  it("detects a static method call receiver `UnknownClass::make()`", () => {
    const source = `<?php

namespace App\\Services;

class Greeter
{
    public function run(): void
    {
        Factory::make();
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "Factory"),
    );

    expect(reference).toEqual({ kind: "class", reference: "Factory" });
  });

  it("detects a static constant receiver `UnknownClass::CONST`", () => {
    const source = `<?php

class Greeter
{
    public function run(): void
    {
        $value = Settings::DEFAULT;
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "Settings"),
    );

    expect(reference).toEqual({ kind: "class", reference: "Settings" });
  });

  it("detects a parameter type hint `UnknownClass $x`", () => {
    const source = `<?php

class Greeter
{
    public function run(Mailer $mailer): void
    {
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "Mailer"),
    );

    expect(reference).toEqual({ kind: "class", reference: "Mailer" });
  });

  it("detects a return type `: UnknownClass`", () => {
    const source = `<?php

class Greeter
{
    public function build(): Report
    {
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "Report"),
    );

    expect(reference).toEqual({ kind: "class", reference: "Report" });
  });

  it("detects an `extends UnknownClass` reference (class kind)", () => {
    const source = `<?php

class Greeter extends BaseGreeter
{
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "BaseGreeter"),
    );

    expect(reference).toEqual({ kind: "class", reference: "BaseGreeter" });
  });

  it("detects an `implements UnknownInterface` reference as interface kind", () => {
    const source = `<?php

class Greeter implements Greetable
{
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "Greetable"),
    );

    expect(reference).toEqual({ kind: "interface", reference: "Greetable" });
  });

  it("detects a `catch (UnknownException $e)` reference", () => {
    const source = `<?php

class Greeter
{
    public function run(): void
    {
        try {
        } catch (CustomException $e) {
        }
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "CustomException"),
    );

    expect(reference).toEqual({ kind: "class", reference: "CustomException" });
  });

  it("detects a fully-qualified `new \\App\\UnknownClass()` reference", () => {
    const source = `<?php

namespace App\\Http;

class Greeter
{
    public function run(): void
    {
        $service = new \\App\\Services\\Unknown();
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "\\App\\Services\\Unknown", 1),
    );

    expect(reference).toEqual({
      kind: "class",
      reference: "\\App\\Services\\Unknown",
    });
  });

  it("returns null when the cursor is on a method call, not a class", () => {
    const source = `<?php

class Greeter
{
    public function run(): void
    {
        $this->doWork();
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "doWork"),
    );

    expect(reference).toBeNull();
  });

  it("returns null when the identifier sits inside a string literal", () => {
    const source = `<?php

class Greeter
{
    public function run(): string
    {
        return "new Unknown()";
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "Unknown", 0),
    );

    expect(reference).toBeNull();
  });

  it("returns null when the identifier sits inside a comment", () => {
    const source = `<?php

class Greeter
{
    // new Unknown() goes here
    public function run(): void
    {
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "Unknown"),
    );

    expect(reference).toBeNull();
  });

  it("returns null when the cursor is outside the source range", () => {
    const source = `<?php new Foo();`;

    expect(detectUnknownClassReference(source, -1)).toBeNull();
    expect(
      detectUnknownClassReference(source, source.length + 5),
    ).toBeNull();
  });

  it("returns null for a ternary value identifier `$cond ? Foo : Bar`", () => {
    const source = `<?php

class Greeter
{
    public function run($cond)
    {
        return $cond ? Foo : Bar;
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "? Foo", 2),
    );

    expect(reference).toBeNull();
  });

  it("returns null for reserved type keywords (`new self`)", () => {
    const source = `<?php

class Greeter
{
    public function run(): static
    {
        return new self();
    }
}
`;

    expect(
      detectUnknownClassReference(source, cursorOn(source, "new self", 4)),
    ).toBeNull();
    expect(
      detectUnknownClassReference(source, cursorOn(source, ": static", 2)),
    ).toBeNull();
  });

  it("returns null for a scalar pseudo-type in a return position (`: string`)", () => {
    const source = `<?php

class Greeter
{
    public function run(): string
    {
        return "hi";
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, ": string", 2),
    );

    expect(reference).toBeNull();
  });

  it("detects an `instanceof UnknownClass` reference", () => {
    const source = `<?php

class Greeter
{
    public function run($x): bool
    {
        return $x instanceof Shape;
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "Shape"),
    );

    expect(reference).toEqual({ kind: "class", reference: "Shape" });
  });

  it("detects a nullable return type `: ?UnknownClass`", () => {
    const source = `<?php

class Greeter
{
    public function build(): ?Report
    {
        return null;
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "Report"),
    );

    expect(reference).toEqual({ kind: "class", reference: "Report" });
  });

  it("detects a union parameter type `Existing|UnknownClass $x`", () => {
    const source = `<?php

class Greeter
{
    public function run(Existing|NewThing $x): void
    {
    }
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "NewThing"),
    );

    expect(reference).toEqual({ kind: "class", reference: "NewThing" });
  });

  it("returns null when the cursor is on a namespace-declaration segment", () => {
    const source = `<?php

namespace App\\Services;

class Greeter
{
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "Services"),
    );

    expect(reference).toBeNull();
  });

  it("returns null when the cursor is on a `use` import target", () => {
    const source = `<?php

use App\\Models\\Post;

class Greeter
{
}
`;
    const reference = detectUnknownClassReference(
      source,
      cursorOn(source, "Post"),
    );

    expect(reference).toBeNull();
  });
});

describe("phpCreateClassDestination", () => {
  it("maps an App\\ FQN to its PSR-4 path and namespace", () => {
    const destination = phpCreateClassDestination(
      "/workspace",
      appRoot,
      [],
      "App\\Services\\Mailer",
    );

    expect(destination).toEqual({
      namespace: "App\\Services",
      path: "/workspace/app/Services/Mailer.php",
    });
  });

  it("supports a nested PSR-4 root (Kontentino\\ -> app/Kontentino/src/)", () => {
    const roots: Psr4Root[] = [
      { dev: false, namespace: "App\\", paths: ["app/"] },
      {
        dev: false,
        namespace: "Kontentino\\",
        paths: ["app/Kontentino/src/"],
      },
    ];
    const destination = phpCreateClassDestination(
      "/workspace",
      roots,
      [],
      "Kontentino\\Billing\\Invoice",
    );

    expect(destination).toEqual({
      namespace: "Kontentino\\Billing",
      path: "/workspace/app/Kontentino/src/Billing/Invoice.php",
    });
  });

  it("picks the most specific (longest) matching PSR-4 namespace", () => {
    const roots: Psr4Root[] = [
      { dev: false, namespace: "App\\", paths: ["app/"] },
      {
        dev: false,
        namespace: "App\\Domain\\",
        paths: ["src/Domain/"],
      },
    ];
    const destination = phpCreateClassDestination(
      "/workspace",
      roots,
      [],
      "App\\Domain\\Billing\\Invoice",
    );

    expect(destination).toEqual({
      namespace: "App\\Domain\\Billing",
      path: "/workspace/src/Domain/Billing/Invoice.php",
    });
  });

  it("returns null when no PSR-4 root covers the FQN (uncertain destination)", () => {
    const destination = phpCreateClassDestination(
      "/workspace",
      appRoot,
      [],
      "Vendor\\Package\\Thing",
    );

    expect(destination).toBeNull();
  });

  it("returns null for a root-namespace class with no covering PSR-4 root", () => {
    const destination = phpCreateClassDestination(
      "/workspace",
      appRoot,
      [],
      "GlobalThing",
    );

    expect(destination).toBeNull();
  });

  it("never offers a destination inside an excluded (vendor) prefix", () => {
    const destination = phpCreateClassDestination(
      "/workspace",
      appRoot,
      ["App\\Vendor\\"],
      "App\\Vendor\\Thing",
    );

    expect(destination).toBeNull();
  });
});

describe("renderPhpTypeSkeleton", () => {
  const kinds: PhpCreatableKind[] = ["class", "interface", "trait", "enum"];

  for (const kind of kinds) {
    it(`renders a ${kind} skeleton with namespace`, () => {
      const skeleton = renderPhpTypeSkeleton(kind, "Mailer", "App\\Services");

      expect(skeleton).toBe(
        `<?php\n\nnamespace App\\Services;\n\n${kind} Mailer\n{\n}\n`,
      );
    });
  }

  it("renders a skeleton without a namespace for a global class", () => {
    const skeleton = renderPhpTypeSkeleton("class", "GlobalThing", null);

    expect(skeleton).toBe(`<?php\n\nclass GlobalThing\n{\n}\n`);
  });
});
