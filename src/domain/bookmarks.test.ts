import { describe, expect, it } from "vitest";
import {
  type Bookmark,
  hasBookmark,
  nextBookmark,
  previousBookmark,
  removeBookmarksForPath,
  renameBookmarksForPath,
  sortBookmarks,
  toggleBookmark,
} from "./bookmarks";

function bookmark(path: string, lineNumber: number, preview = ""): Bookmark {
  return { lineNumber, path, preview };
}

describe("toggleBookmark", () => {
  it("adds a bookmark when none exists for the path+line", () => {
    const list = toggleBookmark([], bookmark("/a.ts", 5, "line five"));

    expect(list).toEqual([bookmark("/a.ts", 5, "line five")]);
  });

  it("removes an existing bookmark on the same path+line (toggle off)", () => {
    const initial = toggleBookmark([], bookmark("/a.ts", 5));
    const toggled = toggleBookmark(initial, bookmark("/a.ts", 5, "ignored"));

    expect(toggled).toEqual([]);
  });

  it("keeps bookmarks on the same path but different lines distinct", () => {
    let list: Bookmark[] = [];
    list = toggleBookmark(list, bookmark("/a.ts", 5));
    list = toggleBookmark(list, bookmark("/a.ts", 9));

    expect(list.map((entry) => entry.lineNumber)).toEqual([5, 9]);
  });

  it("keeps bookmarks on the same line but different paths distinct", () => {
    let list: Bookmark[] = [];
    list = toggleBookmark(list, bookmark("/a.ts", 5));
    list = toggleBookmark(list, bookmark("/b.ts", 5));

    expect(list.map((entry) => entry.path)).toEqual(["/a.ts", "/b.ts"]);
  });

  it("does not mutate the input list", () => {
    const original = [bookmark("/a.ts", 5)];
    toggleBookmark(original, bookmark("/a.ts", 9));

    expect(original).toEqual([bookmark("/a.ts", 5)]);
  });
});

describe("hasBookmark", () => {
  it("reports whether a path+line is bookmarked", () => {
    const list = [bookmark("/a.ts", 5)];

    expect(hasBookmark(list, "/a.ts", 5)).toBe(true);
    expect(hasBookmark(list, "/a.ts", 6)).toBe(false);
    expect(hasBookmark(list, "/b.ts", 5)).toBe(false);
  });
});

describe("removeBookmarksForPath", () => {
  it("drops every bookmark for a deleted file and leaves others intact", () => {
    const list = [
      bookmark("/a.ts", 5),
      bookmark("/a.ts", 9),
      bookmark("/b.ts", 1),
    ];

    expect(removeBookmarksForPath(list, "/a.ts")).toEqual([
      bookmark("/b.ts", 1),
    ]);
  });

  it("is a no-op for a path with no bookmarks", () => {
    const list = [bookmark("/a.ts", 5)];

    expect(removeBookmarksForPath(list, "/missing.ts")).toEqual(list);
  });
});

describe("renameBookmarksForPath", () => {
  it("re-points every bookmark from the old path to the new path", () => {
    const list = [
      bookmark("/old.ts", 5, "five"),
      bookmark("/old.ts", 9, "nine"),
      bookmark("/other.ts", 1, "one"),
    ];

    expect(renameBookmarksForPath(list, "/old.ts", "/new.ts")).toEqual([
      bookmark("/new.ts", 5, "five"),
      bookmark("/new.ts", 9, "nine"),
      bookmark("/other.ts", 1, "one"),
    ]);
  });
});

describe("sortBookmarks", () => {
  it("orders by path then ascending line number", () => {
    const list = [
      bookmark("/b.ts", 2),
      bookmark("/a.ts", 9),
      bookmark("/a.ts", 1),
    ];

    expect(sortBookmarks(list)).toEqual([
      bookmark("/a.ts", 1),
      bookmark("/a.ts", 9),
      bookmark("/b.ts", 2),
    ]);
  });
});

describe("nextBookmark", () => {
  it("returns the first bookmark when there is no current position", () => {
    const list = [bookmark("/a.ts", 5), bookmark("/b.ts", 1)];

    expect(nextBookmark(list, null)).toEqual(bookmark("/a.ts", 5));
  });

  it("advances to the next bookmark in sorted order across files", () => {
    const list = [
      bookmark("/a.ts", 5),
      bookmark("/a.ts", 9),
      bookmark("/b.ts", 1),
    ];

    expect(nextBookmark(list, { lineNumber: 5, path: "/a.ts" })).toEqual(
      bookmark("/a.ts", 9),
    );
    expect(nextBookmark(list, { lineNumber: 9, path: "/a.ts" })).toEqual(
      bookmark("/b.ts", 1),
    );
  });

  it("wraps around to the first bookmark after the last one", () => {
    const list = [bookmark("/a.ts", 5), bookmark("/b.ts", 1)];

    expect(nextBookmark(list, { lineNumber: 1, path: "/b.ts" })).toEqual(
      bookmark("/a.ts", 5),
    );
  });

  it("advances from a position that is not itself a bookmark", () => {
    const list = [bookmark("/a.ts", 5), bookmark("/a.ts", 20)];

    expect(nextBookmark(list, { lineNumber: 10, path: "/a.ts" })).toEqual(
      bookmark("/a.ts", 20),
    );
  });

  it("returns null for an empty list", () => {
    expect(nextBookmark([], { lineNumber: 1, path: "/a.ts" })).toBeNull();
  });
});

describe("previousBookmark", () => {
  it("returns the last bookmark when there is no current position", () => {
    const list = [bookmark("/a.ts", 5), bookmark("/b.ts", 1)];

    expect(previousBookmark(list, null)).toEqual(bookmark("/b.ts", 1));
  });

  it("steps back to the previous bookmark in sorted order across files", () => {
    const list = [
      bookmark("/a.ts", 5),
      bookmark("/a.ts", 9),
      bookmark("/b.ts", 1),
    ];

    expect(previousBookmark(list, { lineNumber: 1, path: "/b.ts" })).toEqual(
      bookmark("/a.ts", 9),
    );
    expect(previousBookmark(list, { lineNumber: 9, path: "/a.ts" })).toEqual(
      bookmark("/a.ts", 5),
    );
  });

  it("wraps around to the last bookmark before the first one", () => {
    const list = [bookmark("/a.ts", 5), bookmark("/b.ts", 1)];

    expect(previousBookmark(list, { lineNumber: 5, path: "/a.ts" })).toEqual(
      bookmark("/b.ts", 1),
    );
  });

  it("steps back from a position that is not itself a bookmark", () => {
    const list = [bookmark("/a.ts", 5), bookmark("/a.ts", 20)];

    expect(previousBookmark(list, { lineNumber: 10, path: "/a.ts" })).toEqual(
      bookmark("/a.ts", 5),
    );
  });

  it("returns null for an empty list", () => {
    expect(previousBookmark([], { lineNumber: 1, path: "/a.ts" })).toBeNull();
  });
});
