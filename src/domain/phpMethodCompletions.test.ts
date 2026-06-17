import { describe, expect, it } from "vitest";
import {
  phpMemberAccessCompletionContextAt,
  phpMethodCompletionsFromSource,
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
      variableName: "request",
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
