import { describe, expect, it } from "vitest";
import {
  PALETTE_IDS,
  RESOLVED_COLOR_SCHEMES,
  type PaletteId,
  type ResolvedColorScheme,
} from "../../domain/appearance";
import {
  paletteTokens,
  surfaceColor,
  type PaletteTokenName,
  type SurfaceRole,
} from "../../domain/appearancePalettes";
import {
  MAC_TRAFFIC_LIGHTS,
  SCHEME_SHELL_STATES,
  SHELL_TINT_NAMES,
  compositeOver,
  macTrafficLightInset,
} from "../../domain/appearanceShellStates";
import { contrastRatio } from "../../domain/themeContrast";
import {
  buildTokenTable,
  lastOf,
  parseAllStyleSheets,
  selectorParts,
  type CssRule,
} from "../../components/cssContractTestSupport";

const AA_TEXT = 4.5;
const NON_TEXT = 3;
const MIN_TONE_STEP = 1.03;
const MIN_HAIRLINE = 1.1;
const NEUTRAL_TEXT: readonly PaletteTokenName[] = ["fgStrong", "fg", "fgMuted", "fgSubtle"];
const STATUS_TEXT: readonly PaletteTokenName[] = ["accent", "ok", "danger", "warn"];
const TINTED_ROLES: readonly SurfaceRole[] = ["canvas", "side", "raised", "popover"];
const PANEL_ROLES: readonly SurfaceRole[] = ["canvas", "side"];
const SEMANTIC_SHEET = "ui/tokens/semantic.css";
const parsed = parseAllStyleSheets();

interface Backdrop {
  readonly label: string;
  readonly color: string;
}

function combinations(): ReadonlyArray<readonly [PaletteId, ResolvedColorScheme]> {
  return PALETTE_IDS.flatMap((palette) =>
    RESOLVED_COLOR_SCHEMES.map((scheme) => [palette, scheme] as const),
  );
}

function tintedBackdrops(palette: PaletteId, scheme: ResolvedColorScheme): readonly Backdrop[] {
  return TINTED_ROLES.flatMap((role) =>
    SHELL_TINT_NAMES.map((tint) => ({
      label: `${tint} over ${role}`,
      color: compositeOver(SCHEME_SHELL_STATES[scheme][tint], surfaceColor(palette, scheme, role)),
    })),
  );
}

function rowBackdrops(palette: PaletteId, scheme: ResolvedColorScheme): readonly Backdrop[] {
  if (scheme === "light") {
    return [
      { label: "row hover (canvas)", color: surfaceColor(palette, scheme, "canvas") },
      { label: "row active (raised)", color: surfaceColor(palette, scheme, "raised") },
    ];
  }
  return (["side", "canvas"] as const).flatMap((role) =>
    (["tint2", "tint3"] as const).map((tint) => ({
      label: `${tint} over ${role}`,
      color: compositeOver(SCHEME_SHELL_STATES.dark[tint], surfaceColor(palette, scheme, role)),
    })),
  );
}

function failures(
  foregrounds: readonly PaletteTokenName[],
  backdrops: (palette: PaletteId, scheme: ResolvedColorScheme) => readonly Backdrop[],
  minimum: number,
): readonly string[] {
  return combinations().flatMap(([palette, scheme]) => {
    const tokens = paletteTokens(palette, scheme);
    return backdrops(palette, scheme).flatMap((backdrop) =>
      foregrounds
        .map((name) => ({ name, ratio: contrastRatio(tokens[name], backdrop.color) }))
        .filter((entry) => entry.ratio < minimum)
        .map(
          (entry) =>
            `${palette} ${scheme}: ${entry.name} on ${backdrop.label} = ${entry.ratio.toFixed(2)}`,
        ),
    );
  });
}

function dividerRatio(palette: PaletteId, scheme: ResolvedColorScheme, role: SurfaceRole): number {
  const surface = surfaceColor(palette, scheme, role);
  return contrastRatio(compositeOver(SCHEME_SHELL_STATES[scheme].divider, surface), surface);
}

function sidebarToneStep(palette: PaletteId, scheme: ResolvedColorScheme): number {
  return contrastRatio(
    surfaceColor(palette, scheme, "side"),
    surfaceColor(palette, scheme, "canvas"),
  );
}

function schemeRules(scheme: ResolvedColorScheme): readonly CssRule[] {
  return parsed.rules.filter(
    (rule) =>
      rule.sheet === SEMANTIC_SHEET &&
      rule.context.length === 0 &&
      selectorParts(rule.selector).includes(`:root[data-cv-scheme="${scheme}"]`),
  );
}

function rootRules(): readonly CssRule[] {
  return parsed.rules.filter(
    (rule) =>
      rule.sheet === SEMANTIC_SHEET &&
      rule.context.length === 0 &&
      selectorParts(rule.selector).length === 1 &&
      selectorParts(rule.selector)[0] === ":root",
  );
}

