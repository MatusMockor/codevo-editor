import { describe, expect, it } from "vitest";
import {
  phpClassConstantPositionOrNull,
  phpClassIdentifierNameAt,
  phpClassPathCandidates,
  phpDocPropertyPositionOrNull,
  phpDocMethodPositionOrNull,
  phpEnclosingMethodNameAt,
  phpExtendsClassName,
  phpIdentifierContextAt,
  phpImplementationDeclarationContextAt,
  phpLaravelRelationStringCompletionContextAt,
  phpLaravelRouteActionMethodCompletionContextAt,
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
 * @method static findForSlug(string $slug)
 * @method \\Illuminate\\Support\\Collection<int, Comment> activeComments()
 * @phpstan-method bool archive(bool $quietly = false)
 * @psalm-method static fromUuid(string $uuid)
 */
class CommentFactory
{
}
`;
    const activeCommentsPosition = positionAfter(source, "activeComments");
    const archivePosition = positionAfter(source, "archive");
    const fromUuidPosition = positionAfter(source, "fromUuid");

    expect(phpDocMethodPositionOrNull(source, "fromNamed")).toEqual({
      column: 26,
      lineNumber: 3,
    });
    expect(phpDocMethodPositionOrNull(source, "publish")).toEqual({
      column: 12,
      lineNumber: 4,
    });
    expect(phpDocMethodPositionOrNull(source, "findForSlug")).toEqual({
      column: 19,
      lineNumber: 5,
    });
    expect(phpDocMethodPositionOrNull(source, "activeComments")).toEqual({
      column: activeCommentsPosition.column - "activeComments".length + 1,
      lineNumber: activeCommentsPosition.lineNumber,
    });
    expect(phpDocMethodPositionOrNull(source, "archive")).toEqual({
      column: archivePosition.column - "archive".length + 1,
      lineNumber: archivePosition.lineNumber,
    });
    expect(phpDocMethodPositionOrNull(source, "fromUuid")).toEqual({
      column: fromUuidPosition.column - "fromUuid".length + 1,
      lineNumber: fromUuidPosition.lineNumber,
    });
    expect(phpDocMethodPositionOrNull(source, "missing")).toBeNull();
  });

  it("locates PHPDoc magic property definitions", () => {
    const source = `<?php
/**
 * @property string $body
 * @property-read int $externalId
 * @property-write bool $archived
 * @phpstan-property-read string $slug
 * @psalm-property-write bool $hidden
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
    expect(phpDocPropertyPositionOrNull(source, "slug")).toEqual({
      column: positionAfter(source, "$slug").column - "slug".length + 1,
      lineNumber: positionAfter(source, "$slug").lineNumber,
    });
    expect(phpDocPropertyPositionOrNull(source, "$hidden")).toEqual({
      column: positionAfter(source, "$hidden").column - "hidden".length + 1,
      lineNumber: positionAfter(source, "$hidden").lineNumber,
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

  it("classifies a class constant access under the cursor as classConstant", () => {
    const source = `<?php
class RevisionController
{
    public function update(): void
    {
        $type = Revision::REVISION_TYPE_POST_INTERNAL_UPDATE;
        \\App\\Models\\Revision::REVISION_TYPE_POST;
        self::INTERNAL_FLAG;
        static::INTERNAL_FLAG;
        parent::BASE_FLAG;
    }
}
`;

    expect(
      phpIdentifierContextAt(
        source,
        positionAfter(source, "Revision::REVISION_TYPE_POST_INTERNAL_UPDATE"),
      ),
    ).toEqual({
      className: "Revision",
      constantName: "REVISION_TYPE_POST_INTERNAL_UPDATE",
      kind: "classConstant",
    });
    expect(
      phpIdentifierContextAt(
        source,
        positionAfter(source, "\\App\\Models\\Revision::REVISION_TYPE_POST"),
      ),
    ).toEqual({
      className: "App\\Models\\Revision",
      constantName: "REVISION_TYPE_POST",
      kind: "classConstant",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "self::INTERNAL_FLAG")),
    ).toEqual({
      className: "self",
      constantName: "INTERNAL_FLAG",
      kind: "classConstant",
    });
    expect(
      phpIdentifierContextAt(
        source,
        positionAfter(source, "static::INTERNAL_FLAG"),
      ),
    ).toEqual({
      className: "static",
      constantName: "INTERNAL_FLAG",
      kind: "classConstant",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "parent::BASE_FLAG")),
    ).toEqual({
      className: "parent",
      constantName: "BASE_FLAG",
      kind: "classConstant",
    });
  });

  it("keeps classifying a static method call (trailing parens) as staticMethodCall", () => {
    const source = `<?php
class AlbumController
{
    public function index(): void
    {
        Album::find(1);
        Album::FIND;
    }
}
`;

    expect(
      phpIdentifierContextAt(source, positionAfter(source, "Album::find")),
    ).toEqual({
      className: "Album",
      kind: "staticMethodCall",
      methodName: "find",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "Album::FIND")),
    ).toEqual({
      className: "Album",
      constantName: "FIND",
      kind: "classConstant",
    });
  });

  it("locates a declared class constant position", () => {
    const source = `<?php
class Revision
{
    public const REVISION_TYPE_POST_INTERNAL_UPDATE = 'post_internal_update';
    final protected const BASE_FLAG = 1;
}
`;

    const position = phpClassConstantPositionOrNull(
      source,
      "REVISION_TYPE_POST_INTERNAL_UPDATE",
    );

    expect(position).not.toBeNull();
    expect(
      source.split("\n")[(position?.lineNumber ?? 1) - 1],
    ).toContain("REVISION_TYPE_POST_INTERNAL_UPDATE");

    const baseFlagPosition = phpClassConstantPositionOrNull(source, "BASE_FLAG");

    expect(baseFlagPosition).not.toBeNull();
    expect(
      source.split("\n")[(baseFlagPosition?.lineNumber ?? 1) - 1],
    ).toContain("BASE_FLAG");
  });

  it("locates an enum case as a class constant position", () => {
    const source = `<?php
enum RevisionType: string
{
    case PostInternalUpdate = 'post_internal_update';
    case PostPublished = 'post_published';
}
`;

    const position = phpClassConstantPositionOrNull(source, "PostPublished");

    expect(position).not.toBeNull();
    expect(
      source.split("\n")[(position?.lineNumber ?? 1) - 1],
    ).toContain("PostPublished");
  });

  it("returns null when no matching class constant exists", () => {
    const source = `<?php
class Revision
{
    public const OTHER = 1;
}
`;

    expect(phpClassConstantPositionOrNull(source, "MISSING")).toBeNull();
  });

  it("does not match a switch arm label as a class constant", () => {
    const source = `<?php
enum RevisionType: string
{
    case PostPublished = 'post_published';

    public function describe(): string
    {
        switch ($this) {
            case PostPublished:
                return 'published';
        }

        return 'unknown';
    }
}
`;

    const position = phpClassConstantPositionOrNull(source, "PostPublished");

    expect(position).not.toBeNull();
    expect(
      source.split("\n")[(position?.lineNumber ?? 1) - 1],
    ).toContain("case PostPublished = 'post_published'");
  });

  it("does not match a constant used as a value rather than declared", () => {
    const source = `<?php
class Revision
{
    public const ALIAS = self::TARGET;
}
`;

    expect(phpClassConstantPositionOrNull(source, "TARGET")).toBeNull();
  });

  it("detects Laravel relation strings under the cursor", () => {
    const source = `<?php
class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->load('children');
        $comment->loadCount('loadedChildren');
        $comment->loadAggregate('aggregateChildren', 'votes', 'sum');
        Comment::with('parent')->first();
        Comment::withCount('countedChildren')->first();
        Comment::withExists('existingChildren')->first();
        Comment::with('children.parent')->first();
        Comment::query()->whereHas('attachments', fn ($query) => $query);
        Comment::query()->withWhereHas('eagerAttachments', fn ($query) => $query);
        Comment::query()->withSum('summedChildren', 'votes');
        Comment::query()->whereRelation('children', 'is_visible', true);
        Comment::query()->orWhereRelation('visibleChildren', 'is_visible', true);
        Comment::query()->withWhereRelation('eagerVisibleChildren', 'is_visible', true);
        Comment::query()->whereDoesntHaveRelation('filteredChildren', 'is_visible', true);
        Comment::query()->orWhereDoesntHaveRelation('orFilteredChildren', 'is_visible', true);
        Comment::query()->orDoesntHave('archivedChildren');
        Comment::withOnly('primaryParent')->first();
        $comment->without('hiddenChildren');
        Comment::query()->hasMorph('morphableComments', [Post::class]);
        Comment::query()->whereMorphDoesntHaveRelation('morphFilteredChildren', [Post::class], 'is_visible', true);
        Comment::query()->orWhereMorphDoesntHaveRelation('orMorphFilteredChildren', [Post::class], 'is_visible', true);
        Comment::query()->whereDoesntHaveMorph('ghostableComments', [Post::class], fn ($query) => $query);
        Comment::query()->orWhereDoesntHaveMorph('archivableComments', [Post::class], fn ($query) => $query);
        $comment->loadMorphAggregate('aggregateCommentable', [Post::class => ['likes']], 'votes', 'sum');
        $comment->loadMorphAvg('avgCommentable', [Post::class => ['likes']], 'votes');
        $comment->loadMorphMax('maxCommentable', [Post::class => ['likes']], 'votes');
        $comment->loadMorphMin('minCommentable', [Post::class => ['likes']], 'votes');
        $comment->loadMorphSum('sumCommentable', [Post::class => ['likes']], 'votes');
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
      phpIdentifierContextAt(source, positionAfter(source, "'loadedChildren'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "loadCount",
      receiverExpression: "$comment",
      relationName: "loadedChildren",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'aggregateChildren'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "loadAggregate",
      receiverExpression: "$comment",
      relationName: "aggregateChildren",
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
      phpIdentifierContextAt(source, positionAfter(source, "'countedChildren'")),
    ).toEqual({
      className: "Comment",
      kind: "laravelRelationString",
      methodName: "withCount",
      receiverExpression: null,
      relationName: "countedChildren",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'existingChildren'")),
    ).toEqual({
      className: "Comment",
      kind: "laravelRelationString",
      methodName: "withExists",
      receiverExpression: null,
      relationName: "existingChildren",
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
      phpIdentifierContextAt(source, positionAfter(source, "'eagerAttachments'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "withWhereHas",
      receiverExpression: "Comment::query()",
      relationName: "eagerAttachments",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'summedChildren'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "withSum",
      receiverExpression: "Comment::query()",
      relationName: "summedChildren",
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
      phpIdentifierContextAt(source, positionAfter(source, "'eagerVisibleChildren'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "withWhereRelation",
      receiverExpression: "Comment::query()",
      relationName: "eagerVisibleChildren",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'filteredChildren'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "whereDoesntHaveRelation",
      receiverExpression: "Comment::query()",
      relationName: "filteredChildren",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'orFilteredChildren'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "orWhereDoesntHaveRelation",
      receiverExpression: "Comment::query()",
      relationName: "orFilteredChildren",
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
      phpIdentifierContextAt(source, positionAfter(source, "'morphFilteredChildren'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "whereMorphDoesntHaveRelation",
      receiverExpression: "Comment::query()",
      relationName: "morphFilteredChildren",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'orMorphFilteredChildren'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "orWhereMorphDoesntHaveRelation",
      receiverExpression: "Comment::query()",
      relationName: "orMorphFilteredChildren",
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
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'aggregateCommentable'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "loadMorphAggregate",
      receiverExpression: "$comment",
      relationName: "aggregateCommentable",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'avgCommentable'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "loadMorphAvg",
      receiverExpression: "$comment",
      relationName: "avgCommentable",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'maxCommentable'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "loadMorphMax",
      receiverExpression: "$comment",
      relationName: "maxCommentable",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'minCommentable'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "loadMorphMin",
      receiverExpression: "$comment",
      relationName: "minCommentable",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'sumCommentable'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "loadMorphSum",
      receiverExpression: "$comment",
      relationName: "sumCommentable",
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

  it("detects Laravel relation strings in named arguments", () => {
    const source = `<?php
class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->load(relations: 'namedChildren');
        Comment::with(relations: ['namedParent']);
        Comment::query()->whereHas(relation: 'namedAttachments', callback: fn ($query) => $query);
        Comment::query()->whereHas(callback: fn ($query) => $query, relation: 'lateAttachments');
        Comment::with(callback: fn () => null, relations: ['lateParent']);
        $comment->load(label: 'notRelation');
    }
}
`;

    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'namedChildren'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "load",
      receiverExpression: "$comment",
      relationName: "namedChildren",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'namedParent'")),
    ).toEqual({
      className: "Comment",
      kind: "laravelRelationString",
      methodName: "with",
      receiverExpression: null,
      relationName: "namedParent",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'namedAttachments'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "whereHas",
      receiverExpression: "Comment::query()",
      relationName: "namedAttachments",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'lateAttachments'")),
    ).toEqual({
      className: null,
      kind: "laravelRelationString",
      methodName: "whereHas",
      receiverExpression: "Comment::query()",
      relationName: "lateAttachments",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'lateParent'")),
    ).toEqual({
      className: "Comment",
      kind: "laravelRelationString",
      methodName: "with",
      receiverExpression: null,
      relationName: "lateParent",
    });
    expect(
      phpIdentifierContextAt(source, positionAfter(source, "'notRelation'")),
    ).toEqual({
      kind: "classIdentifier",
      name: "notRelation",
    });
  });

  it("detects Laravel relation string completion contexts", () => {
    const source = `<?php
class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->load('children');
        $comment->loadCount('loadedChi');
        Comment::with('parent');
        Comment::withCount('countedChi');
        Comment::with('children.parent');
        Comment::query()->whereHas('attachments', fn ($query) => $query);
        Comment::query()->withWhereHas('eagerAtt', fn ($query) => $query);
        Comment::query()->withSum('summedChi', 'votes');
        Comment::query()->whereRelation('children', 'is_visible', true);
        Comment::query()->orWhereRelation('visibleChi', 'is_visible', true);
        Comment::query()->withWhereRelation('eagerVisibleChi', 'is_visible', true);
        Comment::query()->whereDoesntHaveRelation('filteredChi', 'is_visible', true);
        Comment::query()->orWhereDoesntHaveRelation('orFilteredChi', 'is_visible', true);
        Comment::query()->orDoesntHave('archivedChi');
        Comment::withOnly('primaryPar');
        $comment->without('hiddenChi');
        Comment::query()->hasMorph('morphableCom', [Post::class]);
        Comment::query()->whereMorphDoesntHaveRelation('morphFilteredChi', [Post::class], 'is_visible', true);
        Comment::query()->orWhereMorphDoesntHaveRelation('orMorphFilteredChi', [Post::class], 'is_visible', true);
        Comment::query()->whereDoesntHaveMorph('ghostableCom', [Post::class], fn ($query) => $query);
        Comment::query()->orWhereDoesntHaveMorph('archivableCom', [Post::class], fn ($query) => $query);
        $comment->loadMorphAvg('avgCom', [Post::class => ['likes']], 'votes');
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
        cursorAfter(source, "loadCount('loadedChi"),
      ),
    ).toEqual({
      className: null,
      methodName: "loadCount",
      prefix: "loadedChi",
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
        cursorAfter(source, "withCount('countedChi"),
      ),
    ).toEqual({
      className: "Comment",
      methodName: "withCount",
      prefix: "countedChi",
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
        cursorAfter(source, "withWhereHas('eagerAtt"),
      ),
    ).toEqual({
      className: null,
      methodName: "withWhereHas",
      prefix: "eagerAtt",
      receiverExpression: "Comment::query()",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "withSum('summedChi"),
      ),
    ).toEqual({
      className: null,
      methodName: "withSum",
      prefix: "summedChi",
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
        cursorAfter(source, "withWhereRelation('eagerVisibleChi"),
      ),
    ).toEqual({
      className: null,
      methodName: "withWhereRelation",
      prefix: "eagerVisibleChi",
      receiverExpression: "Comment::query()",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "whereDoesntHaveRelation('filteredChi"),
      ),
    ).toEqual({
      className: null,
      methodName: "whereDoesntHaveRelation",
      prefix: "filteredChi",
      receiverExpression: "Comment::query()",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "orWhereDoesntHaveRelation('orFilteredChi"),
      ),
    ).toEqual({
      className: null,
      methodName: "orWhereDoesntHaveRelation",
      prefix: "orFilteredChi",
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
        cursorAfter(source, "whereMorphDoesntHaveRelation('morphFilteredChi"),
      ),
    ).toEqual({
      className: null,
      methodName: "whereMorphDoesntHaveRelation",
      prefix: "morphFilteredChi",
      receiverExpression: "Comment::query()",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "orWhereMorphDoesntHaveRelation('orMorphFilteredChi"),
      ),
    ).toEqual({
      className: null,
      methodName: "orWhereMorphDoesntHaveRelation",
      prefix: "orMorphFilteredChi",
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
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "loadMorphAvg('avgCom"),
      ),
    ).toEqual({
      className: null,
      methodName: "loadMorphAvg",
      prefix: "avgCom",
      receiverExpression: "$comment",
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

  it("detects Laravel relation string completion contexts in named arguments", () => {
    const source = `<?php
class CommentController
{
    public function show(Comment $comment): void
    {
        $comment->load(relations: 'namedChi');
        Comment::with(relations: ['namedParent.arrayChi']);
        Comment::query()->whereHas(relation: 'namedAtt', callback: fn ($query) => $query);
        Comment::query()->whereHas(callback: fn ($query) => $query, relation: 'lateAtt');
        Comment::with(callback: fn () => null, relations: ['lateParent.arrayChi']);
        $comment->load(label: 'notRel');
    }
}
`;

    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "load(relations: 'namedChi"),
      ),
    ).toEqual({
      className: null,
      methodName: "load",
      prefix: "namedChi",
      receiverExpression: "$comment",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "with(relations: ['namedParent.arrayChi"),
      ),
    ).toEqual({
      className: "Comment",
      methodName: "with",
      prefix: "arrayChi",
      previousRelationNames: ["namedParent"],
      receiverExpression: null,
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "whereHas(relation: 'namedAtt"),
      ),
    ).toEqual({
      className: null,
      methodName: "whereHas",
      prefix: "namedAtt",
      receiverExpression: "Comment::query()",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "whereHas(callback: fn ($query) => $query, relation: 'lateAtt"),
      ),
    ).toEqual({
      className: null,
      methodName: "whereHas",
      prefix: "lateAtt",
      receiverExpression: "Comment::query()",
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "with(callback: fn () => null, relations: ['lateParent.arrayChi"),
      ),
    ).toEqual({
      className: "Comment",
      methodName: "with",
      prefix: "arrayChi",
      previousRelationNames: ["lateParent"],
      receiverExpression: null,
    });
    expect(
      phpLaravelRelationStringCompletionContextAt(
        source,
        cursorAfter(source, "load(label: 'notRel"),
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

  it("detects Laravel invokable route controller class actions", () => {
    const routeSource = `<?php
use App\\Http\\Controllers\\DashboardController;

Route::get('/dashboard', DashboardController::class);
Route::get(uri: '/named-dashboard', action: DashboardController::class);
`;

    expect(
      phpIdentifierContextAt(
        routeSource,
        positionAfter(routeSource, "DashboardController::class"),
      ),
    ).toEqual({
      className: "DashboardController",
      kind: "laravelRouteActionMethod",
      methodName: "__invoke",
    });
    expect(
      phpIdentifierContextAt(
        routeSource,
        positionAfter(routeSource, "action: DashboardController::class"),
      ),
    ).toEqual({
      className: "DashboardController",
      kind: "laravelRouteActionMethod",
      methodName: "__invoke",
    });
    expect(
      phpIdentifierContextAt(routeSource, positionAfter(routeSource, "::class")),
    ).toEqual({
      className: "DashboardController",
      kind: "laravelRouteActionMethod",
      methodName: "__invoke",
    });
  });

  it("keeps Laravel non-action Route class arguments out of invokable navigation", () => {
    const routeSource = `<?php
use App\\Http\\Controllers\\CommentController;

Route::get('/comments', [CommentController::class, 'index']);
Route::view('/dashboard', 'dashboard', ['controller' => CommentController::class]);
Route::redirect('/old-dashboard', '/dashboard');
Route::resource('comments', CommentController::class);
`;

    expect(
      phpIdentifierContextAt(
        routeSource,
        positionAfter(routeSource, "[CommentController"),
      ),
    ).toEqual({
      kind: "classIdentifier",
      name: "CommentController",
    });
    expect(
      phpIdentifierContextAt(
        routeSource,
        positionAfter(routeSource, "['controller' => CommentController"),
      ),
    ).toEqual({
      kind: "classIdentifier",
      name: "CommentController",
    });
    expect(
      phpIdentifierContextAt(
        routeSource,
        positionAfter(routeSource, "Route::resource('comments', CommentController"),
      ),
    ).toEqual({
      kind: "classIdentifier",
      name: "CommentController",
    });
  });

  it("detects Laravel controller group route action strings as controller methods", () => {
    const routeSource = `<?php
use App\\Http\\Controllers\\communication\\CommentController;

Route::controller(CommentController::class)->group(function () {
    Route::get('/comments/{comment}', 'show');
    Route::post('/comments', 'store');
});
Route::prefix('admin/comments')->controller(CommentController::class)->group(function () {
    Route::get('/preview', 'preview');
});
Route::controller(controller: CommentController::class)->group(function () {
    Route::get('/featured', 'featured');
});
Route::prefix('admin/comments')->controller(controller: CommentController::class)->group(function () {
    Route::get('/archive', 'archive');
});
Route::controller(CommentController::class)->group(function () {
    Route::get(action: 'namedAction', uri: '/named-action');
    Route::get(label: 'notAction', uri: '/ignored');
});
`;

    expect(
      phpIdentifierContextAt(routeSource, positionAfter(routeSource, "'show")),
    ).toEqual({
      className: "CommentController",
      kind: "laravelRouteActionMethod",
      methodName: "show",
    });
    expect(
      phpIdentifierContextAt(routeSource, positionAfter(routeSource, "'store")),
    ).toEqual({
      className: "CommentController",
      kind: "laravelRouteActionMethod",
      methodName: "store",
    });
    expect(
      phpIdentifierContextAt(routeSource, positionAfter(routeSource, "'preview")),
    ).toEqual({
      className: "CommentController",
      kind: "laravelRouteActionMethod",
      methodName: "preview",
    });
    expect(
      phpIdentifierContextAt(routeSource, positionAfter(routeSource, "'featured")),
    ).toEqual({
      className: "CommentController",
      kind: "laravelRouteActionMethod",
      methodName: "featured",
    });
    expect(
      phpIdentifierContextAt(routeSource, positionAfter(routeSource, "'archive")),
    ).toEqual({
      className: "CommentController",
      kind: "laravelRouteActionMethod",
      methodName: "archive",
    });
    expect(
      phpIdentifierContextAt(routeSource, positionAfter(routeSource, "'namedAction")),
    ).toEqual({
      className: "CommentController",
      kind: "laravelRouteActionMethod",
      methodName: "namedAction",
    });
    expect(
      phpIdentifierContextAt(routeSource, positionAfter(routeSource, "'notAction")),
    ).toEqual({
      kind: "classIdentifier",
      name: "notAction",
    });
  });

  it("detects Laravel route action method completion contexts", () => {
    const routeSource = `<?php
use App\\Http\\Controllers\\communication\\CommentController;

Route::post('/comments', [CommentController::class, 'st']);
Route::post(uri: '/named-comments', action: [CommentController::class, 'sto']);
Route::controller(CommentController::class)->group(function () {
    Route::get('/comments/{comment}', 'sh');
    Route::get(action: 'sho', uri: '/named-action');
});
`;

    expect(
      phpLaravelRouteActionMethodCompletionContextAt(
        routeSource,
        cursorAfter(routeSource, "'st"),
      ),
    ).toEqual({
      className: "CommentController",
      prefix: "st",
    });
    expect(
      phpLaravelRouteActionMethodCompletionContextAt(
        routeSource,
        cursorAfter(routeSource, "'sto"),
      ),
    ).toEqual({
      className: "CommentController",
      prefix: "sto",
    });
    expect(
      phpLaravelRouteActionMethodCompletionContextAt(
        routeSource,
        cursorAfter(routeSource, "'sh"),
      ),
    ).toEqual({
      className: "CommentController",
      prefix: "sh",
    });
    expect(
      phpLaravelRouteActionMethodCompletionContextAt(
        routeSource,
        cursorAfter(routeSource, "'sho"),
      ),
    ).toEqual({
      className: "CommentController",
      prefix: "sho",
    });
  });

  it("keeps Laravel non-action route strings out of action method completion contexts", () => {
    const routeSource = `<?php
use App\\Http\\Controllers\\communication\\CommentController;

Route::view('/comments', 'comments.show');
Route::redirect('/old-comments', '/comments');
Route::resource('comments', CommentController::class);
Route::post('/comments', [CommentController::class, 'store']);
Route::post('/comments', ['controller' => CommentController::class, 'method' => 'store']);
Route::controller(CommentController::class)->group(function () {
    Route::get(label: 'notAction', uri: '/ignored');
});
`;

    expect(
      phpLaravelRouteActionMethodCompletionContextAt(
        routeSource,
        cursorAfter(routeSource, "comments.show"),
      ),
    ).toBeNull();
    expect(
      phpLaravelRouteActionMethodCompletionContextAt(
        routeSource,
        cursorAfter(routeSource, "/comments');"),
      ),
    ).toBeNull();
    expect(
      phpLaravelRouteActionMethodCompletionContextAt(
        routeSource,
        cursorAfter(routeSource, "Route::resource('comments"),
      ),
    ).toBeNull();
    expect(
      phpLaravelRouteActionMethodCompletionContextAt(
        routeSource,
        cursorAfter(routeSource, "method' => 'store"),
      ),
    ).toBeNull();
    expect(
      phpLaravelRouteActionMethodCompletionContextAt(
        routeSource,
        cursorAfter(routeSource, "'notAction"),
      ),
    ).toBeNull();
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

  it("resolves the enclosing method name from a position inside its body", () => {
    const source = `<?php
namespace App\\Services;

class Child extends BaseService
{
    public function handle(string $name): string
    {
        $value = trim($name);

        return $value;
    }

    protected function boot(): void
    {
    }
}
`;

    expect(
      phpEnclosingMethodNameAt(source, positionAfter(source, "trim($name")),
    ).toBe("handle");
    expect(
      phpEnclosingMethodNameAt(source, positionAfter(source, "function handle")),
    ).toBe("handle");
    expect(
      phpEnclosingMethodNameAt(source, positionAfter(source, "function boot")),
    ).toBe("boot");
  });

  it("returns null when the position is outside any method body", () => {
    const source = `<?php
namespace App\\Services;

class Child extends BaseService
{
    public function handle(): void
    {
    }
}
`;

    expect(
      phpEnclosingMethodNameAt(source, positionAfter(source, "class Child")),
    ).toBeNull();
    expect(
      phpEnclosingMethodNameAt(
        source,
        positionAfter(source, "extends BaseService"),
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

  it("routes Laravel authorization ability strings to a Gate ability context", () => {
    const source = `<?php\n\nGate::allows('update-post');\n`;

    expect(
      phpIdentifierContextAt(source, cursorAfter(source, "update-post")),
    ).toEqual({
      ability: "update-post",
      kind: "laravelGateAbilityString",
    });
  });

  it("does not treat dynamic authorization abilities as Gate ability contexts", () => {
    const source = `<?php\n\nGate::allows($ability);\n`;

    expect(
      phpIdentifierContextAt(source, positionAfter(source, "$abilit")),
    ).not.toMatchObject({ kind: "laravelGateAbilityString" });
  });

  it("routes Laravel middleware alias strings to a middleware alias context", () => {
    const source = `<?php\n\nRoute::middleware('verified');\n`;

    expect(
      phpIdentifierContextAt(source, cursorAfter(source, "verified")),
    ).toEqual({
      alias: "verified",
      kind: "laravelMiddlewareAliasString",
    });
  });

  it("routes parameterized middleware alias strings to the alias before the colon", () => {
    const source = `<?php\n\nRoute::middleware('throttle:60,1');\n`;

    expect(
      phpIdentifierContextAt(source, cursorAfter(source, "throttle")),
    ).toEqual({
      alias: "throttle",
      kind: "laravelMiddlewareAliasString",
    });
  });

  it("keeps auth guard navigation for auth: prefixed middleware", () => {
    const source = `<?php\n\nRoute::middleware('auth:web');\n`;

    expect(
      phpIdentifierContextAt(source, cursorAfter(source, "web")),
    ).toEqual({
      guardName: "web",
      kind: "laravelAuthGuardString",
    });
  });

  it("does not treat dynamic middleware arguments as middleware alias contexts", () => {
    const source = `<?php\n\nRoute::middleware($mw);\n`;

    expect(
      phpIdentifierContextAt(source, positionAfter(source, "$m")),
    ).not.toMatchObject({ kind: "laravelMiddlewareAliasString" });
  });

  it("returns the class identifier name for a property type-hint", () => {
    const source = `<?php

class PageService
{
    public function __construct(private PageRepository $pageRepository)
    {
    }
}
`;

    expect(
      phpClassIdentifierNameAt(
        source,
        source.indexOf("private PageRepository") + 12,
      ),
    ).toBe("PageRepository");
  });

  it("returns the interface identifier name for a parameter type-hint", () => {
    const source = `<?php

class PageService
{
    public function __construct(private PageRepositoryInterface $repository)
    {
    }
}
`;

    expect(
      phpClassIdentifierNameAt(
        source,
        source.indexOf("private PageRepositoryInterface") + 12,
      ),
    ).toBe("PageRepositoryInterface");
  });

  it("returns null for a method call rather than a class identifier", () => {
    const source = `<?php\n\n$repository->findPage();\n`;

    expect(
      phpClassIdentifierNameAt(source, source.indexOf("findPage") + 2),
    ).toBeNull();
  });

  it("returns null for a member property access rather than a class identifier", () => {
    const source = `<?php\n\n$comment->parent;\n`;

    expect(
      phpClassIdentifierNameAt(source, source.indexOf("parent") + 2),
    ).toBeNull();
  });

  it("returns null for a static method call rather than a class identifier", () => {
    const source = `<?php\n\nUser::find(1);\n`;

    expect(
      phpClassIdentifierNameAt(source, source.indexOf("find") + 2),
    ).toBeNull();
  });

  it("captures a leading-backslash qualified class name in a docblock @var", () => {
    const source = `<?php

class PageService
{
    /** @var \\App\\Models\\Baz */
    private $baz;
}
`;

    expect(
      phpClassIdentifierNameAt(source, source.indexOf("App\\Models\\Baz") + 7),
    ).toBe("\\App\\Models\\Baz");
  });

  it("captures a qualified class name from any segment in a type-hint", () => {
    const source = `<?php

