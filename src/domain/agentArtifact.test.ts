import { describe, expect, it } from "vitest";
import { extractAgentArtifactReferences, parseAgentArtifactPath } from "./agentArtifact";

describe("artifact references", () => {
  it("extracts provider-neutral links, escaped spaces and absolute paths once", () => {
    expect(
      extractAgentArtifactReferences(
        "[Design](</repo/my design.html>) ![Image](./a.png) [Again](./a.png) [Photo](my\\ photo.webp)",
      ),
    ).toEqual([
      { path: "/repo/my design.html", label: "Design" },
      { path: "a.png", label: "Image" },
      { path: "my photo.webp", label: "Photo" },
    ]);
  });
  it.each([
    "https://a/a.png",
    "data:image/png,a.png",
    "file:/a.png",
    "//host/a.png",
    ".//preview.png",
    "/.//preview.png",
    "../a.png",
    "%2e%2e/a.png",
    "a/%00.png",
    "a.svg",
    "a.png?x",
    "a.png#x",
    "a\\b.png",
    "%zz.png",
  ])("rejects unsupported path %s", (path) => expect(parseAgentArtifactPath(path)).toBeNull());
  it("normalizes current-directory references before native resolution", () => {
    expect(parseAgentArtifactPath("./design/./preview.html")).toBe("design/preview.html");
    expect(extractAgentArtifactReferences("[A](./preview.png) [B](preview.png)")).toEqual([
      { path: "preview.png", label: "A" },
    ]);
  });
  it("does not extract examples from code or bare tool-like paths", () => {
    expect(
      extractAgentArtifactReferences("`[a](a.png)`\n```\n[b](b.html)\n```\n/tmp/c.png"),
    ).toEqual([]);
  });
  it("bounds input and references", () => {
    expect(extractAgentArtifactReferences("a".repeat(256 * 1024 + 1))).toEqual([]);
    expect(
      extractAgentArtifactReferences(
        Array.from({ length: 40 }, (_, i) => `[a](${i}.png)`).join(" "),
      ),
    ).toHaveLength(32);
  });
  it("rejects malformed backslash-heavy markdown without ambiguous backtracking", () => {
    expect(extractAgentArtifactReferences("[x](" + "\\".repeat(60) + " ")).toEqual([]);
  });
});
