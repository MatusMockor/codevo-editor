import { describe, expect, it } from "vitest";
import {
  optimizePhpImportsSource,
  organizePhpImports,
} from "./phpImportsOrganizer";

describe("organizePhpImports", () => {
  it("returns null when there are no use statements", () => {
    const source = `<?php

namespace App;

class Foo
{
    public function bar(): void
    {
    }
}
`;

    expect(organizePhpImports(source)).toBeNull();
  });

  it("removes an unused import", () => {
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

    const result = organizePhpImports(source);

    expect(result).not.toBeNull();
    expect(result?.changed).toBe(true);
    expect(result?.removed).toEqual(["App\\Services\\UnusedService"]);
    expect(result?.organizedUseBlock).toBe(
      "use App\\Services\\UsedService;",
    );
  });

  it("keeps an import used via the new keyword", () => {
    const source = `<?php

namespace App;

use App\\Models\\Widget;

class Foo
{
    public function make()
    {
        return new Widget();
    }
}
`;

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual([]);
    expect(result?.changed).toBe(false);
    expect(result?.organizedUseBlock).toBe("use App\\Models\\Widget;");
  });

  it("keeps an import used via a static call", () => {
    const source = `<?php

namespace App;

use App\\Support\\Helper;

class Foo
{
    public function go()
    {
        return Helper::run();
    }
}
`;

    expect(organizePhpImports(source)?.removed).toEqual([]);
  });

  it("keeps an import used as a parameter type hint", () => {
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

    expect(organizePhpImports(source)?.removed).toEqual([]);
  });

  it("keeps an import used as a return type", () => {
    const source = `<?php

namespace App;

use App\\Models\\User;

class Foo
{
    public function user(): User
    {
    }
}
`;

    expect(organizePhpImports(source)?.removed).toEqual([]);
  });

  it("keeps an import used in extends/implements", () => {
    const source = `<?php

namespace App;

use App\\Base\\Controller;
use App\\Contracts\\Renderable;

class Foo extends Controller implements Renderable
{
}
`;

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual([]);
    expect(result?.changed).toBe(false);
  });

  it("keeps an import referenced only in a PHPDoc annotation", () => {
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

    expect(organizePhpImports(source)?.removed).toEqual([]);
  });

  it("keeps imports referenced only in @property / @method / @mixin docblock tags", () => {
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

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual([]);
    expect(result?.changed).toBe(false);
  });

  it("keeps a parameter-type class referenced only inside an @method signature", () => {
    const source = `<?php

namespace App;

use App\\ValueObjects\\Money;

/**
 * @method static self credit(Money $amount)
 */
class Account
{
}
`;

    expect(organizePhpImports(source)?.removed).toEqual([]);
  });

  it("keeps a class referenced only in an @see tag", () => {
    const source = `<?php

namespace App;

use App\\Support\\Helper;

/**
 * @see Helper::run()
 */
class Foo
{
}
`;

    expect(organizePhpImports(source)?.removed).toEqual([]);
  });

  it("still removes an import that is only mentioned in a docblock description", () => {
    const source = `<?php

namespace App;

use App\\Services\\Ghost;

/**
 * @return void Ghost is only mentioned in prose, never as a type.
 */
class Foo
{
    public function go(): void
    {
    }
}
`;

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual(["App\\Services\\Ghost"]);
    expect(result?.changed).toBe(true);
  });

  it("keeps an import referenced only in an attribute", () => {
    const source = `<?php

namespace App;

use App\\Attributes\\Route;

#[Route('/foo')]
class Foo
{
}
`;

    expect(organizePhpImports(source)?.removed).toEqual([]);
  });

  it("sorts the remaining imports alphabetically (case-insensitive)", () => {
    const source = `<?php

namespace App;

use App\\Zebra;
use App\\alpha;
use App\\Mango;

class Foo extends Zebra implements alpha
{
    public function m(): Mango
    {
    }
}
`;

    expect(organizePhpImports(source)?.organizedUseBlock).toBe(
      ["use App\\alpha;", "use App\\Mango;", "use App\\Zebra;"].join("\n"),
    );
  });

  it("detects usage through an alias and keeps it", () => {
    const source = `<?php

namespace App;

use App\\Models\\User as UserModel;

class Foo
{
    public function user(): UserModel
    {
    }
}
`;

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual([]);
    expect(result?.organizedUseBlock).toBe("use App\\Models\\User as UserModel;");
  });

  it("removes an aliased import when its alias is never used", () => {
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

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual(["App\\Models\\User as UserModel"]);
    expect(result?.organizedUseBlock).toBe("");
    expect(result?.changed).toBe(true);
  });

  it("expands grouped use statements and drops unused members", () => {
    const source = `<?php

namespace App;

use App\\Support\\{Alpha, Beta, Gamma};

class Foo
{
    public function go(Alpha $a): Gamma
    {
    }
}
`;

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual(["App\\Support\\Beta"]);
    expect(result?.organizedUseBlock).toBe(
      ["use App\\Support\\Alpha;", "use App\\Support\\Gamma;"].join("\n"),
    );
  });

  it("treats a name referenced only inside a string or comment as unused", () => {
    const source = `<?php

namespace App;

use App\\Services\\Ghost;

class Foo
{
    public function go(): void
    {
        // Ghost is mentioned here but not used
        $label = 'Ghost lives in a string';
    }
}
`;

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual(["App\\Services\\Ghost"]);
    expect(result?.changed).toBe(true);
  });

  it("keeps function and const imports separate and never removes them", () => {
    const source = `<?php

namespace App;

use App\\Models\\User;
use function App\\Support\\tap;
use const App\\Support\\VERSION;

class Foo
{
    public function user(): User
    {
    }
}
`;

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual([]);
    expect(result?.organizedUseBlock).toBe(
      [
        "use App\\Models\\User;",
        "use function App\\Support\\tap;",
        "use const App\\Support\\VERSION;",
      ].join("\n"),
    );
  });

  it("keeps an import used via instanceof", () => {
    const source = `<?php

namespace App;

use App\\Exceptions\\DomainException;

class Foo
{
    public function go($e): bool
    {
        return $e instanceof DomainException;
    }
}
`;

    expect(organizePhpImports(source)?.removed).toEqual([]);
  });

  it("still parses imports when a ::class reference precedes the use block", () => {
    const source = `<?php

namespace App;

use App\\Models\\User;
use App\\Models\\Unused;

class Foo
{
    public function u(): User
    {
        return Bar::class;
    }
}
`;

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual(["App\\Models\\Unused"]);
    expect(result?.organizedUseBlock).toBe("use App\\Models\\User;");
  });

  it("ignores trait use inside a class body when detecting top-level imports", () => {
    const source = `<?php

namespace App;

use App\\Concerns\\Loggable;
use App\\Concerns\\Unused;

class Foo
{
    use Loggable;
}
`;

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual(["App\\Concerns\\Unused"]);
    expect(result?.organizedUseBlock).toBe("use App\\Concerns\\Loggable;");
  });

  it("never drops a used import from a comma-separated use statement (last member unused)", () => {
    const source = `<?php

namespace App;

use App\\Used, App\\Unused;

class Foo
{
    public function m(Used $u): void
    {
    }
}
`;

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual([]);
    expect(result?.changed).toBe(false);
    // The whole comma-list is preserved verbatim - no used import may vanish.
    expect(result?.organizedUseBlock).toBe("use App\\Used, App\\Unused;");
  });

  it("keeps a comma-separated use statement verbatim when the last member is used", () => {
    const source = `<?php

namespace App;

use App\\Unused, App\\Used;

class Foo
{
    public function m(Used $u): void
    {
    }
}
`;

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual([]);
    expect(result?.changed).toBe(false);
    expect(result?.organizedUseBlock).toBe("use App\\Unused, App\\Used;");
  });

  it("keeps a fully-unused comma-separated use statement verbatim (conservative)", () => {
    const source = `<?php

namespace App;

use App\\A, App\\B;

class Foo
{
}
`;

    const result = organizePhpImports(source);

    expect(result?.removed).toEqual([]);
    expect(result?.changed).toBe(false);
    expect(result?.organizedUseBlock).toBe("use App\\A, App\\B;");
  });
});

