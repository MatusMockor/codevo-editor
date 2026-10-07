import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_INLINE_IMAGES_PER_MESSAGE,
  MAX_AGENT_INLINE_IMAGE_BYTES,
  MAX_AGENT_INLINE_IMAGE_PATH_BYTES,
  resolveAgentInlineImageTarget,
} from "./agentInlineImage";
import { parseAgentMarkdownImageSource } from "./agentMarkdownLink";

const BASE = "/workspace/app";

function target(source: string, base: string | null = BASE) {
  return resolveAgentInlineImageTarget(parseAgentMarkdownImageSource(source), base);
}

describe("resolveAgentInlineImageTarget", () => {
  it("pins the inline image budgets", () => {
    expect(MAX_AGENT_INLINE_IMAGES_PER_MESSAGE).toBe(16);
    expect(MAX_AGENT_INLINE_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_AGENT_INLINE_IMAGE_PATH_BYTES).toBe(4096);
  });

  it("resolves a relative source against the base directory", () => {
    expect(target("shots/x.png")).toEqual({ kind: "local", path: "/workspace/app/shots/x.png" });
    expect(target("shots/x.png", "/workspace/app/")).toEqual({
      kind: "local",
      path: "/workspace/app/shots/x.png",
    });
  });

  it("leaves a relative source unresolved without an absolute base", () => {
    expect(target("shots/x.png", null)).toEqual({ kind: "unresolved" });
    expect(target("shots/x.png", "workspace/app")).toEqual({ kind: "unresolved" });
  });

  it("normalises traversal inside the source and refuses a source that escapes it", () => {
    expect(target("a/b/../../shots/./x.png")).toEqual({
      kind: "local",
      path: "/workspace/app/shots/x.png",
    });
    expect(target("/tmp/a/../x.png", null)).toEqual({ kind: "local", path: "/tmp/x.png" });
    expect(target("../x.png")).toEqual({ kind: "none" });
    expect(target("/../x.png")).toEqual({ kind: "none" });
  });

  it("keeps an absolute path and a local file URL independent of the base", () => {
    expect(target("/tmp/shots/x.png", null)).toEqual({ kind: "local", path: "/tmp/shots/x.png" });
    expect(target("file:///tmp/shots/a%20b.jpeg", null)).toEqual({
      kind: "local",
      path: "/tmp/shots/a b.jpeg",
    });
  });

  it.each(["x.png", "x.jpg", "x.jpeg", "x.gif", "x.webp", "x.PNG", "x.JpEg", "x.WEBP"])(
    "accepts the supported extension of %s",
    (name) => {
      expect(target(name)).toEqual({ kind: "local", path: `${BASE}/${name}` });
    },
  );

  it.each(["x.svg", "x.bmp", "x.html", "x.png.txt", "x", "png", ".png", "shots/.webp"])(
    "reports the local file %s as unsupported",
    (name) => {
      expect(target(name)).toEqual({ kind: "unsupported" });
    },
  );

  it("reports a path beyond the wire byte limit as unsupported", () => {
    const beyond = `/${"ž".repeat(2_046)}.png`;
    expect(new TextEncoder().encode(beyond).byteLength).toBe(MAX_AGENT_INLINE_IMAGE_PATH_BYTES + 1);
    expect(target(beyond, null)).toEqual({ kind: "unsupported" });
    const fitting = `/${"a".repeat(MAX_AGENT_INLINE_IMAGE_PATH_BYTES - 5)}.png`;
    expect(target(fitting, null)).toEqual({ kind: "local", path: fitting });
  });

  it("passes an external source through for the text link", () => {
    expect(target("https://e.com/x.png")).toEqual({ kind: "external", url: "https://e.com/x.png" });
    expect(target("https://e.com/page")).toEqual({ kind: "external", url: "https://e.com/page" });
  });

  it("never makes a webview asset URL or a double-encoded scheme a local image", () => {
    expect(target("http://asset.localhost/x.png")).toEqual({
      kind: "external",
      url: "http://asset.localhost/x.png",
    });
    for (const source of [
      "%2566ile:///tmp/x.png",
      "%256aavascript:x.png",
      "x.png:12",
      "x.png#L3",
    ]) {
      expect(target(source)).toEqual({ kind: "none" });
    }
    expect(target("file%253A///tmp/x.png")).toEqual({
      kind: "local",
      path: `${BASE}/file%3A/tmp/x.png`,
    });
    expect(target("My%2520Image.png")).toEqual({ kind: "local", path: `${BASE}/My%20Image.png` });
  });

  it.each([
    "data:image/png;base64,AAAA",
    "blob:x",
    "asset://localhost/x.png",
    "~/x.png",
    "",
    "/tmp/\u202egnp.ssapwd.png",
  ])("has no target for the rejected source %s", (source) => {
    expect(target(source)).toEqual({ kind: "none" });
  });
});
