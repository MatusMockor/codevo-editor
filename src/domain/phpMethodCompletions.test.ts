import { describe, expect, it } from "vitest";
import {
  phpMemberAccessCompletionContextAt,
  phpMethodCompletionsFromSource,
  phpMethodParameters,
  phpMethodSignatureContextAt,
  phpStaticAccessCompletionContextAt,
  phpTraitClassNames,
} from "./phpMethodCompletions";

describe("phpMethodCompletions", () => {
  it("detects member access completion context", () => {
    const source = `<?php
class Controller
{
    public function store(StoreCommentRequest $request): void
    {
        $request->get
    }
}
`;

    expect(
      phpMemberAccessCompletionContextAt(source, {
        column: 22,
        lineNumber: 6,
      }),
    ).toEqual({
      prefix: "get",
      receiverExpression: "$request",
      variableName: "request",
    });
  });

  it("detects nested member access completion context", () => {
    const source = `<?php
class Controller
{
    public function store(): void
    {
        $this->commentService->cre
    }
}
`;

    expect(
      phpMemberAccessCompletionContextAt(source, {
        column: 35,
        lineNumber: 6,
      }),
    ).toEqual({
      prefix: "cre",
      receiverExpression: "$this->commentService",
      variableName: null,
    });
  });

  it("detects static access completion context", () => {
    expect(
      phpStaticAccessCompletionContextAt("<?php\nCommentFactory::ma", {
        column: 19,
        lineNumber: 2,
      }),
    ).toEqual({
      className: "CommentFactory",
      prefix: "ma",
    });
  });

  it("detects method signature context and active argument", () => {
    const source = `<?php
class Controller
{
    public function store(StoreCommentRequest $request): void
    {
        $request->get($key,
    }
}
`;

    expect(
      phpMethodSignatureContextAt(source, {
        column: 28,
        lineNumber: 6,
      }),
    ).toEqual({
      argumentIndex: 1,
      className: null,
      methodName: "get",
      receiverExpression: "$request",
      variableName: "request",
    });
  });

  it("detects static method signature context", () => {
    expect(
      phpMethodSignatureContextAt("<?php\nCommentFactory::make(", {
        column: 23,
        lineNumber: 2,
      }),
    ).toEqual({
      argumentIndex: 0,
      className: "CommentFactory",
      methodName: "make",
      receiverExpression: null,
      variableName: null,
    });
  });

  it("extracts public methods without leaking private helpers", () => {
    const source = `<?php
class Request
{
    public function get(string $key, mixed $default = null): mixed {}
    protected function internal(): void {}
    private function secret(): void {}
}
`;

    expect(phpMethodCompletionsFromSource(source, "Request")).toEqual([
      {
        declaringClassName: "Request",
        name: "get",
        parameters: "string $key, mixed $default = null",
        returnType: "mixed",
      },
    ]);
  });

  it("uses PHPDoc return types when methods do not declare one", () => {
    expect(
      phpMethodCompletionsFromSource(
        "<?php\nclass Factory\n{\n    /** @return Comment */\n    public static function make() {}\n}\n",
        "Factory",
      ),
    ).toEqual([
      {
        declaringClassName: "Factory",
        isStatic: true,
        name: "make",
        parameters: "",
        returnType: "Comment",
      },
    ]);
  });

  it("parses parameter names, types, defaults and optionality", () => {
    expect(
      phpMethodParameters(
        "string $key, mixed $default = null, array $options = ['a,b']",
      ),
    ).toEqual([
      {
        defaultValue: null,
        name: "$key",
        optional: false,
        raw: "string $key",
        type: "string",
      },
      {
        defaultValue: "null",
        name: "$default",
        optional: true,
        raw: "mixed $default = null",
        type: "mixed",
      },
      {
        defaultValue: "['a,b']",
        name: "$options",
        optional: true,
        raw: "array $options = ['a,b']",
        type: "array",
      },
    ]);
  });

  it("extracts trait names from class bodies", () => {
    expect(
      phpTraitClassNames(`<?php
namespace Illuminate\\Http;

use Illuminate\\Support\\Traits\\Conditionable;

class Request
{
    use Concerns\\InteractsWithInput, Conditionable;
}
`),
    ).toEqual(["Concerns\\InteractsWithInput", "Conditionable"]);
  });
});
