import { describe, expect, it } from "vitest";
import {
  isUsableLaravelGateAbilityName,
  phpLaravelGateAbilityCompletionInsertText,
  phpLaravelGateAbilityDefinitions,
  phpLaravelGateAbilityReferenceContextAt,
} from "./phpLaravelAuthorization";

function positionOf(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length + 1,
    lineNumber: lines.length,
  };
}

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

describe("phpLaravelAuthorization", () => {
  it("detects supported Laravel authorization ability references", () => {
    const samples = [
      ["Gate::allows('update-post')", "Gate::allows"],
      ["Gate::denies('update-post')", "Gate::denies"],
      ["Gate::authorize('update-post')", "Gate::authorize"],
      ["Gate::has('update-post')", "Gate::has"],
      ["Gate::inspect('update-post')", "Gate::inspect"],
      ["Gate::check('update-post')", "Gate::check"],
      ["Gate::raw('update-post')", "Gate::raw"],
      ["Gate::forUser($user)->allows('update-post')", "Gate::allows"],
      ["$this->authorize('update-post', $post)", "authorize"],
      [
        "$this->authorizeForUser($user, 'update-post', $post)",
        "authorizeForUser",
      ],
      ["$user->can('update-post', $post)", "can"],
      ["$user->cannot('update-post', $post)", "cannot"],
      ["$request->user()->can('update-post')", "can"],
    ] as const;

    for (const [expression, call] of samples) {
      const source = `<?php\n\n${expression};\n`;

      expect(
        phpLaravelGateAbilityReferenceContextAt(
          source,
          positionAfter(source, "update-post"),
        ),
      ).toMatchObject({
        ability: "update-post",
        call,
      });
    }
  });

  it("detects abilities inside Gate::any and canAny array arguments", () => {
    const anySource = `<?php\n\nGate::any(['update-post', 'delete-post']);\n`;

    expect(
      phpLaravelGateAbilityReferenceContextAt(
        anySource,
        positionAfter(anySource, "delete-post"),
      ),
    ).toMatchObject({
      ability: "delete-post",
      call: "Gate::any",
    });

    const canAnySource = `<?php\n\n$user->canAny(['update-post', 'delete-post']);\n`;

    expect(
      phpLaravelGateAbilityReferenceContextAt(
        canAnySource,
        positionAfter(canAnySource, "update-post"),
      ),
    ).toMatchObject({
      ability: "update-post",
      call: "canAny",
    });
  });

  it("ignores dynamic or non-literal ability arguments", () => {
    const variableSource = `<?php\n\nGate::allows($ability, $post);\n`;

    expect(
      phpLaravelGateAbilityReferenceContextAt(
        variableSource,
        positionAfter(variableSource, "$abil"),
      ),
    ).toBeNull();

    const interpolatedSource = `<?php\n\nGate::allows("update-$type");\n`;

    expect(
      phpLaravelGateAbilityReferenceContextAt(
        interpolatedSource,
        positionAfter(interpolatedSource, "update-"),
      ),
    ).toBeNull();
  });

  it("ignores unrelated calls and non-ability arguments", () => {
    const unrelatedSource = `<?php\n\n$collection->contains('update-post');\n`;

    expect(
      phpLaravelGateAbilityReferenceContextAt(
        unrelatedSource,
        positionAfter(unrelatedSource, "update-post"),
      ),
    ).toBeNull();

    const secondArgumentSource = `<?php\n\n$user->can('update-post', 'extra');\n`;

    expect(
      phpLaravelGateAbilityReferenceContextAt(
        secondArgumentSource,
        positionAfter(secondArgumentSource, "extra"),
      ),
    ).toBeNull();
  });

  it("collects Gate::define ability registrations across a provider", () => {
    const source = `<?php

namespace App\\Providers;

class AuthServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Gate::define('update-post', [PostPolicy::class, 'update']);
        Gate::define('delete-post', fn ($user) => $user->isAdmin());
        Gate::define(ability: 'view-report', callback: ReportPolicy::class);
    }
}
`;

    expect(phpLaravelGateAbilityDefinitions(source)).toEqual([
      {
        name: "update-post",
        position: positionOf(source, "update-post"),
      },
      {
        name: "delete-post",
        position: positionOf(source, "delete-post"),
      },
      {
        name: "view-report",
        position: positionOf(source, "view-report"),
      },
    ]);
  });

  it("ignores Gate::define with dynamic ability names", () => {
    const source = `<?php\n\nGate::define($ability, fn () => true);\nGate::define("update-{$model}", fn () => true);\n`;

    expect(phpLaravelGateAbilityDefinitions(source)).toEqual([]);
  });

  it("builds the completion insert text from the full ability name", () => {
    expect(phpLaravelGateAbilityCompletionInsertText("update-post")).toBe(
      "update-post",
    );
    expect(phpLaravelGateAbilityCompletionInsertText("posts.update")).toBe(
      "posts.update",
    );
  });

  it("validates usable ability names", () => {
    expect(isUsableLaravelGateAbilityName("update-post")).toBe(true);
    expect(isUsableLaravelGateAbilityName("viewAny")).toBe(true);
    expect(isUsableLaravelGateAbilityName("posts.update")).toBe(true);
    expect(isUsableLaravelGateAbilityName("")).toBe(false);
    expect(isUsableLaravelGateAbilityName("update post")).toBe(false);
  });
});
