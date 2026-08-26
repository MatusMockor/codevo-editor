import { describe, expect, it } from "vitest";
import {
  directoryDisplayPath,
  filterDirectoryEntries,
  parseDirectoryListing,
  MAX_DIRECTORY_ENTRY_NAME_BYTES,
  MAX_DIRECTORY_FILTER_QUERY_CHARS,
  MAX_DIRECTORY_LISTING_ENTRIES,
  type DirectoryEntry,
} from "./directoryListing";

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    path: "/Users/dev/projects",
    parent: "/Users/dev",
    entries: [
      { name: "api", kind: "directory", hidden: false },
      { name: ".env", kind: "file", hidden: true },
      { name: "link", kind: "symlink", hidden: false },
    ],
    truncated: false,
    ...overrides,
  };
}

function entry(name: string, kind: DirectoryEntry["kind"], hidden = false): DirectoryEntry {
  return { name, kind, hidden };
}

describe("parseDirectoryListing", () => {
  it("accepts a valid listing", () => {
    expect(parseDirectoryListing(payload())).toEqual({
      path: "/Users/dev/projects",
      parent: "/Users/dev",
      entries: [
        { name: "api", kind: "directory", hidden: false },
        { name: ".env", kind: "file", hidden: true },
        { name: "link", kind: "symlink", hidden: false },
      ],
      truncated: false,
    });
  });

  it("accepts a root listing without a parent", () => {
    const listing = parseDirectoryListing(payload({ path: "/", parent: null, entries: [] }));

    expect(listing.parent).toBeNull();
    expect(listing.entries).toEqual([]);
  });

  it("rejects a non-object listing", () => {
    expect(() => parseDirectoryListing(null)).toThrow("listing must be an object.");
    expect(() => parseDirectoryListing([])).toThrow("listing must be an object.");
  });

  it("rejects an unknown listing field", () => {
    expect(() => parseDirectoryListing(payload({ cursor: "abc" }))).toThrow(
      'listing has unsupported field "cursor".',
    );
  });

  it("rejects a missing listing field", () => {
    const { truncated: _removed, ...withoutTruncated } = payload();

    expect(() => parseDirectoryListing(withoutTruncated)).toThrow(
      'listing is missing field "truncated".',
    );
  });

  it("rejects a relative path", () => {
    expect(() => parseDirectoryListing(payload({ path: "projects" }))).toThrow(
      "listing.path must be an absolute path.",
    );
    expect(() => parseDirectoryListing(payload({ parent: "dev" }))).toThrow(
      "listing.parent must be an absolute path.",
    );
  });

  it("rejects a non-boolean truncated flag", () => {
    expect(() => parseDirectoryListing(payload({ truncated: "false" }))).toThrow(
      "listing.truncated must be a boolean.",
    );
  });

  it("rejects entries that are not an array", () => {
    expect(() => parseDirectoryListing(payload({ entries: {} }))).toThrow(
      "listing.entries must be an array.",
    );
  });

  it("rejects more entries than the bound allows", () => {
    const entries = Array.from({ length: MAX_DIRECTORY_LISTING_ENTRIES + 1 }, (_value, index) => ({
      name: `entry-${index}`,
      kind: "file",
      hidden: false,
    }));

    expect(() => parseDirectoryListing(payload({ entries }))).toThrow(
      `listing.entries exceeds ${MAX_DIRECTORY_LISTING_ENTRIES} entries.`,
    );
  });

  it("accepts exactly the maximum number of entries", () => {
    const entries = Array.from({ length: MAX_DIRECTORY_LISTING_ENTRIES }, (_value, index) => ({
      name: `entry-${index}`,
      kind: "file",
      hidden: false,
    }));

    expect(parseDirectoryListing(payload({ entries })).entries).toHaveLength(
      MAX_DIRECTORY_LISTING_ENTRIES,
    );
  });

  it("rejects an entry name that is not a single path segment", () => {
    expect(() =>
      parseDirectoryListing(payload({ entries: [{ name: "a/b", kind: "file", hidden: false }] })),
    ).toThrow("listing.entries[0].name must be a single path segment.");
    expect(() =>
      parseDirectoryListing(
        payload({ entries: [{ name: "..", kind: "directory", hidden: false }] }),
      ),
    ).toThrow("listing.entries[0].name must be a single path segment.");
    expect(() =>
      parseDirectoryListing(
        payload({ entries: [{ name: ".", kind: "directory", hidden: false }] }),
      ),
    ).toThrow("listing.entries[0].name must be a single path segment.");
  });

  it("rejects an empty entry name", () => {
    expect(() =>
      parseDirectoryListing(payload({ entries: [{ name: "", kind: "file", hidden: false }] })),
    ).toThrow("listing.entries[0].name must be a non-empty string.");
  });

  it("rejects an entry name longer than the byte bound", () => {
    const name = "a".repeat(MAX_DIRECTORY_ENTRY_NAME_BYTES + 1);

    expect(() =>
      parseDirectoryListing(payload({ entries: [{ name, kind: "file", hidden: false }] })),
    ).toThrow(`listing.entries[0].name exceeds ${MAX_DIRECTORY_ENTRY_NAME_BYTES} bytes.`);
  });

  it("measures entry name length in utf-8 bytes", () => {
    const name = "é".repeat(MAX_DIRECTORY_ENTRY_NAME_BYTES / 2 + 1);

    expect(() =>
      parseDirectoryListing(payload({ entries: [{ name, kind: "file", hidden: false }] })),
    ).toThrow(`listing.entries[0].name exceeds ${MAX_DIRECTORY_ENTRY_NAME_BYTES} bytes.`);
  });

  it("rejects an unsupported entry kind", () => {
    expect(() =>
      parseDirectoryListing(
        payload({ entries: [{ name: "sock", kind: "socket", hidden: false }] }),
      ),
    ).toThrow("listing.entries[0].kind is not a supported entry kind.");
  });

  it("rejects an unknown entry field and a non-boolean hidden flag", () => {
    expect(() =>
      parseDirectoryListing(
        payload({ entries: [{ name: "api", kind: "directory", hidden: false, size: 4 }] }),
      ),
    ).toThrow('listing.entries[0] has unsupported field "size".');
    expect(() =>
      parseDirectoryListing(payload({ entries: [{ name: "api", kind: "directory", hidden: 1 }] })),
    ).toThrow("listing.entries[0].hidden must be a boolean.");
  });
});

