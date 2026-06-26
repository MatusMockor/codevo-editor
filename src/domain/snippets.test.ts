import { describe, expect, it } from "vitest";

import {
  snippetsForLanguage,
  matchingSnippetsForLanguage,
  normalizeUserSnippets,
  snippetCompletionSuggestions,
  type Snippet,
  type UserSnippet,
} from "./snippets";

const JS_TS_LANGUAGES = [
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
] as const;

/**
 * Minimal stand-in for the Monaco constants the snippet helper reads, so the
 * pure-domain helper can be unit tested without pulling in the editor runtime.
 */
const monacoStub = {
  languages: {
    CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    CompletionItemKind: { Snippet: 15 },
  },
} as unknown as Parameters<typeof snippetCompletionSuggestions>[0];

const range = {
  endColumn: 4,
  endLineNumber: 1,
  startColumn: 1,
  startLineNumber: 1,
};

describe("snippetsForLanguage", () => {
  it("returns PHP snippets for the php language", () => {
    const snippets = snippetsForLanguage("php");

    expect(snippets.length).toBeGreaterThan(0);

    const prefixes = snippets.map((snippet) => snippet.prefix);

    expect(prefixes).toEqual(expect.arrayContaining(["nclass", "dd", "ddd"]));
  });

  it("scopes Laravel snippets to php only", () => {
    const route = snippetsForLanguage("php").find(
      (snippet) => snippet.prefix === "route",
    );

    expect(route).toBeDefined();

    const jsRoute = snippetsForLanguage("javascript").find(
      (snippet) => snippet.prefix === "route",
    );

    expect(jsRoute).toBeUndefined();
  });

  it("offers built-in snippets for php, javascript/typescript and blade", () => {
    expect(snippetsForLanguage("php").length).toBeGreaterThan(0);
    expect(snippetsForLanguage("javascript").length).toBeGreaterThan(0);
    expect(snippetsForLanguage("typescript").length).toBeGreaterThan(0);
    expect(snippetsForLanguage("blade").length).toBeGreaterThan(0);
  });

  it("does not leak PHP snippets into javascript", () => {
    const jsSnippets = snippetsForLanguage("javascript");
    const phpOnlyPrefixes = jsSnippets.filter((snippet) =>
      ["nclass", "dd", "ddd", "pubf", "model"].includes(snippet.prefix),
    );

    expect(phpOnlyPrefixes).toEqual([]);
  });

  it("uses Monaco snippet syntax with tab-stops in bodies", () => {
    const nclass = snippetsForLanguage("php").find(
      (snippet) => snippet.prefix === "nclass",
    );

    expect(nclass).toBeDefined();
    expect(nclass?.body).toContain("${1:");
    expect(nclass?.body).toContain("$0");
  });

  it("exposes every PHP/Laravel built-in prefix from the agreed set", () => {
    const prefixes = new Set(
      snippetsForLanguage("php").map((snippet) => snippet.prefix),
    );

    for (const expected of [
      "nclass",
      "pubf",
      "prif",
      "foreachk",
      "dd",
      "ddd",
      "construct",
      "route",
      "model",
      "migration",
      "test",
      "dispatch",
    ]) {
      expect(prefixes.has(expected)).toBe(true);
    }
  });

  it("has unique prefixes per language", () => {
    const phpPrefixes = snippetsForLanguage("php").map(
      (snippet) => snippet.prefix,
    );

    expect(new Set(phpPrefixes).size).toBe(phpPrefixes.length);
  });
});

describe("matchingSnippetsForLanguage", () => {
  it("returns snippets whose prefix starts with the typed word", () => {
    const matches = matchingSnippetsForLanguage("php", "dd");
    const prefixes = matches.map((snippet) => snippet.prefix);

    expect(prefixes).toContain("dd");
    expect(prefixes).toContain("ddd");
    expect(prefixes).not.toContain("nclass");
  });

  it("matches case-insensitively", () => {
    const matches = matchingSnippetsForLanguage("php", "NCL");

    expect(matches.map((snippet) => snippet.prefix)).toContain("nclass");
  });

  it("returns all language snippets for an empty word", () => {
    const matches = matchingSnippetsForLanguage("php", "");

    expect(matches).toEqual(snippetsForLanguage("php"));
  });

  it("returns nothing when no prefix matches", () => {
    const matches = matchingSnippetsForLanguage("php", "zzzznomatch");

    expect(matches).toEqual([]);
  });

  it("never returns snippets from another language", () => {
    const matches: Snippet[] = matchingSnippetsForLanguage("javascript", "nc");

    expect(matches.map((snippet) => snippet.prefix)).not.toContain("nclass");
  });
});

