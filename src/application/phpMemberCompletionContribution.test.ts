import { describe, expect, it } from "vitest";
import {
  createPhpMemberCompletionContributionIdentity,
  createPhpMemberCompletionCollector,
  mergePhpMemberCompletions,
  phpMemberCompletionContributionSignature,
  type PhpMemberCompletionContribution,
} from "./phpMemberCompletionContribution";

describe("phpMemberCompletionContribution", () => {
  it("merges core and framework members with core-first stable deduplication", () => {
    const contribution: PhpMemberCompletionContribution = {
      id: "test.members",
      collect: ({ declaringClassName }) => [
        member(declaringClassName, "save", "framework"),
        member(declaringClassName, "publish", "framework"),
      ],
    };
    const collector = createPhpMemberCompletionCollector([contribution]);
    const members = collector.collect(
      `<?php
class Post
{
    public function save(): void {}
}`,
      "Post",
    );

    expect(members.map(({ detail, name }) => ({ detail, name }))).toEqual([
      { detail: undefined, name: "save" },
      { detail: "framework", name: "publish" },
    ]);
  });

  it("passes immutable workspace source context to every contribution", () => {
    const contexts: readonly string[][] = [];
    const captured: string[][] = contexts as string[][];
    const contribution: PhpMemberCompletionContribution = {
      id: "test.workspace",
      collect: ({ workspaceSources }) => {
        captured.push([...workspaceSources]);
        return [];
      },
    };

    createPhpMemberCompletionCollector([contribution]).collect(
      "<?php class Post {}",
      "Post",
      {},
      ["provider source"],
    );

    expect(contexts).toEqual([["provider source"]]);
  });

  it("deduplicates methods independently from properties", () => {
    expect(
      mergePhpMemberCompletions(
        [member("Post", "status", "method")],
        [{ ...member("Post", "status", "property"), kind: "property" }],
      ).map(({ kind, name }) => ({ kind, name })),
    ).toEqual([
      { kind: undefined, name: "status" },
      { kind: "property", name: "status" },
    ]);
  });

  it("keeps overload-like methods with distinct signatures", () => {
    expect(
      mergePhpMemberCompletions(
        [member("Post", "find", "first", "int $id")],
        [member("Post", "find", "second", "string $slug")],
      ).map(({ detail, name, parameters }) => ({ detail, name, parameters })),
    ).toEqual([
      { detail: "first", name: "find", parameters: "int $id" },
      { detail: "second", name: "find", parameters: "string $slug" },
    ]);
  });

  it("lets a contribution replace one matching core member in place", () => {
    const contribution: PhpMemberCompletionContribution = {
      id: "test.replacement",
      collect: () => [
        { ...member("Post", "published", "scope"), kind: "scope" },
      ],
      replaces: (existing, replacement) =>
        !existing.kind &&
        replacement.kind === "scope" &&
        existing.name === replacement.name,
    };
    const collector = createPhpMemberCompletionCollector([contribution]);

    expect(
      collector
        .collect(
          "<?php class Post { protected function published(): void {} }",
          "Post",
          { includeNonPublicMembers: true },
        )
        .map(({ detail, kind, name }) => ({ detail, kind, name })),
    ).toEqual([{ detail: "scope", kind: "scope", name: "published" }]);
  });

  it("creates a deterministic signature from contribution identity and priority", () => {
    const low = contribution("low", 10);
    const high = contribution("high", 100);

    expect(phpMemberCompletionContributionSignature([low, high])).toBe(
      "low:10|high:100",
    );
    expect(phpMemberCompletionContributionSignature([high, low])).toBe(
      "high:100|low:10",
    );
    expect(
      phpMemberCompletionContributionSignature([
        { ...low, priority: 11 },
        high,
      ]),
    ).toBe("low:11|high:100");
  });

  it("assigns stable owner-local identities to contribution objects", () => {
    const identity = createPhpMemberCompletionContributionIdentity();
    const first = contribution("custom", 10);
    const replacement = contribution("custom", 10);

    expect(identity.signature([first])).toBe("custom:10:1");
    expect(identity.signature([first])).toBe("custom:10:1");
    expect(identity.signature([replacement])).toBe("custom:10:2");
    expect(createPhpMemberCompletionContributionIdentity().signature([first])).toBe(
      "custom:10:1",
    );
  });
});

function contribution(
  id: string,
  priority: number,
): PhpMemberCompletionContribution {
  return { collect: () => [], id, priority };
}

function member(
  declaringClassName: string,
  name: string,
  detail: string,
  parameters = "",
) {
  return {
    declaringClassName,
    detail,
    name,
    parameters,
    returnType: null,
  };
}
