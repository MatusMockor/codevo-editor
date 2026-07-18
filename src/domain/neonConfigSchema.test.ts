import { describe, expect, it } from "vitest";
import {
  compatibleNeonConfigKeySpecsForScope,
  netteComposerPackageVersionsFromLock,
  neonConfigKeyScopeRequiresComposerVersion,
  NETTE_NEON_SCHEMA_PROVENANCE,
  NEON_SECTION_KEYS,
  NEON_SERVICE_ITEM_KEYS,
  NEON_TOP_LEVEL_SECTIONS,
  neonConfigKeyCompletionContextAt,
  neonConfigKeySpecsForScope,
  neonExtensionNamesFromSource,
  neonIndentUnitFromSource,
} from "./neonConfigSchema";

describe("neon config schema data", () => {
  it("lists the standard top-level sections", () => {
    const names = NEON_TOP_LEVEL_SECTIONS.map((section) => section.name);

    for (const expected of [
      "application",
      "database",
      "di",
      "extensions",
      "http",
      "includes",
      "latte",
      "parameters",
      "security",
      "services",
      "session",
      "tracy",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("matches the nette/di DefinitionSchema service keys", () => {
    const names = NEON_SERVICE_ITEM_KEYS.map((key) => key.name);

    expect(names).toEqual([
      "alteration",
      "arguments",
      "autowired",
      "class",
      "create",
      "factory",
      "implement",
      "imported",
      "inject",
      "lazy",
      "references",
      "reset",
      "setup",
      "tagged",
      "tags",
      "type",
    ]);
  });

  it("describes service item keys with value kinds", () => {
    const byName = new Map(
      NEON_SERVICE_ITEM_KEYS.map((key) => [key.name, key]),
    );

    expect(byName.get("factory")?.valueKind).toBe("string");
    expect(byName.get("setup")?.valueKind).toBe("array");
    expect(byName.get("autowired")?.valueKind).toBe("scalar");
    expect(byName.get("tags")?.valueKind).toBe("array");
    expect(byName.get("reset")?.valueKind).toBe("array");
    expect(byName.get("alteration")?.valueKind).toBe("boolean");
    expect(byName.get("factory")?.description).toContain("alias of create");
    expect(byName.get("class")?.description).toContain("deprecated");
  });

  it("records pinned upstream provenance for the bundled offline snapshot", () => {
    expect(NETTE_NEON_SCHEMA_PROVENANCE.schemaVersion).toBe(2);
    expect(NETTE_NEON_SCHEMA_PROVENANCE.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          package: "nette/di",
          revision: "481ca2553e792daffa7fcf0ed43f705d80603fa4",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          version: "3.2.6",
        }),
      ]),
    );
  });

  it("gates individual generated keys without hiding older keys in the same scope", () => {
    const current = new Map([["nette/di", "v3.2.6"]]);
    const older = new Map([["nette/di", "3.1.9"]]);

    expect(
      compatibleNeonConfigKeySpecsForScope(
        { kind: "service-item" },
        current,
      ).map((spec) => spec.name),
    ).toContain("lazy");
    const olderNames = compatibleNeonConfigKeySpecsForScope(
      { kind: "service-item" },
      older,
    ).map((spec) => spec.name);
    const unknownNames = compatibleNeonConfigKeySpecsForScope(
      { kind: "service-item" },
      new Map(),
    ).map((spec) => spec.name);

    expect(olderNames).toContain("factory");
    expect(olderNames).not.toContain("lazy");
    expect(unknownNames).toContain("factory");
    expect(unknownNames).not.toContain("lazy");
  });

  it("keeps stable handwritten scopes available without Composer metadata", () => {
    expect(
      compatibleNeonConfigKeySpecsForScope(
        { kind: "section", section: "application" },
        new Map(),
      ).map((spec) => spec.name),
    ).toContain("errorPresenter");
    expect(
      neonConfigKeyScopeRequiresComposerVersion({
        kind: "section",
        section: "application",
      }),
    ).toBe(false);
    expect(
      neonConfigKeyScopeRequiresComposerVersion({ kind: "service-item" }),
    ).toBe(true);
  });

  it("parses normalized package versions from production and dev lock entries", () => {
    const versions = netteComposerPackageVersionsFromLock(
      JSON.stringify({
        packages: [{ name: "nette/di", version: "v3.2.6" }],
        "packages-dev": [{ name: "nette/tester", version: "v2.5.4" }],
      }),
    );

    expect(versions.get("nette/di")).toBe("v3.2.6");
    expect(versions.get("nette/tester")).toBe("v2.5.4");
    expect(netteComposerPackageVersionsFromLock("not json").size).toBe(0);
  });

  it("provides nested keys from the pinned extension schemas", () => {
    expect(
      neonConfigKeySpecsForScope({
        kind: "section",
        section: "database.*",
      }).map((spec) => spec.name),
    ).toContain("dsn");
    expect(
      neonConfigKeySpecsForScope({
        kind: "section",
        section: "security.authentication",
      }).map((spec) => spec.name),
    ).toContain("persistIdentity");
    expect(
      neonConfigKeySpecsForScope({
        kind: "section",
        section: "search.*.exclude",
      }).map((spec) => spec.name),
    ).toContain("implements");
  });

  it("provides nested keys for common sections", () => {
    const applicationKeys = (NEON_SECTION_KEYS["application"] ?? []).map(
      (key) => key.name,
    );
    const sessionKeys = (NEON_SECTION_KEYS["session"] ?? []).map(
      (key) => key.name,
    );

    expect(applicationKeys).toContain("mapping");
    expect(applicationKeys).toContain("errorPresenter");
    expect(sessionKeys).toContain("expiration");
    expect(sessionKeys).toContain("autoStart");
  });

  it("resolves specs per scope", () => {
    expect(neonConfigKeySpecsForScope({ kind: "top-level" })).toBe(
      NEON_TOP_LEVEL_SECTIONS,
    );
    expect(neonConfigKeySpecsForScope({ kind: "service-item" })).toBe(
      NEON_SERVICE_ITEM_KEYS,
    );
    expect(
      neonConfigKeySpecsForScope({ kind: "section", section: "tracy" }).length,
    ).toBeGreaterThan(0);
    expect(
      neonConfigKeySpecsForScope({ kind: "section", section: "parameters" }),
    ).toEqual([]);
  });
});

