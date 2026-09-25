import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  buildTokenTable,
  customPropertyDeclarations,
  isSingleVar,
  lastOf,
  parseAllStyleSheets,
  readAllStyleSheets,
  referencesSelf,
  selectorParts,
  varListNames,
  varReferences,
  type CssRule,
} from "./cssContractTestSupport";

const TOKEN_SHEET_PREFIX = "ui/tokens/";
const FRAME_SHEET = "components/workbenchShellFrame.css";
const REMAP_PREFIXES = ["--agent-", "--settings-", "--toast-"] as const;
const SEMANTIC_SHEET = "ui/tokens/semantic.css";
const PALETTE_SHEET = "ui/tokens/palettes.css";
const PROMPT_BUBBLE_SELECTOR = ".agent-prompt__bubble";
const PROMPT_BUBBLE_TONE = /^--cv-tint-\d+$/;
const THREAD_COLUMN_SELECTOR = ".agent-mode__center";
const THREAD_COLUMN_TONE = "--cv-canvas";
const THREAD_COLUMN_LAYERS = [
  ".agent-session__scroll",
  ".agent-session__body",
  ".cv-conversation-column",
  ".agent-turn-list",
  ".agent-turn",
  ".agent-prompt",
] as const;
const CV_SCHEMES = ["dark", "light"] as const;
const PALETTE_BLOCK = /^:root\[data-cv-palette="([\w-]+)"\]\[data-cv-scheme="(dark|light)"\]$/;
const RGBA_LITERAL = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/;
const SHADOW_TOKEN = /(^|-)shadow(-|$)|-ring$/;
const RADIUS_TOKEN = /radius|-r-(xs|sm|md|lg|xl|pill)$/;
const FONT_SIZE_TOKEN = /-fs-/;
const FONT_FAMILY_TOKEN = /(^|-)(sans|mono|font(-[\w-]+)?)$/;
const DIMENSION_TOKEN = /^[\d.]+(px|em|rem|ms|%)?$/;

const parsed = parseAllStyleSheets();
const sheets = readAllStyleSheets();

function literalProblem(name: string, value: string): string | null {
  if (COLOR_LITERAL.test(value)) return "colour literal";
  if (SHADOW_TOKEN.test(name) && value !== "none" && varListNames(value) === null) {
    return "shadow literal";
  }
  if (RADIUS_TOKEN.test(name) && !isSingleVar(value)) return "radius literal";
  if (FONT_SIZE_TOKEN.test(name) && !isSingleVar(value)) return "font-size literal";
  if (FONT_FAMILY_TOKEN.test(name) && !isSingleVar(value)) return "font-family literal";
  return null;
}

function rootValue(name: string): string {
  const rules = parsed.rules.filter(
    (rule) =>
      rule.sheet === SEMANTIC_SHEET && rule.context.length === 0 && rule.selector === ":root",
  );
  return lastOf(buildTokenTable(rules, "--cv-").get(name)) ?? "";
}

function schemeValue(scheme: string, name: string): string {
  return lastOf(schemeTable(scheme).get(name)) ?? "";
}

const PROMPT_BUBBLE_MIN_STEP = 3;

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function lightness(hex: string): number {
  const parsed = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  expect(parsed, `expected a six digit hex colour, received "${hex}"`).not.toBeNull();
  const digits = parsed?.[1] ?? "000000";
  const channels = [0, 2, 4].map((offset) =>
    channelLuminance(Number.parseInt(digits.slice(offset, offset + 2), 16)),
  );
  const luminance =
    0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
  return luminance <= 0.008856 ? 903.3 * luminance : 116 * Math.cbrt(luminance) - 16;
}

type Tint = { readonly channels: readonly number[]; readonly alpha: number };

function parseTint(value: string): Tint {
  const match = RGBA_LITERAL.exec(value.trim());
  expect(match, `expected an rgba tint, received "${value}"`).not.toBeNull();
  const numbers = (match ?? []).slice(1).map(Number);
  return { channels: numbers.slice(0, 3), alpha: numbers[3] ?? 0 };
}