class PageService
{
    public function __construct(private App\\Models\\Baz $baz)
    {
    }
}
`;

    expect(
      phpClassIdentifierNameAt(
        source,
        source.indexOf("App\\Models\\Baz") + 1,
      ),
    ).toBe("App\\Models\\Baz");
    expect(
      phpClassIdentifierNameAt(
        source,
        source.indexOf("App\\Models\\Baz") + "App\\Models\\".length,
      ),
    ).toBe("App\\Models\\Baz");
  });

  it("resolves a qualified docblock @var class name through the FQN resolver", () => {
    const source = `<?php

namespace App\\Services;

class PageService
{
    /** @var \\App\\Models\\Baz */
    private $baz;
}
`;

    const name = phpClassIdentifierNameAt(
      source,
      source.indexOf("Models") + 1,
    );

    expect(name).toBe("\\App\\Models\\Baz");
    expect(resolvePhpClassName(source, name ?? "")).toBe("App\\Models\\Baz");
  });

  it("resolves a relative qualified class name against the current namespace", () => {
    const source = `<?php

namespace App;

class PageService
{
    /** @var Models\\Baz */
    private $baz;
}
`;

    const name = phpClassIdentifierNameAt(
      source,
      source.indexOf("Models\\Baz") + 1,
    );

    expect(name).toBe("Models\\Baz");
    expect(resolvePhpClassName(source, name ?? "")).toBe("App\\Models\\Baz");
  });

  it("keeps treating a bare imported class name as a class identifier", () => {
    const source = `<?php

