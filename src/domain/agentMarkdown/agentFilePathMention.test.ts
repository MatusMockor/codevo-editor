import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_PATH_MENTION_SCAN_CHARS,
  agentInlineCodePathMention,
  agentProsePathMentions,
} from "./agentFilePathMention";
import { isAgentFilePathMentionShape } from "./agentFilePathShape";

describe("agentProsePathMentions", () => {
  it("splits workspace-relative paths with optional line and column out of prose", () => {
    expect(agentProsePathMentions("See src/app.ts:12:4 and ./lib/util.js.", 8)).toEqual([
      { kind: "text", text: "See " },
      {
        kind: "path",
        text: "src/app.ts:12:4",
        link: {
          kind: "localFile",
          anchor: "relative",
          location: { path: "src/app.ts", line: 12, column: 4 },
        },
      },
      { kind: "text", text: " and " },
      {
        kind: "path",
        text: "./lib/util.js",
        link: {
          kind: "localFile",
          anchor: "relative",
          location: { path: "lib/util.js", line: null, column: null },
        },
      },
      { kind: "text", text: "." },
    ]);
  });

  it("ignores URLs, absolute paths, parent escapes, bare names and fractions", () => {
    for (const text of [
      "https://example.com/a/b.js",
      "/Users/me/app/src/a.ts",
      "../outside/a.ts",
      "package.json only",
      "ratio 1/2.5 today",
      "a@b.com/x",
      "see github.com/a/b.md for details",
      "docs at example.io/guide/intro.md",
      "upgrade to node_modules/react@18.2.0",
    ]) {
      expect(agentProsePathMentions(text, 8)).toBeNull();
    }
  });

  it("links a home path in prose to the home folder", () => {
    expect(agentProsePathMentions("Edit ~/.coderabbit/auth.json, then rerun.", 8)).toEqual([
      { kind: "text", text: "Edit " },
      {
        kind: "path",
        text: "~/.coderabbit/auth.json",
        link: {
          kind: "localFile",
          anchor: "home",
          location: { path: ".coderabbit/auth.json", line: null, column: null },
        },
      },
      { kind: "text", text: ", then rerun." },
    ]);
  });

  it("bounds the scan and the number of mentions", () => {
    expect(
      agentProsePathMentions(`${"x".repeat(MAX_AGENT_PATH_MENTION_SCAN_CHARS)} a/b.ts`, 8),
    ).toBeNull();
    const many = agentProsePathMentions("a/1.ts b/2.ts c/3.ts", 2);
    expect(many?.filter((segment) => segment.kind === "path")).toHaveLength(2);
    expect(agentProsePathMentions("a/1.ts", 0)).toBeNull();
  });
});

describe("agentInlineCodePathMention", () => {
  it("accepts a whole inline code span that names a file by path or position", () => {
    expect(agentInlineCodePathMention("src/auth.json")).toEqual({
      kind: "localFile",
      anchor: "relative",
      location: { path: "src/auth.json", line: null, column: null },
    });
    expect(agentInlineCodePathMention("src/a.tsx:9")?.location).toEqual({
      path: "src/a.tsx",
      line: 9,
      column: null,
    });
    expect(agentInlineCodePathMention("auth.json:12")).toEqual({
      kind: "localFile",
      anchor: "relative",
      location: { path: "auth.json", line: 12, column: null },
    });
    expect(agentInlineCodePathMention("Makefile:3:7")?.location).toEqual({
      path: "Makefile",
      line: 3,
      column: 7,
    });
  });

  it("does not link a bare file name without a path or position", () => {
    for (const code of ["auth.json", "package.json", "README.md", "ChatView.tsx"]) {
      expect(agentInlineCodePathMention(code)).toBeNull();
    }
  });

  it("links a home path to the home folder instead of the project", () => {
    expect(agentInlineCodePathMention("~/.coderabbit/auth.json")).toEqual({
      kind: "localFile",
      anchor: "home",
      location: { path: ".coderabbit/auth.json", line: null, column: null },
    });
    expect(agentInlineCodePathMention("~/.bashrc:4")?.location).toEqual({
      path: ".bashrc",
      line: 4,
      column: null,
    });
    expect(agentInlineCodePathMention("~/../etc/passwd.txt")).toBeNull();
  });

  it("rejects hosts, versions and numbers that only look like paths", () => {
    for (const code of [
      "github.com/a/b.md",
      "example.io/docs/x.ts",
      "localhost:3000",
      "127.0.0.1:8080",
      "react@18.2.0",
      "node_modules/react@18.2.0",
      "docs/v1.2.3",
      "1.2.3",
      "1.2.3:4",
      "src/build",
    ]) {
      expect(agentInlineCodePathMention(code)).toBeNull();
    }
  });

  it("keeps an explicit relative path even when its folder looks like a host", () => {
    expect(agentInlineCodePathMention("./github.com/a/b.md")?.location.path).toBe(
      "github.com/a/b.md",
    );
  });

  it("links an explicit path to a file without an extension, but not a bare name", () => {
    expect(agentInlineCodePathMention("./Makefile")).toEqual({
      kind: "localFile",
      anchor: "relative",
      location: { path: "Makefile", line: null, column: null },
    });
    expect(agentInlineCodePathMention("~/bin/tool")).toEqual({
      kind: "localFile",
      anchor: "home",
      location: { path: "bin/tool", line: null, column: null },
    });
    expect(agentInlineCodePathMention("./scripts/../Dockerfile")?.location.path).toBe("Dockerfile");
    expect(isAgentFilePathMentionShape("../Dockerfile")).toBe(true);
    expect(agentInlineCodePathMention("../Dockerfile")).toBeNull();
    expect(agentInlineCodePathMention("Makefile")).toBeNull();
    expect(agentInlineCodePathMention("scripts/tool")).toBeNull();
  });

  it("rejects code that only looks dotted", () => {
    for (const code of [
      "console.log",
      "foo.bar()",
      "a.b.c",
      "npm run build",
      "/etc/hosts.conf",
      "src/a b.ts",
      "`src/a.ts`",
    ]) {
      expect(agentInlineCodePathMention(code)).toBeNull();
    }
  });
});

describe("path mention scanning cost", () => {
  it("stays linear on adversarial slash-heavy prose", () => {
    const inputs = [
      "a/".repeat(MAX_AGENT_PATH_MENTION_SCAN_CHARS / 2),
      Array.from({ length: 8 }, () => "a/".repeat(255))
        .join(" ")
        .slice(0, 4_096),
      "x/y.".repeat(MAX_AGENT_PATH_MENTION_SCAN_CHARS / 4),
    ];
    const started = performance.now();
    for (let run = 0; run < 100; run += 1) {
      for (const input of inputs) agentProsePathMentions(input, 24);
    }
    expect(performance.now() - started).toBeLessThan(400);
  });
});
