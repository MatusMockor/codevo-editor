import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  SYSTEM_LIGHT_CONTEXT,
  SYSTEM_THEME_SELECTOR as SYSTEM_THEME,
  buildTokenTable,
  customPropertyDeclarations,
  isSingleVar,
  lastOf,
  parseCssRules,
  readStyleSheet,
  referencesSelf,
  selectorParts,
  varReferences,
  type CssRule,
} from "../cssContractTestSupport";
import { AGENT_MODE_STYLE_SHEETS, agentModeSheetPath } from "./agentModeCssTestSupport";

const SYSTEM_LIGHT = "system-light";

const FRAME_SHEET = "components/workbenchShellFrame.css";
const TOKEN_SCOPE = /^(\.workbench-frame|\.app-shell|\.editor-workbench)/;
const LIGHT_FRAME_SELECTORS = [
  '.app-shell[data-theme="light"] .workbench-frame',
  '.app-shell[data-theme="catppuccinLatte"] .workbench-frame',
  '.app-shell[data-theme="oneLight"] .workbench-frame',
] as const;

const agentRules = AGENT_MODE_STYLE_SHEETS.flatMap((sheet) => {
  const path = agentModeSheetPath(sheet);
  return parseCssRules(readStyleSheet(path).source, path).rules;
});
const frameRules = parseCssRules(readStyleSheet(FRAME_SHEET).source, FRAME_SHEET).rules;
const allRules = [...agentRules, ...frameRules];
const tokenRules = agentRules.filter(
  (rule) => rule.sheet === agentModeSheetPath("agentModeTokens.css"),
);

function declaredNames(rules: readonly CssRule[], prefix: string): ReadonlySet<string> {
  return new Set(customPropertyDeclarations(rules, prefix).map((entry) => entry.property));
}

function frameBase(): readonly CssRule[] {
  return tokenRules.filter(
    (rule) => rule.selector === ".workbench-frame" && rule.context.length === 0,
  );
}

function shellBase(): readonly CssRule[] {
  return tokenRules.filter((rule) => rule.selector === ".app-shell" && rule.context.length === 0);
}

const APP_SHEET = "App.css";
const APP_THEME_SELECTORS = [
  ":root",
  '.app-shell[data-theme="light"]',
  '.app-shell[data-theme="ayuMirage"]',
  '.app-shell[data-theme="materialDeepOcean"]',
  '.app-shell[data-theme="oneDarkPro"]',
  '.app-shell[data-theme="dracula"]',
  '.app-shell[data-theme="catppuccinMocha"]',
  '.app-shell[data-theme="darkPlus"]',
  '.app-shell[data-theme="catppuccinLatte"]',
  '.app-shell[data-theme="oneLight"]',
] as const;
const SOFT_TONE_STEPS = [
  ["--codevo-well-soft", 2.5],
  ["--codevo-hover-soft", 2.5],
  ["--codevo-line", 1.5],
  ["--codevo-line-strong", 3],
] as const;
const MIX = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/;
const HEX = /^#([0-9a-f]{6})$/i;

const appRules = parseCssRules(readStyleSheet(APP_SHEET).source, APP_SHEET).rules;

function themeTones(selector: string): ReadonlyMap<string, string> {
  const scoped = (target: string): readonly CssRule[] =>
    appRules.filter(
      (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(target),
    );
  const merged = new Map<string, string>();
  const collect = (rules: readonly CssRule[]): void => {
    for (const entry of customPropertyDeclarations(rules, "--color-")) {
      merged.set(entry.property, entry.value);
    }
  };
  collect(scoped(":root"));
  if (selector === SYSTEM_LIGHT) {
    collect(
      appRules.filter(
        (rule) => rule.context[0] === SYSTEM_LIGHT_CONTEXT && rule.selector === SYSTEM_THEME,
      ),
    );
  }
  if (selector !== ":root" && selector !== SYSTEM_LIGHT) collect(scoped(selector));
  for (const entry of customPropertyDeclarations(shellBase(), "--codevo-")) {
    merged.set(entry.property, entry.value);
  }
  return merged;
}

function channels(hex: string): readonly number[] {
  const digits = HEX.exec(hex.trim())?.[1] ?? "000000";
  return [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16));
}

