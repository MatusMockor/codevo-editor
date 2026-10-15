import { describe, expect, it } from "vitest";
import { encodeDiffViewWrap, parseDiffViewLayout, parseDiffViewWrap } from "./diffViewPreferences";

describe("diff view preferences", () => {
  it("accepts only known layouts", () => {
    expect(parseDiffViewLayout("split")).toBe("split");
    expect(parseDiffViewLayout("unified")).toBe("unified");
    for (const raw of [null, "", "Split", "side-by-side", '"split"']) {
      expect(parseDiffViewLayout(raw)).toBe("unified");
    }
  });

  it("accepts only exact wrap booleans", () => {
    expect(parseDiffViewWrap("true")).toBe(true);
    expect(parseDiffViewWrap("false")).toBe(false);
    for (const raw of [null, "", "1", "TRUE", "yes"]) expect(parseDiffViewWrap(raw)).toBe(false);
    expect(parseDiffViewWrap(encodeDiffViewWrap(true))).toBe(true);
  });
});