describe("neonConfigKeyCompletionContextAt", () => {
  it("detects a top-level key position with prefix and span", () => {
    const source = "serv";
    const context = neonConfigKeyCompletionContextAt(source, 4);

    expect(context).toEqual({
      followedByColon: false,
      prefix: "serv",
      scope: { kind: "top-level" },
      span: { end: 4, start: 0 },
    });
  });

  it("detects a top-level position on an empty document", () => {
    const context = neonConfigKeyCompletionContextAt("", 0);

    expect(context?.scope).toEqual({ kind: "top-level" });
    expect(context?.prefix).toBe("");
  });

  it("detects a section scope from indentation", () => {
    const source = "application:\n\tmapp";
    const context = neonConfigKeyCompletionContextAt(source, source.length);

    expect(context?.scope).toEqual({ kind: "section", section: "application" });
    expect(context?.prefix).toBe("mapp");
    expect(context?.span).toEqual({ end: source.length, start: 14 });
  });

  it("detects a section scope on a blank indented line", () => {
    const source = "session:\n\t";
    const context = neonConfigKeyCompletionContextAt(source, source.length);

    expect(context?.scope).toEqual({ kind: "section", section: "session" });
    expect(context?.prefix).toBe("");
  });

  it("detects a service-item scope inside a named service", () => {
    const source = "services:\n\tfoo:\n\t\tfact";
    const context = neonConfigKeyCompletionContextAt(source, source.length);

    expect(context?.scope).toEqual({ kind: "service-item" });
    expect(context?.prefix).toBe("fact");
  });

  it("detects a service-item scope inside an anonymous service", () => {
    const source = "services:\n\t-\n\t\targ";
    const context = neonConfigKeyCompletionContextAt(source, source.length);

    expect(context?.scope).toEqual({ kind: "service-item" });
    expect(context?.prefix).toBe("arg");
  });

  it("reports a key that is already followed by a colon", () => {
    const source = "tracy: true";
    const context = neonConfigKeyCompletionContextAt(source, 3);

    expect(context?.followedByColon).toBe(true);
    expect(context?.prefix).toBe("tra");
    expect(context?.span).toEqual({ end: 5, start: 0 });
  });

  it("returns null in a value position", () => {
    const source = "services:\n\tfoo:\n\t\tfactory: App";

    expect(neonConfigKeyCompletionContextAt(source, source.length)).toBeNull();
  });

  it("returns null on a list-item line", () => {
    const source = "services:\n\t- App";

    expect(neonConfigKeyCompletionContextAt(source, source.length)).toBeNull();
  });

  it("returns null at the service-name level of services", () => {
    const source = "services:\n\tfo";

    expect(neonConfigKeyCompletionContextAt(source, source.length)).toBeNull();
  });

  it("returns null on comment lines", () => {
    const source = "# serv";

    expect(neonConfigKeyCompletionContextAt(source, source.length)).toBeNull();
  });

  it("returns null when the typed text is not a key fragment", () => {
    const source = "%ap";

    expect(neonConfigKeyCompletionContextAt(source, source.length)).toBeNull();
  });

  it("returns null below unsupported service nesting depths", () => {
    const source = "services:\n\tfoo:\n\t\tsetup:\n\t\t\tab";

    expect(neonConfigKeyCompletionContextAt(source, source.length)).toBeNull();
  });

  it("detects a named database connection scope", () => {
    const source = "database:\n\tprimary:\n\t\tds";
    const context = neonConfigKeyCompletionContextAt(source, source.length);

    expect(context?.scope).toEqual({ kind: "section", section: "database.*" });
    expect(context?.prefix).toBe("ds");
  });

  it("detects a nested static security scope", () => {
    const source = "security:\n\tauthentication:\n\t\tper";
    const context = neonConfigKeyCompletionContextAt(source, source.length);

    expect(context?.scope).toEqual({
      kind: "section",
      section: "security.authentication",
    });
  });

  it("detects nested wildcard search exclusion scopes", () => {
    const source = "search:\n\tapp:\n\t\texclude:\n\t\t\tcla";
    const context = neonConfigKeyCompletionContextAt(source, source.length);

    expect(context?.scope).toEqual({
      kind: "section",
      section: "search.*.exclude",
    });
  });
});

