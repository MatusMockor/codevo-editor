import { describe, expect, it } from "vitest";
import {
  pushRecentFile,
  recentFilesForSwitcher,
  removeRecentFile,
  renameRecentFile,
  RECENT_FILES_LIMIT,
  type RecentFileEntry,
} from "./recentFiles";

function entry(path: string): RecentFileEntry {
  const name = path.split("/").pop() ?? path;
  return { name, path };
}

describe("pushRecentFile", () => {
  it("places the newest file at the head", () => {
    const list = pushRecentFile(
      pushRecentFile([], entry("/a.ts")),
      entry("/b.ts"),
    );

    expect(list.map((item) => item.path)).toEqual(["/b.ts", "/a.ts"]);
  });

  it("moves an already-present file to the head instead of duplicating it", () => {
    let list: RecentFileEntry[] = [];
    list = pushRecentFile(list, entry("/a.ts"));
    list = pushRecentFile(list, entry("/b.ts"));
    list = pushRecentFile(list, entry("/c.ts"));
    list = pushRecentFile(list, entry("/a.ts"));

    expect(list.map((item) => item.path)).toEqual(["/a.ts", "/c.ts", "/b.ts"]);
  });

  it("bounds the list to the configured limit, dropping the oldest entries", () => {
    let list: RecentFileEntry[] = [];

    for (let index = 0; index < RECENT_FILES_LIMIT + 10; index += 1) {
      list = pushRecentFile(list, entry(`/file-${index}.ts`));
    }

    expect(list).toHaveLength(RECENT_FILES_LIMIT);
    expect(list[0]?.path).toBe(`/file-${RECENT_FILES_LIMIT + 9}.ts`);
    expect(list[list.length - 1]?.path).toBe("/file-10.ts");
  });

  it("respects a custom limit", () => {
    let list: RecentFileEntry[] = [];
    list = pushRecentFile(list, entry("/a.ts"), 2);
    list = pushRecentFile(list, entry("/b.ts"), 2);
    list = pushRecentFile(list, entry("/c.ts"), 2);

    expect(list.map((item) => item.path)).toEqual(["/c.ts", "/b.ts"]);
  });

  it("does not mutate the input list", () => {
    const original = [entry("/a.ts")];
    pushRecentFile(original, entry("/b.ts"));

    expect(original.map((item) => item.path)).toEqual(["/a.ts"]);
  });
});

describe("removeRecentFile", () => {
  it("drops the entry matching the path", () => {
    const list = [entry("/a.ts"), entry("/b.ts"), entry("/c.ts")];

    expect(removeRecentFile(list, "/b.ts").map((item) => item.path)).toEqual([
      "/a.ts",
      "/c.ts",
    ]);
  });

  it("returns an equivalent list when the path is absent", () => {
    const list = [entry("/a.ts"), entry("/b.ts")];

    expect(removeRecentFile(list, "/missing.ts").map((item) => item.path)).toEqual(
      ["/a.ts", "/b.ts"],
    );
  });

  it("does not mutate the input list", () => {
    const original = [entry("/a.ts"), entry("/b.ts")];
    removeRecentFile(original, "/a.ts");

    expect(original.map((item) => item.path)).toEqual(["/a.ts", "/b.ts"]);
  });
});

describe("renameRecentFile", () => {
  it("remaps the old path to the new path and name, preserving position", () => {
    const list = [entry("/a.ts"), entry("/old.ts"), entry("/c.ts")];

    const result = renameRecentFile(list, "/old.ts", {
      name: "new.ts",
      path: "/new.ts",
    });

    expect(result.map((item) => item.path)).toEqual(["/a.ts", "/new.ts", "/c.ts"]);
    expect(result[1]).toEqual({ name: "new.ts", path: "/new.ts" });
  });

  it("leaves the list unchanged when the old path is absent", () => {
    const list = [entry("/a.ts"), entry("/b.ts")];

    const result = renameRecentFile(list, "/missing.ts", {
      name: "new.ts",
      path: "/new.ts",
    });

    expect(result.map((item) => item.path)).toEqual(["/a.ts", "/b.ts"]);
  });

  it("de-duplicates when the new path already exists after, keeping the renamed position", () => {
    const list = [entry("/a.ts"), entry("/old.ts"), entry("/new.ts")];

    const result = renameRecentFile(list, "/old.ts", {
      name: "new.ts",
      path: "/new.ts",
    });

    expect(result.map((item) => item.path)).toEqual(["/a.ts", "/new.ts"]);
  });

  it("keeps the remapped entry (name and slot) when the new path already exists before", () => {
    const list = [
      { name: "stale.ts", path: "/new.ts" },
      entry("/a.ts"),
      entry("/old.ts"),
    ];

    const result = renameRecentFile(list, "/old.ts", {
      name: "fresh.ts",
      path: "/new.ts",
    });

    expect(result.map((item) => item.path)).toEqual(["/a.ts", "/new.ts"]);
    expect(result[1]).toEqual({ name: "fresh.ts", path: "/new.ts" });
  });

  it("does not mutate the input list", () => {
    const original = [entry("/old.ts")];
    renameRecentFile(original, "/old.ts", { name: "new.ts", path: "/new.ts" });

    expect(original.map((item) => item.path)).toEqual(["/old.ts"]);
  });
});

describe("recentFilesForSwitcher", () => {
  it("drops the active file so the previous file leads the switcher", () => {
    const list = [entry("/c.ts"), entry("/b.ts"), entry("/a.ts")];

    expect(
      recentFilesForSwitcher(list, "/c.ts").map((item) => item.path),
    ).toEqual(["/b.ts", "/a.ts"]);
  });

  it("keeps the only recent file when it is also the active file", () => {
    const list = [entry("/a.ts")];

    expect(
      recentFilesForSwitcher(list, "/a.ts").map((item) => item.path),
    ).toEqual(["/a.ts"]);
  });

  it("returns every recent file when there is no active file", () => {
    const list = [entry("/b.ts"), entry("/a.ts")];

    expect(recentFilesForSwitcher(list, null).map((item) => item.path)).toEqual(
      ["/b.ts", "/a.ts"],
    );
  });
});
