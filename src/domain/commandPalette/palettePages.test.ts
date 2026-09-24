import { describe, expect, it } from "vitest";
import { isPalettePageId, palettePageCopy, paletteSurfaceForPage } from "./palettePages";

describe("palette pages", () => {
  it("maps only the files page to the files surface", () => {
    expect(paletteSurfaceForPage("files")).toBe("files");
    expect(paletteSurfaceForPage("root")).toBe("commands");
    expect(paletteSurfaceForPage("shortcuts")).toBe("commands");
  });

  it("uses the mockup copy", () => {
    expect(palettePageCopy("root", false)).toEqual({
      placeholder: "Search commands, projects, threads, and files…",
      enterLabel: null,
      empty: "No matching commands, projects, threads, or files.",
    });
    expect(palettePageCopy("root", true).empty).toBe("No matching actions.");
    expect(palettePageCopy("files", false)).toEqual({
      placeholder: "Search files…",
      enterLabel: "Open file",
      empty: "No matching files.",
    });
    expect(palettePageCopy("changeModel", false).placeholder).toBe("Search models…");
    expect(palettePageCopy("shortcuts", false)).toEqual({
      placeholder: "Search shortcuts…",
      enterLabel: "Run",
      empty: "No matching shortcuts.",
    });
    expect(palettePageCopy("switchBranch", false)).toEqual({
      placeholder: "Search…",
      enterLabel: null,
      empty: "No matches.",
    });
  });

  it("rejects unknown page ids", () => {
    expect(isPalettePageId("theme")).toBe(true);
    expect(isPalettePageId("settings")).toBe(false);
    expect(isPalettePageId(null)).toBe(false);
  });
});
