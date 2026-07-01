// PHP/Laravel IDE correctness matrix.
//
// Purpose: a checked-in regression MATRIX that pins exact, PhpStorm-parity
// expectations for real Laravel/OOP scenarios (completions, chain-type
// resolution, macros, navigation, diagnostics) against the REAL exported
// domain resolvers - the same functions the application layer
// (`useWorkbenchController.ts`) composes for `providePhpMethodCompletions` /
// `goToDefinition` / diagnostic filtering. No mocking of domain logic: every
// row below calls production code with realistic PHP source.
//
// Fixtures are inspired by real-world Laravel/Kontentino-style code shapes
// (Eloquent model with fillable/casts()/relations/scopes, a
// `*RepositoryContract` + implementation, a service provider with
// bind/singleton/macro, a JsonResource, a trait) - they are written fresh for
// this suite, not copied from any proprietary codebase. This mirrors the
// existing "trait members behave as host-class members (kontentino
// HasTenancy)" fixture convention in `phpMethodCompletions.test.ts`: PHP
// fixtures live inline as `const` source strings, not in a separate
// `__fixtures__` directory (there is no such convention elsewhere in this
// repo - verified before adding one).
//
// HOW TO EXTEND: add a fixture (or reuse an existing one) and a new `it(...)`
// row inside the relevant `describe` block below. Each row states the exact
// input (source + position/expression) and the exact expected output. Keep
// one real exported function call per row so a failure points at exactly
// which resolver regressed.
import { describe, expect, it } from "vitest";
import {
  orderPhpMemberCompletionsByCategory,
  phpMethodCompletionsFromSource,
} from "./phpMethodCompletions";
import {
  isKnownPhpFrameworkMemberMethod,
  isKnownPhpFrameworkStaticMethod,
  phpFrameworkMemberCompletionsFromSource,
  phpLaravelFrameworkProvider,
} from "./phpFrameworkProviders";
import {
  isPhpLaravelLocalScopeSourceMethod,
  phpLaravelDynamicWhereCompletionsFromSource,
  phpLaravelEloquentBuilderModelTypeFromExpression,
  phpLaravelLocalScopeCompletionsFromMethods,
  phpLaravelRelationTargetClassNameFromExpression,
  phpLaravelScopeMethodName,
} from "./phpFrameworkLaravel";
import {
  phpCurrentClassName,
  phpReceiverExpressionTypeInSource,
  phpVariableTypeInSource,
} from "./phpSemanticEngine";
import {
  phpExtendsClassName,
  phpIdentifierContextAt,
  phpMethodPositionOrNull,
} from "./phpNavigation";
import {
  classifyPhpLanguageServerDiagnostic,
  filterPhpLanguageServerDiagnostics,
  LARAVEL_MAGIC_DIAGNOSTIC_SOURCE,
  phpTraitHostMethodDiagnosticKey,
} from "./phpLanguageServerDiagnosticFilters";
import type { LanguageServerDiagnostic } from "./languageServerDiagnostics";

const laravelOptions = {
  frameworkProviders: [phpLaravelFrameworkProvider],
};

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  return positionAtOffset(source, offset + needle.length);
}

// Position AT the start of `needle`'s first occurrence (matches how
// `phpMethodPositionOrNull`/`phpNamedTypePosition` point at the start of a
// name, rather than after it).
function positionAt(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  return positionAtOffset(source, offset);
}

function positionAtOffset(source: string, offset: number) {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length + 1,
    lineNumber: lines.length,
  };
}

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

// ---------------------------------------------------------------------------
// Fixtures - a small realistic "project management" Laravel slice.
// ---------------------------------------------------------------------------

const HAS_AUDIT_LOG_TRAIT = `<?php

declare(strict_types=1);

namespace App\\Models\\Concerns;

trait HasAuditLog
{
    public function touchAuditLog(): void
    {
        $this->setAttribute('audited_at', now());
    }

    public function lastAuditedBy(): ?string
    {
        return $this->getAttribute('audited_by');
    }
}
`;

// Target models for the relations below - kept minimal, no fillable/casts of
// their own since they only exist to be relation targets in this matrix.
const PAGE_MODEL = `<?php

declare(strict_types=1);

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Page extends Model
{
    protected $table = 'pages';
}
`;

const TASK_MODEL = `<?php

declare(strict_types=1);

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;

class Task extends Model
{
    protected $table = 'tasks';

    protected $fillable = [
        'text',
    ];
}
`;

