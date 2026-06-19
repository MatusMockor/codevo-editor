import { describe, expect, it } from "vitest";
import { phpVariableCompletionsAt } from "./phpScopeCompletions";

describe("phpVariableCompletionsAt", () => {
  it("returns parameters and local variables visible before the cursor", () => {
    const source = `<?php
class CommentController
{
    public function store(StoreCommentRequest $request): void
    {
        $resolved = $this->modelRouter->resolve();
        $agent = new CommentsAgent();
        $
    }
}
`;

    expect(
      phpVariableCompletionsAt(source, {
        column: 10,
        lineNumber: 8,
      }),
    ).toEqual([
      { detail: "instance", name: "$this" },
      { detail: "parameter", name: "$request" },
      { detail: "local variable", name: "$agent" },
      { detail: "local variable", name: "$resolved" },
    ]);
  });

  it("ignores variables that only appear inside comments and strings", () => {
    const source = `<?php
function run($request) {
    // $fake
    $value = '$alsoFake';
    $
}
`;

    expect(
      phpVariableCompletionsAt(source, {
        column: 6,
        lineNumber: 5,
      }),
    ).toEqual([
      { detail: "parameter", name: "$request" },
      { detail: "local variable", name: "$value" },
    ]);
  });

  it("keeps anonymous function scope separate and exposes use captures", () => {
    const source = `<?php
class CommentController
{
    public function store(StoreCommentRequest $request): void
    {
        $outside = 'hidden';
        $handler = function (Comment $comment) use ($request) {
            $local = $comment->id;
            $
        };
    }
}
`;

    expect(
      phpVariableCompletionsAt(source, {
        column: 14,
        lineNumber: 9,
      }),
    ).toEqual([
      { detail: "instance", name: "$this" },
      { detail: "parameter", name: "$comment" },
      { detail: "local variable", name: "$request" },
      { detail: "local variable", name: "$local" },
    ]);
  });

  it("does not leak variables from closed anonymous functions into the parent scope", () => {
    const source = `<?php
function run($request): void
{
    $handler = function ($item): void {
        $inner = $item;
    };
    $
}
`;

    expect(
      phpVariableCompletionsAt(source, {
        column: 6,
        lineNumber: 7,
      }),
    ).toEqual([
      { detail: "parameter", name: "$request" },
      { detail: "local variable", name: "$handler" },
    ]);
  });

  it("lets arrow functions see outer variables while keeping their own parameters first", () => {
    const source = `<?php
function run($request, array $items): void
{
    $prefix = 'comment';
    array_map(fn ($item) => $
}
`;

    expect(
      phpVariableCompletionsAt(source, {
        column: 29,
        lineNumber: 5,
      }),
    ).toEqual([
      { detail: "parameter", name: "$item" },
      { detail: "parameter", name: "$request" },
      { detail: "parameter", name: "$items" },
      { detail: "local variable", name: "$prefix" },
    ]);
  });

  it("includes foreach and catch variables visible at the cursor", () => {
    const source = `<?php
function run(array $items): void
{
    foreach ($items as $key => $item) {
        try {
            $processed = $item;
        } catch (Throwable $exception) {
            $
        }
    }
}
`;

    expect(
      phpVariableCompletionsAt(source, {
        column: 14,
        lineNumber: 8,
      }),
    ).toEqual([
      { detail: "parameter", name: "$items" },
      { detail: "local variable", name: "$exception" },
      { detail: "local variable", name: "$item" },
      { detail: "local variable", name: "$processed" },
      { detail: "local variable", name: "$key" },
    ]);
  });
});
