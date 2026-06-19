import { describe, expect, it } from "vitest";
import {
  isKnownPhpFrameworkStaticMethod,
  phpFrameworkMemberCompletionsFromSource,
  type PhpFrameworkProvider,
} from "./phpFrameworkProviders";

describe("phpFrameworkProviders", () => {
  it("exposes Laravel model attributes and relations through the framework seam", () => {
    const source = `<?php
use Illuminate\\Database\\Eloquent\\Model;

class Comment extends Model
{
    protected $fillable = [
        'content',
    ];

    protected array $casts = [
        'is_pinned' => 'bool',
    ];

    public function parent(): BelongsTo
    {
        return $this->belongsTo(Comment::class);
    }
}
`;

    expect(phpFrameworkMemberCompletionsFromSource(source, "Comment")).toEqual([
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "content",
        parameters: "",
        returnType: "mixed",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "is_pinned",
        parameters: "",
        returnType: "bool",
      },
      {
        declaringClassName: "Comment",
        kind: "property",
        name: "parent",
        parameters: "",
        returnType: "Comment",
      },
    ]);
  });

  it("supports framework-specific providers without changing the core parser", () => {
    const netteProvider: PhpFrameworkProvider = {
      id: "nette",
      completions: {
        memberCompletionsFromSource: ({ declaringClassName }) => [
          {
            declaringClassName,
            kind: "property",
            name: "presenter",
            parameters: "",
            returnType: "Nette\\Application\\UI\\Presenter",
          },
        ],
      },
      diagnostics: {
        isKnownStaticMethod: ({ methodName }) => methodName === "whereMagic",
      },
    };

    expect(
      phpFrameworkMemberCompletionsFromSource("<?php", "Article", [
        netteProvider,
      ]),
    ).toEqual([
      {
        declaringClassName: "Article",
        kind: "property",
        name: "presenter",
        parameters: "",
        returnType: "Nette\\Application\\UI\\Presenter",
      },
    ]);
    expect(
      isKnownPhpFrameworkStaticMethod("<?php", "Article", "whereMagic", [
        netteProvider,
      ]),
    ).toBe(true);
    expect(
      isKnownPhpFrameworkStaticMethod("<?php", "Article", "whereMissing", [
        netteProvider,
      ]),
    ).toBe(false);
  });
});
