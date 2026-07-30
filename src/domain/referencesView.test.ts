import { describe, expect, it } from "vitest";
import type { LanguageServerLocation } from "./languageServerFeatures";
import {
  MAX_REFERENCE_VIEW_INSPECTED_LOCATIONS,
  MAX_REFERENCE_VIEW_LOCATIONS,
  MAX_REFERENCE_VIEW_LOCATION_URI_UTF8_BYTES,
  projectReferencesView,
  referenceGroups,
  referenceRows,
  referencesSummaryLabel,
  type ReferencesView,
} from "./referencesView";

describe("referenceRows", () => {
  it("maps locations to 1-based, workspace-relative rows sorted by file then line", () => {
    const view: ReferencesView = {
      symbol: "loadUser",
      locations: [
        location("file:///workspace/app/B.php", 9, 6),
        location("file:///workspace/app/A.php", 4, 2),
        location("file:///workspace/app/A.php", 1, 0),
      ],
    };

    const rows = referenceRows(view, "/workspace");

    expect(rows.map((row) => `${row.relativePath}:${row.line}:${row.column}`)).toEqual([
      "app/A.php:2:1",
      "app/A.php:5:3",
      "app/B.php:10:7",
    ]);
  });

  it("keeps the absolute path when a reference sits outside the workspace root", () => {
    const view: ReferencesView = {
      symbol: "loadUser",
      locations: [location("file:///vendor/laravel/Model.php", 0, 0)],
    };

    const [row] = referenceRows(view, "/workspace");

    expect(row.relativePath).toBe("/vendor/laravel/Model.php");
    expect(row.path).toBe("/vendor/laravel/Model.php");
  });

  it("drops locations whose uri cannot be resolved to a file path", () => {
    const view: ReferencesView = {
      symbol: "loadUser",
      locations: [
        location("untitled:Untitled-1", 0, 0),
        location("file:///workspace/app/A.php", 0, 0),
      ],
    };

    const rows = referenceRows(view, "/workspace");

    expect(rows).toHaveLength(1);
    expect(rows[0].relativePath).toBe("app/A.php");
  });
});

describe("referenceGroups", () => {
  it("groups consecutive rows by file", () => {
    const view: ReferencesView = {
      symbol: "loadUser",
      locations: [
        location("file:///workspace/app/A.php", 0, 0),
        location("file:///workspace/app/A.php", 5, 0),
        location("file:///workspace/app/B.php", 2, 0),
      ],
    };

    const groups = referenceGroups(referenceRows(view, "/workspace"));

    expect(groups).toHaveLength(2);
    expect(groups[0].relativePath).toBe("app/A.php");
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[1].relativePath).toBe("app/B.php");
    expect(groups[1].rows).toHaveLength(1);
  });
});

describe("referencesSummaryLabel", () => {
  it("pluralizes the reference count", () => {
    expect(referencesSummaryLabel(0)).toBe("No references");
    expect(referencesSummaryLabel(1)).toBe("1 reference");
    expect(referencesSummaryLabel(3)).toBe("3 references");
    expect(referencesSummaryLabel(2, 5, true)).toBe("Showing 2 of 5 references");
  });
});

describe("projectReferencesView", () => {
  it("caps retained locations and truthfully reports an incomplete result", () => {
    const locations = Array.from({ length: MAX_REFERENCE_VIEW_LOCATIONS + 3 }, (_, index) =>
      location(`file:///workspace/src/file-${index}.ts`, index, 0),
    );

    const view = projectReferencesView("value", locations);

    expect(view.locations).toHaveLength(MAX_REFERENCE_VIEW_LOCATIONS);
    expect(view.totalCount).toBe(MAX_REFERENCE_VIEW_LOCATIONS + 3);
    expect(view.isIncomplete).toBe(true);
  });

  it("accounts for UTF-8 bytes and omits unresolvable locations without hiding truncation", () => {
    const oversizedUri = `file:///workspace/${"😀".repeat(
      MAX_REFERENCE_VIEW_LOCATION_URI_UTF8_BYTES / 4,
    )}.ts`;
    const view = projectReferencesView("value", [
      location(oversizedUri, 0, 0),
      location("untitled:Untitled-1", 0, 0),
      location("file:///workspace/src/value.ts", 1, 0),
    ]);

    expect(view.locations.map(({ uri }) => uri)).toEqual(["file:///workspace/src/value.ts"]);
    expect(view.totalCount).toBe(3);
    expect(view.isIncomplete).toBe(true);
  });

  it("bounds inspection work even when early locations are unusable", () => {
    const locations = Array.from({ length: MAX_REFERENCE_VIEW_INSPECTED_LOCATIONS }, (_, index) =>
      location(`untitled:Untitled-${index}`, 0, 0),
    );
    locations.push(location("file:///workspace/src/beyond-budget.ts", 0, 0));

    const view = projectReferencesView("value", locations);

    expect(view.locations).toEqual([]);
    expect(view.totalCount).toBe(MAX_REFERENCE_VIEW_INSPECTED_LOCATIONS + 1);
    expect(view.isIncomplete).toBe(true);
  });

  it("preserves truthful truncation metadata from the bounded backend receipt", () => {
    const locations = Object.assign([location("file:///workspace/src/value.ts", 0, 0)], {
      isIncomplete: true,
      totalCount: 9,
    });

    const view = projectReferencesView("value", locations);

    expect(view.locations).toHaveLength(1);
    expect(view.totalCount).toBe(9);
    expect(view.isIncomplete).toBe(true);
  });

  it("keeps an all-omitted backend receipt incomplete instead of claiming no results", () => {
    const locations = Object.assign([], {
      isIncomplete: true,
      totalCount: 5,
    });

    const view = projectReferencesView("value", locations);

    expect(view.locations).toEqual([]);
    expect(view.totalCount).toBe(5);
    expect(view.isIncomplete).toBe(true);
  });
});

function location(uri: string, line: number, character: number): LanguageServerLocation {
  return {
    uri,
    range: {
      start: { line, character },
      end: { line, character: character + 4 },
    },
  };
}
