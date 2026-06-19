import { describe, expect, it } from "vitest";
import {
  filterPhpLanguageServerDiagnostics,
  phpMemberMethodDiagnosticKey,
  phpMethodDiagnosticKey,
  phpTraitHostMethodDiagnosticKey,
  phpTraitHostPropertyDiagnosticContext,
  phpTraitHostPropertyDiagnosticKey,
  phpUnresolvedMemberMethodDiagnosticContext,
  phpUnresolvedStaticMethodDiagnosticContext,
} from "./phpLanguageServerDiagnosticFilters";
import type { LanguageServerDiagnostic } from "./languageServerDiagnostics";
import { phpLaravelFrameworkProvider } from "./phpFrameworkProviders";

describe("filterPhpLanguageServerDiagnostics", () => {
  it("suppresses unresolved global Laravel Eloquent static builder methods", () => {
    const source = `<?php
use App\\Models\\Album;

$queryBuilder = Album::whereNull('parent_id');
$album = Album::withRelations()->findOrFail($id);
`;
    expect(
      filterPhpLanguageServerDiagnostics(source, [
        diagnostic({
          character: 23,
          line: 3,
          message: "Method App\\Models\\Album::whereNull() does not exist",
        }),
        diagnostic({
          character: 16,
          line: 4,
          message: "Method App\\Models\\Album::withRelations() does not exist",
        }),
      ], {
        frameworkProviders: [phpLaravelFrameworkProvider],
      }),
    ).toEqual([
      diagnostic({
        character: 16,
        line: 4,
        message: "Method App\\Models\\Album::withRelations() does not exist",
      }),
    ]);
  });

  it("keeps Laravel static builder method diagnostics for non-model receivers", () => {
    const source = `<?php
use App\\Services\\FooService;

$queryBuilder = FooService::whereNull('parent_id');
`;
    const unresolved = diagnostic({
      character: 28,
      line: 3,
      message: "Method App\\Services\\FooService::whereNull() does not exist",
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        frameworkProviders: [phpLaravelFrameworkProvider],
      }),
    ).toEqual([unresolved]);
  });

  it("keeps unresolved diagnostics for unknown static methods", () => {
    const source = `<?php

$queryBuilder = Album::whereNulll('parent_id');
`;
    const unresolved = diagnostic({
      character: 23,
      line: 2,
      message: "Method App\\Models\\Album::whereNulll() does not exist",
    });

    expect(filterPhpLanguageServerDiagnostics(source, [unresolved])).toEqual([
      unresolved,
    ]);
  });

  it("can keep framework magic diagnostics when no framework provider is active", () => {
    const source = `<?php

$queryBuilder = Album::whereNull('parent_id');
$album = Album::withRelations()->findOrFail($id);
`;
    const whereNull = diagnostic({
      character: 23,
      line: 2,
      message: "Method App\\Models\\Album::whereNull() does not exist",
    });
    const withRelations = diagnostic({
      character: 16,
      line: 3,
      message: "Method App\\Models\\Album::withRelations() does not exist",
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [whereNull, withRelations], {
        frameworkProviders: [],
      }),
    ).toEqual([whereNull, withRelations]);
  });

  it("suppresses unresolved static method diagnostics only when semantic context confirms the method", () => {
    const source = `<?php

$album = Album::published()->first();
`;
    const unresolved = diagnostic({
      character: 16,
      line: 2,
      message: "Method App\\Models\\Album::published() does not exist",
    });

    expect(filterPhpLanguageServerDiagnostics(source, [unresolved])).toEqual([
      unresolved,
    ]);
    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        contextualExistingMethods: new Set([
          phpMethodDiagnosticKey("Album", "published"),
        ]),
      }),
    ).toEqual([]);
  });

  it("suppresses unresolved member method diagnostics only when semantic context confirms the receiver", () => {
    const source = `<?php

$album = Album::query()->withRelations()->first();
$album = Album::query()->missingMagic()->first();
`;
    const confirmed = diagnostic({
      character: 27,
      line: 2,
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::withRelations() does not exist",
    });
    const unknown = diagnostic({
      character: 27,
      line: 3,
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::missingMagic() does not exist",
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [confirmed, unknown]),
    ).toEqual([confirmed, unknown]);
    expect(
      filterPhpLanguageServerDiagnostics(source, [confirmed, unknown], {
        contextualMemberMethods: new Set([
          phpMemberMethodDiagnosticKey("Album::query()", "withRelations"),
        ]),
      }),
    ).toEqual([unknown]);
  });

  it("extracts member method diagnostic contexts from unresolved PHPactor messages", () => {
    const source = `<?php

$album = Album::query()->withRelations()->first();
`;

    expect(
      phpUnresolvedMemberMethodDiagnosticContext(
        source,
        diagnostic({
          character: 27,
          line: 2,
          message:
            "Method Illuminate\\Database\\Eloquent\\Builder::withRelations() does not exist",
        }),
      ),
    ).toEqual({
      methodName: "withRelations",
      receiverExpression: "Album::query()",
    });
  });

  it("extracts static method diagnostic contexts from unresolved PHPactor messages", () => {
    const source = `<?php

$album = \\App\\Models\\Album::published()->first();
`;

    expect(
      phpUnresolvedStaticMethodDiagnosticContext(
        source,
        diagnostic({
          character: 29,
          line: 2,
          message: "Method App\\Models\\Album::published() does not exist",
        }),
      ),
    ).toEqual({
      className: "App\\Models\\Album",
      methodName: "published",
    });
  });

  it("keeps syntax diagnostics on Laravel lines", () => {
    const source = `<?php

$queryBuilder = Album::whereNull('parent_id')
`;
    const syntax = diagnostic({
      character: 45,
      line: 2,
      message: "unexpected EOF, expecting ';'",
    });

    expect(filterPhpLanguageServerDiagnostics(source, [syntax])).toEqual([
      syntax,
    ]);
  });

  it("suppresses PHPactor docblock hygiene diagnostics for valid legacy interfaces", () => {
    const source = `<?php

interface LocalUserInterface
{
    public function loadByCredentials($login, $password);
}
`;

    expect(
      filterPhpLanguageServerDiagnostics(source, [
        diagnostic({
          character: 20,
          code: "worse.docblock_missing_return_type",
          line: 4,
          message:
            'Method "loadByCredentials" is missing docblock return type: void',
        }),
        diagnostic({
          character: 38,
          code: "worse.docblock_missing_param",
          line: 4,
          message: 'Method "loadByCredentials" is missing @param $login',
        }),
      ]),
    ).toEqual([]);
  });

  it("keeps real PHPactor syntax diagnostics next to filtered docblock warnings", () => {
    const syntax = diagnostic({
      character: 55,
      code: null,
      line: 4,
      message: "unexpected token",
    });

    expect(
      filterPhpLanguageServerDiagnostics("<?php\ninterface Broken\n{\n", [
        diagnostic({
          character: 20,
          code: "worse.docblock_missing_return_type",
          line: 2,
          message: 'Method "broken" is missing docblock return type: void',
        }),
        syntax,
      ]),
    ).toEqual([syntax]);
  });

  it("suppresses PHPactor keyword-as-method false positives on return statements", () => {
    const source = `<?php

return (new CommentResource($comment))->response()->setStatusCode(200);
`;

    expect(
      filterPhpLanguageServerDiagnostics(source, [
        diagnostic({
          character: 0,
          line: 2,
          message:
            'Method "return" does not exist on class "Kontentino\\Communication\\Models\\Comment"',
        }),
      ]),
    ).toEqual([]);
  });

  it("keeps unknown method diagnostics away from return statements", () => {
    const source = `<?php

$comment->return();
`;
    const unresolved = diagnostic({
      character: 10,
      line: 2,
      message:
        'Method "return" does not exist on class "Kontentino\\Communication\\Models\\Comment"',
    });

    expect(filterPhpLanguageServerDiagnostics(source, [unresolved])).toEqual([
      unresolved,
    ]);
  });

  it("suppresses stale PHPactor return parse diagnostics after completed calls", () => {
    const source = `<?php

$comment->forceDelete();
return (new CommentResource($comment))->response()->setStatusCode(200);
`;

    expect(
      filterPhpLanguageServerDiagnostics(source, [
        diagnostic({
          character: 0,
          line: 3,
          message:
            'Parse error: syntax error, unexpected token "return" in Standard input code on line 4 Errors parsing Standard input code',
        }),
      ]),
    ).toEqual([]);
  });

  it("keeps return parse diagnostics when the previous statement is incomplete", () => {
    const source = `<?php

$comment->forceDelete(
return (new CommentResource($comment))->response()->setStatusCode(200);
`;
    const parseError = diagnostic({
      character: 0,
      line: 3,
      message:
        'Parse error: syntax error, unexpected token "return" in Standard input code on line 4 Errors parsing Standard input code',
    });

    expect(filterPhpLanguageServerDiagnostics(source, [parseError])).toEqual([
      parseError,
    ]);
  });

  it("suppresses PHPactor trait host-method diagnostics with confirmed host context", () => {
    const source = `<?php
namespace Illuminate\\Database\\Eloquent;

trait SoftDeletes
{
    public function forceDelete()
    {
        if ($this->fireModelEvent('forceDeleting') === false) {
            return false;
        }
    }
}
`;
    const unresolved = diagnostic({
      character: 20,
      line: 7,
      message:
        'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(
        source,
        [unresolved],
        {
          contextualTraitHostMethods: new Set([
            phpTraitHostMethodDiagnosticKey(
              "Illuminate\\Database\\Eloquent\\SoftDeletes",
              "fireModelEvent",
            ),
          ]),
          path:
            "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php",
        },
      ),
    ).toEqual([]);
  });

  it("recognizes alternate PHPactor trait host-method diagnostic wording", () => {
    const source = `<?php
namespace Illuminate\\Database\\Eloquent;

trait SoftDeletes
{
    public function forceDelete()
    {
        $this->fireModelEvent('forceDeleting');
    }
}
`;
    const contexts = new Set([
      phpTraitHostMethodDiagnosticKey(
        "Illuminate\\Database\\Eloquent\\SoftDeletes",
        "fireModelEvent",
      ),
    ]);

    expect(
      filterPhpLanguageServerDiagnostics(
        source,
        [
          diagnostic({
            character: 15,
            line: 7,
            message:
              'Undefined method "fireModelEvent" on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
          }),
          diagnostic({
            character: 15,
            line: 7,
            message:
              'Trait "Illuminate\\Database\\Eloquent\\SoftDeletes" has no method "fireModelEvent"',
          }),
        ],
        {
          contextualTraitHostMethods: contexts,
          path:
            "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php",
        },
      ),
    ).toEqual([]);
  });

  it("keeps PHPactor trait diagnostics outside dependency folders", () => {
    const source = `<?php
trait BrokenTrait
{
    public function run()
    {
        $this->missingMethod();
    }
}
`;
    const unresolved = diagnostic({
      character: 15,
      line: 5,
      message: 'Method "missingMethod" does not exist on trait "BrokenTrait"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        path: "/workspace/app/BrokenTrait.php",
      }),
    ).toEqual([unresolved]);
  });

  it("suppresses app trait host-method diagnostics when host context is confirmed", () => {
    const source = `<?php
namespace App\\Support;

trait DispatchesEvents
{
    public function dispatchSaved(): void
    {
        $this->fireModelEvent('saved');
    }
}
`;
    const unresolved = diagnostic({
      character: 15,
      line: 7,
      message:
        'Method "fireModelEvent" does not exist on trait "App\\Support\\DispatchesEvents"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        contextualTraitHostMethods: new Set([
          phpTraitHostMethodDiagnosticKey(
            "App\\Support\\DispatchesEvents",
            "fireModelEvent",
          ),
        ]),
        path: "/workspace/app/Support/DispatchesEvents.php",
      }),
    ).toEqual([]);
  });

  it("suppresses trait self host-method diagnostics when host context is confirmed", () => {
    const source = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): mixed
    {
        return self::hostState();
    }
}
`;
    const unresolved = diagnostic({
      character: 21,
      line: 7,
      message:
        'Method "hostState" does not exist on trait "App\\Support\\ResolvesHostState"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        contextualTraitHostMethods: new Set([
          phpTraitHostMethodDiagnosticKey(
            "App\\Support\\ResolvesHostState",
            "hostState",
          ),
        ]),
        path: "/workspace/app/Support/ResolvesHostState.php",
      }),
    ).toEqual([]);
  });

  it("suppresses trait static host-method diagnostics when host context is confirmed", () => {
    const source = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): mixed
    {
        return static::hostState();
    }
}
`;
    const unresolved = diagnostic({
      character: 23,
      line: 7,
      message:
        'Method "hostState" does not exist on trait "App\\Support\\ResolvesHostState"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        contextualTraitHostMethods: new Set([
          phpTraitHostMethodDiagnosticKey(
            "App\\Support\\ResolvesHostState",
            "hostState",
          ),
        ]),
        path: "/workspace/app/Support/ResolvesHostState.php",
      }),
    ).toEqual([]);
  });

  it("suppresses trait parent host-method diagnostics when host context is confirmed", () => {
    const source = `<?php
namespace App\\Support;

trait BootsHostState
{
    public static function bootBootsHostState(): void
    {
        parent::bootBootsHostState();
    }
}
`;
    const unresolved = diagnostic({
      character: 16,
      line: 7,
      message:
        'Method "bootBootsHostState" does not exist on trait "App\\Support\\BootsHostState"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        contextualTraitHostMethods: new Set([
          phpTraitHostMethodDiagnosticKey(
            "App\\Support\\BootsHostState",
            "bootBootsHostState",
          ),
        ]),
        path: "/workspace/app/Support/BootsHostState.php",
      }),
    ).toEqual([]);
  });

  it("keeps trait parent host-method diagnostics when host context is not confirmed", () => {
    const source = `<?php
namespace App\\Support;

trait BootsHostState
{
    public static function bootBootsHostState(): void
    {
        parent::bootBootsHostState();
    }
}
`;
    const unresolved = diagnostic({
      character: 16,
      line: 7,
      message:
        'Method "bootBootsHostState" does not exist on trait "App\\Support\\BootsHostState"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        path: "/workspace/app/Support/BootsHostState.php",
      }),
    ).toEqual([unresolved]);
  });

  it("keeps trait static host-method diagnostics when host context is not confirmed", () => {
    const source = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): mixed
    {
        return static::hostState();
    }
}
`;
    const unresolved = diagnostic({
      character: 23,
      line: 7,
      message:
        'Method "hostState" does not exist on trait "App\\Support\\ResolvesHostState"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        path: "/workspace/app/Support/ResolvesHostState.php",
      }),
    ).toEqual([unresolved]);
  });

  it("keeps dependency trait diagnostics when host context is not confirmed", () => {
    const source = `<?php
