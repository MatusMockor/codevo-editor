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
    "leaves the new %s unbound when a preserved Quit binding owns %s",
    (commandId, shortcut, unaffectedCommand, unaffectedShortcut) => {
      const persisted = { "editor.fontZoomIn": "", "app.quit": shortcut };
      const migration = migrateRetiredKeymapDefaults(persisted, 1, "mac");
      const keymap = normalizeKeymapSettings(migration.keymap, "mac");
      expect(keymap[commandId]).toBe("");
      expect(keymap[unaffectedCommand]).toBe(unaffectedShortcut);
      expect(keymap["app.quit"]).toBe(shortcut);
      expect(migrateRetiredKeymapDefaults(migration.keymap, migration.revision, "mac")).toEqual(
        migration,
      );
      expect(persisted).toEqual({ "editor.fontZoomIn": "", "app.quit": shortcut });
    },
  );

  it.each([
    ["mac", "Cmd+Enter"],
    ["linux", "Ctrl+Enter"],
    ["linux", "Cmd+Enter"],
    ["windows", "Ctrl+Enter"],
  ] as const)("retires the old %s Git commit default %s", (platform, shortcut) => {
    expect(migratedKeymap({ "git.commit": shortcut }, 3, platform)["git.commit"]).toBe("");
    expect(migratedKeymap({ "git.commit": shortcut }, 4, platform)["git.commit"]).toBe(shortcut);
  });

  it("keeps a custom Git commit binding when retiring the old default", () => {
    expect(migratedKeymap({ "git.commit": "Cmd+Alt+Enter" }, 3, "mac")["git.commit"]).toBe(
      "Cmd+Alt+Enter",
    );
  });

  it.each([
    ["mac", "workbench.zoomIn", "Cmd+="],
    ["mac", "workbench.zoomOut", "Cmd+-"],
    ["mac", "workbench.zoomReset", "Cmd+0"],
    ["linux", "workbench.zoomIn", "Ctrl+="],
    ["linux", "workbench.zoomOut", "Ctrl+-"],
    ["linux", "workbench.zoomReset", "Ctrl+0"],
    ["windows", "workbench.zoomIn", "Ctrl+="],
    ["windows", "workbench.zoomOut", "Ctrl+-"],
    ["windows", "workbench.zoomReset", "Ctrl+0"],
  ] as const)(
    "translates a legacy editor.closeTab binding before the %s %s default is admitted",
    (platform, commandId, shortcut) => {
      const keymap = migratedKeymap({ "editor.closeTab": shortcut }, 1, platform);
      expect(keymap["workbench.closeActive"]).toBe(shortcut);
      expect(keymap[commandId]).toBe("");
      expect(
        Object.entries(keymap)
          .filter(([, binding]) => binding === shortcut)
          .map(([id]) => id),
      ).toEqual(["workbench.closeActive"]);
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
      expect(migratedKeymap({ "app.quit": shortcut }, 1, "mac")[commandId]).toBe("");
    },
  );

  it.each(["linux", "windows", "other"] as const)(
    "recognizes both portable Command and native Control conflicts on %s",
    (platform) => {
      for (const modifier of ["Cmd", "Ctrl"]) {
        expect(
          migratedKeymap({ "app.quit": `${modifier}+=` }, 1, platform)["workbench.zoomIn"],
        ).toBe("");
        expect(
          migratedKeymap({ "app.quit": `${modifier}+-` }, 1, platform)["workbench.zoomOut"],
        ).toBe("");
        expect(
          migratedKeymap({ "app.quit": `${modifier}+0` }, 1, platform)["workbench.zoomReset"],
        ).toBe("");
      }
    },
  );

  it.each(["Cmd+S", "Ctrl+=", "Cmd+Alt+=", "Cmd+Shift+-", "Cmd+Shift+0", "Cmd+K Cmd+="])(
    "enables every new zoom default when the preserved binding %s does not conflict",
    (shortcut) => {
      expect(
        migratedKeymap({ "editor.fontZoomIn": "", "app.quit": shortcut }, 1, "mac"),
      ).toMatchObject({
        "workbench.zoomIn": "Cmd+=",
        "workbench.zoomOut": "Cmd+-",
        "workbench.zoomReset": "Cmd+0",
      });
    },
  );

  it("does not treat unknown commands or malformed bindings as preserved custom shortcuts", () => {
    expect(
      migratedKeymap(
        { "unknown.command": "Cmd+=", "editor.save": "Cmd+=", "app.quit": "Cmd++" },
        1,
        "mac",
      )["workbench.zoomIn"],
    ).toBe("Cmd+=");
  });

  it("preserves explicitly assigned zoom bindings even when they collide", () => {
    const persisted = {
      "app.quit": "Cmd+=",
      "workbench.zoomIn": "Cmd+=",
      "workbench.zoomOut": "",
      "workbench.zoomReset": "Cmd+R",
    };
    expect(migrateRetiredKeymapDefaults(persisted, 1, "mac").keymap).toEqual(persisted);
  });

  it.each(["mac", "linux", "windows", "other"] as const)(
    "drops the retired editor font and fold bindings and enables window zoom on %s",
    (platform) => {
      const primary = platform === "mac" ? "Cmd" : "Ctrl";
      const persisted = {
        "editor.fontZoomIn": `${primary}+=`,
        "editor.fontZoomOut": `${primary}+-`,
        "editor.fontZoomReset": `${primary}+0`,
        "editor.foldAll": `${primary}+Shift+-`,
        "editor.unfoldAll": `${primary}+Shift+=`,
      };
      const migration = migrateRetiredKeymapDefaults(persisted, 0, platform);
      const keymap = normalizeKeymapSettings(migration.keymap, platform);

      expect(migration.revision).toBe(KEYMAP_DEFAULTS_REVISION);
      expect(keymap).toEqual(defaultKeymapSettings(platform));
      expect(Object.keys(keymap).some((id) => id.startsWith("editor."))).toBe(false);
      expect(persisted["editor.fontZoomIn"]).toBe(`${primary}+=`);
      expect(migrateRetiredKeymapDefaults(migration.keymap, migration.revision, platform)).toEqual(
        migration,
      );
    },
  );

  it("keeps the defaults revision at three or later", () => {
    expect(KEYMAP_DEFAULTS_REVISION).toBeGreaterThanOrEqual(3);
  });

  it("returns the keymap unchanged once the revision is current", () => {
    const rebound = { "app.quit": "Cmd+Shift+-", "editor.unfoldAll": "Cmd+Shift+=" };

    const migration = migrateRetiredKeymapDefaults(rebound, KEYMAP_DEFAULTS_REVISION, "mac");

    expect(migration.keymap).toEqual(rebound);
    expect(migration.revision).toBe(KEYMAP_DEFAULTS_REVISION);
  });

  it("never re-runs a migration for a revision written by a newer build", () => {
    const rebound = { "app.quit": "" };

    const migration = migrateRetiredKeymapDefaults(rebound, KEYMAP_DEFAULTS_REVISION + 6, "mac");

    expect(migration.keymap).toEqual(rebound);
    expect(migration.revision).toBe(KEYMAP_DEFAULTS_REVISION + 6);
  });

  it.each([null, "1", -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60, {}, [1]])(
    "treats the malformed revision %j as never migrated",
    (revision) => {
      const migration = migrateRetiredKeymapDefaults({ "app.quit": "Cmd+=" }, revision, "mac");

      expect(migration.revision).toBe(KEYMAP_DEFAULTS_REVISION);
      expect(normalizeKeymapSettings(migration.keymap, "mac")["workbench.zoomIn"]).toBe("");
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
        "app.quit": "Cmd+N",
      },
      2,
      "mac",
    );

    expect(keymap).toMatchObject({
      "agent.newThread": "Cmd+Shift+N",
      "agent.newThreadIn": "",
      "app.quit": "Cmd+N",
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
