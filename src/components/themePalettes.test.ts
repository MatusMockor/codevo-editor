import { describe, expect, it } from "vitest";
import {
  calmDark,
  calmLight,
  customPalettes,
  materialDeepOcean,
  oneLight,
  type ThemePalette,
} from "./themePalettes";

const allPalettes: ThemePalette[] = [...customPalettes, materialDeepOcean];

describe("theme palettes", () => {
  it("define a decorator color for every palette", () => {
    for (const palette of allPalettes) {
      expect(palette.decorator, palette.name).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });

  it("give calm-dark distinct colors for functions, parameters, types and variables", () => {
    const distinct = new Set([
      calmDark.func,
      calmDark.parameter,
      calmDark.property,
      calmDark.type,
      calmDark.variable,
    ]);
    // Five roles must produce five different colors (no flat collapse).
    expect(distinct.size).toBe(5);
  });

  it("give calm-light distinct colors for functions, parameters, types and variables", () => {
    const distinct = new Set([
      calmLight.func,
      calmLight.parameter,
      calmLight.property,
      calmLight.type,
      calmLight.variable,
    ]);
    expect(distinct.size).toBe(5);
  });

  it("puts the calm palettes on the airy canvas, raised and well tones", () => {
    expect(calmDark.bg).toBe("#13151a");
    expect(calmDark.lineHighlight).toBe("#1a1d23");
    expect(calmDark.widgetBg).toBe("#1a1d23");
    expect(calmDark.inputBg).toBe("#0f1014");
    expect(calmDark.selectedBg).toBe("#20232a");
    expect(calmLight.bg).toBe("#f0f2f5");
    expect(calmLight.lineHighlight).toBe("#ffffff");
    expect(calmLight.widgetBg).toBe("#ffffff");
    expect(calmLight.inputBg).toBe("#eaedf1");
    expect(calmLight.selectedBg).toBe("#e5e8ed");
  });

  it("drives the calm accents from the airy primary", () => {
    expect(calmDark.accent).toBe("#4fcdb3");
    expect(calmLight.accent).toBe("#15907c");
  });

  it("uses the muted and subtle foregrounds for gutter line numbers", () => {
    expect(calmDark.lineNumber).toBe("#6a7180");
    expect(calmDark.lineNumberActive).toBe("#9aa0ab");
    expect(calmLight.lineNumber).toBe("#99a1ad");
    expect(calmLight.lineNumberActive).toBe("#6c7482");
  });

  it("tints diffs with the airy ok and danger washes", () => {
    expect(calmDark.diffInserted).toBe("#4cc38a21");
    expect(calmDark.diffRemoved).toBe("#ef6f6f21");
    expect(calmLight.diffInserted).toBe("#1f9d5f21");
    expect(calmLight.diffRemoved).toBe("#d645451f");
  });

  it("takes the seven core syntax roles straight from the design scale", () => {
    expect({
      comment: calmDark.comment,
      func: calmDark.func,
      keyword: calmDark.keyword,
      number: calmDark.number,
      string: calmDark.string,
      type: calmDark.type,
      variable: calmDark.variable,
    }).toEqual({
      comment: "#6b7a6b",
      func: "#e6d39a",
      keyword: "#7fa3ff",
      number: "#b5cea8",
      string: "#d5a37f",
      type: "#7fd1c2",
      variable: "#bcd6f5",
    });
    expect({
      comment: calmLight.comment,
      func: calmLight.func,
      keyword: calmLight.keyword,
      number: calmLight.number,
      string: calmLight.string,
      type: calmLight.type,
      variable: calmLight.variable,
    }).toEqual({
      comment: "#9098a0",
      func: "#3b64c9",
      keyword: "#7b3fd6",
      number: "#a35c1c",
      string: "#4f8a41",
      type: "#b46a00",
      variable: "#2c3e5e",
    });
  });

  it("leaves the untouched palettes on their own backgrounds", () => {
    expect(materialDeepOcean.bg).toBe("#0f111a");
    expect(oneLight.bg).toBe("#fafafa");
  });
});