trait SoftDeletes
{
    public function forceDelete()
    {
        $this->fireModelEvent('forceDeleting');
    }
}
`;
    const unresolved = diagnostic({
      character: 15,
      line: 4,
      message:
        'Method "fireModelEvent" does not exist on trait "Illuminate\\Database\\Eloquent\\SoftDeletes"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        path: "/workspace/vendor/laravel/framework/src/Illuminate/Database/Eloquent/SoftDeletes.php",
      }),
    ).toEqual([unresolved]);
  });

  it("suppresses trait host-property diagnostics when host context is confirmed", () => {
    const source = `<?php
namespace App\\Support;

trait UsesConnection
{
    public function connectionName(): string
    {
        return $this->connectionName;
    }
}
`;
    const unresolved = diagnostic({
      character: 22,
      line: 7,
      message:
        'Property "$connectionName" does not exist on trait "App\\Support\\UsesConnection"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        contextualTraitHostProperties: new Set([
          phpTraitHostPropertyDiagnosticKey(
            "App\\Support\\UsesConnection",
            "connectionName",
          ),
        ]),
        path: "/workspace/app/Support/UsesConnection.php",
      }),
    ).toEqual([]);
  });

  it("recognizes alternate PHPactor trait host-property diagnostic wording", () => {
    const source = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): mixed
    {
        return static::$hostState;
    }
}
`;

    expect(
      phpTraitHostPropertyDiagnosticContext(
        source,
        diagnostic({
          character: 24,
          line: 7,
          message:
            'Undefined property "$hostState" on trait "App\\Support\\ResolvesHostState"',
        }),
      ),
    ).toEqual({
      propertyName: "hostState",
      traitName: "App\\Support\\ResolvesHostState",
    });

    expect(
      filterPhpLanguageServerDiagnostics(
        source,
        [
          diagnostic({
            character: 24,
            line: 7,
            message:
              'Trait "App\\Support\\ResolvesHostState" has no property "$hostState"',
          }),
        ],
        {
          contextualTraitHostProperties: new Set([
            phpTraitHostPropertyDiagnosticKey(
              "App\\Support\\ResolvesHostState",
              "hostState",
            ),
          ]),
          path: "/workspace/app/Support/ResolvesHostState.php",
        },
      ),
    ).toEqual([]);
  });

  it("keeps trait host-property diagnostics when host context is not confirmed", () => {
    const source = `<?php
namespace App\\Support;

trait UsesConnection
{
    public function connectionName(): string
    {
        return $this->connectionName;
    }
}
`;
    const unresolved = diagnostic({
      character: 22,
      line: 7,
      message:
        'Property "$connectionName" does not exist on trait "App\\Support\\UsesConnection"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        path: "/workspace/app/Support/UsesConnection.php",
      }),
    ).toEqual([unresolved]);
  });

  it("keeps trait host-property diagnostics when the line is actually a method call", () => {
    const source = `<?php
namespace App\\Support;

trait UsesConnection
{
    public function connectionName(): string
    {
        return $this->connectionName();
    }
}
`;
    const unresolved = diagnostic({
      character: 22,
      line: 7,
      message:
        'Property "$connectionName" does not exist on trait "App\\Support\\UsesConnection"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        contextualTraitHostProperties: new Set([
          phpTraitHostPropertyDiagnosticKey(
            "App\\Support\\UsesConnection",
            "connectionName",
          ),
        ]),
        path: "/workspace/app/Support/UsesConnection.php",
      }),
    ).toEqual([unresolved]);
  });
});

function diagnostic(
  overrides: Partial<LanguageServerDiagnostic>,
): LanguageServerDiagnostic {
  return {
    character: 0,
    line: 0,
    message: "Unknown method",
    severity: "error",
    source: "PHPactor",
    ...overrides,
  };
}
