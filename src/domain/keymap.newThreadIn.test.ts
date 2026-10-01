import { describe, expect, it } from "vitest";
import { defaultKeymapSettings, findKeymapConflicts, keymapCommands } from "./keymap";

describe("agent.newThreadIn keybinding", () => {
  it("binds New thread in… to Shift+Cmd+N without conflicts", () => {
    expect(keymapCommands.find((command) => command.id === "agent.newThreadIn")).toMatchObject({
      category: "Agent",
      defaultShortcut: "Cmd+Shift+N",
    });
    expect(defaultKeymapSettings("mac")["agent.newThreadIn"]).toBe("Cmd+Shift+N");
    expect(defaultKeymapSettings("linux")["agent.newThreadIn"]).toBe("Ctrl+Shift+N");
    for (const platform of ["mac", "linux", "windows"] as const) {
      const defaults = defaultKeymapSettings(platform);
      expect(findKeymapConflicts(defaults, "agent.newThreadIn", platform)).toEqual([]);
      expect(findKeymapConflicts(defaults, "agent.newThread", platform)).toEqual([]);
    }
  });
});
