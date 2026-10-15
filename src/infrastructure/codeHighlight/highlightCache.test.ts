import { describe, expect, it } from "vitest";
import type {
  CodeHighlightOutcome,
  CodeHighlightRequest,
} from "../../application/codeHighlight/codeHighlighter";
import { createHighlightCache } from "./highlightCache";

const OUTCOME: CodeHighlightOutcome = { kind: "plain", reason: "unavailable" };

function request(
  text: string,
  theme: CodeHighlightRequest["theme"] = "dark-plus",
): CodeHighlightRequest {
  return { text, language: "json", theme };
}

describe("createHighlightCache", () => {
  it("keys entries by theme, language and content", () => {
    const cache = createHighlightCache();
    cache.set(request("a"), OUTCOME);
    expect(cache.get(request("a"))).toBe(OUTCOME);
    expect(cache.get(request("b"))).toBeNull();
    expect(cache.get(request("a", "dracula"))).toBeNull();
    expect(cache.get({ ...request("a"), language: "jsonc" })).toBeNull();
  });

  it("evicts the least recently used entry when the entry limit is reached", () => {
    const cache = createHighlightCache(2, 100);
    cache.set(request("a"), OUTCOME);
    cache.set(request("b"), OUTCOME);
    cache.get(request("a"));
    cache.set(request("c"), OUTCOME);
    expect(cache.get(request("a"))).toBe(OUTCOME);
    expect(cache.get(request("b"))).toBeNull();
    expect(cache.size).toBe(2);
  });

  it("bounds the total cached characters and skips oversized inputs", () => {
    const cache = createHighlightCache(10, 5);
    cache.set(request("aaa"), OUTCOME);
    cache.set(request("bbb"), OUTCOME);
    expect(cache.get(request("aaa"))).toBeNull();
    expect(cache.totalChars).toBe(3);
    cache.set(request("cccccc"), OUTCOME);
    expect(cache.get(request("cccccc"))).toBeNull();
    expect(cache.totalChars).toBe(3);
  });

  it("replaces an existing entry without double counting", () => {
    const cache = createHighlightCache(10, 10);
    cache.set(request("abc"), OUTCOME);
    cache.set(request("abc"), OUTCOME);
    expect(cache.size).toBe(1);
    expect(cache.totalChars).toBe(3);
  });
});
