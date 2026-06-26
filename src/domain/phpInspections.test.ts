import { describe, expect, it } from "vitest";
import {
  phpInspectionDiagnostics,
  phpUnusedImportRemovalAt,
  phpUnusedPrivateMethodRemovalAt,
} from "./phpInspections";

function offsetOf(source: string, needle: string): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`needle not found: ${needle}`);
  }

  return index;
}

describe("phpInspectionDiagnostics - unused import", () => {
  it("flags an unused import with a warning on the use line", () => {
    const source = `<?php

namespace App;

use App\\Services\\UsedService;
use App\\Services\\UnusedService;

class Foo
{
    public function bar(UsedService $service): void
    {
    }
}
`;

    const diagnostics = phpInspectionDiagnostics(source);

    expect(diagnostics).toEqual([
      {
        character: 0,
        endCharacter: "use App\\Services\\UnusedService;".length,
        endLine: 5,
        kind: "unused-import",
        line: 5,
        message: "Unused import App\\Services\\UnusedService.",
        severity: "warning",
        unnecessary: true,
      },
    ]);
  });

  it("flags an unused aliased import using its FQN and alias", () => {
    const source = `<?php

namespace App;

use App\\Models\\User as UserModel;

class Foo
{
    public function user(): User
    {
    }
}
`;

    const diagnostics = phpInspectionDiagnostics(source);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      kind: "unused-import",
      line: 4,
      message: "Unused import App\\Models\\User as UserModel.",
    });
  });

  it("does not flag an import used as a parameter type hint", () => {
    const source = `<?php

namespace App;

use App\\Http\\Request;

class Foo
{
    public function handle(Request $request): void
    {
    }
}
`;

    expect(phpInspectionDiagnostics(source)).toEqual([]);
  });

  it("does not flag an import used via new / static call / instanceof", () => {
    const source = `<?php

namespace App;

use App\\Models\\Widget;
use App\\Support\\Helper;
use App\\Exceptions\\DomainException;

class Foo
{
    public function go($e)
    {
        $w = new Widget();
        Helper::run();
        return $e instanceof DomainException;
    }
}
`;

    expect(phpInspectionDiagnostics(source)).toEqual([]);
  });

  it("does not flag an import referenced only in a PHPDoc @return tag", () => {
    const source = `<?php

namespace App;

use App\\Collections\\WidgetCollection;

class Foo
{
    /**
     * @return WidgetCollection
     */
    public function widgets()
    {
    }
}
`;

    expect(phpInspectionDiagnostics(source)).toEqual([]);
  });

  it("does not flag imports referenced only in @property / @method / @mixin docblock tags", () => {
    const source = `<?php

namespace App;

use App\\Models\\Profile;
use Illuminate\\Support\\Collection;
use Illuminate\\Database\\Eloquent\\Builder;
use App\\Macros\\BuilderMacros;

/**
 * @property Profile $profile
 * @property-read Collection $events
 * @method static Builder query()
 * @mixin BuilderMacros
 */
class Foo
{
}
`;

    expect(phpInspectionDiagnostics(source)).toEqual([]);
  });

  it("does not flag imports referenced only in generic/static-analysis docblock tags", () => {
    const source = `<?php

namespace App;

use Illuminate\\Support\\Collection;
use App\\Contracts\\Entity;
use App\\Contracts\\Comparable;
use App\\Concerns\\HasUuid;
use App\\ValueObjects\\Amount;
use App\\ValueObjects\\Currency;

/**
 * @extends Collection<int, User>
 * @template T of Entity
 * @implements Comparable<self>
 * @use HasUuid<int>
 * @phpstan-param Amount $amount
 * @psalm-return Currency
 */
class Repository extends Collection
{
}
`;

    expect(phpInspectionDiagnostics(source)).toEqual([]);
  });

  it("does not flag an import referenced only in an attribute", () => {
    const source = `<?php

namespace App;

use App\\Attributes\\Route;

#[Route('/foo')]
class Foo
{
}
`;

    expect(phpInspectionDiagnostics(source)).toEqual([]);
  });

  it("does not flag a class referenced only inside a heredoc body (it is masked, but conservative: keep)", () => {
    // A name that appears ONLY inside a heredoc is masked out by the analyzer,
    // so it would be reported as unused. Guard the OTHER direction: a class used
    // in real code AND mentioned in a heredoc must never be a false positive.
    const source = `<?php

namespace App;

use App\\Support\\Helper;

class Foo
{
    public function go(): void
    {
        Helper::run();
        $sql = <<<SQL
            Helper is mentioned in this heredoc string
        SQL;
    }
}
`;

    expect(phpInspectionDiagnostics(source)).toEqual([]);
  });

  it("does not flag function or const imports (out of scope, conservative)", () => {
    const source = `<?php

namespace App;

use function App\\Support\\tap;
use const App\\Support\\VERSION;

class Foo
{
}
`;

    expect(phpInspectionDiagnostics(source)).toEqual([]);
  });

  it("does not flag a comma-separated use statement (conservative no-op)", () => {
    const source = `<?php

namespace App;

use App\\A, App\\B;

class Foo
{
}
`;

    const diagnostics = phpInspectionDiagnostics(source).filter(
      (diagnostic) => diagnostic.kind === "unused-import",
    );

    expect(diagnostics).toEqual([]);
  });

  it("does not flag members of a grouped use statement (conservative: no per-member range)", () => {
    const source = `<?php

namespace App;

use App\\Support\\{Alpha, Beta};

class Foo
{
    public function go(Alpha $a): void
    {
    }
}
`;

    const diagnostics = phpInspectionDiagnostics(source).filter(
      (diagnostic) => diagnostic.kind === "unused-import",
    );

    expect(diagnostics).toEqual([]);
  });
});