function composite(surface: string, tint: Tint): string {
  const digits = surface.trim().slice(1);
  return `#${[0, 2, 4]
    .map((offset, index) => {
      const base = Number.parseInt(digits.slice(offset, offset + 2), 16);
      const mixed = Math.round(base * (1 - tint.alpha) + (tint.channels[index] ?? 0) * tint.alpha);
      return mixed.toString(16).padStart(2, "0");
    })
    .join("")}`;
}

function backgroundsOf(selector: string): readonly string[] {
  return parsed.rules
    .filter((rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector))
    .flatMap((rule) => rule.declarations)
    .filter((entry) => entry.property === "background" || entry.property === "background-color")
    .map((entry) => entry.value);
}

function singleVarToken(value: string | undefined, label: string): string {
  expect(isSingleVar(value ?? ""), `${label} is a single token: ${value}`).toBe(true);
  return varReferences(value ?? "")[0] ?? "";
}

function schemeTable(scheme: string): ReturnType<typeof buildTokenTable> {
  return buildTokenTable(
    parsed.rules.filter(
      (rule) =>
        rule.sheet === SEMANTIC_SHEET &&
        rule.context.length === 0 &&
        selectorParts(rule.selector).includes(`:root[data-cv-scheme="${scheme}"]`),
    ),
    "--cv-",
  );
}

function paletteBlocks(scheme: string): ReadonlyMap<string, readonly CssRule[]> {
  const blocks = new Map<string, CssRule[]>();
  for (const rule of parsed.rules) {
    if (rule.sheet !== PALETTE_SHEET || rule.context.length !== 0) continue;
    for (const part of selectorParts(rule.selector)) {
      const match = PALETTE_BLOCK.exec(part);
      if (match === null || match[2] !== scheme) continue;
      const name = match[1] ?? "";
      blocks.set(name, [...(blocks.get(name) ?? []), rule]);
    }
  }
  return blocks;
}

