import { describe, expect, it } from "vitest";
import { defaultKeymapSettings, type KeymapPlatform } from "../../../domain/keymap";
import { keybindingCategories, keybindingWhenLabel } from "./keybindingsPresentation";

const PRE_EXISTING_CONTEXT_RESOLVED_PAIRS: Readonly<Record<KeymapPlatform, readonly string[]>> = {
  mac: [
    "agent.searchThreads <> editor.deleteLine",
    "debug.stop <> workbench.action.debug.disconnect",
  ],
  windows: [
    "agent.searchThreads <> editor.deleteLine",
    "debug.setVariable <> editor.rename",
    "debug.stop <> workbench.action.debug.disconnect",
  ],
  linux: [
    "agent.searchThreads <> editor.deleteLine",
    "debug.setVariable <> editor.rename",
    "debug.stop <> workbench.action.debug.disconnect",
  ],
  other: [
    "agent.searchThreads <> editor.deleteLine",
    "debug.stop <> workbench.action.debug.disconnect",
  ],
};

function conflictingPairs(platform: KeymapPlatform): readonly string[] {
  const pairs = keybindingCategories(defaultKeymapSettings(platform), platform, "")
    .flatMap((category) => category.bindings)
    .flatMap((binding) =>
      binding.conflicts.map((conflict) => [binding.commandId, conflict.id].sort().join(" <> ")),
    );
  return [...new Set(pairs)].sort();
}

describe("keybindingCategories", () => {
  it.each(["mac", "windows", "linux", "other"] as const)(
    "reports no conflicts introduced by focus-scoped defaults on %s",
    (platform) => {
      expect(conflictingPairs(platform)).toEqual(PRE_EXISTING_CONTEXT_RESOLVED_PAIRS[platform]);
    },
  );

  it("does not flag the palette or sidebar defaults against editor-text bindings", () => {
    const flagged = conflictingPairs("mac").join("\n");

    expect(flagged).not.toContain("palette.open");
    expect(flagged).not.toContain("agent.toggleSidebar");
    expect(flagged).not.toContain("editor.goToDefinition");
  });

  it("still reports a real conflict between overlapping scopes", () => {
    const keymap = { ...defaultKeymapSettings("mac"), "palette.shortcuts": "Cmd+K" };

    const binding = keybindingCategories(keymap, "mac", "palette.shortcuts")
      .flatMap((category) => category.bindings)
      .find((candidate) => candidate.commandId === "palette.shortcuts");

    expect(binding?.conflicts.map((conflict) => conflict.id)).toContain("palette.open");
  });
});

describe("keybindingWhenLabel", () => {
  function bindingFor(commandId: string) {
    return keybindingCategories(defaultKeymapSettings("mac"), "mac", "")
      .flatMap((category) => category.bindings)
      .find((candidate) => candidate.commandId === commandId);
  }

  it.each([
    ["editor.splitDown", "Editor text focused"],
    ["agent.toggleSidebar", "Outside editor text"],
    ["editor.splitRight", "Always"],
    ["editor.nextRecentlyUsedEditor", "Reserved"],
  ] as const)("labels %s as %s", (commandId, label) => {
    const binding = bindingFor(commandId);

    expect(binding).toBeDefined();
    expect(binding === undefined ? null : keybindingWhenLabel(binding)).toBe(label);
  });
});