describe("javascript/typescript built-in snippets", () => {
  it("offers the agreed JS/TS prefixes for every JS/TS language id", () => {
    for (const language of JS_TS_LANGUAGES) {
      const prefixes = new Set(
        snippetsForLanguage(language).map((snippet) => snippet.prefix),
      );

      for (const expected of [
        "clg",
        "fn",
        "afn",
        "imp",
        "exp",
        "forof",
        "cls",
        "tryc",
        "prom",
      ]) {
        expect(prefixes.has(expected)).toBe(true);
      }
    }
  });

  it("uses Monaco tab-stop syntax in JS/TS bodies", () => {
    const clg = snippetsForLanguage("typescript").find(
      (snippet) => snippet.prefix === "clg",
    );

    expect(clg?.body).toContain("$");
  });

  it("does not leak JS/TS snippets into php or blade", () => {
    expect(
      snippetsForLanguage("php").map((snippet) => snippet.prefix),
    ).not.toContain("clg");
    expect(
      snippetsForLanguage("blade").map((snippet) => snippet.prefix),
    ).not.toContain("clg");
  });

  it("does not leak PHP snippets into JS/TS", () => {
    for (const language of JS_TS_LANGUAGES) {
      const prefixes = snippetsForLanguage(language).map(
        (snippet) => snippet.prefix,
      );

      expect(prefixes).not.toContain("nclass");
      expect(prefixes).not.toContain("route");
    }
  });
});

describe("blade built-in snippets", () => {
  it("offers the agreed Blade prefixes", () => {
    const prefixes = new Set(
      snippetsForLanguage("blade").map((snippet) => snippet.prefix),
    );

    for (const expected of [
      "@if",
      "@foreach",
      "@forelse",
      "@section",
      "@extends",
      "@component",
      "@php",
      "bvar",
    ]) {
      expect(prefixes.has(expected)).toBe(true);
    }
  });

  it("does not leak Blade snippets into php or javascript", () => {
    expect(
      snippetsForLanguage("php").map((snippet) => snippet.prefix),
    ).not.toContain("bvar");
    expect(
      snippetsForLanguage("javascript").map((snippet) => snippet.prefix),
    ).not.toContain("@foreach");
  });
});

describe("snippetCompletionSuggestions", () => {
  it("returns InsertAsSnippet items in the 2_ sort bucket for matched prefixes", () => {
    const suggestions = snippetCompletionSuggestions(
      monacoStub,
      "javascript",
      "clg",
      range,
    );

    expect(suggestions.length).toBeGreaterThan(0);

    const clg = suggestions.find((item) => item.label === "clg");

    expect(clg).toEqual(
      expect.objectContaining({
        insertTextRules:
          monacoStub.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        kind: monacoStub.languages.CompletionItemKind.Snippet,
        label: "clg",
        range,
      }),
    );
    expect(clg?.insertText).toContain("$");
    expect(clg?.sortText?.startsWith("2_")).toBe(true);
  });

  it("returns nothing for an empty typed word", () => {
    expect(snippetCompletionSuggestions(monacoStub, "javascript", "", range)).toEqual(
      [],
    );
  });

  it("scopes suggestions to the requested language", () => {
    const phpInJs = snippetCompletionSuggestions(
      monacoStub,
      "javascript",
      "nclass",
      range,
    );

    expect(phpInJs).toEqual([]);

    const jsInPhp = snippetCompletionSuggestions(
      monacoStub,
      "php",
      "clg",
      range,
    );

    expect(jsInPhp).toEqual([]);
  });

  it("matches blade snippets including @-prefixed directives", () => {
    const suggestions = snippetCompletionSuggestions(
      monacoStub,
      "blade",
      "@fore",
      range,
    );

    expect(suggestions.map((item) => item.label)).toContain("@foreach");
  });
});

