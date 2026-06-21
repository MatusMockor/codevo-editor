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
 * @method static findForSlug(string $slug)
 * @method \\Illuminate\\Support\\Collection<int, Comment> activeComments()
 */
class CommentFactory
{
}
`;
    const activeCommentsPosition = positionAfter(source, "activeComments");

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
        Comment::with('parent');
        Comment::with('children.parent');
        Comment::query()->whereHas('attachments', fn ($query) => $query);
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