describe("filterDirectoryEntries", () => {
  const entries = [
    entry("Source", "directory"),
    entry("readme.md", "file"),
    entry(".hidden", "directory", true),
    entry(".gitignore", "file", true),
  ];

  it("hides hidden entries unless hidden entries are shown", () => {
    expect(filterDirectoryEntries(entries, "", false).map((item) => item.name)).toEqual([
      "Source",
      "readme.md",
    ]);
    expect(filterDirectoryEntries(entries, "", true).map((item) => item.name)).toEqual([
      "Source",
      "readme.md",
      ".hidden",
      ".gitignore",
    ]);
  });

  it("matches a case-insensitive substring", () => {
    expect(filterDirectoryEntries(entries, "OUR", false).map((item) => item.name)).toEqual([
      "Source",
    ]);
    expect(filterDirectoryEntries(entries, "ME.M", false).map((item) => item.name)).toEqual([
      "readme.md",
    ]);
  });

  it("keeps hidden filtering while matching a substring", () => {
    expect(filterDirectoryEntries(entries, "git", false)).toEqual([]);
    expect(filterDirectoryEntries(entries, "git", true).map((item) => item.name)).toEqual([
      ".gitignore",
    ]);
  });

  it("trims the query", () => {
    expect(filterDirectoryEntries(entries, "   source   ", false).map((item) => item.name)).toEqual(
      ["Source"],
    );
    expect(filterDirectoryEntries(entries, "   ", false).map((item) => item.name)).toEqual([
      "Source",
      "readme.md",
    ]);
  });

  it("caps the query at the bounded character count", () => {
    const name = "a".repeat(MAX_DIRECTORY_FILTER_QUERY_CHARS);
    const capped = [entry(name, "directory")];

    expect(filterDirectoryEntries(capped, `${name}zzz`, false)).toHaveLength(1);
    expect(filterDirectoryEntries(capped, `${name.slice(1)}z`, false)).toHaveLength(0);
  });
});

describe("directoryDisplayPath", () => {
  it("renders the home directory as a tilde root", () => {
    expect(directoryDisplayPath("/Users/dev", "/Users/dev")).toBe("~/");
  });

  it("renders a child of home relative to the tilde", () => {
    expect(directoryDisplayPath("/Users/dev/projects/api", "/Users/dev")).toBe("~/projects/api");
  });

  it("renders a path outside home as absolute", () => {
    expect(directoryDisplayPath("/var/log", "/Users/dev")).toBe("/var/log");
  });

  it("does not treat a sibling prefix as a home child", () => {
    expect(directoryDisplayPath("/Users/developer", "/Users/dev")).toBe("/Users/developer");
  });

  it("renders an absolute path when home is unknown", () => {
    expect(directoryDisplayPath("/Users/dev", null)).toBe("/Users/dev");
  });
});
