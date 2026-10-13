import { describe, expect, it } from "vitest";
import { defaultKeymapSettings, normalizeKeymapSettings, type KeymapPlatform } from "./keymap";
import { KEYMAP_DEFAULTS_REVISION, migrateRetiredKeymapDefaults } from "./keymapDefaultsMigration";

function migratedKeymap(keymap: unknown, revision: unknown, platform: KeymapPlatform) {
  return normalizeKeymapSettings(
    migrateRetiredKeymapDefaults(keymap, revision, platform).keymap,
    platform,
  );
}

describe("migrateRetiredKeymapDefaults", () => {
  it("moves the retired fold defaults to the new defaults once and bumps the revision", () => {
    const persisted = {
      ...defaultKeymapSettings("mac"),
      "editor.foldAll": "Cmd+Shift+-",
      "editor.unfoldAll": "Cmd+Shift+=",
    };

    const migration = migrateRetiredKeymapDefaults(persisted, undefined, "mac");

    expect(migration.revision).toBe(KEYMAP_DEFAULTS_REVISION);
    expect(normalizeKeymapSettings(migration.keymap, "mac")).toEqual(defaultKeymapSettings("mac"));
    expect(persisted["editor.unfoldAll"]).toBe("Cmd+Shift+=");
  });

  it("compares the persisted shortcut after normalisation", () => {
    expect(
      migratedKeymap(
        { "editor.foldAll": " command + shift + - ", "editor.unfoldAll": "shift+cmd+=" },
        undefined,
        "mac",
      ),
    ).toMatchObject({ "editor.foldAll": "Cmd+Alt+-", "editor.unfoldAll": "Cmd+Alt+=" });
  });

  it.each(["linux", "windows", "other"] as const)(
    "migrates both the Ctrl and the persisted Mac form of the retired defaults on %s",
    (platform) => {
      expect(
        migratedKeymap(
          { "editor.foldAll": "Ctrl+Shift+-", "editor.unfoldAll": "Ctrl+Shift+=" },
          undefined,
          platform,
        ),
      ).toMatchObject({ "editor.foldAll": "Ctrl+Alt+-", "editor.unfoldAll": "Ctrl+Alt+=" });
      expect(
        migratedKeymap(
          { "editor.foldAll": "Cmd+Shift+-", "editor.unfoldAll": "Cmd+Shift+=" },
          undefined,
          platform,
        ),
      ).toMatchObject({ "editor.foldAll": "Ctrl+Alt+-", "editor.unfoldAll": "Ctrl+Alt+=" });
    },
  );

  it("leaves customised fold shortcuts and every other command untouched", () => {
    const customised = {
      "editor.foldAll": "Cmd+Shift+U",
      "editor.save": "Cmd+Shift+=",
      "editor.toggleCase": "Cmd+Shift+-",
      "editor.unfoldAll": "",
    };

    const migration = migrateRetiredKeymapDefaults(customised, undefined, "mac");

    expect(migration.keymap).toEqual(customised);
    expect(migration.revision).toBe(KEYMAP_DEFAULTS_REVISION);
  });

  it("treats an explicit Control binding on macOS as a customisation", () => {
    expect(
      migratedKeymap(
        { "editor.foldAll": "Ctrl+Shift+-", "editor.unfoldAll": "Ctrl+Shift+=" },
        undefined,
        "mac",
      ),
    ).toMatchObject({ "editor.foldAll": "Ctrl+Shift+-", "editor.unfoldAll": "Ctrl+Shift+=" });
  });

  it("migrates each retired default independently", () => {
    expect(
      migratedKeymap(
        { "editor.foldAll": "Cmd+Alt+F", "editor.unfoldAll": "Cmd+Shift+=" },
        undefined,
        "mac",
      ),
    ).toMatchObject({ "editor.foldAll": "Cmd+Alt+F", "editor.unfoldAll": "Cmd+Alt+=" });
  });

  it("keeps a deliberate re-bind to a retired default once the revision is current", () => {
    const rebound = { "editor.foldAll": "Cmd+Shift+-", "editor.unfoldAll": "Cmd+Shift+=" };

    const migration = migrateRetiredKeymapDefaults(rebound, KEYMAP_DEFAULTS_REVISION, "mac");

    expect(migration.keymap).toEqual(rebound);
    expect(migration.revision).toBe(KEYMAP_DEFAULTS_REVISION);
  });

  it("never re-runs a migration for a revision written by a newer build", () => {
    const rebound = { "editor.unfoldAll": "Cmd+Shift+=" };

    const migration = migrateRetiredKeymapDefaults(rebound, KEYMAP_DEFAULTS_REVISION + 6, "mac");

    expect(migration.keymap).toEqual(rebound);
    expect(migration.revision).toBe(KEYMAP_DEFAULTS_REVISION + 6);
  });

  it.each([null, "1", -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, {}, [1]])(
    "treats the malformed revision %j as never migrated",
    (revision) => {
      const migration = migrateRetiredKeymapDefaults(
        { "editor.unfoldAll": "Cmd+Shift+=" },
        revision,
        "mac",
      );

      expect(migration.revision).toBe(KEYMAP_DEFAULTS_REVISION);
      expect(normalizeKeymapSettings(migration.keymap, "mac")["editor.unfoldAll"]).toBe(
        "Cmd+Alt+=",
      );
    },
  );

  it.each([undefined, null, "Cmd+Shift+=", 7])(
    "passes the non-record keymap %j through and still settles the revision",
    (keymap) => {
      const migration = migrateRetiredKeymapDefaults(keymap, undefined, "mac");

      expect(migration.keymap).toBe(keymap);
      expect(migration.revision).toBe(KEYMAP_DEFAULTS_REVISION);
    },
  );

  it("ignores a non-string persisted fold shortcut", () => {
    expect(
      migratedKeymap({ "editor.foldAll": 7, "editor.unfoldAll": null }, undefined, "mac"),
    ).toMatchObject({ "editor.foldAll": "Cmd+Alt+-", "editor.unfoldAll": "Cmd+Alt+=" });
  });
});
