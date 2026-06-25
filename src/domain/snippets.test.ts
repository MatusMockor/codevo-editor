import { describe, expect, it } from "vitest";

import {
  snippetsForLanguage,
  matchingSnippetsForLanguage,
  type Snippet,
} from "./snippets";

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

  it("offers every built-in snippet for php and none for other languages", () => {
    const phpCount = snippetsForLanguage("php").length;

    expect(phpCount).toBeGreaterThan(0);
    expect(snippetsForLanguage("javascript")).toEqual([]);
    expect(snippetsForLanguage("typescript")).toEqual([]);
    expect(snippetsForLanguage("blade")).toEqual([]);
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
