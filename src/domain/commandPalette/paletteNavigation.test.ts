import { describe, expect, it } from "vitest";
import {
  INITIAL_PALETTE_NAVIGATION,
  currentPalettePage,
  reducePaletteNavigation,
} from "./paletteNavigation";

describe("reducePaletteNavigation", () => {
  it("opens root alone, files alone and other pages above root", () => {
    const root = reducePaletteNavigation(INITIAL_PALETTE_NAVIGATION, {
      type: "open",
      page: "root",
      query: ">",
    });
    const files = reducePaletteNavigation(root, { type: "open", page: "files", query: "" });
    const keys = reducePaletteNavigation(files, { type: "open", page: "shortcuts", query: "" });

    expect(root.stack).toEqual(["root"]);
    expect(root.query).toBe(">");
    expect(files.stack).toEqual(["files"]);
    expect(keys.stack).toEqual(["root", "shortcuts"]);
    expect(keys.generation).toBeGreaterThan(files.generation);
  });

  it("pushes a page with an empty query and pops back to its parent", () => {
    const typed = reducePaletteNavigation(INITIAL_PALETTE_NAVIGATION, {
      type: "setQuery",
      query: "ord",
    });
    const pushed = reducePaletteNavigation(typed, { type: "push", page: "switchProject" });
    const popped = reducePaletteNavigation(pushed, { type: "pop" });

    expect(currentPalettePage(pushed)).toBe("switchProject");
    expect(pushed.query).toBe("");
    expect(currentPalettePage(popped)).toBe("root");
    expect(popped.query).toBe("");
  });

  it("never pops the last page and ignores pushing the current page", () => {
    const popped = reducePaletteNavigation(INITIAL_PALETTE_NAVIGATION, { type: "pop" });
    const same = reducePaletteNavigation(INITIAL_PALETTE_NAVIGATION, {
      type: "push",
      page: "root",
    });

    expect(popped).toBe(INITIAL_PALETTE_NAVIGATION);
    expect(same).toBe(INITIAL_PALETTE_NAVIGATION);
  });

  it("bounds depth and query length", () => {
    let state = INITIAL_PALETTE_NAVIGATION;
    for (const page of [
      "switchProject",
      "theme",
      "appearance",
      "shortcuts",
      "runScript",
    ] as const) {
      state = reducePaletteNavigation(state, { type: "push", page });
    }
    const long = reducePaletteNavigation(state, { type: "setQuery", query: "x".repeat(5_000) });

    expect(state.stack.length).toBeLessThanOrEqual(4);
    expect(long.query.length).toBe(256);
  });
});
