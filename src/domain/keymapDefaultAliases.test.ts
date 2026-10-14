import { describe, expect, it } from "vitest";
import {
  defaultKeymapSettings,
  defaultShortcutForCommand,
  keymapCommands,
  type KeymapPlatform,
} from "./keymap";
import {
  keymapDefaultAliasCommandIdsForEvent,
  keymapDefaultAliasIsActive,
  keymapDefaultAliases,
} from "./keymapDefaultAliases";

const PLATFORMS: readonly KeymapPlatform[] = ["mac", "linux", "windows", "other"];

describe("keymapDefaultAliases", () => {
  it("maps the window zoom in alias to the platform primary modifier", () => {
    expect(keymapDefaultAliases("mac")).toEqual([
      { commandId: "workbench.zoomIn", shortcut: "Cmd+Shift+=" },
    ]);
    for (const platform of ["linux", "windows", "other"] as const) {
      expect(keymapDefaultAliases(platform)).toEqual([
        { commandId: "workbench.zoomIn", shortcut: "Ctrl+Shift+=" },
      ]);
    }
  });

  it.each(PLATFORMS)("keeps every alias active on the default %s keymap", (platform) => {
    const keymap = defaultKeymapSettings(platform);

    for (const alias of keymapDefaultAliases(platform)) {
      expect(keymapDefaultAliasIsActive(keymap, alias, platform)).toBe(true);
    }
  });

  it.each(PLATFORMS)("never aliases a shortcut owned by a default %s binding", (platform) => {
    const defaults = keymapCommands.map((command) =>
      defaultShortcutForCommand(command.id, platform),
    );

    for (const alias of keymapDefaultAliases(platform)) {
      expect(defaults).not.toContain(alias.shortcut);
      expect(defaults.filter((shortcut) => shortcut.startsWith(`${alias.shortcut} `))).toEqual([]);
    }
  });

  it("deactivates an alias once its command leaves the default shortcut", () => {
    const [alias] = keymapDefaultAliases("mac");
    const rebound = { ...defaultKeymapSettings("mac"), "workbench.zoomIn": "Cmd+Alt+I" };
    const unbound = { ...defaultKeymapSettings("mac"), "workbench.zoomIn": "" };

    expect(alias && keymapDefaultAliasIsActive(rebound, alias, "mac")).toBe(false);
    expect(alias && keymapDefaultAliasIsActive(unbound, alias, "mac")).toBe(false);
  });

  it("deactivates an alias when another command is explicitly bound to its shortcut", () => {
    const [macAlias] = keymapDefaultAliases("mac");
    const [linuxAlias] = keymapDefaultAliases("linux");
    const macExplicit = { ...defaultKeymapSettings("mac"), "editor.unfoldAll": "Cmd+Shift+=" };
    const macControl = { ...defaultKeymapSettings("mac"), "editor.unfoldAll": "Ctrl+Shift+=" };
    const macChord = { ...defaultKeymapSettings("mac"), "editor.save": "Cmd+Shift+= Cmd+S" };
    const linuxExplicit = {
      ...defaultKeymapSettings("linux"),
      "editor.unfoldAll": "Ctrl+Shift+=",
    };
    const linuxMacForm = { ...defaultKeymapSettings("linux"), "editor.unfoldAll": "Cmd+Shift+=" };

    expect(macAlias && keymapDefaultAliasIsActive(macExplicit, macAlias, "mac")).toBe(false);
    expect(macAlias && keymapDefaultAliasIsActive(macControl, macAlias, "mac")).toBe(true);
    expect(macAlias && keymapDefaultAliasIsActive(macChord, macAlias, "mac")).toBe(false);
    expect(linuxAlias && keymapDefaultAliasIsActive(linuxExplicit, linuxAlias, "linux")).toBe(
      false,
    );
    expect(linuxAlias && keymapDefaultAliasIsActive(linuxMacForm, linuxAlias, "linux")).toBe(false);
  });

  it("resolves the alias command only for the exact shifted + chord of the platform", () => {
    const mac = defaultKeymapSettings("mac");
    const linux = defaultKeymapSettings("linux");

    expect(
      keymapDefaultAliasCommandIdsForEvent(
        mac,
        keyEvent({ key: "+", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toEqual(["workbench.zoomIn"]);
    expect(
      keymapDefaultAliasCommandIdsForEvent(
        mac,
        keyEvent({ key: "=", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toEqual(["workbench.zoomIn"]);
    expect(
      keymapDefaultAliasCommandIdsForEvent(
        linux,
        keyEvent({ ctrlKey: true, key: "+", shiftKey: true }),
        "linux",
      ),
    ).toEqual(["workbench.zoomIn"]);
    expect(
      keymapDefaultAliasCommandIdsForEvent(
        mac,
        keyEvent({ ctrlKey: true, key: "+", shiftKey: true }),
        "mac",
      ),
    ).toEqual([]);
    expect(
      keymapDefaultAliasCommandIdsForEvent(mac, keyEvent({ key: "+", metaKey: true }), "mac"),
    ).toEqual([]);
    expect(
      keymapDefaultAliasCommandIdsForEvent(
        mac,
        keyEvent({ altKey: true, key: "+", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toEqual([]);
    expect(
      keymapDefaultAliasCommandIdsForEvent(
        { ...mac, "editor.unfoldAll": "Cmd+Shift+=" },
        keyEvent({ key: "+", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toEqual([]);
  });
});

function keyEvent(
  overrides: Partial<
    Pick<KeyboardEvent, "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey">
  >,
): KeyboardEvent {
  return {
    altKey: false,
    code: "",
    ctrlKey: false,
    key: "",
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}