namespace App\\Services;

use App\\Models\\Foo;

class PageService
{
    /** @var Foo */
    private $foo;
}
`;

    const name = phpClassIdentifierNameAt(source, source.indexOf("@var Foo") + 6);

    expect(name).toBe("Foo");
    expect(resolvePhpClassName(source, name ?? "")).toBe("App\\Models\\Foo");
  });

  it("does not hijack a qualified static method call as a class identifier", () => {
    const source = `<?php\n\n\\App\\Models\\Album::whereNull('parent_id');\n`;

    expect(
      phpClassIdentifierNameAt(
        source,
        source.indexOf("whereNull") + 2,
      ),
    ).toBeNull();
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
  });

  it("does not hijack a qualified method call on a member chain", () => {
    const source = `<?php\n\n$this->postRepository->getFilteredPosts();\n`;

    expect(
      phpClassIdentifierNameAt(
        source,
        source.indexOf("getFilteredPosts") + 2,
      ),
    ).toBeNull();
  });

  // Regression: `parent::method()` is a static method call whose receiver is the
  // literal token `parent`. Go-to-definition must resolve that receiver via the
  // extends clause (resolvePhpClassReference), never via resolvePhpClassName,
  // which would treat `parent` as a real type name (`<namespace>\parent`) and
  // never reach the parent declaration.
  it("classifies parent::method() as a static call to the parent receiver", () => {
    const source = `<?php

namespace App\\DTOs\\Facebook\\Posts;

final readonly class FacebookCarouselPostDTO extends AbstractFacebookPostDTO
{
    public function toImportFields(): array
    {
        return [...parent::toImportFields()];
    }
}
`;

    expect(
      phpIdentifierContextAt(
        source,
        positionAfter(source, "parent::toImportFields"),
      ),
    ).toEqual({
      className: "parent",
      kind: "staticMethodCall",
      methodName: "toImportFields",
    });

    // The extends clause names the real parent (covering `final readonly class`).
    expect(phpExtendsClassName(source)).toBe("AbstractFacebookPostDTO");

    // resolvePhpClassName must NOT be used for the `parent` receiver: it yields a
    // junk namespaced literal instead of the parent class.
    expect(resolvePhpClassName(source, "parent")).toBe(
      "App\\DTOs\\Facebook\\Posts\\parent",
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