describe("optimizePhpImportsSource", () => {
  it("returns null when there are no use statements", () => {
    const source = `<?php

namespace App;

class Foo
{
}
`;

    expect(optimizePhpImportsSource(source)).toBeNull();
  });

  it("returns null when the imports are already clean and sorted", () => {
    const source = `<?php

namespace App;

use App\\Models\\User;

class Foo
{
    public function bar(User $user): void
    {
    }
}
`;

    expect(optimizePhpImportsSource(source)).toBeNull();
  });

  it("rewrites the source dropping an unused import", () => {
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

    expect(optimizePhpImportsSource(source)).toBe(`<?php

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

  it("sorts surviving imports alphabetically without touching the rest", () => {
    const source = `<?php

namespace App;

use App\\Models\\Zebra;
use App\\Models\\Apple;

class Foo
{
    public function bar(Zebra $zebra, Apple $apple): void
    {
    }
}
`;

    expect(optimizePhpImportsSource(source)).toBe(`<?php

namespace App;

use App\\Models\\Apple;
use App\\Models\\Zebra;

class Foo
{
    public function bar(Zebra $zebra, Apple $apple): void
    {
    }
}
`);
  });

  it("returns null when a comment sits between use statements", () => {
    const source = `<?php

namespace App;

use App\\Models\\User;
// keep this around
use App\\Models\\Unused;

class Foo
{
    public function bar(User $user): void
    {
    }
}
`;

    expect(optimizePhpImportsSource(source)).toBeNull();
  });

  it("returns null when a trailing comment follows the last use statement", () => {
    const source = `<?php

namespace App;

use App\\Models\\Zebra;
use App\\Models\\Apple; // keep this comment where it is

class Foo
{
    public function bar(Zebra $zebra, Apple $apple): void
    {
    }
}
`;

    expect(optimizePhpImportsSource(source)).toBeNull();
  });

  it("returns null when a removable import carries a trailing comment", () => {
    const source = `<?php

namespace App;

use App\\Models\\Used;
use App\\Models\\Unused; // drop me

class Foo
{
    public function bar(Used $used): void
    {
    }
}
`;

    expect(optimizePhpImportsSource(source)).toBeNull();
  });

  it("returns null (no-op) for a comma-separated use statement so no used import is corrupted", () => {
    const source = `<?php

namespace App;

use App\\Used, App\\Unused;

class Foo
{
    public function m(Used $u): void
    {
    }
}
`;

    expect(optimizePhpImportsSource(source)).toBeNull();
  });

  it("does not drop a used import from a mixed block containing a comma-separated use", () => {
    const source = `<?php

namespace App;

use App\\Used, App\\Unused;
use App\\Models\\Lonely;

class Foo
{
    public function m(Used $u, Lonely $l): void
    {
    }
}
`;

    const optimized = optimizePhpImportsSource(source);

    // Whatever the rewrite does, the used comma-list members must survive.
    if (optimized !== null) {
      expect(optimized).toContain("App\\Used");
      expect(optimized).toContain("App\\Unused");
    }
  });
});
