import { describe, expect, it } from "vitest";
import { canExpandPhpFileEntry, emptyPhpFileOutline } from "./phpFileOutline";
import type { FileEntry } from "./workspace";

describe("phpFileOutline", () => {
  it("creates an empty outline", () => {
    expect(emptyPhpFileOutline()).toEqual({ nodes: [] });
  });

  it("allows only PHP files to expand into outlines", () => {
    expect(canExpandPhpFileEntry(file("User.php"))).toBe(true);
    expect(canExpandPhpFileEntry(file("User.PHP"))).toBe(true);
    expect(canExpandPhpFileEntry(file("User.ts"))).toBe(false);
    expect(
      canExpandPhpFileEntry({
        kind: "directory",
        name: "src.php",
        path: "/workspace/src.php",
      }),
    ).toBe(false);
  });
});

function file(name: string): FileEntry {
  return {
    kind: "file",
    name,
    path: `/workspace/${name}`,
  };
}
