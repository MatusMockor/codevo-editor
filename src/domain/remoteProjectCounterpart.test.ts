import { describe, expect, it } from "vitest";
import type { DirectoryListing } from "./directoryListing";
import { counterpartFolderPath, localProjectFolderName } from "./remoteProjectCounterpart";

function listing(path: string, names: readonly string[], kind: "directory" | "file" = "directory") {
  const result: DirectoryListing = {
    path,
    parent: null,
    entries: names.map((name) => ({ name, kind, hidden: name.startsWith(".") })),
    truncated: false,
  };
  return result;
}

describe("remote project counterpart folder", () => {
  it("names a local project by the last segment of its absolute root", () => {
    expect(localProjectFolderName("/Users/dev/Developer/playablemaker")).toBe("playablemaker");
    expect(localProjectFolderName("remote:linux:runner:playablemaker")).toBeNull();
    expect(localProjectFolderName("/")).toBeNull();
    expect(localProjectFolderName("relative/path")).toBeNull();
  });

  it("matches only an exact directory entry of the listed server root", () => {
    const root = listing("/home/codex/Developer", ["pa-ai-be", "playablemaker"]);
    expect(counterpartFolderPath(root, "playablemaker")).toBe(
      "/home/codex/Developer/playablemaker",
    );
    expect(counterpartFolderPath(root, "PlayableMaker")).toBeNull();
    expect(counterpartFolderPath(root, "playable")).toBeNull();
    expect(
      counterpartFolderPath(listing("/srv", ["playablemaker"], "file"), "playablemaker"),
    ).toBeNull();
    expect(counterpartFolderPath(listing("/", ["playablemaker"]), "playablemaker")).toBe(
      "/playablemaker",
    );
  });
});