// The main Eloquent model fixture: fillable + casts() + relations + scopes +
// a trait, matching a realistic Kontentino-style `Project` model.
const PROJECT_MODEL = `<?php

declare(strict_types=1);

namespace App\\Models;

use App\\Models\\Concerns\\HasAuditLog;
use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class Project extends Model
{
    use HasAuditLog;

    protected $table = 'projects';

    protected $fillable = [
        'name',
        'page_id',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'page_id' => 'integer',
            'is_default' => 'boolean',
            'settings' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function page(): BelongsTo
    {
        return $this->belongsTo(Page::class, 'page_id');
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class, 'project_id');
    }

    public function scopeDefault(Builder $query): Builder
    {
        return $query->where('is_default', true);
    }

    public function scopeForPage(Builder $query, int $pageId): Builder
    {
        return $query->where('page_id', $pageId);
    }
}
`;

// A *RepositoryContract + its implementation - the "repository pattern"
// convention used throughout the reference codebase.
const PROJECT_REPOSITORY_CONTRACT = `<?php

declare(strict_types=1);

namespace App\\Contracts\\Repositories;

use App\\Models\\Project;

interface ProjectRepositoryContract
{
    public function findOrFail(int $id): Project;

    public function create(array $attributes): Project;
}
`;

const PROJECT_REPOSITORY = `<?php

declare(strict_types=1);

namespace App\\Repositories;

use App\\Contracts\\Repositories\\ProjectRepositoryContract;
use App\\Models\\Project;

final class ProjectRepository implements ProjectRepositoryContract
{
    public function findOrFail(int $id): Project
    {
        return Project::query()->findOrFail($id);
    }

    public function create(array $attributes): Project
    {
        return Project::query()->create($attributes);
    }
}
`;

// A service provider registering a repository binding and a Builder macro.
const APP_SERVICE_PROVIDER = `<?php

declare(strict_types=1);

namespace App\\Providers;

use App\\Contracts\\Repositories\\ProjectRepositoryContract;
use App\\Repositories\\ProjectRepository;
use Illuminate\\Database\\Eloquent\\Builder;
use Illuminate\\Support\\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(ProjectRepositoryContract::class, ProjectRepository::class);
    }

    public function boot(): void
    {
        Builder::macro('whereActive', function (): Builder {
            return $this->where('status', 'active');
        });
    }
}
`;

const PROJECT_RESOURCE = `<?php

declare(strict_types=1);

namespace App\\Http\\Resources;

use App\\Models\\Project;
use Illuminate\\Http\\Resources\\Json\\JsonResource;

/**
 * @mixin Project
 */
class ProjectResource extends JsonResource
{
    public function toArray($request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
        ];
    }
}
`;

const PROJECT_WORKSPACE_SOURCES = [
  PAGE_MODEL,
  TASK_MODEL,
  HAS_AUDIT_LOG_TRAIT,
  PROJECT_REPOSITORY_CONTRACT,
  PROJECT_REPOSITORY,
  APP_SERVICE_PROVIDER,
  PROJECT_RESOURCE,
];

