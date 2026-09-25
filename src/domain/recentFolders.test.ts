import { describe, expect, it } from "vitest";
import { recentFolderAge, recentFolderEntries } from "./recentFolders";

describe("recent folders", () => {
  it("lists recent folders that are not open, newest first, at most five", () => {
    const entries = recentFolderEntries({
      recentPaths: [
        "/code/a",
        "/code/open",
        "/code/b/",
        "/code/c",
        "/code/d",
        "/code/e",
        "/code/f",
      ],
      openedAt: { "/code/a": 5, "/code/b": 4 },
      excludeRoots: ["/code/open/"],
    });
    expect(entries.map((entry) => entry.path)).toEqual([
      "/code/a",
      "/code/b/",
      "/code/c",
      "/code/d",
      "/code/e",
    ]);
    expect(entries[1]).toEqual({ path: "/code/b/", label: "b", openedAtMs: 4 });
    expect(entries[2].openedAtMs).toBeNull();
  });

  it("formats compact ages like the sidebar", () => {
    const now = 10 * 7 * 24 * 3_600_000;
    expect(recentFolderAge(null, now)).toBeNull();
    expect(recentFolderAge(now - 30_000, now)).toBe("now");
    expect(recentFolderAge(now - 4 * 60_000, now)).toBe("4m");
    expect(recentFolderAge(now - 2 * 3_600_000, now)).toBe("2h");
    expect(recentFolderAge(now - 3 * 24 * 3_600_000, now)).toBe("3d");
    expect(recentFolderAge(now - 5 * 7 * 24 * 3_600_000, now)).toBe("5w");
    expect(recentFolderAge(now + 60_000, now)).toBe("now");
  });
});