describe("user snippets merged with built-ins", () => {
  const phpUserSnippet: UserSnippet = {
    prefix: "myhelper",
    body: "helper($0);",
    description: "Call my helper",
    languages: ["php"],
  };

  it("includes user snippets for the matching language in snippetsForLanguage", () => {
    const snippets = snippetsForLanguage("php", [phpUserSnippet]);
    const prefixes = snippets.map((snippet) => snippet.prefix);

    expect(prefixes).toContain("myhelper");
    expect(prefixes).toContain("nclass");
  });

  it("scopes user snippets to their declared languages", () => {
    const inPhp = snippetsForLanguage("php", [phpUserSnippet]).map(
      (snippet) => snippet.prefix,
    );
    const inJs = snippetsForLanguage("javascript", [phpUserSnippet]).map(
      (snippet) => snippet.prefix,
    );

    expect(inPhp).toContain("myhelper");
    expect(inJs).not.toContain("myhelper");
  });

  it("matches user snippets by typed prefix", () => {
    const matches = matchingSnippetsForLanguage("php", "myh", [phpUserSnippet]);

    expect(matches.map((snippet) => snippet.prefix)).toContain("myhelper");
  });

  it("offers user snippets as completion items in the 2_ bucket", () => {
    const suggestions = snippetCompletionSuggestions(
      monacoStub,
      "php",
      "myh",
      range,
      [phpUserSnippet],
    );
    const item = suggestions.find((entry) => entry.label === "myhelper");

    expect(item).toEqual(
      expect.objectContaining({
        insertText: "helper($0);",
        insertTextRules:
          monacoStub.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        kind: monacoStub.languages.CompletionItemKind.Snippet,
        label: "myhelper",
        range,
      }),
    );
    expect(item?.sortText?.startsWith("2_")).toBe(true);
  });

  it("lets a user snippet override a built-in with the same prefix and language", () => {
    const override: UserSnippet = {
      prefix: "dd",
      body: "dump_die($0);",
      description: "My dd override",
      languages: ["php"],
    };
    const matches = matchingSnippetsForLanguage("php", "dd", [override]);
    const dd = matches.filter((snippet) => snippet.prefix === "dd");

    expect(dd).toHaveLength(1);
    expect(dd[0].body).toBe("dump_die($0);");
    expect(dd[0].description).toBe("My dd override");
  });

  it("does not override a built-in when the override targets a different language", () => {
    const override: UserSnippet = {
      prefix: "dd",
      body: "dump_die($0);",
      description: "JS dd",
      languages: ["javascript"],
    };
    const dd = matchingSnippetsForLanguage("php", "dd", [override]).find(
      (snippet) => snippet.prefix === "dd",
    );

    expect(dd?.body).toBe("dd($0);");
  });

  it("keeps built-in behaviour unchanged when no user snippets are passed", () => {
    expect(snippetsForLanguage("php")).toEqual(snippetsForLanguage("php", []));
    expect(matchingSnippetsForLanguage("php", "dd")).toEqual(
      matchingSnippetsForLanguage("php", "dd", []),
    );
  });
});

describe("normalizeUserSnippets", () => {
  it("returns an empty array for non-array input", () => {
    expect(normalizeUserSnippets(undefined)).toEqual([]);
    expect(normalizeUserSnippets(null)).toEqual([]);
    expect(normalizeUserSnippets("nope")).toEqual([]);
    expect(normalizeUserSnippets({})).toEqual([]);
  });

  it("keeps well-formed snippets and trims string fields", () => {
    const normalized = normalizeUserSnippets([
      {
        prefix: "  myhelper  ",
        body: "helper($0);",
        description: "  Call helper  ",
        languages: ["php", "blade"],
      },
    ]);

    expect(normalized).toEqual([
      {
        prefix: "myhelper",
        body: "helper($0);",
        description: "Call helper",
        languages: ["php", "blade"],
      },
    ]);
  });

  it("drops snippets without a prefix, body, or any language", () => {
    const normalized = normalizeUserSnippets([
      { prefix: "", body: "x", description: "", languages: ["php"] },
      { prefix: "ok", body: "", description: "", languages: ["php"] },
      { prefix: "nolang", body: "x", description: "", languages: [] },
      { prefix: "good", body: "y", description: "", languages: ["php"] },
    ]);

    expect(normalized.map((snippet) => snippet.prefix)).toEqual(["good"]);
  });

  it("dedupes language ids and ignores non-string languages", () => {
    const normalized = normalizeUserSnippets([
      {
        prefix: "p",
        body: "b",
        description: "",
        languages: ["php", "php", 5, "blade"],
      },
    ]);

    expect(normalized[0].languages).toEqual(["php", "blade"]);
  });
});