describe("Laravel/PHP IDE correctness matrix", () => {
  // -------------------------------------------------------------------------
  // 1. Completions: `$model->`, `Model::`, magic-where, scopes.
  // -------------------------------------------------------------------------
  describe("completions", () => {
    it("lists exactly the fillable + casts() attributes on $model-> with their cast types, ordered fillable-then-new-cast-keys", () => {
      // Mirrors `readPhpClassMembersFromPath` in useWorkbenchController.ts:
      // `phpMethodCompletionsFromSource(content, className, { frameworkProviders })`
      // is the real call used to build `$model->` completions for a class.
      const attributeCompletions = phpFrameworkMemberCompletionsFromSource(
        PROJECT_MODEL,
        "App\\Models\\Project",
        [phpLaravelFrameworkProvider],
      ).filter((completion) => completion.kind === "property");

      expect(attributeCompletions).toEqual([
        {
          declaringClassName: "App\\Models\\Project",
          kind: "property",
          name: "name",
          parameters: "",
          returnType: "mixed",
        },
        // `page_id` is both fillable and cast - the derived type wins but the
        // fillable-list position is preserved (Map insertion order).
        {
          declaringClassName: "App\\Models\\Project",
          kind: "property",
          name: "page_id",
          parameters: "",
          returnType: "int",
        },
        {
          declaringClassName: "App\\Models\\Project",
          kind: "property",
          name: "status",
          parameters: "",
          returnType: "mixed",
        },
        {
          declaringClassName: "App\\Models\\Project",
          kind: "property",
          name: "is_default",
          parameters: "",
          returnType: "bool",
        },
        {
          declaringClassName: "App\\Models\\Project",
          kind: "property",
          name: "settings",
          parameters: "",
          returnType: "array",
        },
        {
          declaringClassName: "App\\Models\\Project",
          kind: "property",
          name: "created_at",
          parameters: "",
          returnType: "\\Illuminate\\Support\\Carbon",
        },
        // Relations surface through the SAME "property" kind (Eloquent
        // exposes relations as magic properties, e.g. `$project->page`) -
        // NOT a distinct "relation" kind. `orderPhpMemberCompletionsByCategory`
        // still has a "relation" bucket, but the Laravel provider never emits
        // it; see the "ordering" row below for how these interleave in the UI.
        // Relation target types are the raw class-name token used in the
        // `X::class` argument (not import/namespace-qualified) - the same
        // behavior already locked by the "Comment"/"featuredPosts" -> "Post"
        // case in phpFrameworkProviders.test.ts.
        {
          declaringClassName: "App\\Models\\Project",
          kind: "property",
          name: "page",
          parameters: "",
          returnType: "Page",
        },
        {
          declaringClassName: "App\\Models\\Project",
          kind: "property",
          name: "tasks",
          parameters: "",
          returnType: "Task",
        },
      ]);
    });

    it("orders $model-> completions PhpStorm-like via orderPhpMemberCompletionsByCategory: attributes/relations before local scopes", () => {
      // Mirrors `resolvePhpReceiverMethodCompletions` in
      // useWorkbenchController.ts: attribute/relation completions come from
      // the framework provider, scopes are derived separately from the raw
      // `scopeX()` source methods via `phpLaravelLocalScopeCompletionsFromMethods`,
      // then the final list is ordered PhpStorm-like.
      const attributeAndRelationMembers = phpFrameworkMemberCompletionsFromSource(
        PROJECT_MODEL,
        "App\\Models\\Project",
        [phpLaravelFrameworkProvider],
      );
      const rawScopeSourceMembers = phpMethodCompletionsFromSource(
        PROJECT_MODEL,
        "App\\Models\\Project",
      ).filter((member) => isPhpLaravelLocalScopeSourceMethod(member));
      const scopeMembers = phpLaravelLocalScopeCompletionsFromMethods(
        rawScopeSourceMembers,
      );

      const ordered = orderPhpMemberCompletionsByCategory([
        ...attributeAndRelationMembers,
        ...scopeMembers,
      ]);

      expect(ordered.map((member) => member.name)).toEqual([
        "name",
        "page_id",
        "status",
        "is_default",
        "settings",
        "created_at",
        "page",
        "tasks",
        "default",
        "forPage",
      ]);
    });

    it("derives magic-where completions (kind magic-where) only for fillable/cast attributes, never for undeclared columns", () => {
      const magicWhere = phpLaravelDynamicWhereCompletionsFromSource(
        PROJECT_MODEL,
        "App\\Models\\Project",
      );

      expect(magicWhere).toEqual(
        expect.arrayContaining([
          {
            declaringClassName: "App\\Models\\Project",
            kind: "magic-where",
            name: "whereName",
            parameters: "$value",
            returnType: "Illuminate\\Database\\Eloquent\\Builder",
          },
          {
            declaringClassName: "App\\Models\\Project",
            kind: "magic-where",
            name: "wherePageId",
            parameters: "$value",
            returnType: "Illuminate\\Database\\Eloquent\\Builder",
          },
          {
            declaringClassName: "App\\Models\\Project",
            kind: "magic-where",
            name: "whereIsDefault",
            parameters: "$value",
            returnType: "Illuminate\\Database\\Eloquent\\Builder",
          },
        ]),
      );
      expect(magicWhere.map((member) => member.name)).not.toContain(
        "whereUnknownColumn",
      );
    });

    it("does NOT surface magic-where completions on a bare $model-> receiver (only on Builder-typed receivers - see chain-type matrix)", () => {
      // `resolvePhpReceiverMethodCompletions` in useWorkbenchController.ts only
      // computes dynamic-where members when `resolvePhpEloquentBuilderModelType`
      // (backed by the exported `phpLaravelEloquentBuilderModelTypeFromExpression`)
      // resolves the receiver EXPRESSION to a Builder - never for a bare model
      // variable, even though the variable's TYPE is the same model. This row
      // exercises that exact gate, not just the (unconditional) generator.
      const source = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Project;

class ProjectController
{
    public function show(Project $project): void
    {
        $query = Project::query();
    }
}
`;

      // Gate is false for a bare model-typed variable - production merges no
      // dynamic-where members for `$project->`.
      expect(
        phpLaravelEloquentBuilderModelTypeFromExpression(source, "$project"),
      ).toBeNull();
      // Gate is true for a Builder-returning receiver expression (`Model::query()`,
      // or a variable assigned from one) - production DOES merge them there.
      expect(
        phpLaravelEloquentBuilderModelTypeFromExpression(source, "Project::query()"),
      ).toBe("App\\Models\\Project");
      expect(
        phpLaravelEloquentBuilderModelTypeFromExpression(source, "$query"),
      ).toBe("App\\Models\\Project");

      // The raw generator itself is unconditional (by design - the caller
      // decides whether to merge it in), so it always has magic-where members
      // available once given a model type; confirming that keeps this row
      // honest about WHERE the real gate lives.
      expect(
        phpLaravelDynamicWhereCompletionsFromSource(
          PROJECT_MODEL,
          "App\\Models\\Project",
        ).some((member) => member.kind === "magic-where"),
      ).toBe(true);
    });

    it("static Model:: completions expose the Model's own static methods but filter out instance-only attribute/relation completions", () => {
      const allMembers = phpMethodCompletionsFromSource(
        PROJECT_MODEL,
        "App\\Models\\Project",
        { frameworkProviders: [phpLaravelFrameworkProvider] },
      );
      const staticCompletions = allMembers.filter((member) => member.isStatic);

      // Fillable/cast attributes and relations are magic INSTANCE properties;
      // Eloquent never exposes them as static members.
      expect(
        staticCompletions.some((member) =>
          ["name", "page_id", "page", "tasks"].includes(member.name),
        ),
      ).toBe(false);
    });

    it("$request-> completions resolve through the real inherited/trait chain (Symfony Request -> Illuminate Request -> InteractsWithInput trait -> FormRequest -> app request)", () => {
      // Reproduces the exact multi-file inheritance the hook resolves for
      // `providePhpMethodCompletions` on `$request->`, combined into one
      // source string the way `phpMethodCompletionsFromSource` reads a single
      // file (cross-file `extends`/`use` walking is the hook's job, covered
      // in `useWorkbenchController.preview.test.tsx`; this row locks the
      // domain-level resolution once the classes are visible in one source).
      const combinedSource = `<?php
namespace App\\Http\\Requests;

use Illuminate\\Foundation\\Http\\FormRequest;

class StoreProjectRequest extends FormRequest
{
    public function projectData(): array
    {
        return $this->only(['name', 'page_id', 'status']);
    }
}

namespace Illuminate\\Foundation\\Http;

use Illuminate\\Http\\Request;

class FormRequest extends Request
{
}

namespace Illuminate\\Http;

use Symfony\\Component\\HttpFoundation\\Request as SymfonyRequest;

class Request extends SymfonyRequest
{
    use Concerns\\InteractsWithInput;
}

namespace Illuminate\\Http\\Concerns;

trait InteractsWithInput
{
    public function input($key = null, $default = null) {}
}

namespace Symfony\\Component\\HttpFoundation;

class Request
{
    public function get(string $key, mixed $default = null): mixed {}
}
`;

      const members = phpMethodCompletionsFromSource(
        combinedSource,
        "App\\Http\\Requests\\StoreProjectRequest",
      );

      // `declaringClassName` is not asserted here: a single combined source
      // walking `extends`/`use` across namespaces attributes every inherited
      // member to the QUERIED class (this domain-level simplification is
      // distinct from the hook's real per-file resolution, which DOES keep
      // the true origin class - see `providePhpMethodCompletions` /
      // `$request->get` in useWorkbenchController.preview.test.tsx). What
      // this row locks is that the full chain (own method, trait method,
      // grandparent method) is actually reachable and typed correctly.
      expect(
        members.map((member) => ({
          name: member.name,
          parameters: member.parameters,
          returnType: member.returnType,
        })),
      ).toEqual(
        expect.arrayContaining([
          { name: "projectData", parameters: "", returnType: "array" },
          {
            name: "input",
            parameters: "$key = null, $default = null",
            returnType: null,
          },
          {
            name: "get",
            parameters: "string $key, mixed $default = null",
            returnType: "mixed",
          },
        ]),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 2. Chain types: repository/builder/collection/resource/container chains.
  // -------------------------------------------------------------------------
  describe("chain type resolution", () => {
    it("$repo->findOrFail(1)-> resolves to the model type through a *RepositoryContract-typed parameter", () => {
      const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\Repositories\\ProjectRepositoryContract;

class ProjectController
{
    public function show(ProjectRepositoryContract $repo): void
    {
        $project = $repo->findOrFail(1);
        $project->na
    }
}
`;
      const options = {
        ...laravelOptions,
        frameworkSourceContext: { workspaceSources: PROJECT_WORKSPACE_SOURCES },
      };

      expect(
        phpReceiverExpressionTypeInSource(
          controllerSource,
          positionAfter(controllerSource, "$repo->findOrFail(1)"),
          "$repo->findOrFail(1)",
          options,
        ),
      ).toBe("App\\Models\\Project");
      expect(
        phpVariableTypeInSource(
          controllerSource,
          positionAfter(controllerSource, "$project->na"),
          "project",
          options,
        ),
      ).toBe("App\\Models\\Project");
    });

    it("Model::query()->where()->first()-> resolves to the model type", () => {
      const source = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Project;

class ProjectController
{
    public function show(): void
    {
        $project = Project::query()->where('status', 'active')->first();
        $project->na
    }
}
`;

      expect(
        phpReceiverExpressionTypeInSource(
          source,
          positionAfter(source, "$project->na"),
          "Project::query()->where('status', 'active')->first()",
          laravelOptions,
        ),
      ).toBe("App\\Models\\Project");
    });

    it("Model::with('relation')->get()->first()-> resolves to the model type (collection terminal method)", () => {
      const source = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Project;

class ProjectController
{
    public function show(): void
    {
        $project = Project::with('tasks')->get()->first();
        $project->na
    }
}
`;

      expect(
        phpReceiverExpressionTypeInSource(
          source,
          positionAfter(source, "$project->na"),
          "Project::with('tasks')->get()->first()",
          laravelOptions,
        ),
      ).toBe("App\\Models\\Project");
    });

    it("ProjectResource::make($project)->response()-> resolves to Illuminate\\Http\\JsonResponse", () => {
      // Resource-chain resolution (`phpLaravelResourceStaticMakeReturnTypeFromSource`
      // / `phpLaravelResourceMethodCallReturnTypeFromSource`) only inspects
      // `source` itself - unlike repository/container resolution it is not
      // threaded through `frameworkSourceContext.workspaceSources` - so the
      // resource class declaration has to be visible in the same source the
      // hook reads for the controller file, and (like every domain-level
      // single-source test in this codebase - see
      // "resolves parenthesized new Laravel resource chains to JsonResponse"
      // in phpSemanticEngine.test.ts) that single source has exactly ONE
      // `namespace` declaration, matching real PSR-4 file boundaries:
      // `use`-import and namespace resolution here are file-scoped, not
      // block-scoped, so a source string can't straddle two namespaces the
      // way this fixture set's multi-file layout normally would.
      const source = `<?php
namespace App\\Http\\Resources;

use App\\Models\\Project;
use Illuminate\\Http\\Resources\\Json\\JsonResource;

class ProjectResource extends JsonResource
{
    public function toArray($request): array
    {
        return [];
    }
}

class ProjectController
{
    public function show(Project $project): void
    {
        $response = ProjectResource::make($project)->response();
        $response->setStatusCode(200);
    }
}
`;
      const options = laravelOptions;

      expect(
        phpReceiverExpressionTypeInSource(
          source,
          positionAfter(source, "ProjectResource::make($project)"),
          "ProjectResource::make($project)",
          options,
        ),
      ).toBe("App\\Http\\Resources\\ProjectResource");
      expect(
        phpReceiverExpressionTypeInSource(
          source,
          positionAfter(
            source,
            "ProjectResource::make($project)->response()",
          ),
          "ProjectResource::make($project)->response()",
          options,
        ),
      ).toBe("Illuminate\\Http\\JsonResponse");
    });

    it("app()->make(ProjectRepositoryContract::class)-> resolves through the container binding to the concrete repository, then through its method to the model", () => {
      const source = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\Repositories\\ProjectRepositoryContract;

class ProjectController
{
    public function show(): void
    {
        $project = app()->make(ProjectRepositoryContract::class)->findOrFail(1);
        $project->na
    }
}
`;
      const options = {
        ...laravelOptions,
        frameworkSourceContext: { workspaceSources: PROJECT_WORKSPACE_SOURCES },
      };

      expect(
        phpReceiverExpressionTypeInSource(
          source,
          positionAfter(
            source,
            "app()->make(ProjectRepositoryContract::class)",
          ),
          "app()->make(ProjectRepositoryContract::class)",
          options,
        ),
        // The container binding's concrete class name is the raw token from
        // `bind(X::class, Y::class)` (unqualified here) - the same behavior
        // already locked by the AuditRepositoryInterface -> EloquentCommentRepository
        // case in phpSemanticEngine.test.ts. It still resolves through to the
        // right model below because repository method lookup matches by name.
      ).toBe("ProjectRepository");
      expect(
        phpVariableTypeInSource(
          source,
          positionAfter(source, "$project->na"),
          "project",
          options,
        ),
      ).toBe("App\\Models\\Project");
      // Without an active framework provider, container resolution is
      // disabled entirely - no false type, no false completions.
      expect(
        phpReceiverExpressionTypeInSource(
          source,
          positionAfter(
            source,
            "app()->make(ProjectRepositoryContract::class)",
          ),
          "app()->make(ProjectRepositoryContract::class)",
          {},
        ),
      ).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Macros: correct receiver, only-if-defined.
  // -------------------------------------------------------------------------
  describe("macros", () => {
    it("a Builder::macro() registered in a provider source is a known member method on a Builder-typed receiver (Model::query()->)", () => {
      const source = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Project;

class ProjectController
{
    public function index(): void
    {
        $query = Project::query();
    }
}
`;

      expect(
        isKnownPhpFrameworkMemberMethod(
          source,
          "Project::query()",
          "whereActive",
          [phpLaravelFrameworkProvider],
          { workspaceSources: [APP_SERVICE_PROVIDER] },
        ),
      ).toBe(true);
      expect(
        isKnownPhpFrameworkMemberMethod(
          source,
          "$query",
          "whereActive",
          [phpLaravelFrameworkProvider],
          { workspaceSources: [APP_SERVICE_PROVIDER] },
        ),
      ).toBe(true);
      expect(
        isKnownPhpFrameworkStaticMethod(
          source,
          "Project",
          "whereActive",
          [phpLaravelFrameworkProvider],
          { workspaceSources: [APP_SERVICE_PROVIDER] },
        ),
      ).toBe(true);
    });

    it("an undefined macro name is NOT a known member method - no false-positive completion/no false-negative diagnostic suppression", () => {
      const source = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Project;

class ProjectController
{
    public function index(): void
    {
        $query = Project::query();
    }
}
`;

      expect(
        isKnownPhpFrameworkMemberMethod(
          source,
          "Project::query()",
          "whereSomethingNeverRegistered",
          [phpLaravelFrameworkProvider],
          { workspaceSources: [APP_SERVICE_PROVIDER] },
        ),
      ).toBe(false);
    });

    it("KNOWN GAP: a Builder::macro() does not surface as a completion on a bare $model-> receiver, only on Builder-typed receivers", () => {
      // Eloquent's `Model::__call` really does forward unknown instance calls
      // to `newQuery()`, so `$project->whereActive()` is valid Laravel at
      // runtime. The domain layer's macro registrar matching keys off the
      // exact declaring class passed to `phpLaravelMacroCompletionsFromSource`
      // and only maps a Model receiver to the SEPARATE "Model::macro()"
      // registrar bucket - not the "Builder::macro()" bucket - so this
      // completion is currently missing for the bare-model-receiver case.
      // This row locks the CURRENT (imperfect) behavior so a future fix is a
      // deliberate, visible change to this test, not a silent regression.
      const memberCompletions = phpFrameworkMemberCompletionsFromSource(
        PROJECT_MODEL,
        "App\\Models\\Project",
        [phpLaravelFrameworkProvider],
        { workspaceSources: [APP_SERVICE_PROVIDER] },
      );

      expect(
        memberCompletions.some((member) => member.name === "whereActive"),
      ).toBe(false);
    });

    it("a Query Builder macro (Illuminate\\Database\\Query\\Builder::macro) is scoped to the query builder receiver, not the Eloquent model", () => {
      // `$rows` is typed via a parameter type hint - a realistic way a
      // Query Builder instance reaches a method body (e.g. injected via a
      // `tap()`/pipeline callback, or built up by a query-object class) - so
      // its receiver type resolves through the already-real
      // `phpParameterTypeForVariable` path composed inside
      // `phpReceiverExpressionTypeInSource`, then that resolved class name is
      // what the diagnostics/completion seam checks the macro against - the
      // exact same two-step (resolve type, then ask the framework provider)
      // the hook performs.
      const source = `<?php
namespace App\\Http\\Controllers;

use Illuminate\\Database\\Query\\Builder;

class ReportController
{
    public function index(Builder $rows): void
    {
        $rows->where('status', 'active');
    }
}
`;
      const providerSource = `<?php
namespace App\\Providers;

use Illuminate\\Database\\Query\\Builder;
use Illuminate\\Support\\ServiceProvider;

class QueryBuilderMacroServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Builder::macro('whereRecentlyActive', function (): Builder {
            return $this->where('status', 'active');
        });
    }
}
`;
      const options = {
        ...laravelOptions,
        frameworkSourceContext: { workspaceSources: [providerSource] },
      };
      const resolvedReceiverType = phpReceiverExpressionTypeInSource(
        source,
        positionAfter(source, "$rows->where('status', 'active')"),
        "$rows",
        options,
      );

      // Parameter type hints resolve to the raw declared token (unqualified
      // here) - `isKnownPhpFrameworkMemberMethod` re-resolves it against
      // `source`'s own `use` import when matching the macro's registrar, so
      // the unqualified name still routes correctly below.
      expect(resolvedReceiverType).toBe("Builder");
      expect(
        isKnownPhpFrameworkMemberMethod(
          source,
          "$rows",
          "whereRecentlyActive",
          [phpLaravelFrameworkProvider],
          { workspaceSources: [providerSource] },
          resolvedReceiverType,
        ),
      ).toBe(true);
      // The same macro name is not a known member on an unrelated receiver
      // class (a plain service, not any Macroable Laravel builder/collection).
      expect(
        isKnownPhpFrameworkMemberMethod(
          "<?php\nclass PlainService {}\n$service = new PlainService();\n",
          "$service",
          "whereRecentlyActive",
          [phpLaravelFrameworkProvider],
          { workspaceSources: [providerSource] },
        ),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Navigation: trait method, parent::, self::/static::, scope, relation.
  // -------------------------------------------------------------------------
  describe("navigation", () => {
    it("classifies a trait member call ($this->traitMethod()) as a methodCall and resolves its definition inside the trait's own source", () => {
      const hostSource = `<?php
namespace App\\Models;

use App\\Models\\Concerns\\HasAuditLog;
use Illuminate\\Database\\Eloquent\\Model;

class Project extends Model
{
    use HasAuditLog;

    public function markAudited(): void
    {
        $this->touchAuditLog();
    }
}
`;

      expect(
        phpIdentifierContextAt(
          hostSource,
          positionAfter(hostSource, "$this->touchAuditLog"),
        ),
      ).toEqual({
        kind: "methodCall",
        methodName: "touchAuditLog",
        receiverExpression: "$this",
        variableName: "this",
      });
      // `phpTraitClassNames(hostSource)` (real navigation flow) tells the
      // caller which trait file to search next; once there, the method
      // definition itself is found at the start of its name.
      expect(phpMethodPositionOrNull(HAS_AUDIT_LOG_TRAIT, "touchAuditLog")).toEqual(
        positionAt(HAS_AUDIT_LOG_TRAIT, "touchAuditLog"),
      );
    });

    it("classifies parent::method() as a static call to the resolved parent class (not a literal namespaced 'parent' type)", () => {
      const source = `<?php
namespace App\\Repositories;

class ProjectRepository extends AbstractRepository
{
    public function findOrFail(int $id)
    {
        return parent::findOrFail($id);
    }
}
`;

      expect(
        phpIdentifierContextAt(
          source,
          positionAfter(source, "parent::findOrFail"),
        ),
      ).toEqual({
        className: "parent",
        kind: "staticMethodCall",
        methodName: "findOrFail",
      });
      expect(phpExtendsClassName(source)).toBe("AbstractRepository");
    });

    it("classifies self::/static:: calls as a static call resolved to the current class (self::) so navigation targets the class the call is written in", () => {
      const source = `<?php
namespace App\\Repositories;

class ProjectRepository
{
    public static function make(): self
    {
        return new self();
    }

    public function findDefault()
    {
        return self::make();
    }

    public function findLatest()
    {
        return static::make();
    }
}
`;

      expect(
        phpIdentifierContextAt(source, positionAfter(source, "self::make")),
      ).toEqual({ className: "self", kind: "staticMethodCall", methodName: "make" });
      expect(
        phpIdentifierContextAt(source, positionAfter(source, "static::make")),
      ).toEqual({
        className: "static",
        kind: "staticMethodCall",
        methodName: "make",
      });
      expect(phpCurrentClassName(source)).toBe(
        "App\\Repositories\\ProjectRepository",
      );
    });

    it("resolves a scope call (Model::default()) to its source method name (scopeDefault) for navigation", () => {
      expect(phpLaravelScopeMethodName("default")).toBe("scopeDefault");
      expect(phpLaravelScopeMethodName("forPage")).toBe("scopeForPage");
      expect(
        phpMethodPositionOrNull(PROJECT_MODEL, "scopeDefault"),
      ).not.toBeNull();
      expect(
        phpIdentifierContextAt(
          "<?php\n$projects = Project::default()->get();\n",
          positionAfter(
            "<?php\n$projects = Project::default()->get();\n",
            "Project::default",
          ),
        ),
      ).toEqual({
        className: "Project",
        kind: "staticMethodCall",
        methodName: "default",
      });
    });

    it("resolves a belongsTo/hasMany relation method's return statement to its target model class name for navigation", () => {
      // `includeCollectionRelations=false` restricts to singular relations
      // (belongsTo/hasOne/...) - the mode navigation uses for a `$model->relation`
      // magic-PROPERTY jump, since only a single related model is ever behind a
      // property read. `hasMany` is a collection relation and needs
      // `includeCollectionRelations=true` (the mode used when jumping from a
      // `relation()` METHOD call, which can return a many-relation).
      expect(
        phpLaravelRelationTargetClassNameFromExpression(
          "return $this->belongsTo(Page::class, 'page_id');",
          false,
        ),
      ).toBe("Page");
      expect(
        phpLaravelRelationTargetClassNameFromExpression(
          "return $this->hasMany(Task::class, 'project_id');",
          false,
        ),
      ).toBeNull();
      expect(
        phpLaravelRelationTargetClassNameFromExpression(
          "return $this->hasMany(Task::class, 'project_id');",
          true,
        ),
      ).toBe("Task");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Diagnostics: false-positive suppression vs. real errors.
  // -------------------------------------------------------------------------
  describe("diagnostics false positives", () => {
    it("suppresses a phpactor 'method does not exist on trait' false positive when the host class provides the member (Eloquent Model::setAttribute called from HasAuditLog)", () => {
      const unresolved = diagnosticAt(HAS_AUDIT_LOG_TRAIT, "setAttribute", {
        message:
          'Method "setAttribute" does not exist on trait "App\\Models\\Concerns\\HasAuditLog"',
      });

      expect(
        filterPhpLanguageServerDiagnostics(HAS_AUDIT_LOG_TRAIT, [unresolved], {
          contextualTraitHostMethods: new Set([
            phpTraitHostMethodDiagnosticKey(
              "App\\Models\\Concerns\\HasAuditLog",
              "setAttribute",
            ),
          ]),
          path: "/workspace/app/Models/Concerns/HasAuditLog.php",
        }),
      ).toEqual([]);
    });

    it("downgrades an unresolved Laravel Eloquent builder magic method to a hint (laravel-magic source), never an error", () => {
      const source = `<?php
use App\\Models\\Project;

$projects = Project::whereNull('deleted_at');
`;
      const magic = diagnosticAt(source, "whereNull", {
        message: "Method App\\Models\\Project::whereNull() does not exist",
      });

      const [classified, ...rest] = filterPhpLanguageServerDiagnostics(
        source,
        [magic],
        { frameworkProviders: [phpLaravelFrameworkProvider] },
      );

      expect(rest).toEqual([]);
      expect(classified).toEqual({
        ...magic,
        severity: "hint",
        source: LARAVEL_MAGIC_DIAGNOSTIC_SOURCE,
      });
      expect(
        classifyPhpLanguageServerDiagnostic(source, magic, {
          frameworkProviders: [phpLaravelFrameworkProvider],
        }),
      ).toBe("framework-magic");
    });

    it("does not suppress an undefined method on a container-resolved chain when the method genuinely does not exist on the concrete class", () => {
      const source = `<?php
namespace App\\Http\\Controllers;

use App\\Contracts\\Repositories\\ProjectRepositoryContract;

class ProjectController
{
    public function show(): void
    {
        $project = app()->make(ProjectRepositoryContract::class)->findOrFail(1);
        $project->thisMethodDoesNotExistAnywhere();
    }
}
`;
      const real = diagnosticAt(source, "thisMethodDoesNotExistAnywhere", {
        message:
          "Method App\\Models\\Project::thisMethodDoesNotExistAnywhere() does not exist",
      });

      // The container-resolved receiver type really is `App\Models\Project`
      // (confirmed via the same resolver used in the chain-type matrix), and
      // `thisMethodDoesNotExistAnywhere` is not a fillable/cast/relation/scope
      // of `Project`, nor any Laravel builder method - so this diagnostic
      // must remain a real, unsuppressed error.
      const options = {
        ...laravelOptions,
        frameworkSourceContext: { workspaceSources: PROJECT_WORKSPACE_SOURCES },
      };
      const resolvedReceiverType = phpReceiverExpressionTypeInSource(
        source,
        positionAfter(
          source,
          "app()->make(ProjectRepositoryContract::class)->findOrFail(1)",
        ),
        "app()->make(ProjectRepositoryContract::class)->findOrFail(1)",
        options,
      );
      expect(resolvedReceiverType).toBe("App\\Models\\Project");
      expect(
        isKnownPhpFrameworkMemberMethod(
          source,
          "$project",
          "thisMethodDoesNotExistAnywhere",
          [phpLaravelFrameworkProvider],
          undefined,
          resolvedReceiverType,
        ),
      ).toBe(false);
      // Re-use the SAME `options` (active Laravel provider + workspace
      // sources) as the "downgrades ... to a hint" row above: this proves the
      // framework-aware path stays a no-op for a genuine error instead of
      // trivially passing because no framework provider was ever consulted.
      expect(
        filterPhpLanguageServerDiagnostics(source, [real], options),
      ).toEqual([real]);
    });
  });
});
