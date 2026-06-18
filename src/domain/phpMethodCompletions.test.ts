import { describe, expect, it } from "vitest";
import {
  phpMemberAccessCompletionContextAt,
  phpMethodCompletionsFromSource,
  phpMethodParameters,
  phpMethodSignatureContextAt,
  phpStaticAccessCompletionContextAt,
  phpTraitClassNames,
} from "./phpMethodCompletions";

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

  it("detects member access completion after fluent calls with arguments", () => {
    const source = `<?php
class Controller
{
    public function index(): void
    {
        $query->whereNull('parent_id')->ord
    }
}
`;

    expect(
      phpMemberAccessCompletionContextAt(source, {
        column: 44,
        lineNumber: 6,
      }),
    ).toEqual({
      prefix: "ord",
      receiverExpression: "$query->whereNull('parent_id')",
      variableName: null,
    });
  });

  it("detects Laravel container receiver completion contexts", () => {
    const sources = [
      {
        expectedReceiver: "app(CommentService::class)",
        source: "<?php\napp(CommentService::class)->cre",
      },
      {
        expectedReceiver: "resolve(CommentService::class)",
        source: "<?php\nresolve(CommentService::class)->cre",
      },
      {
        expectedReceiver: "app()->make(CommentService::class)",
        source: "<?php\napp()->make(CommentService::class)->cre",
      },
      {
        expectedReceiver: "App::make(CommentService::class)",
        source: "<?php\nApp::make(CommentService::class)->cre",
      },
      {
        expectedReceiver: "Container::getInstance()->make(CommentService::class)",
        source:
          "<?php\nContainer::getInstance()->make(CommentService::class)->cre",
      },
    ];

    for (const { expectedReceiver, source } of sources) {
      expect(
        phpMemberAccessCompletionContextAt(
          source,
          positionAfter(source, "->cre"),
        ),
      ).toEqual({
        prefix: "cre",
        receiverExpression: expectedReceiver,
        variableName: null,
      });
    }
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

  it("detects Laravel container receiver method signature contexts", () => {
    const source = "<?php\napp(CommentService::class)->create(";

    expect(
      phpMethodSignatureContextAt(
        source,
        positionAfter(source, "app(CommentService::class)->create("),
      ),
    ).toEqual({
      argumentIndex: 0,
      className: null,
      methodName: "create",
      receiverExpression: "app(CommentService::class)",
      variableName: null,
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

  it("keeps more specific generic PHPDoc return types over declared relation types", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;

class Comment
{
    /** @return BelongsTo<Comment, self> */
    public function parent(): BelongsTo {}
}
`,
        "Comment",
      ),
    ).toEqual([
      {
        declaringClassName: "Comment",
        name: "parent",
        parameters: "",
        returnType: "BelongsTo<Comment, self>",
      },
    ]);
  });

  it("extracts PHPDoc magic methods for framework-style OOP APIs", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
/**
 * @method static \\Illuminate\\Database\\Eloquent\\Builder<static> whereNull(string $column, string $boolean = 'and')
 * @method \\App\\Models\\Album publish(bool $quietly = false)
 */
class Album
{
}
`,
        "App\\Models\\Album",
      ),
    ).toEqual([
      {
        declaringClassName: "App\\Models\\Album",
        isStatic: true,
        name: "whereNull",
        parameters: "string $column, string $boolean = 'and'",
        returnType: "\\Illuminate\\Database\\Eloquent\\Builder<static>",
      },
      {
        declaringClassName: "App\\Models\\Album",
        name: "publish",
        parameters: "bool $quietly = false",
        returnType: "\\App\\Models\\Album",
      },
    ]);
  });

  it("uses PHPDoc parameter types when method parameters are untyped", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
trait InteractsWithInput
{
    /**
     * Retrieve an input item from the request.
     *
     * @param  string|null  $key
     * @param  mixed  $default
     * @return mixed
     */
    public function input($key = null, $default = null) {}
}
`,
        "Illuminate\\Http\\Concerns\\InteractsWithInput",
      ),
    ).toEqual([
      {
        declaringClassName: "Illuminate\\Http\\Concerns\\InteractsWithInput",
        name: "input",
        parameters: "string|null $key = null, mixed $default = null",
        returnType: "mixed",
      },
    ]);
  });

  it("extracts public and PHPDoc properties as member completions", () => {
    expect(
      phpMethodCompletionsFromSource(
        `<?php
/**
 * @property string $body
 * @property-read int $externalId
 */
class Comment
{
    public string $status;
    protected string $internal;
    private string $secret;

    public function getBody(): string {}
}
`,
        "Comment",
      ),
    ).toEqual([
      {
        declaringClassName: "Comment",
        name: "getBody",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "body",
        parameters: "",
        returnType: "string",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "externalId",
        parameters: "",
        returnType: "int",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "status",
        parameters: "",
        returnType: "string",
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
