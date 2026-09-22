import { describe, expect, it } from "vitest";
import { buildAgentTurnDiffTree } from "./agentTurnDiffTree";
import type { AgentTurnChangedFile } from "./agentTurnChanges";
const file = (
  relativePath: string,
  addedLines: number | null = 2,
  deletedLines: number | null = 1,
): AgentTurnChangedFile => ({
  relativePath,
  oldRelativePath: null,
  status: "modified",
  addedLines,
  deletedLines,
});
describe("per-turn diff tree", () => {
  it("compacts single-child directory chains and aggregates descendants without changing totals", () => {
    const tree = buildAgentTurnDiffTree([
      file("src/a/b/two.ts", 4, 3),
      file("README.md", 1, 0),
      file("src/a/b/one.ts", 3, 1),
    ]);
    expect(tree.stats).toEqual({ addedLines: 8, deletedLines: 4, unknownFiles: 0, fileCount: 3 });
    expect(tree.nodes.map((node) => node.name)).toEqual(["src/a/b", "README.md"]);
    const folder = tree.nodes[0];
    expect(folder.kind).toBe("directory");
    if (folder.kind !== "directory") throw new Error("Expected directory");
    expect(folder.stats.addedLines).toBe(7);
    expect(folder.children.map((node) => node.name)).toEqual(["one.ts", "two.ts"]);
  });
  it("does not fabricate line counts for binary or unavailable entries", () => {
    const binary = buildAgentTurnDiffTree([file("image.png", null, null)]);
    expect(binary.stats).toEqual({
      addedLines: null,
      deletedLines: null,
      unknownFiles: 1,
      fileCount: 1,
    });
    const mixed = buildAgentTurnDiffTree([file("image.png", null, null), file("text.ts", 0, 2)]);
    expect(mixed.stats).toEqual({ addedLines: 0, deletedLines: 2, unknownFiles: 1, fileCount: 2 });
  });
  it("bounds files and depth and exposes omitted paths as a partial projection", () => {
    const many = buildAgentTurnDiffTree(Array.from({ length: 501 }, (_, i) => file(`f${i}.ts`)));
    expect(many.stats.fileCount).toBe(500);
    expect(many.truncated).toBe(true);
    const invalid = buildAgentTurnDiffTree([
      file("../escape"),
      file("/absolute"),
      file("C:/absolute"),
      file("a/".repeat(64) + "file"),
      file("valid.ts"),
    ]);
    expect(invalid.stats.fileCount).toBe(1);
    expect(invalid.truncated).toBe(true);
  });
  it("normalizes separators for grouping but preserves exact original path for diff requests", () => {
    const original = file("src\\nested\\file.ts");
    const tree = buildAgentTurnDiffTree([original, file("src/nested/file.ts")]);
    expect(tree.stats.fileCount).toBe(1);
    expect(tree.truncated).toBe(true);
    const folder = tree.nodes[0];
    if (folder.kind !== "directory") throw new Error("Expected directory");
    const leaf = folder.children[0];
    expect(leaf.kind === "file" && leaf.file.relativePath).toBe(original.relativePath);
  });
});