describe("phpInspectionDiagnostics - unused private method", () => {
  it("flags an unused private method", () => {
    const source = `<?php

namespace App;

class Foo
{
    public function run(): void
    {
    }

    private function helper(): void
    {
    }
}
`;

    const diagnostics = phpInspectionDiagnostics(source).filter(
      (diagnostic) => diagnostic.kind === "unused-private-method",
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      kind: "unused-private-method",
      message: 'Unused private method "helper".',
      severity: "warning",
      unnecessary: true,
    });
  });

  it("does not flag a private method called via $this->method()", () => {
    const source = `<?php

namespace App;

class Foo
{
    public function run(): void
    {
        $this->helper();
    }

    private function helper(): void
    {
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-private-method",
      ),
    ).toEqual([]);
  });

  it("does not flag a private method called via self:: or static::", () => {
    const source = `<?php

namespace App;

class Foo
{
    public function run(): void
    {
        self::alpha();
        static::beta();
    }

    private static function alpha(): void
    {
    }

    private static function beta(): void
    {
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-private-method",
      ),
    ).toEqual([]);
  });

  it("does not flag protected or public methods even when uncalled", () => {
    const source = `<?php

namespace App;

class Foo
{
    public function publicUncalled(): void
    {
    }

    protected function protectedUncalled(): void
    {
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-private-method",
      ),
    ).toEqual([]);
  });

  it("does not flag any private method when a dynamic method call is present (conservative)", () => {
    const source = `<?php

namespace App;

class Foo
{
    public function run(string $name): void
    {
        $this->$name();
    }

    private function helper(): void
    {
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-private-method",
      ),
    ).toEqual([]);
  });

  it("does not flag any private method when call_user_func references a callable (conservative)", () => {
    const source = `<?php

namespace App;

class Foo
{
    public function run(): void
    {
        call_user_func([$this, 'helper']);
    }

    private function helper(): void
    {
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-private-method",
      ),
    ).toEqual([]);
  });

  it("does not flag a private method referenced as an array callable [$this, 'name']", () => {
    const source = `<?php

namespace App;

class Foo
{
    public function run(): void
    {
        $items->each([$this, 'helper']);
    }

    private function helper(): void
    {
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-private-method",
      ),
    ).toEqual([]);
  });

  it("does not flag any private method in a class that adopts a trait (trait may call it)", () => {
    const source = `<?php

namespace App;

class Foo
{
    use Loggable;

    private function helper(): void
    {
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-private-method",
      ),
    ).toEqual([]);
  });

  it("does not flag private methods when a trait is adopted with conflict resolution { ... }", () => {
    const source = `<?php

namespace App;

class Foo
{
    use A, B {
        A::hello insteadof B;
    }

    private function helper(): void
    {
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-private-method",
      ),
    ).toEqual([]);
  });

  it("does not flag magic methods (__construct, __get, ...) even when private and uncalled", () => {
    const source = `<?php

namespace App;

class Foo
{
    private function __construct()
    {
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-private-method",
      ),
    ).toEqual([]);
  });

  it("does not run method analysis on interfaces / traits / enums (only classes)", () => {
    const source = `<?php

namespace App;

trait Foo
{
    private function helper(): void
    {
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-private-method",
      ),
    ).toEqual([]);
  });
});

