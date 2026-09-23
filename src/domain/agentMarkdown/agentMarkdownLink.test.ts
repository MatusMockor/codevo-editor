import { describe, expect, it } from "vitest";
import {
  AGENT_MARKDOWN_LINK_POLICY,
  MAX_AGENT_MARKDOWN_LINK_CHARS,
  parseAgentMarkdownLink,
  resolveAgentLocalFilePath,
  type AgentLocalFileLink,
  type AgentMarkdownLink,
} from "./agentMarkdownLink";

function local(
  anchor: "absolute" | "relative",
  path: string,
  line: number | null = null,
  column: number | null = null,
): AgentMarkdownLink {
  return { kind: "localFile", anchor, location: { path, line, column } };
}

function localLink(href: string): AgentLocalFileLink {
  const link = parseAgentMarkdownLink(href);
  expect(link.kind).toBe("localFile");
  return link as AgentLocalFileLink;
}

describe("parseAgentMarkdownLink", () => {
  it.each([
    ["https://example.com/docs?q=1#x", { kind: "external", url: "https://example.com/docs?q=1#x" }],
    ["http://localhost:3000", { kind: "external", url: "http://localhost:3000" }],
  ])("keeps external http(s) link %s", (href, expected) => {
    expect(parseAgentMarkdownLink(href)).toEqual(expected);
  });

  it.each([
    [
      "/Users/x/proj/odovzdavky/prepis.txt",
      local("absolute", "/Users/x/proj/odovzdavky/prepis.txt"),
    ],
    ["/Users/x/My%20Proj/prepis%20%C5%BE.txt", local("absolute", "/Users/x/My Proj/prepis ž.txt")],
    ["/Users/x/%C3%A1.ts:12", local("absolute", "/Users/x/á.ts", 12)],
    ["/Users/x/a.ts:12:3", local("absolute", "/Users/x/a.ts", 12, 3)],
    ["/Users/x/a.ts#L10", local("absolute", "/Users/x/a.ts", 10)],
    ["/Users/x/a.ts#L10C2", local("absolute", "/Users/x/a.ts", 10, 2)],
    ["/Users/x/a.ts#L10-L20", local("absolute", "/Users/x/a.ts", 10)],
    ["/Users/x/a.ts#readme", local("absolute", "/Users/x/a.ts")],
    ["/Users/x/./src/../a.ts", local("absolute", "/Users/x/a.ts")],
    ["file:///Users/x/a%20b.ts#L10", local("absolute", "/Users/x/a b.ts", 10)],
    ["file://localhost/Users/x/%C5%BEaba.ts", local("absolute", "/Users/x/žaba.ts")],
    ["FILE:///Users/x/a.ts:4:9", local("absolute", "/Users/x/a.ts", 4, 9)],
    ["src/server.ts", local("relative", "src/server.ts")],
    ["./src/server.ts:8", local("relative", "src/server.ts", 8)],
    ["src/nested/../server.ts", local("relative", "src/server.ts")],
    ["100%.txt", local("relative", "100%.txt")],
    ["README:12", local("relative", "README", 12)],
    ["Makefile:3", local("relative", "Makefile", 3)],
    ["prepis.txt:12", local("relative", "prepis.txt", 12)],
    ["server.ts:12:3", local("relative", "server.ts", 12, 3)],
    ["README:12#intro", local("relative", "README", 12)],
    ["src/My%20Proj/a.ts", local("relative", "src/My Proj/a.ts")],
  ])("parses local file link %s", (href, expected) => {
    expect(parseAgentMarkdownLink(href)).toEqual(expected);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>1</script>",
    "vscode://file/Users/x/a.ts",
    "codevo://open",
    "mailto:someone@example.com",
    "javascript:12",
    "JavaScript:12:3",
    "data:12",
    "mailto:12",
    "about:12",
    "blob:12",
    "vbscript:12",
    "README:12abc",
    "README:0",
    "README://12",
    "%20javascript:alert(1)",
    " javascript:alert(1)",
    "\u00a0javascript:alert(1)",
    "%C2%A0javascript:alert(1)",
    "%09javascript:alert(1)",
    "\tjavascript:alert(1)",
    "%E2%80%8Bjavascript:alert(1)",
    "%E3%80%80src/a.ts",
    "%EF%BB%BFsrc/a.ts",
    "src/a.ts%20",
    "javascript%3Aalert(1)",
    "JAVASCRIPT%3aalert(1)",
    "file://remote-host/etc/passwd",
    "file:///Users/x/a.ts?x=1",
    "//evil.example.com/a",
    "#section",
    "",
    "../outside.txt",
    "src/../../outside.txt",
    "/..",
    "/",
    "src/a%00.ts",
    "src\\a.ts",
    "src/a.ts?raw",
  ])("rejects %j", (href) => {
    expect(parseAgentMarkdownLink(href)).toEqual({ kind: "none" });
  });

  it("rejects null and over-long hrefs", () => {
    expect(parseAgentMarkdownLink(null)).toEqual({ kind: "none" });
    const long = `/${"a".repeat(MAX_AGENT_MARKDOWN_LINK_CHARS)}`;
    expect(parseAgentMarkdownLink(long)).toEqual({ kind: "none" });
  });

  it("accepts exactly the parsed links in the sanitizer policy", () => {
    expect(AGENT_MARKDOWN_LINK_POLICY.accepts("/Users/x/a.ts")).toBe(true);
    expect(AGENT_MARKDOWN_LINK_POLICY.accepts("https://example.com")).toBe(true);
    expect(AGENT_MARKDOWN_LINK_POLICY.accepts("javascript:alert(1)")).toBe(false);
    expect(AGENT_MARKDOWN_LINK_POLICY.allowedUriPattern?.test("file:///Users/x/a.ts")).toBe(true);
    expect(AGENT_MARKDOWN_LINK_POLICY.allowedUriPattern?.test("javascript:alert(1)")).toBe(false);
  });

  it.each(["README:12", "Makefile:3", "server.ts:12:3", "README:12#intro"])(
    "keeps the bare file with a line suffix %s through the sanitizer pattern",
    (href) => {
      expect(AGENT_MARKDOWN_LINK_POLICY.allowedUriPattern?.test(href)).toBe(true);
      expect(AGENT_MARKDOWN_LINK_POLICY.accepts(href)).toBe(true);
    },
  );

  it.each(["javascript:12", "data:1", "vbscript:1:2", "README:12abc", "codevo:1/x"])(
    "keeps the sanitizer pattern closed for %s",
    (href) => {
      expect(AGENT_MARKDOWN_LINK_POLICY.allowedUriPattern?.test(href)).toBe(false);
    },
  );

  it("rejects percent-encoded whitespace before a scheme in the sanitizer policy", () => {
    expect(AGENT_MARKDOWN_LINK_POLICY.accepts("%20javascript:alert(1)")).toBe(false);
  });
});

describe("resolveAgentLocalFilePath", () => {
  it("keeps absolute paths and joins relative paths to an absolute base", () => {
    expect(resolveAgentLocalFilePath(localLink("/Users/x/a.ts"), null)).toBe("/Users/x/a.ts");
    expect(resolveAgentLocalFilePath(localLink("src/a.ts"), "/workspace/app/")).toBe(
      "/workspace/app/src/a.ts",
    );
  });

  it("fails closed without an absolute base", () => {
    expect(resolveAgentLocalFilePath(localLink("src/a.ts"), null)).toBeNull();
    expect(resolveAgentLocalFilePath(localLink("src/a.ts"), "workspace/app")).toBeNull();
  });
});
