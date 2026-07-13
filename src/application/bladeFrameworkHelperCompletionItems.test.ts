import { describe, expect, it } from "vitest";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import {
  bladeFrameworkHelperNameCompletions,
  bladeFrameworkLiteralCompletionItems,
} from "./bladeFrameworkHelperCompletionItems";

describe("blade framework helper completion items", () => {
  it("filters helper-name completions by prefix through active providers", () => {
    const provider: PhpFrameworkProvider = {
      id: "custom",
      stringLiterals: {
        helperNameCompletions: () => [
          {
            detail: "Custom helper",
            insertText: "route()",
            label: "route",
          },
          {
            detail: "Custom helper",
            insertText: "config()",
            label: "config",
          },
        ],
      },
    };

    expect(
      bladeFrameworkHelperNameCompletions(
        "ro",
        {
          replaceEnd: 10,
          replaceStart: 8,
        },
        [provider],
      ),
    ).toEqual([
      expect.objectContaining({
        detail: "Custom helper",
        insertText: "route()",
        kind: "helper",
        label: "route",
      }),
    ]);
  });

  it("dedupes helper-name completions by provider order", () => {
    const firstProvider: PhpFrameworkProvider = {
      id: "first",
      stringLiterals: {
        helperNameCompletions: () => [
          {
            detail: "First helper",
            insertText: "route()",
            label: "route",
          },
        ],
      },
    };
    const secondProvider: PhpFrameworkProvider = {
      id: "second",
      stringLiterals: {
        helperNameCompletions: () => [
          {
            detail: "Second helper",
            insertText: "routeTo()",
            label: "route",
          },
        ],
      },
    };

    expect(
      bladeFrameworkHelperNameCompletions(
        "ro",
        {
          replaceEnd: 10,
          replaceStart: 8,
        },
        [firstProvider, secondProvider],
      ),
    ).toEqual([
      expect.objectContaining({
        detail: "First helper",
        insertText: "route()",
        label: "route",
      }),
    ]);
  });

  it("maps provider literal completions to Blade helper items", () => {
    expect(
      bladeFrameworkLiteralCompletionItems(
        [
          {
            declaringClassName: "routes/web.php",
            insertText: "users.index",
            kind: "route",
            name: "admin.users.index",
            parameters: "",
            returnType: null,
          },
        ],
        20,
        "admin.",
      ),
    ).toEqual([
      expect.objectContaining({
        detail: "routes/web.php",
        insertText: "users.index",
        kind: "helper",
        label: "admin.users.index",
        replaceEnd: 20,
        replaceStart: 14,
      }),
    ]);
  });
});
