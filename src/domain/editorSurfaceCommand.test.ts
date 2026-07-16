import { describe, expect, it } from "vitest";
import { editorSurfaceCommandIds } from "./editorSurfaceCommand";
import { keymapCommands } from "./keymap";

describe("editorSurfaceCommandIds", () => {
  it("keeps every surface command represented in the keymap", () => {
    const keymapCommandIds = new Set(keymapCommands.map(({ id }) => id));

    expect(
      editorSurfaceCommandIds.filter((id) => !keymapCommandIds.has(id)),
    ).toEqual([]);
  });
});
