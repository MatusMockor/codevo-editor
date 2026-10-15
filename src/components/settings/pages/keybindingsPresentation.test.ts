import { describe, expect, it } from "vitest";
import { defaultKeymapSettings, type KeymapPlatform } from "../../../domain/keymap";
import { keybindingCategories } from "./keybindingsPresentation";

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
    "reports no conflicts between the default bindings on %s",
    (platform) => {
      expect(conflictingPairs(platform)).toEqual([]);
    },
  );

  it("still reports a real conflict between overlapping scopes", () => {
    const keymap = { ...defaultKeymapSettings("mac"), "palette.shortcuts": "Cmd+K" };

    const binding = keybindingCategories(keymap, "mac", "palette.shortcuts")
      .flatMap((category) => category.bindings)
      .find((candidate) => candidate.commandId === "palette.shortcuts");

    expect(binding?.conflicts.map((conflict) => conflict.id)).toContain("palette.open");
  });
});
