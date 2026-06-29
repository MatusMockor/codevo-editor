import { describe, expect, it } from "vitest";
import {
  filterPhpLanguageServerDiagnostics,
  phpMemberMethodDiagnosticKey,
  phpMemberPropertyDiagnosticKey,
  phpMethodDiagnosticKey,
  phpTraitHostConstantDiagnosticContext,
  phpTraitHostConstantDiagnosticKey,
  phpTraitHostMethodDiagnosticKey,
  phpTraitHostPropertyDiagnosticContext,
  phpTraitHostPropertyDiagnosticKey,
  phpUnresolvedMemberMethodDiagnosticContext,
  phpUnresolvedMemberPropertyDiagnosticContext,
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

  it("suppresses confirmed unresolved nullsafe member method diagnostics", () => {
    const source = `<?php

$album = Album::query()?->withRelations()?->first();
$album = Album::query()?->missingMagic()?->first();
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
      phpUnresolvedMemberMethodDiagnosticContext(source, confirmed),
    ).toEqual({
      methodName: "withRelations",
      receiverExpression: "Album::query()",
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

  it("suppresses global Laravel builder member method diagnostics through the framework provider", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Album extends Model
{
}

$album = Album::query()->whereNull('parent_id')->first();
$album = Album::query()->withRelations()->first();
`;
    const globalBuilderMethod = diagnostic({
      character: 26,
      line: 9,
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::whereNull() does not exist",
    });
    const localScope = diagnostic({
      character: 26,
      line: 10,
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::withRelations() does not exist",
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [globalBuilderMethod, localScope], {
        frameworkProviders: [phpLaravelFrameworkProvider],
      }),
    ).toEqual([localScope]);
    expect(
      filterPhpLanguageServerDiagnostics(source, [globalBuilderMethod], {
        frameworkProviders: [],
      }),
    ).toEqual([globalBuilderMethod]);
  });

  it("suppresses discovered Laravel builder macro diagnostics without broadening unknown methods", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Model;

class Post extends Model
{
}

Builder::macro('published', function (): Builder {
    return $this->whereNotNull('published_at');
});

$fromStatic = Post::published()->first();
$fromMember = Post::query()->published()->first();
$query = Post::query();
$fromVariable = $query->published()->first();
$fromUnknown = $query->missingMacro()->first();
`;
    const staticMacro = diagnosticAt(
      source,
      "published()->first();\n$fromMember",
      {
        message: "Method App\\Models\\Post::published() does not exist",
      },
    );
    const memberMacro = diagnosticAt(source, "published()->first();\n$query", {
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::published() does not exist",
    });
    const variableMacro = diagnosticAt(
      source,
      "published()->first();\n$fromUnknown",
      {
        message:
          "Method Illuminate\\Database\\Eloquent\\Builder::published() does not exist",
      },
    );
    const unknownBuilderMethod = diagnosticAt(source, "missingMacro", {
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::missingMacro() does not exist",
    });

    expect(
      filterPhpLanguageServerDiagnostics(
        source,
        [staticMacro, memberMacro, variableMacro, unknownBuilderMethod],
        {
          frameworkProviders: [phpLaravelFrameworkProvider],
        },
      ),
    ).toEqual([unknownBuilderMethod]);
    expect(
      filterPhpLanguageServerDiagnostics(source, [staticMacro, memberMacro], {
        frameworkProviders: [],
      }),
    ).toEqual([staticMacro, memberMacro]);
  });

  it("suppresses workspace Laravel builder macro diagnostics without broadening unknown methods", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Post extends Model
{
}

$fromStatic = Post::withRelations()->first();
$fromMember = Post::query()->withRelations()->first();
$query = Post::query();
$fromVariable = $query->withRelations()->first();
$fromUnknown = $query->missingWorkspaceMacro()->first();
`;
    const providerSource = `<?php
namespace App\\Providers;

use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Support\\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Builder::macro('withRelations', function (): \\Illuminate\\Database\\Eloquent\\Builder {
            return $this->with([]);
        });
    }
}
`;
    const staticMacro = diagnosticAt(
      source,
      "withRelations()->first();\n$fromMember",
      {
        message: "Method App\\Models\\Post::withRelations() does not exist",
      },
    );
    const memberMacro = diagnosticAt(source, "withRelations()->first();\n$query", {
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::withRelations() does not exist",
    });
    const variableMacro = diagnosticAt(
      source,
      "withRelations()->first();\n$fromUnknown",
      {
        message:
          "Method Illuminate\\Database\\Eloquent\\Builder::withRelations() does not exist",
      },
    );
    const unknownBuilderMethod = diagnosticAt(source, "missingWorkspaceMacro", {
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::missingWorkspaceMacro() does not exist",
    });

    expect(
      filterPhpLanguageServerDiagnostics(
        source,
        [staticMacro, memberMacro, variableMacro, unknownBuilderMethod],
        {
          frameworkProviders: [phpLaravelFrameworkProvider],
          frameworkSourceContext: { workspaceSources: [providerSource] },
        },
      ),
    ).toEqual([unknownBuilderMethod]);
    expect(
      filterPhpLanguageServerDiagnostics(source, [staticMacro, memberMacro], {
        frameworkProviders: [phpLaravelFrameworkProvider],
      }),
    ).toEqual([staticMacro, memberMacro]);
  });

  it("suppresses same-source Laravel local scope diagnostics without broadening unknown methods", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Attributes\\Scope;
use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Model;

class Post extends Model
{
    public function scopePublished(Builder $query): void
    {
        $query->whereNotNull('published_at');
    }

    #[Scope]
    protected function popular(Builder $query): void
    {
        $query->where('views', '>', 100);
    }
}

class Report
{
}

$fromStatic = Post::published()->first();
$fromMember = Post::query()->published()->first();
$query = Post::query();
$fromVariable = $query->published()->first();
$fromAttribute = Post::popular()->first();
$fromMissing = $query->missingScope()->first();
$fromNonModel = Report::published();
`;
    const staticScope = diagnosticAt(
      source,
      "published()->first();\n$fromMember",
      {
        message: "Method App\\Models\\Post::published() does not exist",
      },
    );
    const memberScope = diagnosticAt(source, "published()->first();\n$query", {
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::published() does not exist",
    });
    const variableScope = diagnosticAt(
      source,
      "published()->first();\n$fromAttribute",
      {
        message:
          "Method Illuminate\\Database\\Eloquent\\Builder::published() does not exist",
      },
    );
    const attributeScope = diagnosticAt(source, "popular()->first", {
      message: "Method App\\Models\\Post::popular() does not exist",
    });
    const missingScope = diagnosticAt(source, "missingScope", {
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::missingScope() does not exist",
    });
    const nonModelScope = diagnosticAt(source, "published();", {
      message: "Method App\\Models\\Report::published() does not exist",
    });

    expect(
      filterPhpLanguageServerDiagnostics(
        source,
        [
          staticScope,
          memberScope,
          variableScope,
          attributeScope,
          missingScope,
          nonModelScope,
        ],
        {
          frameworkProviders: [phpLaravelFrameworkProvider],
        },
      ),
    ).toEqual([missingScope, nonModelScope]);
  });

  it("suppresses confirmed unresolved member method diagnostics on multiline chains", () => {
    const source = `<?php

$album = Album::query()
    ->withRelations()
    ->first();
$album = Album::query()
    ->missingMagic()
    ->first();
`;
    const confirmed = diagnostic({
      character: 6,
      line: 3,
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::withRelations() does not exist",
    });
    const unknown = diagnostic({
      character: 6,
      line: 6,
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::missingMagic() does not exist",
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [confirmed, unknown], {
        contextualMemberMethods: new Set([
          phpMemberMethodDiagnosticKey("Album::query()", "withRelations"),
        ]),
      }),
    ).toEqual([unknown]);
  });

  it("suppresses confirmed unresolved member property diagnostics", () => {
    const source = `<?php

$comment->content;
$comment->missing;
$comment->missing();
`;
    const confirmed = diagnostic({
      character: 11,
      line: 2,
      message:
        'Property "$content" does not exist on class "App\\Models\\Comment"',
    });
    const unknown = diagnostic({
      character: 11,
      line: 3,
      message:
        'Property "$missing" does not exist on class "App\\Models\\Comment"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [confirmed, unknown]),
    ).toEqual([confirmed, unknown]);
    expect(
      filterPhpLanguageServerDiagnostics(source, [confirmed, unknown], {
        contextualMemberProperties: new Set([
          phpMemberPropertyDiagnosticKey("$comment", "content"),
        ]),
      }),
    ).toEqual([unknown]);
    expect(
      phpUnresolvedMemberPropertyDiagnosticContext(
        source,
        diagnostic({
          character: 11,
          line: 4,
          message:
            'Property "$missing" does not exist on class "App\\Models\\Comment"',
        }),
      ),
    ).toBeNull();
  });

  it("suppresses confirmed unresolved nullsafe member property diagnostics", () => {
    const source = `<?php

$comment?->content;
$comment?->missing;
$comment?->missing();
`;
    const confirmed = diagnostic({
      character: 11,
      line: 2,
      message:
        'Property "$content" does not exist on class "App\\Models\\Comment"',
    });
    const unknown = diagnostic({
      character: 11,
      line: 3,
      message:
        'Property "$missing" does not exist on class "App\\Models\\Comment"',
    });

    expect(
      phpUnresolvedMemberPropertyDiagnosticContext(source, confirmed),
    ).toEqual({
      propertyName: "content",
      receiverExpression: "$comment",
    });
    expect(
      filterPhpLanguageServerDiagnostics(source, [confirmed, unknown]),
    ).toEqual([confirmed, unknown]);
    expect(
      filterPhpLanguageServerDiagnostics(source, [confirmed, unknown], {
        contextualMemberProperties: new Set([
          phpMemberPropertyDiagnosticKey("$comment", "content"),
        ]),
      }),
    ).toEqual([unknown]);
    expect(
      phpUnresolvedMemberPropertyDiagnosticContext(
        source,
        diagnostic({
          character: 11,
          line: 4,
          message:
            'Property "$missing" does not exist on class "App\\Models\\Comment"',
        }),
      ),
    ).toBeNull();
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

  it("extracts member method diagnostic contexts from multiline chains", () => {
    const source = `<?php

$album = Album::query()
    ->withRelations()
    ->first();
`;

    expect(
      phpUnresolvedMemberMethodDiagnosticContext(
        source,
        diagnostic({
          character: 6,
          line: 3,
          message:
            "Method Illuminate\\Database\\Eloquent\\Builder::withRelations() does not exist",
        }),
      ),
    ).toEqual({
      methodName: "withRelations",
      receiverExpression: "Album::query()",
    });
  });

  it("extracts member method contexts when the line ends with a trailing closure brace", () => {
    const source = `<?php

$post->localPosts()->each(function (Post $localPost): void {
    $localPost->delete();
});
`;

    expect(
      phpUnresolvedMemberMethodDiagnosticContext(
        source,
        diagnostic({
          character: 7,
          line: 2,
          message:
            'Method "localPosts" does not exist on class "App\\Models\\Post"',
        }),
      ),
    ).toEqual({
      methodName: "localPosts",
      receiverExpression: "$post",
    });
  });

  it("extracts member method contexts when the line ends with a trailing arrow function", () => {
    const source = `<?php

$post->localPosts()->map(fn (Post $localPost): int => $localPost->id);
`;

    expect(
      phpUnresolvedMemberMethodDiagnosticContext(
        source,
        diagnostic({
          character: 7,
          line: 2,
          message:
            'Method "localPosts" does not exist on class "App\\Models\\Post"',
        }),
      ),
    ).toEqual({
      methodName: "localPosts",
      receiverExpression: "$post",
    });
  });

  it("suppresses confirmed member method diagnostics on lines ending with a trailing closure", () => {
    const source = `<?php

$post->localPosts()->each(function (Post $localPost): void {
    $localPost->delete();
});
$post->missingMagic()->each(function (Post $localPost): void {
    $localPost->delete();
});
`;
    const confirmed = diagnostic({
      character: 7,
      line: 2,
      message:
        'Method "localPosts" does not exist on class "App\\Models\\Post"',
    });
    const unknown = diagnostic({
      character: 7,
      line: 5,
      message:
        'Method "missingMagic" does not exist on class "App\\Models\\Post"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [confirmed, unknown], {
        contextualMemberMethods: new Set([
          phpMemberMethodDiagnosticKey("$post", "localPosts"),
        ]),
      }),
    ).toEqual([unknown]);
  });

  it("extracts member property contexts when the line ends with a trailing closure brace", () => {
    const source = `<?php

$post->localPosts->each(function (Post $localPost): void {
    $localPost->delete();
});
`;

    expect(
      phpUnresolvedMemberPropertyDiagnosticContext(
        source,
        diagnostic({
          character: 7,
          line: 2,
          message:
            'Property "$localPosts" does not exist on class "App\\Models\\Post"',
        }),
      ),
    ).toEqual({
      propertyName: "localPosts",
      receiverExpression: "$post",
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

  it("treats a real kontentino trait (HasTenancy) as part of its host model", () => {
    // app/Tenancy/HasTenancy.php: trait methods reach for Eloquent host members
    // (getAttribute/setAttribute). PHPactor analysing the trait in isolation
    // reports them as missing; with the host context confirmed they are not the
    // user's bug, so the trait is treated as part of the host model.
    const source = `<?php

declare(strict_types=1);

namespace App\\Tenancy;

trait HasTenancy
{
    public function getTenantKey(): mixed
    {
        return $this->getAttribute($this->getTenantKeyName());
    }

    public function setInternal(string $key, mixed $value): self
    {
        $this->setAttribute(static::internalPrefix() . $key, $value);

        return $this;
    }
}
`;

    expect(
      filterPhpLanguageServerDiagnostics(
        source,
        [
          diagnosticAt(source, "getAttribute(", {
            message:
              'Method "getAttribute" does not exist on trait "App\\Tenancy\\HasTenancy"',
          }),
          diagnosticAt(source, "setAttribute(", {
            message:
              'Method "setAttribute" does not exist on trait "App\\Tenancy\\HasTenancy"',
          }),
        ],
        {
          contextualTraitHostMethods: new Set([
            phpTraitHostMethodDiagnosticKey(
              "App\\Tenancy\\HasTenancy",
              "getAttribute",
            ),
            phpTraitHostMethodDiagnosticKey(
              "App\\Tenancy\\HasTenancy",
              "setAttribute",
            ),
          ]),
          path: "/workspace/app/Tenancy/HasTenancy.php",
        },
      ),
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

  it("suppresses trait host-constant diagnostics when host context is confirmed", () => {
    const source = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): string
    {
        return static::HOST_STATE;
    }
}
`;
    const unresolved = diagnostic({
      character: 24,
      line: 7,
      message:
        'Constant "HOST_STATE" does not exist on trait "App\\Support\\ResolvesHostState"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        contextualTraitHostConstants: new Set([
          phpTraitHostConstantDiagnosticKey(
            "App\\Support\\ResolvesHostState",
            "HOST_STATE",
          ),
        ]),
        path: "/workspace/app/Support/ResolvesHostState.php",
      }),
    ).toEqual([]);
  });

  it("recognizes alternate PHPactor trait host-constant diagnostic wording", () => {
    const source = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): string
    {
        return self::HOST_STATE;
    }
}
`;

    expect(
      phpTraitHostConstantDiagnosticContext(
        source,
        diagnostic({
          character: 21,
          line: 7,
          message:
            'Undefined class constant "HOST_STATE" on trait "App\\Support\\ResolvesHostState"',
        }),
      ),
    ).toEqual({
      constantName: "HOST_STATE",
      traitName: "App\\Support\\ResolvesHostState",
    });

    expect(
      filterPhpLanguageServerDiagnostics(
        source,
        [
          diagnostic({
            character: 21,
            line: 7,
            message:
              'Trait "App\\Support\\ResolvesHostState" has no class constant "HOST_STATE"',
          }),
        ],
        {
          contextualTraitHostConstants: new Set([
            phpTraitHostConstantDiagnosticKey(
              "App\\Support\\ResolvesHostState",
              "HOST_STATE",
            ),
          ]),
          path: "/workspace/app/Support/ResolvesHostState.php",
        },
      ),
    ).toEqual([]);
  });

  it("keeps trait host-constant diagnostics when host context is not confirmed", () => {
    const source = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): string
    {
        return static::HOST_STATE;
    }
}
`;
    const unresolved = diagnostic({
      character: 24,
      line: 7,
      message:
        'Constant "HOST_STATE" does not exist on trait "App\\Support\\ResolvesHostState"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        path: "/workspace/app/Support/ResolvesHostState.php",
      }),
    ).toEqual([unresolved]);
  });

  it("keeps trait host-constant diagnostics when the line is actually a method call", () => {
    const source = `<?php
namespace App\\Support;

trait ResolvesHostState
{
    public function resolve(): string
    {
        return static::HOST_STATE();
    }
}
`;
    const unresolved = diagnostic({
      character: 24,
      line: 7,
      message:
        'Constant "HOST_STATE" does not exist on trait "App\\Support\\ResolvesHostState"',
    });

    expect(
      filterPhpLanguageServerDiagnostics(source, [unresolved], {
        contextualTraitHostConstants: new Set([
          phpTraitHostConstantDiagnosticKey(
            "App\\Support\\ResolvesHostState",
            "HOST_STATE",
          ),
        ]),
        path: "/workspace/app/Support/ResolvesHostState.php",
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

function diagnosticAt(
  source: string,
  needle: string,
  overrides: Partial<LanguageServerDiagnostic>,
): LanguageServerDiagnostic {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test diagnostic needle: ${needle}`);
  }

  const before = source.slice(0, offset);
  const lines = before.split("\n");

  return diagnostic({
    character: (lines[lines.length - 1] ?? "").length,
    line: lines.length - 1,
    ...overrides,
  });
}
