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
  it.each([
    ["workbench.zoomIn", "Cmd+=", "workbench.zoomOut", "Cmd+-"],
    ["workbench.zoomOut", "Cmd+-", "workbench.zoomReset", "Cmd+0"],
    ["workbench.zoomReset", "Cmd+0", "workbench.zoomIn", "Cmd+="],
  ] as const)(
    "leaves the new %s unbound when a preserved Save binding owns %s",
    (commandId, shortcut, unaffectedCommand, unaffectedShortcut) => {
      const persisted = { "editor.fontZoomIn": "", "editor.save": shortcut };
      const migration = migrateRetiredKeymapDefaults(persisted, 1, "mac");
      const keymap = normalizeKeymapSettings(migration.keymap, "mac");
      expect(keymap[commandId]).toBe("");
      expect(keymap[unaffectedCommand]).toBe(unaffectedShortcut);
      expect(keymap["editor.save"]).toBe(shortcut);
      expect(migrateRetiredKeymapDefaults(migration.keymap, migration.revision, "mac")).toEqual(
        migration,
      );
      expect(persisted).toEqual({ "editor.fontZoomIn": "", "editor.save": shortcut });
    },
  );

  it.each([
    ["workbench.zoomIn", " command + = "],
    ["workbench.zoomIn", "shift+cmd+="],
    ["workbench.zoomIn", "Cmd+Plus"],
    ["workbench.zoomIn", "Cmd+Equal"],
    ["workbench.zoomIn", "Cmd+NumpadAdd"],
    ["workbench.zoomIn", "Cmd+Add"],
    ["workbench.zoomOut", "Cmd+Minus"],
    ["workbench.zoomOut", "Cmd+NumpadSubtract"],
    ["workbench.zoomOut", "Cmd+Subtract"],
    ["workbench.zoomReset", "Cmd+Digit0"],
    ["workbench.zoomReset", "Cmd+Numpad0"],
    ["workbench.zoomIn", "Cmd+= Cmd+S"],
    ["workbench.zoomOut", "Cmd+- Cmd+S"],
    ["workbench.zoomReset", "Cmd+0 Cmd+S"],
  ] as const)(
    "recognizes normalized and physical conflicts for %s with %s",
    (commandId, shortcut) => {
      expect(migratedKeymap({ "editor.save": shortcut }, 1, "mac")[commandId]).toBe("");
    },
  );

  it.each(["linux", "windows", "other"] as const)(
    "recognizes both portable Command and native Control conflicts on %s",
    (platform) => {
      for (const modifier of ["Cmd", "Ctrl"]) {
        expect(
          migratedKeymap({ "editor.save": `${modifier}+=` }, 1, platform)["workbench.zoomIn"],
        ).toBe("");
        expect(
          migratedKeymap({ "editor.save": `${modifier}+-` }, 1, platform)["workbench.zoomOut"],
        ).toBe("");
        expect(
          migratedKeymap({ "editor.save": `${modifier}+0` }, 1, platform)["workbench.zoomReset"],
        ).toBe("");
      }
    },
  );

  it.each(["Cmd+S", "Ctrl+=", "Cmd+Alt+=", "Cmd+Shift+-", "Cmd+Shift+0", "Cmd+K Cmd+="])(
    "enables every new zoom default when the preserved binding %s does not conflict",
    (shortcut) => {
      expect(
        migratedKeymap({ "editor.fontZoomIn": "", "editor.save": shortcut }, 1, "mac"),
      ).toMatchObject({
        "workbench.zoomIn": "Cmd+=",
        "workbench.zoomOut": "Cmd+-",
        "workbench.zoomReset": "Cmd+0",
      });
    },
  );

  it("does not treat unknown commands or malformed bindings as preserved custom shortcuts", () => {
    expect(
      migratedKeymap({ "unknown.command": "Cmd+=", "editor.save": "Cmd++" }, 1, "mac")[
        "workbench.zoomIn"
      ],
    ).toBe("Cmd+=");
  });

  it("preserves explicitly assigned zoom bindings even when they collide", () => {
    const persisted = {
      "editor.save": "Cmd+=",
      "workbench.zoomIn": "Cmd+=",
      "workbench.zoomOut": "",
      "workbench.zoomReset": "Cmd+R",
    };
    expect(migrateRetiredKeymapDefaults(persisted, 1, "mac").keymap).toEqual(persisted);
  });

  it.each(["mac", "linux", "windows", "other"] as const)(
    "retires editor font defaults and enables window zoom on %s from revision one",
    (platform) => {
      const primary = platform === "mac" ? "Cmd" : "Ctrl";
      const persisted = {
        "editor.fontZoomIn": `${primary}+=`,
        "editor.fontZoomOut": `${primary}+-`,
        "editor.fontZoomReset": `${primary}+0`,
      };
      const migration = migrateRetiredKeymapDefaults(persisted, 1, platform);
      expect(migration.revision).toBe(KEYMAP_DEFAULTS_REVISION);
      expect(normalizeKeymapSettings(migration.keymap, platform)).toMatchObject({
        "editor.fontZoomIn": "",
        "editor.fontZoomOut": "",
        "editor.fontZoomReset": "",
        "workbench.zoomIn": `${primary}+=`,
        "workbench.zoomOut": `${primary}+-`,
        "workbench.zoomReset": `${primary}+0`,
      });
      expect(persisted["editor.fontZoomIn"]).toBe(`${primary}+=`);
      expect(migrateRetiredKeymapDefaults(migration.keymap, migration.revision, platform)).toEqual(
        migration,
      );
    },
  );

  it("preserves custom font bindings and window zoom removals during the revision two migration", () => {
    const persisted = {
      "editor.fontZoomIn": "Cmd+Alt+=",
      "editor.fontZoomOut": "Cmd+K Cmd+-",
      "editor.fontZoomReset": "",
      "workbench.zoomIn": "",
      "workbench.zoomOut": "Cmd+Alt+O",
    };
    expect(migrateRetiredKeymapDefaults(persisted, 1, "mac").keymap).toEqual(persisted);
  });

  it("preserves font defaults deliberately rebound after revision two", () => {
    const persisted = { "editor.fontZoomIn": "Cmd+=", "editor.fontZoomOut": "Cmd+-" };
    expect(migrateRetiredKeymapDefaults(persisted, 2, "mac").keymap).toEqual(persisted);
  });

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

    expect(migration.keymap).toEqual({ ...customised, "workbench.zoomIn": "" });
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