function toHex(values: readonly number[]): string {
  return `#${values.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function resolveTone(value: string, tones: ReadonlyMap<string, string>, depth = 0): string {
  const trimmed = value.trim();
  if (depth > 10) return trimmed;
  if (HEX.test(trimmed)) return trimmed.toLowerCase();
  const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(trimmed)?.[1];
  if (reference !== undefined) return resolveTone(tones.get(reference) ?? "", tones, depth + 1);
  const mix = MIX.exec(trimmed);
  if (mix === null) return trimmed;
  const weight = Number.parseFloat(mix[2] ?? "0") / 100;
  const first = channels(resolveTone(mix[1] ?? "", tones, depth + 1));
  const second = channels(resolveTone(mix[3] ?? "", tones, depth + 1));
  return toHex(first.map((value, index) => weight * value + (1 - weight) * (second[index] ?? 0)));
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function lightness(hex: string): number {
  const linear = channels(hex).map(channelLuminance);
  const luminance =
    0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
  return luminance <= 0.008856 ? 903.3 * luminance : 116 * Math.cbrt(luminance) - 16;
}

function tone(selector: string, name: string): string {
  const tones = themeTones(selector);
  return resolveTone(tones.get(name) ?? "", tones);
}

function withinTolerance(got: string, expected: string): number {
  const a = channels(got);
  const b = channels(expected);
  return Math.max(...a.map((value, index) => Math.abs(value - (b[index] ?? 0))));
}

const TYPE_STEPS = ["hero", "title", "heading", "body", "ui", "meta", "small", "label"] as const;
const AGENT_TYPE_STEPS = [
  "--agent-fs-2xs",
  "--agent-fs-xs",
  "--agent-fs-sm",
  "--agent-fs-md",
  "--agent-fs-lg",
  "--agent-fs-xl",
] as const;

describe("agent mode token contract", () => {
  it("never declares a token in terms of itself", () => {
    const cycles = customPropertyDeclarations(allRules, "--")
      .filter((entry) => referencesSelf(entry.property, entry.value))
      .map((entry) => entry.property);

    expect(cycles).toEqual([]);
  });

  it("defines every agent token it references across the agent styles and the shell frame", () => {
    const defined = declaredNames(allRules, "--agent-");
    const undefinedTokens = [
      ...new Set(
        allRules.flatMap((rule) =>
          rule.declarations.flatMap((declaration) => varReferences(declaration.value)),
        ),
      ),
    ]
      .filter((name) => name.startsWith("--agent-") && !defined.has(name))
      .sort();

    expect(undefinedTokens).toEqual([]);
  });

  it("keeps the frame-owned layout tokens out of the agent visual styles", () => {
    const agentDefined = declaredNames(agentRules, "--agent-");
    const frameDefined = declaredNames(frameRules, "--agent-");

    for (const token of [
      "--agent-rail-track",
      "--agent-rail-width",
      "--agent-rail-collapsed-width",
      "--agent-surface-tree-width",
      "--agent-surface-header-height",
    ]) {
      expect(frameDefined.has(token), token).toBe(true);
      expect(agentDefined.has(token), token).toBe(false);
    }
  });

  it("declares every agent token inside the shell frame scope", () => {
    const unscoped = allRules
      .filter((rule) => rule.declarations.some((entry) => entry.property.startsWith("--agent-")))
      .map((rule) => rule.selector)
      .filter((selector) => selectorParts(selector).some((part) => !TOKEN_SCOPE.test(part)));

    expect(unscoped).toEqual([]);
  });

  it("remaps every agent role to the codevo ladder or a dimension", () => {
    const base = buildTokenTable(frameBase(), "--agent-");
    const expectation: ReadonlyArray<readonly [string, string]> = [
      ["--agent-canvas", "var(--codevo-canvas)"],
      ["--agent-thread-canvas", "var(--codevo-thread)"],
      ["--agent-rail", "var(--codevo-side)"],
      ["--agent-raised", "var(--codevo-raised)"],
      ["--agent-well", "var(--codevo-well-soft)"],
      ["--agent-fill", "var(--codevo-active)"],
      ["--agent-hover", "var(--codevo-hover-soft)"],
      ["--agent-hairline", "var(--codevo-line)"],
      ["--agent-hairline-strong", "var(--codevo-line-strong)"],
      ["--agent-text-strong", "var(--codevo-fg-strong)"],
      ["--agent-text", "var(--codevo-prose)"],
      ["--agent-text-muted", "var(--codevo-fg-muted)"],
      ["--agent-code-background", "var(--codevo-well-soft)"],
      ["--agent-text-subtle", "var(--codevo-prose-subtle)"],
      ["--agent-text-disabled", "var(--codevo-fg-disabled)"],
      ["--agent-live", "var(--codevo-primary)"],
      ["--agent-live-soft", "var(--codevo-primary-soft)"],
      ["--agent-live-contrast", "var(--codevo-primary-fg)"],
      ["--agent-ok", "var(--codevo-ok)"],
      ["--agent-attention", "var(--codevo-warn)"],
      ["--agent-danger", "var(--codevo-danger)"],
      ["--agent-status-working", "var(--codevo-ok)"],
      ["--agent-status-failed", "var(--codevo-danger)"],
      ["--agent-row-selected", "var(--codevo-raised)"],
      ["--agent-focus-ring", "var(--codevo-focus-ring)"],
      ["--agent-shadow-raised", "var(--codevo-shadow-card)"],
      ["--agent-shadow-well", "none"],
      ["--agent-ambient", "none"],
      ["--agent-scanline", "transparent"],
      ["--agent-composer-outline", "transparent"],
      ["--agent-composer-highlight", "transparent"],
      ["--agent-cta-bg", "var(--codevo-primary)"],
      ["--agent-cta-fg", "var(--codevo-primary-fg)"],
      ["--agent-radius-sm", "var(--codevo-r-sm)"],
      ["--agent-radius-md", "var(--codevo-r-md)"],
      ["--agent-radius-lg", "var(--codevo-r-lg)"],
      ["--agent-radius-xl", "var(--codevo-r-xl)"],
      ["--agent-radius-pill", "var(--codevo-r-pill)"],
      ["--agent-fs-2xs", "var(--codevo-fs-small)"],
      ["--agent-fs-xs", "var(--codevo-fs-meta)"],
      ["--agent-fs-sm", "var(--codevo-fs-meta)"],
      ["--agent-fs-md", "var(--codevo-fs-ui)"],
      ["--agent-fs-lg", "var(--codevo-fs-heading)"],
      ["--agent-fs-xl", "var(--codevo-fs-title)"],
      ["--agent-sans", "var(--codevo-sans)"],
      ["--agent-mono", "var(--codevo-mono)"],
    ];
    for (const [name, value] of expectation) {
      expect(lastOf(base.get(name)), name).toBe(value);
    }
  });

  it("drives every type step from the one user scale", () => {
    const shell = buildTokenTable(shellBase(), "--codevo-fs-");

    expect(lastOf(shell.get("--codevo-fs-scale"))).toBe("1");

    for (const step of TYPE_STEPS) {
      const value = lastOf(shell.get(`--codevo-fs-${step}`)) ?? "";

      expect(value, step).toMatch(/^calc\(\d+px \* var\(--codevo-fs-scale\)\)$/);
      expect(varReferences(value), step).toEqual(["--codevo-fs-scale"]);
    }
  });

  it("keeps every agent type step tied to a scaled codevo step", () => {
    const base = buildTokenTable(frameBase(), "--agent-fs-");
    const shell = buildTokenTable(shellBase(), "--codevo-fs-");

    for (const name of AGENT_TYPE_STEPS) {
      const reference = varReferences(lastOf(base.get(name)) ?? "")[0] ?? "";

      expect(reference, name).toMatch(/^--codevo-fs-/);
      expect(lastOf(shell.get(reference)), name).toContain("var(--codevo-fs-scale)");
    }
  });

  it("never pins an agent type step to a raw pixel literal", () => {
    const literals = customPropertyDeclarations(agentRules, "--agent-fs-")
      .filter((entry) => !isSingleVar(entry.value))
      .map((entry) => `${entry.rule.sheet} ${entry.property}: ${entry.value}`);

    expect(literals).toEqual([]);
  });

  it("derives the agent reading palette from the ladder in one scheme-free block", () => {
    const base = buildTokenTable(shellBase(), "--codevo-");
    const expectation: ReadonlyArray<readonly [string, string]> = [
      ["--codevo-thread", "color-mix(in srgb, var(--codevo-side) 63%, var(--codevo-well))"],
      ["--codevo-prose", "color-mix(in srgb, var(--codevo-fg-strong) 96%, var(--codevo-side))"],
      [
        "--codevo-prose-subtle",
        "color-mix(in srgb, var(--codevo-fg-muted) 46%, var(--codevo-fg-disabled))",
      ],
      [
        "--codevo-well-soft",
        "color-mix(in srgb, var(--codevo-thread) 90%, var(--codevo-fg-subtle))",
      ],
      [
        "--codevo-hover-soft",
        "color-mix(in srgb, var(--codevo-thread) 82%, var(--codevo-fg-subtle))",
      ],
      ["--codevo-line", "color-mix(in srgb, var(--codevo-thread) 75%, var(--codevo-fg-subtle))"],
      [
        "--codevo-line-strong",
        "color-mix(in srgb, var(--codevo-thread) 63%, var(--codevo-fg-subtle))",
      ],
    ];
    for (const [name, value] of expectation) {
      const declared = lastOf(base.get(name)) ?? "";

      expect(declared, name).toBe(value);
      expect(COLOR_LITERAL.test(declared), `${name} stays theme-following`).toBe(false);

      const overrides = tokenRules
        .filter((rule) => rule.selector !== ".app-shell" || rule.context.length > 0)
        .flatMap((rule) => rule.declarations)
        .filter((entry) => entry.property === name);

      expect(overrides, `${name} needs no scheme override`).toEqual([]);
    }
  });

  it("keeps every soft tone a visible step off the thread canvas in all themes", () => {
    const failures: string[] = [];
    for (const selector of [...APP_THEME_SELECTORS, SYSTEM_LIGHT]) {
      const canvas = tone(selector, "--codevo-thread");

      expect(canvas, `${selector} thread`).toMatch(HEX);

      for (const [name, minimum] of SOFT_TONE_STEPS) {
        const resolved = tone(selector, name);
        const step = Math.abs(lightness(resolved) - lightness(canvas));
        if (step < minimum) failures.push(`${selector} ${name} ${step.toFixed(2)} < ${minimum}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("lifts the prompt bubble off the thread canvas in every theme", () => {
    const failures: string[] = [];
    for (const selector of [...APP_THEME_SELECTORS, SYSTEM_LIGHT]) {
      const canvas = tone(selector, "--codevo-thread");
      const bubble = tone(selector, "--codevo-raised");
      const lift = lightness(bubble) - lightness(canvas);
      if (lift < 3) failures.push(`${selector} ${lift.toFixed(2)} < 3`);
    }

    expect(failures).toEqual([]);
  });

  it("anchors the resolved reading palette to the approved values", () => {
    const expectation: ReadonlyArray<readonly [string, string, string]> = [
      ["--codevo-thread", "#0c0d10", "#f5f6f9"],
      ["--codevo-prose", "#e8eaee", "#202328"],
      ["--codevo-prose-subtle", "#6f7580", "#979ea8"],
      ["--codevo-well-soft", "#14161b", "#eceef1"],
      ["--codevo-hover-soft", "#1d2026", "#e4e7eb"],
      ["--codevo-line", "#23262d", "#dee1e6"],
      ["--codevo-line-strong", "#2e323b", "#d3d7dd"],
    ];
    for (const [name, dark, light] of expectation) {
      expect(withinTolerance(tone(":root", name), dark), `${name} dark`).toBeLessThanOrEqual(3);
      expect(
        withinTolerance(tone('.app-shell[data-theme="light"]', name), light),
        `${name} light`,
      ).toBeLessThanOrEqual(3);
    }
  });

  it("keeps the surface ladder ordered away from the thread canvas in every theme", () => {
    const chain = [
      "--codevo-thread",
      "--codevo-well-soft",
      "--codevo-hover-soft",
      "--codevo-line",
      "--codevo-line-strong",
    ] as const;
    const failures: string[] = [];
    for (const selector of [...APP_THEME_SELECTORS, SYSTEM_LIGHT]) {
      const steps = chain.map((name) => lightness(tone(selector, name)));
      const canvas = steps[0] ?? 0;
      const rising = canvas < 50;
      for (let index = 1; index < steps.length; index += 1) {
        const previous = steps[index - 1] ?? 0;
        const current = steps[index] ?? 0;
        const delta = rising ? current - previous : previous - current;
        if (delta < 1) {
          failures.push(`${selector} ${chain[index]} ${delta.toFixed(2)} < 1`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("leaves the derived reading tones unshadowed by any other sheet", () => {
    const derived = new Set([
      "--codevo-thread",
      "--codevo-prose",
      "--codevo-prose-subtle",
      "--codevo-well-soft",
      "--codevo-hover-soft",
      "--codevo-line",
      "--codevo-line-strong",
    ]);
    const foreign = [...agentRules, ...frameRules, ...appRules]
      .filter((rule) => rule.sheet !== agentModeSheetPath("agentModeTokens.css"))
      .flatMap((rule) =>
        rule.declarations
          .filter((entry) => derived.has(entry.property))
          .map((entry) => `${rule.sheet} ${rule.selector} ${entry.property}`),
      );

    expect(foreign).toEqual([]);
  });

  it("keeps the light frame overrides down to the shadow alpha scalar", () => {
    for (const selector of LIGHT_FRAME_SELECTORS) {
      const rules = tokenRules.filter(
        (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector),
      );
      const declared = [...declaredNames(rules, "--agent-")];
      expect(declared, selector).toEqual(["--agent-shadow-alpha"]);
    }
  });

  it("keeps the rail track at the committed frame width", () => {
    const table = buildTokenTable(frameRules, "--agent-rail-");

    expect(lastOf(table.get("--agent-rail-width"))).toBe("var(--agent-rail-committed)");
    expect(lastOf(table.get("--agent-rail-committed"))).toBe("256px");
  });

  it("stamps the agent surfaces with the codevo sans stack", () => {
    const stamp = tokenRules.find((rule) =>
      selectorParts(rule.selector).includes(".status-bar--agent"),
    );
    const fontFamily = stamp?.declarations.find((entry) => entry.property === "font-family");

    expect(selectorParts(stamp?.selector ?? "")).toEqual([
      ".agent-mode",
      ".agent-surface-host",
      ".agent-usage-layer",
      ".status-bar--agent",
    ]);
    expect(fontFamily?.value).toBe("var(--codevo-sans)");
  });
});