function declared(rules: readonly CssRule[], name: string): string | undefined {
  return lastOf(buildTokenTable(rules, "--cv-").get(name));
}

describe("shell state contrast gate", () => {
  it("keeps neutral text at AA on every hover and active tint over every surface", () => {
    expect(failures(NEUTRAL_TEXT, tintedBackdrops, AA_TEXT)).toEqual([]);
  });

  it("keeps status and neutral text at AA on sidebar row hover and active states", () => {
    expect(failures([...NEUTRAL_TEXT, ...STATUS_TEXT], rowBackdrops, AA_TEXT)).toEqual([]);
  });

  it("separates the sidebar from the conversation by a visible tone step", () => {
    const flat = combinations()
      .map(([palette, scheme]) => ({
        label: `${palette} ${scheme}: side vs canvas`,
        ratio: sidebarToneStep(palette, scheme),
      }))
      .filter((entry) => entry.ratio < MIN_TONE_STEP)
      .map((entry) => `${entry.label} = ${entry.ratio.toFixed(3)}`);

    expect(flat).toEqual([]);
  });

  it("keeps panel dividers quiet hairlines that stay visible on every panel surface", () => {
    const outOfRange = combinations()
      .flatMap(([palette, scheme]) =>
        PANEL_ROLES.map((role) => ({
          label: `${palette} ${scheme}: divider on ${role}`,
          ratio: dividerRatio(palette, scheme, role),
        })),
      )
      .filter((entry) => entry.ratio < MIN_HAIRLINE || entry.ratio >= NON_TEXT)
      .map((entry) => `${entry.label} = ${entry.ratio.toFixed(3)}`);

    expect(outOfRange).toEqual([]);
  });

  it("draws a stronger divider in light than in dark and than the light mockup hairline", () => {
    const weak = PALETTE_IDS.flatMap((palette) =>
      PANEL_ROLES.flatMap((role) => {
        const canvas = surfaceColor(palette, "light", role);
        const hairline = contrastRatio(
          compositeOver(paletteTokens(palette, "light").hair, canvas),
          canvas,
        );
        const light = dividerRatio(palette, "light", role);
        const dark = dividerRatio(palette, "dark", role);
        return light > dark && light > hairline
          ? []
          : [
              `${palette} on ${role}: light ${light.toFixed(3)} dark ${dark.toFixed(3)} hairline ${hairline.toFixed(3)}`,
            ];
      }),
    );

    expect(weak).toEqual([]);
  });

  it("fails on the previous tint and on flat adjacent surfaces so the gate is not vacuous", () => {
    const previousTint = compositeOver(
      "rgba(255, 255, 255, 0.09)",
      surfaceColor("ink-mint", "dark", "popover"),
    );
    expect(contrastRatio(paletteTokens("ink-mint", "dark").fgSubtle, previousTint)).toBeLessThan(
      AA_TEXT,
    );
    const canvas = surfaceColor("graphite-teal", "dark", "canvas");
    expect(contrastRatio(canvas, canvas)).toBeLessThan(MIN_TONE_STEP);
  });

  it("composites translucent colours over a backdrop and passes solid colours through", () => {
    expect(compositeOver("rgba(255, 255, 255, 0.5)", "#000000")).toBe("#808080");
    expect(compositeOver("rgba(0, 0, 0, 0)", "#123456")).toBe("#123456");
    expect(compositeOver("#ABCDEF", "#000000")).toBe("#ABCDEF");
  });

  it("declares the typed tint and divider values in semantic.css", () => {
    for (const scheme of RESOLVED_COLOR_SCHEMES) {
      const rules = schemeRules(scheme);
      const states = SCHEME_SHELL_STATES[scheme];
      expect(declared(rules, "--cv-tint-1"), scheme).toBe(states.tint1);
      expect(declared(rules, "--cv-tint-2"), scheme).toBe(states.tint2);
      expect(declared(rules, "--cv-tint-3"), scheme).toBe(states.tint3);
      expect(declared(rules, "--cv-divider"), scheme).toBe(states.divider);
    }
  });

  it("declares the divider edges and the traffic-light inset on the root", () => {
    const rules = rootRules();
    expect(declared(rules, "--cv-edge-start-divider")).toBe("inset 1px 0 0 var(--cv-divider)");
    expect(declared(rules, "--cv-edge-end-divider")).toBe("inset -1px 0 0 var(--cv-divider)");
    expect(declared(rules, "--cv-edge-top-divider")).toBe("inset 0 1px 0 var(--cv-divider)");
    expect(declared(rules, "--cv-edge-bottom-divider")).toBe("inset 0 -1px 0 var(--cv-divider)");
    expect(macTrafficLightInset()).toBe(
      MAC_TRAFFIC_LIGHTS.x + MAC_TRAFFIC_LIGHTS.clusterWidth + MAC_TRAFFIC_LIGHTS.trailingGap,
    );
    expect(declared(rules, "--cv-traffic-light-inset")).toBe(`${macTrafficLightInset()}px`);
  });
});