describe("New thread picker collision repair", () => {
  it.each([
    ["mac", "Cmd+Shift+N", "Cmd+Shift+N", "Cmd+N"],
    ["mac", "shift+cmd+n", "Shift+Cmd+N", "Cmd+N"],
    ["linux", "Ctrl+Shift+N", "Ctrl+Shift+N", "Ctrl+N"],
    ["windows", "Cmd+Shift+N", "Ctrl+Shift+N", "Ctrl+N"],
  ] as const)(
    "moves the %s picker off a shared %s back to its default",
    (platform, shared, newThread, newThreadIn) => {
      const persisted = { "agent.newThread": shared, "agent.newThreadIn": shared };
      const migration = migrateRetiredKeymapDefaults(persisted, 2, platform);

      expect(normalizeKeymapSettings(migration.keymap, platform)).toMatchObject({
        "agent.newThread": newThread,
        "agent.newThreadIn": newThreadIn,
      });
      expect(migration.revision).toBe(KEYMAP_DEFAULTS_REVISION);
      expect(migrateRetiredKeymapDefaults(migration.keymap, migration.revision, platform)).toEqual(
        migration,
      );
      expect(persisted).toEqual({ "agent.newThread": shared, "agent.newThreadIn": shared });
    },
  );

  it("leaves the picker unbound when a custom binding already owns its default", () => {
    const keymap = migratedKeymap(
      {
        "agent.newThread": "Cmd+Shift+N",
        "agent.newThreadIn": "Cmd+Shift+N",
        "editor.save": "Cmd+N",
      },
      2,
      "mac",
    );

    expect(keymap).toMatchObject({
      "agent.newThread": "Cmd+Shift+N",
      "agent.newThreadIn": "",
      "editor.save": "Cmd+N",
    });
  });

  it.each([
    [{ "agent.newThread": "Cmd+Shift+N", "agent.newThreadIn": "Cmd+Alt+N" }, 2],
    [{ "agent.newThread": "Cmd+Alt+N", "agent.newThreadIn": "Cmd+Alt+N" }, 2],
    [{ "agent.newThread": "Cmd+Shift+N", "agent.newThreadIn": "Cmd+Shift+N" }, 3],
  ] as const)("keeps New thread bindings %j saved at revision %i", (persisted, revision) => {
    expect(migratedKeymap(persisted, revision, "mac")).toMatchObject(persisted);
  });
});
