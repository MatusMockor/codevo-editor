import { describe, expect, it } from "vitest";
import { parsePaletteRootQuery } from "./paletteRootQuery";

describe("parsePaletteRootQuery", () => {
  it("classifies empty, actions-only, file prefix and search input", () => {
    expect(parsePaletteRootQuery("   ")).toEqual({ kind: "empty" });
    expect(parsePaletteRootQuery(">")).toEqual({ kind: "actions", text: "" });
    expect(parsePaletteRootQuery("> toggle")).toEqual({ kind: "actions", text: " toggle" });
    expect(parsePaletteRootQuery("@")).toEqual({ kind: "files", text: "" });
    expect(parsePaletteRootQuery("@ord")).toEqual({ kind: "files", text: "ord" });
    expect(parsePaletteRootQuery("ord")).toEqual({ kind: "search", text: "ord" });
  });
});
