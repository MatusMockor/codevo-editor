import { describe, expect, it } from "vitest";
import {
  phpClassPathCandidates,
  phpDocPropertyPositionOrNull,
  phpDocMethodPositionOrNull,
  phpExtendsClassName,
  phpIdentifierContextAt,
  phpImplementationDeclarationContextAt,
  phpLaravelRelationStringCompletionContextAt,
  phpLaravelRequestMethodDefinition,
  phpMethodPosition,
  phpNamedTypePosition,
  phpParameterTypeForVariable,
  phpPropertyPositionOrNull,
  phpSuperTypeReferences,
  resolvePhpClassName,
} from "./phpNavigation";
import type { PhpProjectDescriptor } from "./workspace";

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length,
    lineNumber: lines.length,
  };
}

function cursorAfter(source: string, needle: string) {
  const position = positionAfter(source, needle);

  return {
    column: position.column + 1,
    lineNumber: position.lineNumber,
  };
}

describe("phpNavigation", () => {
  const controllerSource = `<?php
namespace App\\Http\\Controllers;

use App\\Http\\Request\\AiHub\\StoreCommentRequest;
use Illuminate\\Foundation\\Http\\FormRequest;

class CommentController
{
    public function store(StoreCommentRequest $request): void
    {
        $request->input('originalComment', '');
    }
}
`;

  it("detects a PHP method call under the cursor", () => {
    expect(
      phpIdentifierContextAt(controllerSource, {
        column: 20,
        lineNumber: 11,
      }),
    ).toEqual({
      kind: "methodCall",
      methodName: "input",
      receiverExpression: "$request",
      variableName: "request",
    });
  });

  it("locates PHPDoc magic method definitions", () => {
    const source = `<?php
/**
 * @method static object fromNamed(string $name)
 * @method publish(bool $quietly = false)
 */
class CommentFactory
{
}
`;

    expect(phpDocMethodPositionOrNull(source, "fromNamed")).toEqual({
      column: 26,
      lineNumber: 3,
    });
    expect(phpDocMethodPositionOrNull(source, "publish")).toEqual({
      column: 12,
      lineNumber: 4,
    });
    expect(phpDocMethodPositionOrNull(source, "missing")).toBeNull();
  });

  it("locates PHPDoc magic property definitions", () => {
    const source = `<?php
/**
 * @property string $body
 * @property-read int $externalId
 * @property-write bool $archived
 */
class Comment
{
}
`;

    expect(phpPropertyPositionOrNull(source, "body")).toEqual({
      column: 22,
      lineNumber: 3,
    });
    expect(phpDocPropertyPositionOrNull(source, "body")).toEqual({
      column: 22,
      lineNumber: 3,
    });
    expect(phpDocPropertyPositionOrNull(source, "externalId")).toEqual({
      column: 24,
      lineNumber: 4,
    });
    expect(phpDocPropertyPositionOrNull(source, "$archived")).toEqual({
      column: 26,
      lineNumber: 5,
    });
    expect(phpDocPropertyPositionOrNull(source, "missing")).toBeNull();
  });

  it("prefers declared property definitions over PHPDoc properties", () => {
    const source = `<?php
/**
 * @property string $status
 */
class Comment
{
    public string $status;
}
`;

    expect(phpPropertyPositionOrNull(source, "status")).toEqual({
      column: 20,
      lineNumber: 7,
    });
  });

  it("detects chained method calls under the cursor", () => {
    const source = `<?php
class AlbumController
{
    public function index(): void
    {
        $query->whereNull('parent_id')->first();
        Album::query()->whereNull('parent_id')->firstOrFail();
    }
}
`;

    expect(
      phpIdentifierContextAt(source, {
        column: 43,
        lineNumber: 6,
      }),
    ).toEqual({
      kind: "methodCall",
      methodName: "first",
      receiverExpression: "$query->whereNull('parent_id')",
      variableName: "",
    });
    expect(
      phpIdentifierContextAt(source, {
        column: 52,
        lineNumber: 7,
      }),
    ).toEqual({
      kind: "methodCall",
      methodName: "firstOrFail",
      receiverExpression: "Album::query()->whereNull('parent_id')",
      variableName: "",
    });
  });

  it("detects multiline chained method calls under the cursor", () => {
    const source = `<?php
class AlbumController
{
    public function index(): void
    {
        $query
            ->whereNull('parent_id')
            ->first();

        Album::query()
            ->whereNull('parent_id')
            ->firstOrFail();
    }
}
`;

    expect(
      phpIdentifierContextAt(source, positionAfter(source, "->first")),
    ).toEqual({
      kind: "methodCall",
      methodName: "first",
      receiverExpression: "$query->whereNull('parent_id')",
      variableName: "",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "->firstOrFail")),
    ).toEqual({
      kind: "methodCall",
      methodName: "firstOrFail",
      receiverExpression: "Album::query()->whereNull('parent_id')",
      variableName: "",
    });
  });

  it("detects member property accesses without treating them as method calls", () => {
    const source = `<?php
class CommentController
{
    public function show(): void
    {
        $comment->parent;
        $comment->parentCall();
        $comment->children->first();
        $comment?->nullableParent;
        $comment?->nullableParentCall();
        $comment?->children?->first();
    }
}
`;

    expect(
      phpIdentifierContextAt(source, positionAfter(source, "$comment->parent;")),
    ).toEqual({
      kind: "memberPropertyAccess",
      propertyName: "parent",
      receiverExpression: "$comment",
      variableName: "comment",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "$comment->parentCall")),
    ).toEqual({
      kind: "methodCall",
      methodName: "parentCall",
      receiverExpression: "$comment",
      variableName: "comment",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "$comment->children")),
    ).toEqual({
      kind: "memberPropertyAccess",
      propertyName: "children",
      receiverExpression: "$comment",
      variableName: "comment",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "->first")),
    ).toEqual({
      kind: "methodCall",
      methodName: "first",
      receiverExpression: "$comment->children",
      variableName: "",
    });
    expect(
      phpIdentifierContextAt(
        source,
        positionAfter(source, "$comment?->nullableParent"),
      ),
    ).toEqual({
      kind: "memberPropertyAccess",
      propertyName: "nullableParent",
      receiverExpression: "$comment",
      variableName: "comment",
    });
    expect(
      phpIdentifierContextAt(
        source,
        positionAfter(source, "$comment?->nullableParentCall"),
      ),
    ).toEqual({
      kind: "methodCall",
      methodName: "nullableParentCall",
      receiverExpression: "$comment",
      variableName: "comment",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "?->first")),
    ).toEqual({
      kind: "methodCall",
      methodName: "first",
      receiverExpression: "$comment?->children",
      variableName: "",
    });
  });

  it("detects static method calls under the cursor", () => {
    const source = `<?php
class AlbumController
{
    public function index(): void
    {
        Album::withRelations()->findOrFail(1);
        \\App\\Models\\Album::whereNull('parent_id');
        Album::class;
    }
}
`;

    expect(
      phpIdentifierContextAt(
        source,
        positionAfter(source, "Album::withRelations"),
      ),
    ).toEqual({
      className: "Album",
      kind: "staticMethodCall",
      methodName: "withRelations",
    });
    expect(
      phpIdentifierContextAt(
        source,
        positionAfter(source, "\\App\\Models\\Album::whereNull"),
      ),
    ).toEqual({
      className: "App\\Models\\Album",
      kind: "staticMethodCall",
      methodName: "whereNull",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "Album::class")),
    ).toEqual({
      kind: "classIdentifier",
      name: "class",
    });
  });

  it("detects Laravel relation strings under the cursor", () => {
    const source = `<?php
class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->load('children');
        Comment::with('parent')->first();
        Comment::with('children.parent')->first();
        Comment::query()->whereHas('attachments', fn ($query) => $query);
        Comment::query()->whereRelation('children', 'is_visible', true);
        Comment::query()->orWhereRelation('visibleChildren', 'is_visible', true);
        Comment::query()->orDoesntHave('archivedChildren');
        Comment::withOnly('primaryParent')->first();
        $comment->without('hiddenChildren');
        Comment::query()->hasMorph('morphableComments', [Post::class]);
        Comment::query()->whereDoesntHaveMorph('ghostableComments', [Post::class], fn ($query) => $query);
        Comment::query()->orWhereDoesntHaveMorph('archivableComments', [Post::class], fn ($query) => $query);
    }
}
`;

    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'children'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "load",
      receiverExpression: "$comment",
      relationName: "children",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'parent'")),
    ).toEqual({
      className: "Comment",
      kind: "laravelRelationString",
      methodName: "with",
      receiverExpression: null,
      relationName: "parent",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'attachments'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "whereHas",
      receiverExpression: "Comment::query()",
      relationName: "attachments",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "children.parent")),
    ).toEqual({
      className: "Comment",
      kind: "laravelRelationString",
      methodName: "with",
      previousRelationNames: ["children"],
      receiverExpression: null,
      relationName: "parent",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'is_visible'")),
    ).toEqual({
      kind: "classIdentifier",
      name: "is_visible",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'visibleChildren'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "orWhereRelation",
      receiverExpression: "Comment::query()",
      relationName: "visibleChildren",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'archivedChildren'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "orDoesntHave",
      receiverExpression: "Comment::query()",
      relationName: "archivedChildren",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'primaryParent'")),
    ).toEqual({
      className: "Comment",
      kind: "laravelRelationString",
      methodName: "withOnly",
      receiverExpression: null,
      relationName: "primaryParent",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'hiddenChildren'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "without",
      receiverExpression: "$comment",
      relationName: "hiddenChildren",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'morphableComments'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "hasMorph",
      receiverExpression: "Comment::query()",
      relationName: "morphableComments",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'ghostableComments'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "whereDoesntHaveMorph",
      receiverExpression: "Comment::query()",
      relationName: "ghostableComments",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'archivableComments'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "orWhereDoesntHaveMorph",
      receiverExpression: "Comment::query()",
      relationName: "archivableComments",
    });
  });

  it("detects Laravel relation strings in first argument arrays", () => {
    const source = `<?php
class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->load(['arrayChildren']);
        Comment::with(['arrayParent'])->first();
        Comment::with(['arrayChildren.arrayParent'])->first();
        Comment::with(['constrainedChildren' => fn ($query) => $query->where('title', 'callbackString')]);
        Comment::query()->whereRelation('visibleChildren', 'is_visible', true);
    }
}
`;

    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'arrayChildren'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "load",
      receiverExpression: "$comment",
      relationName: "arrayChildren",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'arrayParent'")),
    ).toEqual({
      className: "Comment",
      kind: "laravelRelationString",
      methodName: "with",
      receiverExpression: null,
      relationName: "arrayParent",
    });
    expect(
      phpIdentifierContextAt(
        source,
        positionAfter(source, "arrayChildren.arrayParent"),
      ),
    ).toEqual({
      className: "Comment",
      kind: "laravelRelationString",
      methodName: "with",
      previousRelationNames: ["arrayChildren"],
      receiverExpression: null,
      relationName: "arrayParent",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'constrainedChildren'")),
    ).toEqual({
      className: "Comment",
      kind: "laravelRelationString",
      methodName: "with",
      receiverExpression: null,
      relationName: "constrainedChildren",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'callbackString'")),
    ).toEqual({
      kind: "classIdentifier",
      name: "callbackString",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'is_visible'")),
    ).toEqual({
      kind: "classIdentifier",
      name: "is_visible",
    });
  });

  it("detects Laravel relation string completion contexts", () => {
    const source = `<?php
class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->load('children');
        Comment::with('parent');
        Comment::with('children.parent');
        Comment::query()->whereHas('attachments', fn ($query) => $query);
        Comment::query()->whereRelation('children', 'is_visible', true);
        Comment::query()->orWhereRelation('visibleChi', 'is_visible', true);
        Comment::query()->orDoesntHave('archivedChi');
        Comment::withOnly('primaryPar');
        $comment->without('hiddenChi');
        Comment::query()->hasMorph('morphableCom', [Post::class]);
        Comment::query()->whereDoesntHaveMorph('ghostableCom', [Post::class], fn ($query) => $query);
        Comment::query()->orWhereDoesntHaveMorph('archivableCom', [Post::class], fn ($query) => $query);
    }
}
`;
    const incompleteSource = `<?php
class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->load('chi
    }
}
`;

    expect(
      phpLaravelRelationStringCompletionContextAt(
        incompleteSource,
        cursorAfter(incompleteSource, "$comment->load('chi"),
      ),
    ).toEqual({
      className: null,
      methodName: "load",
      prefix: "chi",
      receiverExpression: "$comment",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "Comment::with('par"),
      ),
    ).toEqual({
      className: "Comment",
      methodName: "with",
      prefix: "par",
      receiverExpression: null,
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "whereHas('att"),
      ),
    ).toEqual({
      className: null,
      methodName: "whereHas",
      prefix: "att",
      receiverExpression: "Comment::query()",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "with('children.pa"),
      ),
    ).toEqual({
      className: "Comment",
      methodName: "with",
      prefix: "pa",
      previousRelationNames: ["children"],
      receiverExpression: null,
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "whereRelation('children', 'is_vis"),
      ),
    ).toBeNull();
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "orWhereRelation('visibleChi"),
      ),
    ).toEqual({
      className: null,
      methodName: "orWhereRelation",
      prefix: "visibleChi",
      receiverExpression: "Comment::query()",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "orDoesntHave('archivedChi"),
      ),
    ).toEqual({
      className: null,
      methodName: "orDoesntHave",
      prefix: "archivedChi",
      receiverExpression: "Comment::query()",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "withOnly('primaryPar"),
      ),
    ).toEqual({
      className: "Comment",
      methodName: "withOnly",
      prefix: "primaryPar",
      receiverExpression: null,
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "without('hiddenChi"),
      ),
    ).toEqual({
      className: null,
      methodName: "without",
      prefix: "hiddenChi",
      receiverExpression: "$comment",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "hasMorph('morphableCom"),
      ),
    ).toEqual({
      className: null,
      methodName: "hasMorph",
      prefix: "morphableCom",
      receiverExpression: "Comment::query()",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "whereDoesntHaveMorph('ghostableCom"),
      ),
    ).toEqual({
      className: null,
      methodName: "whereDoesntHaveMorph",
      prefix: "ghostableCom",
      receiverExpression: "Comment::query()",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "orWhereDoesntHaveMorph('archivableCom"),
      ),
    ).toEqual({
      className: null,
      methodName: "orWhereDoesntHaveMorph",
      prefix: "archivableCom",
      receiverExpression: "Comment::query()",
    });
  });

  it("detects Laravel relation string completion contexts in first argument arrays", () => {
    const source = `<?php
class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->load(['arrayChi']);
        Comment::with(['arrayChildren.arrayPa']);
        Comment::with(['constrainedChi' => fn ($query) => $query->where('title', 'callbackStr')]);
        Comment::query()->whereRelation('visibleChildren', 'is_vis');
    }
}
`;

    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "$comment->load(['arrayChi"),
      ),
    ).toEqual({
      className: null,
      methodName: "load",
      prefix: "arrayChi",
      receiverExpression: "$comment",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "with(['arrayChildren.arrayPa"),
      ),
    ).toEqual({
      className: "Comment",
      methodName: "with",
      prefix: "arrayPa",
      previousRelationNames: ["arrayChildren"],
      receiverExpression: null,
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "with(['constrainedChi"),
      ),
    ).toEqual({
      className: "Comment",
      methodName: "with",
      prefix: "constrainedChi",
      receiverExpression: null,
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "'callbackStr"),
      ),
    ).toBeNull();
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "whereRelation('visibleChildren', 'is_vis"),
      ),
    ).toBeNull();
  });

  it("detects Laravel container expression method calls under the cursor", () => {
    const source = `<?php
class CommentController
{
    public function store(): void
    {
        app(CommentService::class)->createWithAttachments();
        App::make(CommentService::class)->createWithAttachments();
        Container::getInstance()->make(CommentService::class)->createWithAttachments();
    }
}
`;

    expect(
      phpIdentifierContextAt(
        source,
        positionAfter(source, "app(CommentService::class)->create"),
      ),
    ).toEqual({
      kind: "methodCall",
      methodName: "createWithAttachments",
      receiverExpression: "app(CommentService::class)",
      variableName: "",
    });
    expect(
      phpIdentifierContextAt(
        source,
        positionAfter(source, "App::make(CommentService::class)->create"),
      ),
    ).toEqual({
      kind: "methodCall",
      methodName: "createWithAttachments",
      receiverExpression: "App::make(CommentService::class)",
      variableName: "",
    });
    expect(
      phpIdentifierContextAt(
        source,
        positionAfter(
          source,
          "Container::getInstance()->make(CommentService::class)->create",
        ),
      ),
    ).toEqual({
      kind: "methodCall",
      methodName: "createWithAttachments",
      receiverExpression: "Container::getInstance()->make(CommentService::class)",
      variableName: "",
    });
  });

  it("detects Laravel route action strings as controller methods", () => {
    const routeSource = `<?php
use App\\Http\\Controllers\\communication\\CommentController;
use App\\Http\\Controllers\\communication\\ReactionController;

Route::post('/comments', [CommentController::class, 'store']);
Route::post('/reactions', [ReactionController::class, 'store']);
`;

    expect(
      phpIdentifierContextAt(routeSource, {
        column: 54,
        lineNumber: 5,
      }),
    ).toEqual({
      className: "CommentController",
      kind: "laravelRouteActionMethod",
      methodName: "store",
    });
  });

  it("resolves imports and typed request parameters", () => {
    expect(resolvePhpClassName(controllerSource, "StoreCommentRequest")).toBe(
      "App\\Http\\Request\\AiHub\\StoreCommentRequest",
    );
    expect(resolvePhpClassName(controllerSource, "FormRequest")).toBe(
      "Illuminate\\Foundation\\Http\\FormRequest",
    );
    expect(
      phpParameterTypeForVariable(
        controllerSource,
        {
          column: 20,
          lineNumber: 11,
        },
        "request",
      ),
    ).toBe("StoreCommentRequest");
  });

  it("resolves grouped imports and grouped aliases", () => {
    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\{Album, Comment as UserComment};
use App\\Services\\{
    ReportService,
    Analytics\\Tracker as AnalyticsTracker
};
use function App\\Support\\debug_value;
use const App\\Support\\DEFAULT_LIMIT;

class AlbumController
{
}
`;

    expect(resolvePhpClassName(source, "Album")).toBe("App\\Models\\Album");
    expect(resolvePhpClassName(source, "UserComment")).toBe(
      "App\\Models\\Comment",
    );
    expect(resolvePhpClassName(source, "UserComment\\Meta")).toBe(
      "App\\Models\\Comment\\Meta",
    );
    expect(resolvePhpClassName(source, "ReportService")).toBe(
      "App\\Services\\ReportService",
    );
    expect(resolvePhpClassName(source, "AnalyticsTracker")).toBe(
      "App\\Services\\Analytics\\Tracker",
    );
  });

  it("does not let class body trait uses shadow namespace imports", () => {
    const source = `<?php
namespace App\\Models;

use Illuminate\\Database\\Eloquent\\SoftDeletes;

class Comment
{
    use SoftDeletes;
}
`;

    expect(resolvePhpClassName(source, "SoftDeletes")).toBe(
      "Illuminate\\Database\\Eloquent\\SoftDeletes",
    );
  });

  it("maps Composer PSR-4 roots to project and vendor class files", () => {
    expect(
      phpClassPathCandidates(
        "/workspace",
        phpProjectDescriptor(),
        "App\\Http\\Request\\AiHub\\StoreCommentRequest",
      ),
    ).toContain("/workspace/app/Http/Request/AiHub/StoreCommentRequest.php");
    expect(
      phpClassPathCandidates(
        "/workspace",
        phpProjectDescriptor(),
        "Illuminate\\Foundation\\Http\\FormRequest",
      ),
    ).toContain(
      "/workspace/vendor/laravel/framework/src/Illuminate/Foundation/Http/FormRequest.php",
    );
  });

  it("maps Laravel request helper methods to their trait definitions", () => {
    expect(
      phpLaravelRequestMethodDefinition(
        "App\\Http\\Request\\AiHub\\StoreCommentRequest",
        "input",
      ),
    ).toEqual({
      className: "Illuminate\\Http\\Concerns\\InteractsWithInput",
      methodName: "input",
    });
  });

  it("finds named type and method positions in source files", () => {
    expect(
      phpNamedTypePosition("<?php\nclass FormRequest {}\n", "FormRequest"),
    ).toEqual({
      column: 7,
      lineNumber: 2,
    });
    expect(
      phpMethodPosition(
        "<?php\ntrait InteractsWithInput {\n    public function input() {}\n}\n",
        "input",
      ),
    ).toEqual({
      column: 21,
      lineNumber: 3,
    });
  });

  it("detects PHP declarations that can use implementation fallback", () => {
    const interfaceSource = `<?php
interface PlatformAdapter
{
    public function getPlatform(): Platform;
}
`;
    const abstractSource = `<?php
abstract class PlatformAdapter
{
    abstract public static function getPlatform(): Platform;

    public function label(): string
    {
        return 'platform';
    }
}
`;
    const multilineAbstractSource = `<?php
abstract class ParserFactory
{
    abstract public function
        getParser(
            string $apiVersion,
        ): ParserInterface;
}
`;

    expect(
      phpImplementationDeclarationContextAt(
        interfaceSource,
        positionAfter(interfaceSource, "getPlatform"),
      ),
    ).toEqual({
      methodName: "getPlatform",
      typeKind: "interface",
    });
    expect(
      phpImplementationDeclarationContextAt(
        abstractSource,
        positionAfter(abstractSource, "getPlatform"),
      ),
    ).toEqual({
      methodName: "getPlatform",
        typeKind: "class",
      });
    expect(
      phpImplementationDeclarationContextAt(
        multilineAbstractSource,
        positionAfter(multilineAbstractSource, "getParser"),
      ),
    ).toEqual({
      methodName: "getParser",
      typeKind: "class",
    });
    expect(
      phpImplementationDeclarationContextAt(
        abstractSource,
        positionAfter(abstractSource, "label"),
      ),
    ).toBeNull();
  });

  it("extracts PHP supertype references from class headers", () => {
    const source = `<?php
namespace App\\Services;

use App\\Contracts\\PlatformAdapter;
use Vendor\\Audits\\TracksEvents;

final class FacebookAdapter extends BaseAdapter implements PlatformAdapter, TracksEvents
{
}
`;

    expect(phpSuperTypeReferences(source)).toEqual([
      "BaseAdapter",
      "PlatformAdapter",
      "TracksEvents",
    ]);
  });

  it("detects imported parent class names", () => {
    const source = `<?php
namespace Kontentino\\Eloquent;

use Illuminate\\Database\\Eloquent\\Model;

class UserAccountModel extends Model
{
}
`;

    expect(
      resolvePhpClassName(
        source,
        phpExtendsClassName(source) ?? "",
      ),
    ).toBe("Illuminate\\Database\\Eloquent\\Model");
  });

  it("resolves relative qualified class names inside a namespace", () => {
    const source = `<?php
namespace Illuminate\\Http;

class Request
{
    use Concerns\\InteractsWithInput;
}
`;

    expect(resolvePhpClassName(source, "Concerns\\InteractsWithInput")).toBe(
      "Illuminate\\Http\\Concerns\\InteractsWithInput",
    );
    expect(resolvePhpClassName(source, "\\App\\Models\\User")).toBe(
      "App\\Models\\User",
    );
  });
});

function phpProjectDescriptor(): PhpProjectDescriptor {
  return {
    classmapRoots: [],
    hasComposer: true,
    packageName: "laravel/laravel",
    packages: [
      {
        classmapRoots: [],
        dev: false,
        installPath: "../laravel/framework",
        name: "laravel/framework",
        packageType: "library",
        psr4Roots: [
          {
            dev: false,
            namespace: "Illuminate\\",
            paths: ["src/Illuminate/"],
          },
        ],
        version: "13.0.0",
      },
    ],
    phpPlatformVersion: null,
    phpVersionConstraint: "^8.3",
    psr4Roots: [
      {
        dev: false,
        namespace: "App\\",
        paths: ["app/"],
      },
    ],
  };
}
