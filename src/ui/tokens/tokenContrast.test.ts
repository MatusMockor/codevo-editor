import { describe, expect, it } from "vitest";
import {
  PALETTE_IDS,
  RESOLVED_COLOR_SCHEMES,
  type PaletteId,
  type ResolvedColorScheme,
} from "../../domain/appearance";
import { paletteTokens, type PaletteTokenName } from "../../domain/appearancePalettes";
import { contrastRatio } from "../../domain/themeContrast";

const AA_TEXT = 4.5;
const TEXT_TOKENS: readonly PaletteTokenName[] = [
  "fgStrong",
  "fg",
  "fgMuted",
  "fgSubtle",
  "accent",
  "ok",
  "danger",
  "warn",
];
const TEXT_SURFACES: readonly PaletteTokenName[] = ["s0", "s1", "s2", "s3", "popBg"];
const SYNTAX_TOKENS: readonly PaletteTokenName[] = ["synKw", "synStr", "synNum", "synCom"];
const SYNTAX_SURFACES: readonly PaletteTokenName[] = ["s0", "s1", "s2"];
const LEGACY_ON_ACCENT: Readonly<Record<ResolvedColorScheme, (palette: PaletteId) => string>> = {
  dark: (palette) => paletteTokens(palette, "dark").s0,
  light: () => "#FFFFFF",
};

interface ContrastPair {
  readonly pair: string;
  readonly foreground: string;
  readonly background: string;
}

function pairsFor(palette: PaletteId, scheme: ResolvedColorScheme): readonly ContrastPair[] {
  const tokens = paletteTokens(palette, scheme);
  const onSurfaces = (
    foregrounds: readonly PaletteTokenName[],
    backgrounds: readonly PaletteTokenName[],
  ): ContrastPair[] =>
    foregrounds.flatMap((foreground) =>
      backgrounds.map((background) => ({
        pair: `${foreground} on ${background}`,
        foreground: tokens[foreground],
        background: tokens[background],
      })),
    );

  return [
    ...onSurfaces(TEXT_TOKENS, TEXT_SURFACES),
    ...onSurfaces(SYNTAX_TOKENS, SYNTAX_SURFACES),
    { pair: "onAccent on accentFill", foreground: tokens.onAccent, background: tokens.accentFill },
    {
      pair: "legacy on-accent on accent",
      foreground: LEGACY_ON_ACCENT[scheme](palette),
      background: tokens.accent,
    },
  ];
}

describe("palette contrast gate", () => {
  it("checks all twelve palette and scheme combinations", () => {
    expect(PALETTE_IDS.length * RESOLVED_COLOR_SCHEMES.length).toBe(12);
  });

  it("keeps every text, syntax and accent pair at WCAG AA or better", () => {
    const failures = PALETTE_IDS.flatMap((palette) =>
      RESOLVED_COLOR_SCHEMES.flatMap((scheme) =>
        pairsFor(palette, scheme)
          .map((entry) => ({
            combination: `${palette} ${scheme}`,
            pair: entry.pair,
            ratio: contrastRatio(entry.foreground, entry.background),
          }))
          .filter((entry) => entry.ratio < AA_TEXT)
          .map((entry) => `${entry.combination}: ${entry.pair} = ${entry.ratio.toFixed(2)}`),
      ),
    );

    expect(failures).toEqual([]);
  });

  it("detects a pair below AA so the gate cannot pass vacuously", () => {
    expect(contrastRatio("#777777", "#888888")).toBeLessThan(AA_TEXT);
  });
});
