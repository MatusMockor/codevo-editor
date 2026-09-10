import { describe, expect, it } from "vitest";
import {
  appUpdateNotesSpanEntries,
  appUpdateNotesSpanSummary,
  parseAppUpdateNotesSpan,
  MAX_APP_UPDATE_NOTES_ENTRIES,
  MAX_APP_UPDATE_NOTES_SOURCE_ENTRIES,
} from "./appUpdateNotes";
import { MAX_APP_UPDATE_NOTES_LENGTH } from "./appUpdater";

function manifestWith(versions: readonly string[]): Record<string, unknown> {
  return {
    version: versions[0],
    notes: `Notes for ${versions[0]}`,
    releaseNotes: versions.map((version) => ({ version, notes: `Notes for ${version}` })),
  };
}

describe("app update notes span", () => {
  it("renders every release between the installed and the offered version, newest first", () => {
    const span = parseAppUpdateNotesSpan({
      currentVersion: "0.2.0-beta.24",
      version: "0.2.0-beta.29",
      notes: "Notes for 0.2.0-beta.29",
      manifest: manifestWith([
        "0.2.0-beta.29",
        "0.2.0-beta.28",
        "0.2.0-beta.27",
        "0.2.0-beta.26",
        "0.2.0-beta.25",
        "0.2.0-beta.24",
        "0.2.0-beta.23",
      ]),
    });

    expect(span.kind).toBe("complete");
    expect(appUpdateNotesSpanEntries(span).map((entry) => entry.version)).toEqual([
      "0.2.0-beta.29",
      "0.2.0-beta.28",
      "0.2.0-beta.27",
      "0.2.0-beta.26",
      "0.2.0-beta.25",
    ]);
    expect(appUpdateNotesSpanSummary(span)).toBe("Includes notes for 5 releases.");
  });

  it("sorts an out-of-order manifest list by version precedence, not by position", () => {
    const span = parseAppUpdateNotesSpan({
      currentVersion: "0.2.0-beta.8",
      version: "0.2.0-beta.29",
      notes: "Newest",
      manifest: {
        releaseNotes: [
          { version: "0.2.0-beta.9", notes: "Nine" },
          { version: "0.2.0-beta.29", notes: "Twenty nine" },
          { version: "0.2.0-beta.10", notes: "Ten" },
        ],
      },
    });

    expect(appUpdateNotesSpanEntries(span).map((entry) => entry.version)).toEqual([
      "0.2.0-beta.29",
      "0.2.0-beta.10",
      "0.2.0-beta.9",
    ]);
    expect(span.kind).toBe("bounded");
  });

  it("never claims completeness for a window that stops short of the installed version", () => {
    const span = parseAppUpdateNotesSpan({
      currentVersion: "0.2.0-beta.20",
      version: "0.2.0-beta.29",
      notes: "Newest",
      manifest: manifestWith(["0.2.0-beta.29", "0.2.0-beta.28", "0.2.0-beta.27"]),
    });

    expect(span.kind).toBe("bounded");
    expect(appUpdateNotesSpanSummary(span)).toBe("Showing the last 3 releases of a longer span.");
  });

  it("never claims completeness when the newest carried entry is not the offered release", () => {
    const span = parseAppUpdateNotesSpan({
      currentVersion: "0.2.0-beta.26",
      version: "0.2.0-beta.30",
      notes: "Newest",
      manifest: manifestWith([
        "0.2.0-beta.29",
        "0.2.0-beta.28",
        "0.2.0-beta.27",
        "0.2.0-beta.26",
        "0.2.0-beta.25",
      ]),
    });

    expect(span.kind).toBe("bounded");
    expect(appUpdateNotesSpanEntries(span).map((entry) => entry.version)).toEqual([
      "0.2.0-beta.29",
      "0.2.0-beta.28",
      "0.2.0-beta.27",
    ]);
  });

  it("claims completeness only when the window reaches back past the installed version", () => {
    const span = parseAppUpdateNotesSpan({
      currentVersion: "0.2.0-beta.27",
      version: "0.2.0-beta.29",
      notes: "Newest",
      manifest: manifestWith(["0.2.0-beta.29", "0.2.0-beta.28", "0.2.0-beta.27", "0.2.0-beta.26"]),
    });

    expect(span.kind).toBe("complete");
    expect(appUpdateNotesSpanSummary(span)).toBe("Includes notes for 2 releases.");
  });

  it("renders one version and many versions from the same heading-free bodies", () => {
    const manifest = {
      version: "0.2.0-beta.29",
      notes: "## [0.2.0-beta.29] - 2026-09-10\n\n### Added\n\n- A change.",
      releaseNotes: [
        { version: "0.2.0-beta.29", notes: "### Added\n\n- A change." },
        { version: "0.2.0-beta.28", notes: "### Fixed\n\n- A fix." },
        { version: "0.2.0-beta.27", notes: "### Fixed\n\n- An older fix." },
      ],
    };
    const one = parseAppUpdateNotesSpan({
      currentVersion: "0.2.0-beta.28",
      version: "0.2.0-beta.29",
      notes: manifest.notes,
      manifest,
    });
    const many = parseAppUpdateNotesSpan({
      currentVersion: "0.2.0-beta.27",
      version: "0.2.0-beta.29",
      notes: manifest.notes,
      manifest,
    });

    expect(one).toEqual({ kind: "single", notes: "### Added\n\n- A change." });
    expect(appUpdateNotesSpanEntries(many)[0].notes).toBe("### Added\n\n- A change.");
  });

  it("strips the changelog heading from a legacy manifest without a per-version list", () => {
    expect(
      parseAppUpdateNotesSpan({
        currentVersion: "0.2.0-beta.28",
        version: "0.2.0-beta.29",
        notes: "## [0.2.0-beta.29] - 2026-09-10\n\n### Added\n\n- A change.",
        manifest: { version: "0.2.0-beta.29" },
      }),
    ).toEqual({ kind: "single", notes: "### Added\n\n- A change." });
    expect(
      parseAppUpdateNotesSpan({
        currentVersion: "0.2.0-beta.28",
        version: "0.2.0-beta.29",
        notes: "A plain note without a heading.",
        manifest: null,
      }),
    ).toEqual({ kind: "single", notes: "A plain note without a heading." });
  });

  it("stays on the single manifest note when only one release separates the versions", () => {
    const span = parseAppUpdateNotesSpan({
      currentVersion: "0.2.0-beta.28",
      version: "0.2.0-beta.29",
      notes: "Notes for 0.2.0-beta.29",
      manifest: manifestWith(["0.2.0-beta.29", "0.2.0-beta.28", "0.2.0-beta.27"]),
    });

    expect(span).toEqual({ kind: "single", notes: "Notes for 0.2.0-beta.29" });
    expect(appUpdateNotesSpanEntries(span)).toEqual([]);
    expect(appUpdateNotesSpanSummary(span)).toBeNull();
  });

  it("reports a truthful bounded state when the span exceeds the entry cap", () => {
    const versions = Array.from(
      { length: MAX_APP_UPDATE_NOTES_ENTRIES + 3 },
      (_unused, index) => `0.2.0-beta.${40 - index}`,
    );
    const span = parseAppUpdateNotesSpan({
      currentVersion: "0.2.0-beta.1",
      version: "0.2.0-beta.40",
      notes: "Newest",
      manifest: manifestWith(versions),
    });

    expect(span.kind).toBe("bounded");
    expect(appUpdateNotesSpanEntries(span)).toHaveLength(MAX_APP_UPDATE_NOTES_ENTRIES);
    expect(appUpdateNotesSpanEntries(span)[0].version).toBe("0.2.0-beta.40");
    expect(appUpdateNotesSpanSummary(span)).toBe(
      `Showing the last ${MAX_APP_UPDATE_NOTES_ENTRIES} releases of a longer span.`,
    );
  });

  it("never offers notes for a release newer than the offered candidate", () => {
    const span = parseAppUpdateNotesSpan({
      currentVersion: "0.2.0-beta.26",
      version: "0.2.0-beta.28",
      notes: "Notes for 0.2.0-beta.28",
      manifest: manifestWith(["0.2.0-beta.30", "0.2.0-beta.28", "0.2.0-beta.27", "0.2.0-beta.26"]),
    });

    expect(appUpdateNotesSpanEntries(span).map((entry) => entry.version)).toEqual([
      "0.2.0-beta.28",
      "0.2.0-beta.27",
    ]);
  });

  it("degrades to the single manifest note for malformed, missing, or unbounded lists", () => {
    const base = {
      currentVersion: "0.2.0-beta.20",
      version: "0.2.0-beta.29",
      notes: "Notes for 0.2.0-beta.29",
    } as const;
    const fallback = { kind: "single", notes: "Notes for 0.2.0-beta.29" };
    const rejected: readonly unknown[] = [
      undefined,
      null,
      "releaseNotes",
      [{ version: "0.2.0-beta.29", notes: "n" }],
      { releaseNotes: "not-an-array" },
      { releaseNotes: [] },
      { releaseNotes: [{ version: "0.2.0-beta.29" }, { version: "0.2.0-beta.28", notes: "n" }] },
      { releaseNotes: [{ version: "0.2.0-beta.29", notes: 7 }] },
      { releaseNotes: [{ version: "not-a-version", notes: "n" }] },
      { releaseNotes: [{ version: "0.2.0-beta.29", notes: "  " }] },
      {
        releaseNotes: [
          { version: "0.2.0-beta.29", notes: "a" },
          { version: "0.2.0-beta.29", notes: "b" },
        ],
      },
      {
        releaseNotes: [
          { version: "0.2.0-beta.29", notes: "a".repeat(MAX_APP_UPDATE_NOTES_LENGTH + 1) },
          { version: "0.2.0-beta.28", notes: "b" },
        ],
      },
      {
        releaseNotes: Array.from(
          { length: MAX_APP_UPDATE_NOTES_SOURCE_ENTRIES + 1 },
          (_unused, index) => ({ version: `0.2.${index}.0`, notes: "n" }),
        ),
      },
    ];

    for (const manifest of rejected) {
      expect(parseAppUpdateNotesSpan({ ...base, manifest })).toEqual(fallback);
    }
  });

  it("falls back to the single note when either compared version is unparseable", () => {
    const manifest = manifestWith(["0.2.0-beta.29", "0.2.0-beta.28", "0.2.0-beta.27"]);
    expect(
      parseAppUpdateNotesSpan({
        currentVersion: "nightly",
        version: "0.2.0-beta.29",
        notes: null,
        manifest,
      }),
    ).toEqual({ kind: "single", notes: null });
    expect(
      parseAppUpdateNotesSpan({
        currentVersion: "0.2.0-beta.26",
        version: "nightly",
        notes: null,
        manifest,
      }),
    ).toEqual({ kind: "single", notes: null });
  });

  it("uses the only matching entry when the manifest carries no single note", () => {
    expect(
      parseAppUpdateNotesSpan({
        currentVersion: "0.2.0-beta.28",
        version: "0.2.0-beta.29",
        notes: null,
        manifest: { releaseNotes: [{ version: "0.2.0-beta.29", notes: "Only entry" }] },
      }),
    ).toEqual({ kind: "single", notes: "Only entry" });
  });
});