describe("neonExtensionNamesFromSource", () => {
  it("collects extension names registered under extensions:", () => {
    const source = [
      "extensions:",
      "\tmyExt: App\\DI\\MyExtension",
      "\tmigrations: Nextras\\Migrations\\Bridges\\NetteDI\\MigrationsExtension(%dbal%)",
      "services:",
      "\tfoo: App\\Foo",
    ].join("\n");

    expect(neonExtensionNamesFromSource(source)).toEqual([
      "myExt",
      "migrations",
    ]);
  });

  it("returns an empty list without an extensions section", () => {
    expect(neonExtensionNamesFromSource("services:\n\tfoo: App\\Foo")).toEqual(
      [],
    );
  });
});

describe("neonIndentUnitFromSource", () => {
  it("defaults to a tab", () => {
    expect(neonIndentUnitFromSource("services:")).toBe("\t");
  });

  it("detects tab indentation", () => {
    expect(neonIndentUnitFromSource("services:\n\tfoo: App\\Foo")).toBe("\t");
  });

  it("detects space indentation", () => {
    expect(neonIndentUnitFromSource("services:\n    foo: App\\Foo")).toBe(
      "    ",
    );
  });

  it("normalizes space indentation to the smallest indent step", () => {
    const source = "services:\n  foo:\n      setup:\n        - a()";

    expect(neonIndentUnitFromSource(source)).toBe("  ");
  });

  it("prefers tabs when any line is tab-indented", () => {
    expect(
      neonIndentUnitFromSource("services:\n    foo:\n\tbar: App\\Bar"),
    ).toBe("\t");
  });
});
