import { describe, expect, it } from "vitest";
import {
  buildRecentLocation,
  pushRecentLocation,
  removeRecentLocationsForPath,
  renameRecentLocationsPath,
  RECENT_LOCATIONS_LIMIT,
  RECENT_LOCATION_NEAR_LINES,
  type RecentLocation,
} from "./recentLocations";

function loc(
  path: string,
  line: number,
  overrides: Partial<RecentLocation> = {},
): RecentLocation {
  const name = path.split("/").pop() ?? path;
  return {
    column: 1,
    line,
    name,
    path,
    relativePath: path.replace(/^\/workspace\//, ""),
    snippet: `line ${line}`,
    ...overrides,
  };
}

describe("pushRecentLocation", () => {
  it("places the newest location at the head", () => {
    const list = pushRecentLocation(
      pushRecentLocation([], loc("/workspace/a.ts", 10)),
      loc("/workspace/b.ts", 5),
    );

    expect(list.map((item) => [item.path, item.line])).toEqual([
      ["/workspace/b.ts", 5],
      ["/workspace/a.ts", 10],
    ]);
  });

  it("keeps distinct lines in the same file as separate entries", () => {
    let list: RecentLocation[] = [];
    list = pushRecentLocation(list, loc("/workspace/a.ts", 10));
    list = pushRecentLocation(list, loc("/workspace/a.ts", 80));

    expect(list.map((item) => item.line)).toEqual([80, 10]);
  });

  it("collapses a nearby line in the same file into a single (updated) head entry", () => {
    let list: RecentLocation[] = [];
    list = pushRecentLocation(list, loc("/workspace/a.ts", 10));
    // Within RECENT_LOCATION_NEAR_LINES of line 10 -> treated as the same spot.
    list = pushRecentLocation(
      list,
      loc("/workspace/a.ts", 10 + RECENT_LOCATION_NEAR_LINES, {
        snippet: "updated snippet",
      }),
    );

    expect(list).toHaveLength(1);
    expect(list[0]?.line).toBe(10 + RECENT_LOCATION_NEAR_LINES);
    expect(list[0]?.snippet).toBe("updated snippet");
  });

  it("does NOT collapse when the line gap exceeds the near threshold", () => {
    let list: RecentLocation[] = [];
    list = pushRecentLocation(list, loc("/workspace/a.ts", 10));
    list = pushRecentLocation(
      list,
      loc("/workspace/a.ts", 10 + RECENT_LOCATION_NEAR_LINES + 1),
    );

    expect(list).toHaveLength(2);
  });

  it("only collapses against the head entry, not deeper near-duplicates", () => {
    let list: RecentLocation[] = [];
    list = pushRecentLocation(list, loc("/workspace/a.ts", 10));
    list = pushRecentLocation(list, loc("/workspace/b.ts", 50));
    // Near a.ts:10 but a.ts is no longer the head -> a new entry is added.
    list = pushRecentLocation(list, loc("/workspace/a.ts", 11));

    expect(list.map((item) => [item.path, item.line])).toEqual([
      ["/workspace/a.ts", 11],
      ["/workspace/b.ts", 50],
      ["/workspace/a.ts", 10],
    ]);
  });

  it("bounds the list, dropping the oldest entries", () => {
    let list: RecentLocation[] = [];

    for (let index = 0; index < RECENT_LOCATIONS_LIMIT + 10; index += 1) {
      list = pushRecentLocation(list, loc(`/workspace/file-${index}.ts`, 1));
    }

    expect(list).toHaveLength(RECENT_LOCATIONS_LIMIT);
    expect(list[0]?.path).toBe(
      `/workspace/file-${RECENT_LOCATIONS_LIMIT + 9}.ts`,
    );
  });

  it("respects a custom limit", () => {
    let list: RecentLocation[] = [];
    list = pushRecentLocation(list, loc("/workspace/a.ts", 1), 2);
    list = pushRecentLocation(list, loc("/workspace/b.ts", 1), 2);
    list = pushRecentLocation(list, loc("/workspace/c.ts", 1), 2);

    expect(list.map((item) => item.path)).toEqual([
      "/workspace/c.ts",
      "/workspace/b.ts",
    ]);
  });

  it("ignores a null location", () => {
    const list = [loc("/workspace/a.ts", 10)];

    expect(pushRecentLocation(list, null)).toBe(list);
  });

  it("does not mutate the input list", () => {
    const original = [loc("/workspace/a.ts", 10)];
    pushRecentLocation(original, loc("/workspace/b.ts", 5));

    expect(original.map((item) => item.path)).toEqual(["/workspace/a.ts"]);
  });
});

describe("buildRecentLocation", () => {
  const content = ["class Order", "{", "    public function total(): int", "}"].join(
    "\n",
  );

  it("captures path, relative path, name, line, column and the trimmed line snippet", () => {
    const built = buildRecentLocation({
      content,
      name: "Order.php",
      navigation: {
        path: "/workspace/app/Order.php",
        position: { column: 9, lineNumber: 3 },
      },
      relativePath: "app/Order.php",
    });

    expect(built).toEqual({
      column: 9,
      line: 3,
      name: "Order.php",
      path: "/workspace/app/Order.php",
      relativePath: "app/Order.php",
      snippet: "public function total(): int",
    });
  });

  it("falls back to an empty snippet when the line is out of range", () => {
    const built = buildRecentLocation({
      content,
      name: "Order.php",
      navigation: {
        path: "/workspace/app/Order.php",
        position: { column: 1, lineNumber: 999 },
      },
      relativePath: "app/Order.php",
    });

    expect(built?.snippet).toBe("");
  });

  it("returns null without a relative path (target outside the workspace)", () => {
    const built = buildRecentLocation({
      content,
      name: "Order.php",
      navigation: {
        path: "/elsewhere/Order.php",
        position: { column: 1, lineNumber: 1 },
      },
      relativePath: null,
    });

    expect(built).toBeNull();
  });

  it("returns null for a null navigation location", () => {
    const built = buildRecentLocation({
      content: null,
      name: null,
      navigation: null,
      relativePath: null,
    });

    expect(built).toBeNull();
  });

  it("derives the name from the path when none is supplied", () => {
    const built = buildRecentLocation({
      content,
      name: null,
      navigation: {
        path: "/workspace/app/Order.php",
        position: { column: 1, lineNumber: 1 },
      },
      relativePath: "app/Order.php",
    });

    expect(built?.name).toBe("Order.php");
  });
});

describe("removeRecentLocationsForPath", () => {
  it("drops every entry for a deleted file", () => {
    const list = [
      loc("/workspace/a.ts", 10),
      loc("/workspace/b.ts", 5),
      loc("/workspace/a.ts", 99),
    ];

    expect(
      removeRecentLocationsForPath(list, "/workspace/a.ts").map(
        (item) => item.path,
      ),
    ).toEqual(["/workspace/b.ts"]);
  });

  it("does not mutate the input list", () => {
    const original = [loc("/workspace/a.ts", 10)];
    removeRecentLocationsForPath(original, "/workspace/a.ts");

    expect(original).toHaveLength(1);
  });
});

describe("renameRecentLocationsPath", () => {
  it("remaps path, relativePath and name for every entry of the moved file", () => {
    const list = [
      loc("/workspace/old.ts", 10),
      loc("/workspace/b.ts", 5),
      loc("/workspace/old.ts", 20),
    ];

    const result = renameRecentLocationsPath(list, "/workspace/old.ts", {
      name: "new.ts",
      path: "/workspace/sub/new.ts",
      relativePath: "sub/new.ts",
    });

    const moved = result.filter((item) => item.path === "/workspace/sub/new.ts");
    expect(moved).toHaveLength(2);
    expect(moved.every((item) => item.name === "new.ts")).toBe(true);
    expect(moved.every((item) => item.relativePath === "sub/new.ts")).toBe(true);
    expect(moved.map((item) => item.line).sort((a, b) => a - b)).toEqual([
      10, 20,
    ]);
  });

  it("leaves the list unchanged when the old path is absent", () => {
    const list = [loc("/workspace/a.ts", 10)];

    const result = renameRecentLocationsPath(list, "/workspace/missing.ts", {
      name: "new.ts",
      path: "/workspace/new.ts",
      relativePath: "new.ts",
    });

    expect(result.map((item) => item.path)).toEqual(["/workspace/a.ts"]);
  });
});
