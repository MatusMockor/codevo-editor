import { describe, expect, it } from "vitest";
import {
  agentPromptLinkSegments,
  MAX_AGENT_PROMPT_LINK_CHARS,
  MAX_AGENT_PROMPT_LINK_SCAN_CHARS,
  MAX_AGENT_PROMPT_LINKS,
  type AgentPromptSegment,
} from "./agentPromptLinks";
import { CLIPPED_AGENT_PROMPT_MARKER } from "./agentPromptClipping";

function links(text: string): ReadonlyArray<string> {
  return agentPromptLinkSegments(text).flatMap((segment) =>
    segment.kind === "link" ? [segment.url] : [],
  );
}

function rebuilt(text: string, segments: ReadonlyArray<AgentPromptSegment>): string {
  return segments.map((segment) => text.slice(segment.start, segment.end)).join("");
}

describe("agentPromptLinkSegments", () => {
  it("links the owner's merge request URL and keeps the Slovak text around it literal", () => {
    const text =
      "https://git.efabrica.sk/ebox/backend/cms/-/merge_requests/5126 test napis len ahoj nic nepozeraj";
    expect(agentPromptLinkSegments(text)).toEqual([
      {
        kind: "link",
        start: 0,
        end: 62,
        url: "https://git.efabrica.sk/ebox/backend/cms/-/merge_requests/5126",
      },
      { kind: "text", start: 62, end: text.length },
    ]);
  });

  it("finds a URL at the end of Slovak text with diacritics", () => {
    expect(links("Pozri si prosím túto zmenu: https://example.sk/čo-ďalej")).toEqual([
      "https://example.sk/čo-ďalej",
    ]);
  });

  it("finds several URLs separated by newlines and keeps every character", () => {
    const text = "prvý http://a.example/x\n\tdruhý https://b.example/y?q=1#top\n";
    const segments = agentPromptLinkSegments(text);
    expect(links(text)).toEqual(["http://a.example/x", "https://b.example/y?q=1#top"]);
    expect(rebuilt(text, segments)).toBe(text);
    expect(segments.map((segment) => segment.kind)).toEqual([
      "text",
      "link",
      "text",
      "link",
      "text",
    ]);
  });

  it.each([
    ["Hotovo: https://example.com/a.", "https://example.com/a"],
    ["https://example.com/a, potom", "https://example.com/a"],
    ["Naozaj https://example.com/a?!", "https://example.com/a"],
    ["(pozri https://example.com/a)", "https://example.com/a"],
    ["[https://example.com/a]", "https://example.com/a"],
    ["{https://example.com/a}", "https://example.com/a"],
    ["„https://example.com/a“", "https://example.com/a"],
    ["'https://example.com/a'", "https://example.com/a"],
    ["*https://example.com/a*", "https://example.com/a"],
    ["https://example.com/a…", "https://example.com/a"],
    ["(https://example.com/a).", "https://example.com/a"],
    ["koniec https://example.com/a:;", "https://example.com/a"],
  ])("trims trailing punctuation from %j", (text, url) => {
    expect(links(text)).toEqual([url]);
  });

  it.each([
    "https://en.wikipedia.org/wiki/Bratislava_(disambiguation)",
    "https://example.com/a(b)c(d)",
    "http://[::1]:8080/status",
    "https://example.com/list[0]",
    "https://example.com/?q=a,b&x=1",
  ])("keeps balanced brackets and inner punctuation in %s", (url) => {
    expect(links(`viď ${url} prosím`)).toEqual([url]);
  });

  it("keeps a balanced parenthesis but drops an unbalanced outer one and a period", () => {
    expect(links("(viď https://en.wikipedia.org/wiki/Foo_(bar)).")).toEqual([
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    ]);
  });

  it("stops at angle brackets, quotes and backticks", () => {
    expect(
      links('<https://example.com/a> "https://example.com/b" `https://example.com/c`'),
    ).toEqual(["https://example.com/a", "https://example.com/b", "https://example.com/c"]);
  });

  it("accepts an upper-case scheme and passes the URL exactly as written", () => {
    expect(links("HTTPS://Example.COM/Path")).toEqual(["HTTPS://Example.COM/Path"]);
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<script>alert(1)</script>",
    "mailto:someone@example.com",
    "ftp://example.com/file",
    "www.example.com",
    "vbscript:msgbox",
  ])("never links a non-http scheme: %s", (text) => {
    expect(links(`pozri ${text} hneď`)).toEqual([]);
  });

  it.each(["https://", "https:// example.com", "http:///path-only", "https://?q=1", "https://#x"])(
    "rejects a scheme without a host: %j",
    (text) => {
      expect(links(text)).toEqual([]);
    },
  );

  it("does not link a scheme glued to a preceding word or path", () => {
    expect(
      links("xhttps://example.com abc/https://example.com redirect=https://example.com"),
    ).toEqual([]);
  });

  it("does not start a second link inside a URL that embeds another URL", () => {
    expect(links("https://example.com/login?next=https://other.example/x")).toEqual([
      "https://example.com/login?next=https://other.example/x",
    ]);
  });

  it("leaves an over-long URL as plain text instead of linking a truncated part", () => {
    const long = `https://example.com/${"a".repeat(MAX_AGENT_PROMPT_LINK_CHARS)}`;
    const text = `${long} https://ok.example`;
    expect(links(text)).toEqual(["https://ok.example"]);
    expect(rebuilt(text, agentPromptLinkSegments(text))).toBe(text);
  });

  it("links at most the bounded number of URLs per message", () => {
    const text = Array.from(
      { length: MAX_AGENT_PROMPT_LINKS + 5 },
      (_, i) => `https://e.example/${i}`,
    ).join(" ");
    const found = links(text);
    expect(found).toHaveLength(MAX_AGENT_PROMPT_LINKS);
    expect(found[found.length - 1]).toBe(`https://e.example/${MAX_AGENT_PROMPT_LINKS - 1}`);
    expect(rebuilt(text, agentPromptLinkSegments(text))).toBe(text);
  });

  it("does not look for URLs past the scan bound of a huge message", () => {
    const text = `${"x ".repeat(MAX_AGENT_PROMPT_LINK_SCAN_CHARS / 2)}https://late.example`;
    expect(links(text)).toEqual([]);
    expect(links(`https://early.example ${text}`)).toEqual(["https://early.example"]);
  });

  it("returns a single text segment when there is nothing to link and nothing for empty text", () => {
    expect(agentPromptLinkSegments("len ahoj")).toEqual([{ kind: "text", start: 0, end: 8 }]);
    expect(agentPromptLinkSegments("")).toEqual([]);
  });

  it("never links a URL cut off by the clipped-prompt marker but keeps earlier complete ones", () => {
    const clipped = `pozri https://ok.example/a a https://example.com/very/long/pa${CLIPPED_AGENT_PROMPT_MARKER}`;
    expect(links(clipped)).toEqual(["https://ok.example/a"]);
    expect(rebuilt(clipped, agentPromptLinkSegments(clipped))).toBe(clipped);
    const ended = `https://ok.example/a ${CLIPPED_AGENT_PROMPT_MARKER}`;
    expect(links(ended)).toEqual(["https://ok.example/a"]);
  });

  it.each([
    ["（https://example.jp/a）", "https://example.jp/a"],
    ["見て https://example.jp/a。", "https://example.jp/a"],
    ["「https://example.jp/a」", "https://example.jp/a"],
    ["https://example.jp/a、次", "https://example.jp/a"],
    ["https://example.jp/a，", "https://example.jp/a"],
  ])("trims full-width punctuation and brackets from %j", (text, url) => {
    expect(links(text)).toEqual([url]);
  });

  it.each([0x202e, 0x2066, 0x200f])("stops a link at the bidi control U+%s", (code) => {
    const control = String.fromCharCode(code);
    expect(links(`https://example.com/a${control}gpj.exe`)).toEqual(["https://example.com/a"]);
  });

  it("stops at non-breaking and zero-width spaces", () => {
    expect(links("https://example.com/a b https://example.com/c​d")).toEqual([
      "https://example.com/a",
      "https://example.com/c",
    ]);
  });
});
