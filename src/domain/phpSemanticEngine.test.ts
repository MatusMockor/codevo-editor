import { describe, expect, it } from "vitest";
import {
  phpAssignmentExpressionForVariableBefore,
  phpCurrentClassName,
  phpDeclaredGenericTypeCandidates,
  phpDeclaredTypeCandidate,
  phpLaravelContainerExpressionClassName,
  phpMethodCallExpression,
  phpMethodReturnExpressions,
  phpNewExpressionClassName,
  phpPropertyAccessExpression,
  phpReceiverExpressionTypeInSource,
  phpStaticCallExpression,
  phpThisPropertyType,
  phpVariableTypeInSource,
} from "./phpSemanticEngine";

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
