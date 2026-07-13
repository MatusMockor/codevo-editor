import { describe, expect, it } from "vitest";
import type { EditorPosition } from "./languageServerFeatures";
import { phpLaravelCollectionCallbackContextForVariable } from "./phpLaravelCollectionCallbackContext";

function positionAfter(source: string, needle: string): EditorPosition {
  const offset = source.indexOf(needle);

  expect(offset).toBeGreaterThanOrEqual(0);

  const before = source.slice(0, offset + needle.length);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length + 1,
    lineNumber: lines.length,
  };
}

describe("phpLaravelCollectionCallbackContextForVariable", () => {
  const source = `<?php
use App\\Models\\User;

$users->map(fn ($user) => $user->nam);

$users->filter(function ($candidate) {
    $candidate->act
});

$users->each(function ($visited): void {
    $visited->sav
});

$users->sortBy(fn ($sorted) => $sorted->cre);

$users->first(fn ($found) => $found->act);

$users->reject(fn ($rejected) => $rejected->ban);

User::all()->map(fn ($model) => $model->nam);

$users->map(fn ($outer) => $outer->posts->filter(fn ($inner) => $inner->pub));

$users->map(function ($element, $key) {
    $key->probe
});

$users->transformAll(fn ($custom) => $custom->nam);

$users->each($options, function ($late) {
    $late->nam
});

$users->when($flag, fn ($conditional) => $conditional->nam);

$users->map(function (User $typed) {
    $typed->nam
});

$users->filter(fn (User $typedArrow) => $typedArrow->act);

$users->map(/* $wrong->filter( */ fn ($commented) => $commented->na);

$users->pluck("->filter(")->map(fn ($stringArg) => $stringArg->na);

$plain->nam;
`;

  it.each([
    ["an arrow callback", "$user->nam", "user", "map", "$users"],
    ["a closure callback", "$candidate->act", "candidate", "filter", "$users"],
    ["an each closure", "$visited->sav", "visited", "each", "$users"],
    ["a sortBy arrow callback", "$sorted->cre", "sorted", "sortBy", "$users"],
    ["a first arrow callback", "$found->act", "found", "first", "$users"],
    ["a reject arrow callback", "$rejected->ban", "rejected", "reject", "$users"],
    [
      "a static receiver chain",
      "$model->nam",
      "model",
      "map",
      "User::all()",
    ],
  ])(
    "detects the element callback context for %s",
    (_label, needle, variableName, methodName, receiverExpression) => {
      expect(
        phpLaravelCollectionCallbackContextForVariable(
          source,
          positionAfter(source, needle),
          variableName,
        ),
      ).toEqual({ methodName, receiverExpression });
    },
  );

  it("resolves nested pipelines to the innermost callback receiver", () => {
    expect(
      phpLaravelCollectionCallbackContextForVariable(
        source,
        positionAfter(source, "$inner->pub"),
        "inner",
      ),
    ).toEqual({ methodName: "filter", receiverExpression: "$outer->posts" });
    expect(
      phpLaravelCollectionCallbackContextForVariable(
        source,
        positionAfter(source, "$outer->posts"),
        "outer",
      ),
    ).toEqual({ methodName: "map", receiverExpression: "$users" });
  });

  it("ignores commented-out method calls when resolving the receiver", () => {
    expect(
      phpLaravelCollectionCallbackContextForVariable(
        source,
        positionAfter(source, "$commented->na"),
        "commented",
      ),
    ).toEqual({ methodName: "map", receiverExpression: "$users" });
  });

  it("ignores string-literal method calls when resolving the receiver", () => {
    expect(
      phpLaravelCollectionCallbackContextForVariable(
        source,
        positionAfter(source, "$stringArg->na"),
        "stringArg",
      ),
    ).toEqual({
      methodName: "map",
      receiverExpression: '$users->pluck("->filter(")',
    });
  });

  it("drops a trailing comment between the receiver and the method call", () => {
    const commentedChain = `<?php
$order->items /* pending */ ->map(fn ($line) => $line->na);
`;

    expect(
      phpLaravelCollectionCallbackContextForVariable(
        commentedChain,
        positionAfter(commentedChain, "$line->na"),
        "line",
      ),
    ).toEqual({ methodName: "map", receiverExpression: "$order->items" });
  });

  it("detects the first parameter of a multi-parameter callback", () => {
    expect(
      phpLaravelCollectionCallbackContextForVariable(
        source,
        positionAfter(source, "$key->probe"),
        "element",
      ),
    ).toEqual({ methodName: "map", receiverExpression: "$users" });
  });

  it.each([
    ["a non-first callback parameter", "$key->probe", "key"],
    ["a non-collection method call", "$custom->nam", "custom"],
    ["a second-argument callback", "$late->nam", "late"],
    ["a control-flow when callback", "$conditional->nam", "conditional"],
    ["an explicitly typed closure parameter", "$typed->nam", "typed"],
    ["an explicitly typed arrow parameter", "$typedArrow->act", "typedArrow"],
    ["a usage outside any callback", "$plain->nam", "plain"],
  ])("returns null for %s", (_label, needle, variableName) => {
    expect(
      phpLaravelCollectionCallbackContextForVariable(
        source,
        positionAfter(source, needle),
        variableName,
      ),
    ).toBeNull();
  });
});
