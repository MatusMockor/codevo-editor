import { describe, expect, it } from "vitest";
import {
  phpAssignmentExpressionForVariableBefore,
  phpClassStringCallExpression,
  phpCurrentClassName,
  phpDeclaredGenericTypeCandidates,
  phpDeclaredTypeCandidate,
  phpDocGenericInheritances,
  phpDocTemplateNames,
  phpDocRawTypeForVariableBefore,
  phpFunctionReturnsClassStringArgument,
  phpLaravelContainerBindingsFromSource,
  phpLaravelContainerExpressionClassName,
  phpLaravelQueryCallbackContextForVariable,
  phpMethodCallExpression,
  phpMethodReturnExpressions,
  phpNewExpressionClassName,
  phpPropertyAccessExpression,
  phpReceiverExpressionTypeInSource,
  phpStaticCallExpression,
  phpThisPropertyType,
  phpVariableTypeInSource,
} from "./phpSemanticEngine";

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length + 1,
    lineNumber: lines.length,
  };
}

describe("phpSemanticEngine", () => {
  const source = `<?php
namespace App\\Http\\Controllers;

use App\\Services\\CommentService;
use App\\Repositories\\CommentRepository;

class CommentController
{
    /** @var CommentRepository */
    private $legacyRepository;

    public function __construct(
        private readonly CommentService $commentService,
    ) {}

    public function store(): void
    {
        /** @var CommentRepository $repository */
        $repository = app(CommentRepository::class);
        $agent = new CommentService();
        $comment = $this->commentService->create();

        $agent->cre
    }
}
`;

  it("builds basic class and property symbols", () => {
    expect(phpCurrentClassName(source)).toBe(
      "App\\Http\\Controllers\\CommentController",
    );
    expect(phpThisPropertyType(source, "commentService")).toBe("CommentService");
    expect(phpThisPropertyType(source, "legacyRepository")).toBe(
      "CommentRepository",
    );
  });

  it("resolves receiver expressions from scope symbols", () => {
    expect(
      phpReceiverExpressionTypeInSource(source, { column: 20, lineNumber: 22 }, "$this"),
    ).toBe("App\\Http\\Controllers\\CommentController");
    expect(
      phpReceiverExpressionTypeInSource(
        source,
        { column: 20, lineNumber: 22 },
        "$this->commentService",
      ),
    ).toBe("CommentService");
    expect(
      phpVariableTypeInSource(source, { column: 20, lineNumber: 22 }, "repository"),
    ).toBe("CommentRepository");
    expect(
      phpVariableTypeInSource(source, { column: 20, lineNumber: 22 }, "agent"),
    ).toBe("CommentService");
  });

  it("extracts assignment expressions and expression types", () => {
    expect(
      phpAssignmentExpressionForVariableBefore(
        source,
        { column: 20, lineNumber: 22 },
        "agent",
      ),
    ).toBe("new CommentService()");
    expect(phpNewExpressionClassName("new CommentService()")).toBe(
      "CommentService",
    );
    expect(
      phpNewExpressionClassName("new UserAccountModel()->getConnection()"),
    ).toBeNull();
    expect(phpLaravelContainerExpressionClassName("app(CommentRepository::class)")).toBe(
      "CommentRepository",
    );
    expect(
      phpLaravelContainerExpressionClassName("resolve(CommentRepository::class)"),
    ).toBe("CommentRepository");
    expect(
      phpLaravelContainerExpressionClassName(
        "app()->make(CommentRepository::class)",
      ),
    ).toBe("CommentRepository");
    expect(
      phpLaravelContainerExpressionClassName(
        "App::make(CommentRepository::class)",
      ),
    ).toBe("CommentRepository");
    expect(
      phpLaravelContainerExpressionClassName(
        "Container::getInstance()->make(CommentRepository::class)",
      ),
    ).toBe("CommentRepository");
  });

  it("detects method and static call expressions", () => {
    expect(phpMethodCallExpression("$this->commentService->create()")).toEqual({
      methodName: "create",
      receiverExpression: "$this->commentService",
    });
    expect(
      phpMethodCallExpression("$this->userAccount->getDatabaseConnection()"),
    ).toEqual({
      methodName: "getDatabaseConnection",
      receiverExpression: "$this->userAccount",
    });
    expect(phpMethodCallExpression("new UserAccountModel()->getConnection()")).toEqual(
      {
        methodName: "getConnection",
        receiverExpression: "new UserAccountModel()",
      },
    );
    expect(
      phpMethodCallExpression("Album::query()->whereNull('parent_id')->first()"),
    ).toEqual({
      methodName: "first",
      receiverExpression: "Album::query()->whereNull('parent_id')",
    });
    expect(phpMethodCallExpression("app(CommentService::class)->create()")).toEqual(
      {
        methodName: "create",
        receiverExpression: "app(CommentService::class)",
      },
    );
    expect(
      phpMethodCallExpression("App::make(CommentService::class)->create()"),
    ).toEqual({
      methodName: "create",
      receiverExpression: "App::make(CommentService::class)",
    });
    expect(phpPropertyAccessExpression("$comment->parent")).toEqual({
      propertyName: "parent",
      receiverExpression: "$comment",
    });
    expect(
      phpPropertyAccessExpression("$comment->parent()->first()->author"),
    ).toEqual({
      propertyName: "author",
      receiverExpression: "$comment->parent()->first()",
    });
    expect(phpStaticCallExpression("CommentFactory::make()")).toEqual({
      className: "CommentFactory",
      methodName: "make",
    });
  });

  it("detects calls that pass class-string arguments", () => {
    expect(
      phpClassStringCallExpression("$this->container->get(CommentService::class)"),
    ).toEqual({
      argumentClassName: "CommentService",
      kind: "methodCall",
      methodName: "get",
      receiverExpression: "$this->container",
    });
    expect(
      phpClassStringCallExpression("ServiceLocator::get(CommentService::class)"),
    ).toEqual({
      argumentClassName: "CommentService",
      className: "ServiceLocator",
      kind: "staticCall",
      methodName: "get",
    });
    expect(phpClassStringCallExpression("service(CommentService::class)")).toEqual(
      {
        argumentClassName: "CommentService",
        functionName: "service",
        kind: "functionCall",
      },
    );
  });

  it("detects generic functions that return their class-string argument", () => {
    expect(
      phpFunctionReturnsClassStringArgument(
        `<?php
/**
 * @template T of object
 * @param class-string<T> $className
 * @return T
 */
function service(string $className): object {}
`,
        "service",
      ),
    ).toBe(true);
    expect(
      phpFunctionReturnsClassStringArgument(
        "<?php\n/** @return object */\nfunction service(string $className): object {}\n",
        "service",
      ),
    ).toBe(false);
  });

  it("detects Laravel query callback context for closure variables", () => {
    const source = `<?php
use App\\Models\\Album;

Album::query()->whereHas('tracks', function ($query): void {
    $query->ord
});

Album::whereHas(relation: 'artist', callback: function ($builder): void {
    $builder->ord
});
`;

    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$query->ord"),
        "query",
      ),
    ).toEqual({
      methodName: "whereHas",
      modelClassName: null,
      receiverExpression: "Album::query()",
      relationName: "tracks",
    });
    expect(
      phpLaravelQueryCallbackContextForVariable(
        source,
        positionAfter(source, "$builder->ord"),
        "builder",
      ),
    ).toEqual({
      methodName: "whereHas",
      modelClassName: "Album",
      receiverExpression: null,
      relationName: "artist",
    });
  });

  it("extracts Laravel container bindings from service providers", () => {
    expect(
      phpLaravelContainerBindingsFromSource(`<?php
namespace App\\Providers;

use App\\Contracts\\CommentRepositoryInterface;
use App\\Repositories\\EloquentCommentRepository;
use App\\Contracts\\StatusRepositoryInterface;
use App\\Repositories\\DatabaseStatusRepository;
use App\\Contracts\\ReportRepositoryInterface;
use App\\Repositories\\CachedReportRepository;
use App\\Contracts\\WebhookRepositoryInterface;
use App\\Repositories\\DatabaseWebhookRepository;

class AppServiceProvider
{
    public function register(): void
    {
        $this->app->bind(CommentRepositoryInterface::class, EloquentCommentRepository::class);
        $this->app->singleton(StatusRepositoryInterface::class, DatabaseStatusRepository::class);
        app()->scoped(ReportRepositoryInterface::class, CachedReportRepository::class);
        $this->app->when(SendWebhookJob::class)
            ->needs(WebhookRepositoryInterface::class)
            ->give(DatabaseWebhookRepository::class);
    }
}
`),
    ).toEqual([
      {
        abstractClassName: "CommentRepositoryInterface",
        concreteClassName: "EloquentCommentRepository",
      },
      {
        abstractClassName: "StatusRepositoryInterface",
        concreteClassName: "DatabaseStatusRepository",
      },
      {
        abstractClassName: "ReportRepositoryInterface",
        concreteClassName: "CachedReportRepository",
      },
      {
        abstractClassName: "WebhookRepositoryInterface",
        concreteClassName: "DatabaseWebhookRepository",
      },
    ]);
  });

  it("normalizes generic PHPDoc type candidates", () => {
    expect(
      phpDeclaredTypeCandidate(
        "\\Illuminate\\Database\\Eloquent\\Builder<\\App\\Models\\Album>",
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Builder");
    expect(
      phpDeclaredGenericTypeCandidates(
        "\\Illuminate\\Database\\Eloquent\\Builder<\\App\\Models\\Album>",
      ),
    ).toEqual(["App\\Models\\Album"]);
    expect(phpDeclaredTypeCandidate("array<int, \\App\\Models\\Album>")).toBe(
      "App\\Models\\Album",
    );
  });

  it("extracts PHPDoc template inheritance declarations", () => {
    const source = `<?php
namespace App\\Repositories;

use App\\Models\\Comment;

/**
 * @template TModel of object
 * @phpstan-extends BaseRepository<Comment>
 * @psalm-implements SearchRepository<int, Comment>
 */
class CommentRepository extends BaseRepository implements SearchRepository
{
}
`;

    expect(phpDocTemplateNames(source)).toEqual(["TModel"]);
    expect(phpDocGenericInheritances(source)).toEqual([
      {
        className: "BaseRepository",
        genericTypes: ["Comment"],
      },
      {
        className: "SearchRepository",
        genericTypes: ["Comment"],
      },
    ]);
  });

  it("keeps spaced PHPDoc generic @var types intact", () => {
    const source = `<?php
/** @var \\Illuminate\\Database\\Eloquent\\Collection<int, \\App\\Models\\Album> $albums */
$album = $albums->first();
`;
    const rawType = phpDocRawTypeForVariableBefore(
      source,
      { column: 10, lineNumber: 3 },
      "albums",
    );

    expect(rawType).toBe(
      "\\Illuminate\\Database\\Eloquent\\Collection<int, \\App\\Models\\Album>",
    );
    expect(phpDeclaredGenericTypeCandidates(rawType ?? "")).toEqual([
      "App\\Models\\Album",
    ]);
  });

  it("extracts method return expressions from concrete method bodies", () => {
    expect(
      phpMethodReturnExpressions(
        `<?php
class UserAccount
{
    public function getDatabaseConnection()
    {
        if (! $this->isValid()) {
            return null;
        }

        return new UserAccountModel()->getConnection();
    }
}
`,
        "getDatabaseConnection",
      ),
    ).toEqual(["new UserAccountModel()->getConnection()"]);
  });
});