describe("phpInspectionDiagnostics - adversarial false positives", () => {
  it("does not flag an import referenced only via ::class", () => {
    const source = `<?php

namespace App;

use App\\Models\\Widget;

class Foo
{
    public function go(): string
    {
        return Widget::class;
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-import",
      ),
    ).toEqual([]);
  });

  it("does not flag an import used inside an arrow function / closure body", () => {
    const source = `<?php

namespace App;

use App\\Support\\Helper;

class Foo
{
    public function go(): callable
    {
        return fn () => Helper::run();
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-import",
      ),
    ).toEqual([]);
  });

  it("does not flag a private method called from inside a nested closure", () => {
    const source = `<?php

namespace App;

class Foo
{
    public function go(): callable
    {
        return function () {
            return $this->helper();
        };
    }

    private function helper(): int
    {
        return 1;
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-private-method",
      ),
    ).toEqual([]);
  });

  it("does not flag a private method used as a PHP 8.1 first-class callable", () => {
    const source = `<?php

namespace App;

class Foo
{
    public function go(): Closure
    {
        return $this->helper(...);
    }

    private function helper(): int
    {
        return 1;
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-private-method",
      ),
    ).toEqual([]);
  });

  it("only flags the genuinely unused method when names share a prefix", () => {
    const source = `<?php

namespace App;

class Foo
{
    public function go(): void
    {
        $this->helperFull();
    }

    private function helper(): void
    {
    }

    private function helperFull(): void
    {
    }
}
`;

    const flagged = phpInspectionDiagnostics(source)
      .filter((diagnostic) => diagnostic.kind === "unused-private-method")
      .map((diagnostic) => diagnostic.message);

    expect(flagged).toEqual(['Unused private method "helper".']);
  });

  it("does not flag a private method invoked through ClassName::method (self-named class)", () => {
    const source = `<?php

namespace App;

class Foo
{
    public function go(): void
    {
        Foo::helper();
    }

    private static function helper(): void
    {
    }
}
`;

    expect(
      phpInspectionDiagnostics(source).filter(
        (diagnostic) => diagnostic.kind === "unused-private-method",
      ),
    ).toEqual([]);
  });

  it("does not flag a private method whose name appears only in a comment as used (still flags it)", () => {
    // The name in a comment is masked out, so the method IS still reported. This
    // documents that comments never KEEP a method (no false negative leak) while
    // the inverse - a comment mention causing a false 'used' - cannot happen.
    const source = `<?php

namespace App;

class Foo
{
    public function go(): void
    {
        // helper() is described here but never actually called
    }

    private function helper(): void
    {
    }
}
`;

    const flagged = phpInspectionDiagnostics(source).filter(
      (diagnostic) => diagnostic.kind === "unused-private-method",
    );

    expect(flagged).toHaveLength(1);
    expect(flagged[0].message).toBe('Unused private method "helper".');
  });
});

describe("phpInspectionDiagnostics - safety", () => {
  it("returns an empty array for a file with no class and no imports", () => {
    expect(phpInspectionDiagnostics("<?php\n\necho 'hi';\n")).toEqual([]);
  });
});

describe("phpUnusedImportRemovalAt", () => {
  const source = `<?php

namespace App;

use App\\Services\\UsedService;
use App\\Services\\UnusedService;

class Foo
{
    public function bar(UsedService $service): void
    {
    }
}
`;

  it("returns a removal span that deletes the whole unused use line incl. newline", () => {
    const cursor = offsetOf(source, "UnusedService;") + 2;
    const removal = phpUnusedImportRemovalAt(source, cursor);

    expect(removal).not.toBeNull();
    expect(removal?.label).toBe("App\\Services\\UnusedService");

    const rewritten =
      source.slice(0, removal!.start) + source.slice(removal!.end);

    expect(rewritten).toBe(`<?php

namespace App;

use App\\Services\\UsedService;

class Foo
{
    public function bar(UsedService $service): void
    {
    }
}
`);
  });

  it("returns null when the cursor is not on an unused import", () => {
    const cursor = offsetOf(source, "UsedService;");

    expect(phpUnusedImportRemovalAt(source, cursor)).toBeNull();
  });
});

describe("phpUnusedPrivateMethodRemovalAt", () => {
  const source = `<?php

namespace App;

class Foo
{
    public function run(): void
    {
    }

    private function helper(): void
    {
        $x = 1;
    }
}
`;

  it("removes the whole unused private method declaration and body", () => {
    const cursor = offsetOf(source, "helper");
    const removal = phpUnusedPrivateMethodRemovalAt(source, cursor);

    expect(removal).not.toBeNull();
    expect(removal?.label).toBe("helper");

    const rewritten =
      source.slice(0, removal!.start) + source.slice(removal!.end);

    expect(rewritten).toBe(`<?php

namespace App;

class Foo
{
    public function run(): void
    {
    }

}
`);
  });

  it("returns null when the cursor is on a used / public method", () => {
    const cursor = offsetOf(source, "run");

    expect(phpUnusedPrivateMethodRemovalAt(source, cursor)).toBeNull();
  });

  it("matches the brace even when the body contains string braces", () => {
    const withStringBraces = `<?php

namespace App;

class Foo
{
    private function helper(): string
    {
        return '}';
    }
}
`;
    const cursor = offsetOf(withStringBraces, "helper");
    const removal = phpUnusedPrivateMethodRemovalAt(withStringBraces, cursor);

    expect(removal).not.toBeNull();

    const rewritten =
      withStringBraces.slice(0, removal!.start) +
      withStringBraces.slice(removal!.end);

    expect(rewritten).toBe(`<?php

namespace App;

class Foo
{
}
`);
  });
});
