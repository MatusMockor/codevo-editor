import { describe, expect, it } from "vitest";
import {
  calmDark,
  calmLight,
  customPalettes,
  materialDeepOcean,
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
});
