import { describe, expect, it } from "vitest";
import {
  defaultKeymapSettings,
  findKeymapConflicts,
  keymapCommands,
  normalizeKeymapSettings,
} from "./keymap";

describe("agent.newThreadIn keybinding", () => {
  it("binds New thread in… to Cmd+N and New thread to Shift+Cmd+N without conflicts", () => {
    expect(keymapCommands.find((command) => command.id === "agent.newThreadIn")).toMatchObject({
      category: "Agent",
      defaultShortcut: "Cmd+N",
    });
    expect(keymapCommands.find((command) => command.id === "agent.newThread")).toMatchObject({
      category: "Agent",
      defaultShortcut: "Cmd+Shift+N",
    });
    expect(defaultKeymapSettings("mac")).toMatchObject({
      "agent.newThreadIn": "Cmd+N",
      "agent.newThread": "Cmd+Shift+N",
    });
    for (const platform of ["linux", "windows"] as const) {
      expect(defaultKeymapSettings(platform)).toMatchObject({
        "agent.newThreadIn": "Ctrl+N",
        "agent.newThread": "Ctrl+Shift+N",
      });
    }
    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);
      expect(findKeymapConflicts(defaults, "agent.newThreadIn", platform)).toEqual([]);
      expect(findKeymapConflicts(defaults, "agent.newThread", platform)).toEqual([]);
    }
  });

  it("moves a keymap saved before New thread in… existed onto the picker command", () => {
    expect(normalizeKeymapSettings({ "agent.newThread": "Cmd+N" }, "mac")).toMatchObject({
      "agent.newThreadIn": "Cmd+N",
      "agent.newThread": "Cmd+Shift+N",
    });
    expect(normalizeKeymapSettings({ "agent.newThread": "Ctrl+N" }, "linux")).toMatchObject({
      "agent.newThreadIn": "Ctrl+N",
      "agent.newThread": "Ctrl+Shift+N",
    });
    expect(normalizeKeymapSettings({ "agent.newThread": "Cmd+Ctrl+T" }, "mac")).toMatchObject({
      "agent.newThreadIn": "Cmd+Ctrl+T",
      "agent.newThread": "Cmd+Shift+N",
    });
    expect(normalizeKeymapSettings({ "agent.newThread": "" }, "mac")).toMatchObject({
      "agent.newThreadIn": "",
      "agent.newThread": "Cmd+Shift+N",
    });
  });

  it.each([
    ["mac", "Cmd+Shift+N", "Cmd+Shift+N", "Cmd+N"],
    ["mac", "shift+cmd+n", "Shift+Cmd+N", "Cmd+N"],
    ["linux", "Ctrl+Shift+N", "Ctrl+Shift+N", "Ctrl+N"],
    ["linux", "Cmd+Shift+N", "Ctrl+Shift+N", "Ctrl+N"],
    ["windows", "Ctrl+Shift+N", "Ctrl+Shift+N", "Ctrl+N"],
  ] as const)(
    "keeps a %s keymap that lost the picker binding on the current New thread default %s",
    (platform, persisted, newThread, newThreadIn) => {
      expect(normalizeKeymapSettings({ "agent.newThread": persisted }, platform)).toMatchObject({
        "agent.newThread": newThread,
        "agent.newThreadIn": newThreadIn,
      });
    },
  );

  it.each([
    ["mac", "Cmd+Shift+N", "Cmd+N"],
    ["linux", "Ctrl+Shift+N", "Ctrl+N"],
    ["windows", "Ctrl+Shift+N", "Ctrl+N"],
  ] as const)(
    "leaves a missing %s picker unbound when a custom binding owns its default",
    (platform, newThread, owned) => {
      expect(
        normalizeKeymapSettings({ "agent.newThread": newThread, "editor.save": owned }, platform),
      ).toMatchObject({
        "agent.newThread": newThread,
        "agent.newThreadIn": "",
        "editor.save": owned,
      });
    },
  );

  it("keeps both bindings once the picker command has been saved", () => {
    expect(
      normalizeKeymapSettings(
        { "agent.newThread": "Cmd+Ctrl+N", "agent.newThreadIn": "Cmd+Ctrl+Shift+N" },
        "mac",
      ),
    ).toMatchObject({
      "agent.newThread": "Cmd+Ctrl+N",
      "agent.newThreadIn": "Cmd+Ctrl+Shift+N",
    });
    expect(normalizeKeymapSettings({ "agent.newThreadIn": "" }, "mac")).toMatchObject({
      "agent.newThreadIn": "",
      "agent.newThread": "Cmd+Shift+N",
    });
    expect(normalizeKeymapSettings({}, "mac")).toMatchObject({
      "agent.newThreadIn": "Cmd+N",
      "agent.newThread": "Cmd+Shift+N",
    });
  });
});
