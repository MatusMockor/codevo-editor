import { describe, expect, it } from "vitest";
import {
  FILE_VIEWER_LINE_HEIGHT_PX,
  directoriesToReveal,
  estimatedBlockHeight,
  fileViewerBlockCount,
  fileViewerCrumbs,
  fileViewerWindow,
  formatFileSize,
  relativePathInTree,
  relativePathWithin,
  truncatedPreviewNote,
} from "./fileViewerModel";

describe("file viewer paths", () => {
  it("accepts only normalized paths strictly inside the root", () => {
    expect(relativePathWithin("/repo", "/repo/src/app.ts")).toBe("src/app.ts");
    expect(relativePathWithin("/repo/", "/repo/a.ts")).toBe("a.ts");
    expect(relativePathWithin("/repo", "/repo2/a.ts")).toBeNull();
    expect(relativePathWithin("/repo", "/repo")).toBeNull();
    expect(relativePathWithin("/repo", "/repo/src/../../etc/passwd")).toBeNull();
    expect(relativePathWithin("/repo", "/repo/src//a.ts")).toBeNull();
  });

  it("builds breadcrumbs whose folders point back into the tree", () => {
    expect(fileViewerCrumbs("/work/repo", "src/lib/a.ts")).toEqual([
      { label: "repo", directory: "/work/repo" },
      { label: "src", directory: "/work/repo/src" },
      { label: "lib", directory: "/work/repo/src/lib" },
      { label: "a.ts", directory: null },
    ]);
    expect(directoriesToReveal("/work/repo", "/work/repo/src/lib")).toEqual([
      "/work/repo/src",
      "/work/repo/src/lib",
    ]);
    expect(directoriesToReveal("/work/repo", "/elsewhere")).toEqual([]);
  });
});

describe("file viewer worktree mapping", () => {
  const checkout = { projectRoot: "/repo", checkoutRoot: "/repo/.worktrees/t1" };

  it("maps a main project path onto the same relative path in the thread checkout", () => {
    expect(relativePathInTree("/repo/.worktrees/t1", "/repo/src/a.ts", checkout)).toBe("src/a.ts");
    expect(relativePathInTree("/repo/.worktrees/t1/", "/repo/src/a.ts", checkout)).toBe("src/a.ts");
    expect(relativePathInTree("/repo/.worktrees/t1", "/repo/.worktrees/t1/b.ts", checkout)).toBe(
      "b.ts",
    );
  });

  it("does not map outside the project, without a checkout or onto another tree root", () => {
    expect(relativePathInTree("/repo/.worktrees/t1", "/other/a.ts", checkout)).toBeNull();
    expect(relativePathInTree("/repo/.worktrees/t1", "/repo/../etc/a.ts", checkout)).toBeNull();
    expect(relativePathInTree("/repo/.worktrees/t1", "/repo/src/a.ts", null)).toBeNull();
    expect(relativePathInTree("/elsewhere", "/repo/src/a.ts", checkout)).toBeNull();
  });
});

describe("file viewer window", () => {
  it("covers the viewport plus one block of overscan on each side", () => {
    const lines = 20_000;
    const heights = Array.from({ length: fileViewerBlockCount(lines) }, (_unused, block) =>
      estimatedBlockHeight(block, lines),
    );
    const total = heights.reduce((sum, height) => sum + height, 0);
    expect(total).toBe(lines * FILE_VIEWER_LINE_HEIGHT_PX);

    const top = fileViewerWindow({ heights, scrollTop: 0, viewportHeight: 600 });
    expect(top).toMatchObject({ firstBlock: 0, lastBlock: 1, before: 0 });

    const middle = fileViewerWindow({ heights, scrollTop: 200_000, viewportHeight: 600 });
    expect(middle.firstBlock).toBe(155);
    expect(middle.lastBlock).toBe(157);
    expect(middle.before + middle.after + 3 * (heights[0] ?? 0)).toBe(total);

    const end = fileViewerWindow({ heights, scrollTop: total * 2, viewportHeight: 600 });
    expect(end.lastBlock).toBe(heights.length - 1);
    expect(end.after).toBe(0);
  });
});

describe("file viewer sizes", () => {
  it("formats sizes for the truncation banner", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(truncatedPreviewNote(5 * 1024 * 1024)).toBe(
      "Preview limited to the first 1 MB of a 5 MB file.",
    );
  });
});
