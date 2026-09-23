import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_PATH_MENTION_SCAN_CHARS,
  agentInlineCodePathMention,
  agentProsePathMentions,
} from "./agentFilePathMention";

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
    ]) {
      expect(agentProsePathMentions(text, 8)).toBeNull();
    }
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
  it("accepts a whole inline code span that names a source file", () => {
    expect(agentInlineCodePathMention("package.json")?.location.path).toBe("package.json");
    expect(agentInlineCodePathMention("src/a.tsx:9")?.location).toEqual({
      path: "src/a.tsx",
      line: 9,
      column: null,
    });
  });

  it("rejects code that only looks dotted", () => {
    for (const code of ["console.log", "foo.bar()", "a.b.c", "npm run build", "/etc/hosts.conf"]) {
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
