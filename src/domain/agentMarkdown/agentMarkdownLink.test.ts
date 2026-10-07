import { describe, expect, it } from "vitest";
import {
  AGENT_MARKDOWN_LINK_POLICY,
  MAX_AGENT_MARKDOWN_LINK_CHARS,
  parseAgentMarkdownImageSource,
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

describe("parseAgentMarkdownImageSource", () => {
  it("classifies external, local and file URL image sources like links", () => {
    expect(parseAgentMarkdownImageSource("https://e.com/x.png")).toEqual({
      kind: "external",
      url: "https://e.com/x.png",
    });
    expect(parseAgentMarkdownImageSource("shots/a%20b.png")).toEqual(
      local("relative", "shots/a b.png"),
    );
    expect(parseAgentMarkdownImageSource("/tmp/x.png")).toEqual(local("absolute", "/tmp/x.png"));
    expect(parseAgentMarkdownImageSource("file:///tmp/x.png")).toEqual(
      local("absolute", "/tmp/x.png"),
    );
    expect(parseAgentMarkdownImageSource("~backup.png")).toEqual(local("relative", "~backup.png"));
    expect(parseAgentMarkdownImageSource("/tmp/~/x.png")).toEqual(
      local("absolute", "/tmp/~/x.png"),
    );
  });

  it.each([
    null,
    "",
    "~/x.png",
    "~other/x.png",
    "%7E/x.png",
    "data:image/png;base64,AAAA",
    "blob:https://e.com/0a1b",
    "asset://localhost/x.png",
    "javascript:alert(1)",
    "//host/x.png",
    "file://remote.host/x.png",
    "../x.png",
    "a/\u0007.png",
  ])("rejects the image source %s", (source) => {
    expect(parseAgentMarkdownImageSource(source)).toEqual({ kind: "none" });
  });

  it.each([
    ["a right-to-left override", "/tmp/\u202egnp.ssapwd.png"],
    ["an encoded right-to-left override", "/tmp/%E2%80%AEgnp.ssapwd.png"],
    ["a left-to-right embedding", "shots/\u202ax.png"],
    ["an isolate", "shots/\u2066x\u2069.png"],
    ["a left-to-right mark", "shots/x\u200e.png"],
    ["a right-to-left mark", "shots/x\u200f.png"],
    ["a zero width no-break space", "shots/\ufeffx.png"],
    ["a zero width joiner", "shots/x\u200d.png"],
    ["a soft hyphen in a file URL", "file:///tmp/x\u00ad.png"],
    ["a format character in an external URL", "https://e.com/\u202ex.png"],
  ])("refuses an image source with %s", (_label, source) => {
    expect(parseAgentMarkdownImageSource(source)).toEqual({ kind: "none" });
    expect(AGENT_MARKDOWN_LINK_POLICY.acceptsImage(source)).toBe(false);
  });

  it("keeps a format character a link concern only, never an image one", () => {
    expect(parseAgentMarkdownLink("/tmp/%E2%80%AEgnp.txt").kind).toBe("localFile");
    expect(parseAgentMarkdownLink("https://e.com/\u202ex").kind).toBe("external");
  });

  it.each([
    "shots/x.png:12",
    "shots/x.png:12:3",
    "/tmp/x.png:7",
    "shots/x.png#L12",
    "shots/x.png#L12C3",
    "shots/x.png#intro",
    "shots/x.png#",
    "file:///tmp/x.png#L3",
    "file:///tmp/x.png#intro",
    "shots/x.png?raw=1",
    "file:///tmp/x.png?raw=1",
    "shots/x.png%3Fraw=1",
  ])("refuses the image source %s instead of reading the file without its suffix", (source) => {
    expect(parseAgentMarkdownImageSource(source)).toEqual({ kind: "none" });
  });

  it("still reads a line suffix and a fragment as a position for links", () => {
    expect(parseAgentMarkdownLink("shots/x.png:12")).toEqual({
      kind: "localFile",
      anchor: "relative",
      location: { path: "shots/x.png", line: 12, column: null },
    });
    expect(parseAgentMarkdownLink("shots/x.png#intro")).toEqual(local("relative", "shots/x.png"));
  });

  it.each([
    "%66ile:///tmp/x.png",
    "%2566ile:///tmp/x.png",
    "%68ttps://e.com/x.png",
    "%2568ttps://e.com/x.png",
    "%256aavascript:x.png",
    "%6aavascript:x.png",
    "codevo:shots/x.png",
    "shots:old/x.png",
  ])("never turns the encoded or scheme-like source %s into a local image", (source) => {
    expect(parseAgentMarkdownImageSource(source)).toEqual({ kind: "none" });
  });

  it("decodes a source exactly once, so an encoded percent sign names a literal file", () => {
    expect(parseAgentMarkdownImageSource("My%2520Image.png")).toEqual(
      local("relative", "My%20Image.png"),
    );
    expect(parseAgentMarkdownImageSource("My%20Image.png")).toEqual(
      local("relative", "My Image.png"),
    );
    expect(parseAgentMarkdownImageSource("50%25faster.png")).toEqual(
      local("relative", "50%faster.png"),
    );
    expect(parseAgentMarkdownImageSource("50%faster.png")).toEqual(
      local("relative", "50%faster.png"),
    );
    expect(parseAgentMarkdownImageSource("file%253A///tmp/x.png")).toEqual(
      local("relative", "file%3A/tmp/x.png"),
    );
    expect(parseAgentMarkdownImageSource("shots/old:new.png")).toEqual(
      local("relative", "shots/old:new.png"),
    );
  });

  it("keeps an asset.localhost URL an external link instead of a local image", () => {
    expect(parseAgentMarkdownImageSource("http://asset.localhost/x.png")).toEqual({
      kind: "external",
      url: "http://asset.localhost/x.png",
    });
    expect(parseAgentMarkdownImageSource("shots/a%23b.png")).toEqual(
      local("relative", "shots/a#b.png"),
    );
  });

  it("keeps a home-relative path a link target while refusing it as an image source", () => {
    expect(parseAgentMarkdownLink("~/x.png")).toEqual(local("relative", "~/x.png"));
    expect(AGENT_MARKDOWN_LINK_POLICY.accepts("~/x.png")).toBe(true);
    expect(AGENT_MARKDOWN_LINK_POLICY.acceptsImage("~/x.png")).toBe(false);
  });

  it("accepts exactly the parsed image sources in the sanitizer policy", () => {
    for (const source of ["rel/x.png", "/abs/x.png", "file:///abs/x.png", "https://e.com/x.png"]) {
      expect(AGENT_MARKDOWN_LINK_POLICY.allowedUriPattern?.test(source)).toBe(true);
      expect(AGENT_MARKDOWN_LINK_POLICY.acceptsImage(source)).toBe(true);
    }
    for (const source of ["data:image/png;base64,AAAA", "blob:x", "asset://localhost/x.png"]) {
      expect(AGENT_MARKDOWN_LINK_POLICY.acceptsImage(source)).toBe(false);
    }
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