describe("palette token contract", () => {
  it("parses every stylesheet under src without issues", () => {
    expect(parsed.issues).toEqual([]);
  });

  it("declares palette tokens only in the token sheets", () => {
    const foreign = customPropertyDeclarations(parsed.rules, "--cv-")
      .filter((entry) => !entry.rule.sheet.startsWith(TOKEN_SHEET_PREFIX))
      .map((entry) => `${entry.rule.sheet} ${entry.property}`);

    expect(foreign).toEqual([]);
  });

  it("never declares a token in terms of itself", () => {
    const cycles = customPropertyDeclarations(parsed.rules, "--")
      .filter((entry) => referencesSelf(entry.property, entry.value))
      .map((entry) => `${entry.rule.sheet} ${entry.property}`);

    expect(cycles).toEqual([]);
  });

  it("keeps the card shadow flat in dark and soft in light", () => {
    expect(schemeValue("dark", "--cv-shadow-card")).toBe("none");
    expect(schemeValue("light", "--cv-shadow-card")).toContain("rgba(18, 20, 30");
  });

  it("pins the tone roles to the amended surface model", () => {
    expect(schemeValue("dark", "--cv-canvas")).toBe("var(--cv-s0)");
    expect(schemeValue("dark", "--cv-side")).toBe("var(--cv-s1)");
    expect(schemeValue("light", "--cv-canvas")).toBe("var(--cv-s1)");
    expect(schemeValue("light", "--cv-side")).toBe("var(--cv-s0)");
    for (const scheme of CV_SCHEMES) {
      expect(schemeValue(scheme, "--cv-raised"), scheme).toBe("var(--cv-s2)");
    }
  });

  it("pins the radii and the neutral type scale", () => {
    expect(rootValue("--cv-r-control")).toBe("8px");
    expect(rootValue("--cv-r-card")).toBe("10px");
    expect(rootValue("--cv-r-group")).toBe("12px");
    expect(rootValue("--cv-r-pill")).toBe("999px");
    expect(rootValue("--cv-type-scale")).toBe("1");
  });

  it("lifts the prompt bubble off the thread column by tone in every palette and scheme", () => {
    const bubbleBackgrounds = backgroundsOf(PROMPT_BUBBLE_SELECTOR);
    expect(bubbleBackgrounds, "prompt bubble backgrounds").toHaveLength(1);
    const bubbleTone = singleVarToken(bubbleBackgrounds[0], "prompt bubble background");
    expect(bubbleTone).toMatch(PROMPT_BUBBLE_TONE);

    const columnBackgrounds = backgroundsOf(THREAD_COLUMN_SELECTOR);
    expect(columnBackgrounds, "thread column backgrounds").toHaveLength(1);
    expect(singleVarToken(columnBackgrounds[0], "thread column background")).toBe(
      THREAD_COLUMN_TONE,
    );
    expect(bubbleTone).not.toBe(THREAD_COLUMN_TONE);
    for (const layer of THREAD_COLUMN_LAYERS) {
      expect(backgroundsOf(layer), `${layer} stays transparent over the column`).toEqual([]);
    }

    const foreignTone = customPropertyDeclarations(parsed.rules, "--cv-")
      .filter((entry) => entry.property === bubbleTone || entry.property === THREAD_COLUMN_TONE)
      .filter((entry) => entry.rule.sheet !== SEMANTIC_SHEET)
      .map((entry) => `${entry.rule.sheet} ${entry.property}`);
    expect(foreignTone).toEqual([]);

    const lightPalettes = [...paletteBlocks("light").keys()].sort();
    expect([...paletteBlocks("dark").keys()].sort()).toEqual(lightPalettes);

    for (const scheme of CV_SCHEMES) {
      const semantic = schemeTable(scheme);
      const tint = parseTint(lastOf(semantic.get(bubbleTone)) ?? "");
      expect(tint.alpha, `${scheme} bubble tint alpha`).toBeGreaterThan(0);
      const surface = singleVarToken(lastOf(semantic.get(THREAD_COLUMN_TONE)), `${scheme} column`);

      const palettes = paletteBlocks(scheme);
      expect(palettes.size, `${scheme} palettes`).toBeGreaterThan(0);
      for (const [palette, rules] of palettes) {
        const label = `${palette} ${scheme}`;
        const column = lastOf(buildTokenTable(rules, "--cv-").get(surface));
        expect(column, `${label} column tone`).toBeDefined();
        const bubble = composite(column ?? "", tint);
        expect(bubble, `${label} bubble vs column`).not.toBe(column?.toLowerCase());
        const step = Math.abs(lightness(bubble) - lightness(column ?? ""));
        expect(step, `${label} bubble vs column lightness step`).toBeGreaterThanOrEqual(
          PROMPT_BUBBLE_MIN_STEP,
        );
      }
    }
  });

  it("removes every t3 token", () => {
    const declared = customPropertyDeclarations(parsed.rules, "--t3-").map(
      (entry) => `${entry.rule.sheet} ${entry.property}`,
    );
    const referenced = sheets
      .filter((sheet) => sheet.source.includes("--t3-"))
      .map((sheet) => sheet.sheet);

    expect(declared).toEqual([]);
    expect(referenced).toEqual([]);
  });

  it("keeps the agent, settings and toast remaps free of literal colours, shadows, radii and fonts", () => {
    const problems = customPropertyDeclarations(parsed.rules, "--")
      .filter((entry) => REMAP_PREFIXES.some((prefix) => entry.property.startsWith(prefix)))
      .map((entry) => ({ entry, problem: literalProblem(entry.property, entry.value) }))
      .filter((candidate) => candidate.problem !== null)
      .map(
        (candidate) =>
          `${candidate.entry.rule.sheet} ${candidate.entry.property}: ${candidate.entry.value} (${candidate.problem})`,
      );

    expect(problems).toEqual([]);
  });

  it("keeps the workbench frame layout variables as plain dimensions", () => {
    const frame: readonly CssRule[] = parsed.rules.filter(
      (rule) =>
        rule.sheet === FRAME_SHEET &&
        rule.context.length === 0 &&
        rule.selector === ".workbench-frame",
    );
    const suspicious = customPropertyDeclarations(frame, "--agent-")
      .filter((entry) => !DIMENSION_TOKEN.test(entry.value))
      .filter((entry) => !/^[\d.]+(px|em)( [\d.]+(px|em))+$/.test(entry.value))
      .map((entry) => `${entry.property}: ${entry.value}`);

    expect(customPropertyDeclarations(frame, "--agent-").length).toBeGreaterThan(0);
    expect(suspicious).toEqual([]);
  });
});
