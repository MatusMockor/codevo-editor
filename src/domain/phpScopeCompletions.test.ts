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
});
