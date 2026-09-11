import { describe, expect, it } from "vitest";
import {
  LIGHT_THEME_SELECTORS,
  SYSTEM_LIGHT_CONTEXT,
  COLOR_LITERAL,
  SYSTEM_THEME_SELECTOR,
  buildTokenTable,
  customPropertyDeclarations,
  isSingleVar,
  lastOf,
  parseAllStyleSheets,
  readAllStyleSheets,
  referencesSelf,
  resolveVarRoots,
  selectorParts,
  varListNames,
  varReferences,
  type CssRule,
} from "./cssContractTestSupport";

const TOKEN_SHEET = "components/agentMode/agentModeTokens.css";
const APP_SHEET = "App.css";
const VARIANTS_SHEET = "components/agentMode/agentModeVariants.css";
const REMAP_PREFIXES = ["--agent-", "--settings-", "--toast-"] as const;
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
const CODEVO_LADDER = [
  "--codevo-side",
  "--codevo-canvas",
  "--codevo-raised",
  "--codevo-well",
  "--codevo-hover",
  "--codevo-active",
  "--codevo-selected",
  "--codevo-fg-strong",
  "--codevo-fg",
  "--codevo-fg-muted",
  "--codevo-fg-subtle",
  "--codevo-fg-disabled",
  "--codevo-primary",
  "--codevo-primary-fg",
  "--codevo-primary-soft",
  "--codevo-ok",
  "--codevo-warn",
  "--codevo-danger",
  "--codevo-ok-soft",
  "--codevo-warn-soft",
  "--codevo-danger-soft",
  "--codevo-diff-add",
  "--codevo-diff-del",
  "--codevo-ft-ts",
  "--codevo-ft-tsx",
  "--codevo-ft-js",
  "--codevo-ft-json",
  "--codevo-ft-npm",
  "--codevo-ft-md",
  "--codevo-ft-css",
  "--codevo-ft-sh",
  "--codevo-ft-docker",
  "--codevo-ft-git",
  "--codevo-ft-env",
  "--codevo-ft-lock",
  "--codevo-shadow-card",
  "--codevo-shadow-float",
  "--codevo-shadow-window",
  "--codevo-separator-inset",
  "--codevo-focus-ring",
  "--codevo-r-sm",
  "--codevo-r-md",
  "--codevo-r-lg",
  "--codevo-r-xl",
  "--codevo-r-pill",
  "--codevo-fs-hero",
  "--codevo-fs-title",
  "--codevo-fs-heading",
  "--codevo-fs-body",
  "--codevo-fs-ui",
  "--codevo-fs-meta",
  "--codevo-fs-small",
  "--codevo-fs-label",
  "--codevo-sans",
  "--codevo-mono",
  "--codevo-icon",
  "--codevo-icon-stroke",
] as const;
const LIGHT_LADDER = [
  "--codevo-primary-soft",
  "--codevo-ok-soft",
  "--codevo-warn-soft",
  "--codevo-danger-soft",
  "--codevo-diff-add",
  "--codevo-diff-del",
  "--codevo-ft-ts",
  "--codevo-ft-tsx",
  "--codevo-ft-js",
  "--codevo-ft-json",
  "--codevo-ft-npm",
  "--codevo-ft-md",
  "--codevo-ft-css",
  "--codevo-ft-sh",
  "--codevo-ft-docker",
  "--codevo-ft-git",
  "--codevo-ft-env",
  "--codevo-ft-lock",
  "--codevo-shadow-card",
  "--codevo-shadow-float",
  "--codevo-shadow-window",
] as const;
const PROMPT_BUBBLE_TONE = "--agent-raised";
const THREAD_COLUMN_TONE = "--agent-canvas";
const PENDING_T3_SHEETS: readonly string[] = [];
const PENDING_LITERAL_REMAP_SHEETS: readonly string[] = [];
const SCHEME_SCALARS = new Set(["--agent-shadow-alpha"]);
const DISTINCT_THEME_TONES = [
  ["--color-control", "--color-surface"],
  ["--color-hover", "--color-surface"],
  ["--color-sidebar", "--color-surface"],
] as const;
const SHADOW_TOKEN = /(^|-)shadow(-|$)|-ring$/;
const RADIUS_TOKEN = /radius|-r-(xs|sm|md|lg|xl|pill)$/;
const FONT_SIZE_TOKEN = /-fs-/;
const FONT_FAMILY_TOKEN = /(^|-)(sans|mono|font(-[\w-]+)?)$/;
const DIMENSION_TOKEN = /^[\d.]+(px|em|rem|ms|%)?$/;

const parsed = parseAllStyleSheets();
const sheets = readAllStyleSheets();
const tokenRules = parsed.rules.filter((rule) => rule.sheet === TOKEN_SHEET);
const codevoTable = buildTokenTable(
  tokenRules.filter((rule) => rule.selector === ".app-shell" && rule.context.length === 0),
  "--codevo-",
);

function appShellRules(): readonly CssRule[] {
  return tokenRules.filter((rule) => rule.selector === ".app-shell" && rule.context.length === 0);
}

function lightRules(selector: string): readonly CssRule[] {
  return tokenRules.filter(
    (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector),
  );
}

function systemLightRules(): readonly CssRule[] {
  return tokenRules.filter(
    (rule) =>
      rule.context.length === 1 &&
      rule.context[0] === SYSTEM_LIGHT_CONTEXT &&
      rule.selector === SYSTEM_THEME_SELECTOR,
  );
}

function declaredNames(rules: readonly CssRule[], prefix: string): ReadonlySet<string> {
  return new Set(customPropertyDeclarations(rules, prefix).map((entry) => entry.property));
}

function codevoValue(name: string): string {
  const values = codevoTable.get(name) ?? [];
  return values[values.length - 1] ?? "";
}

function isPending(sheet: string, pending: readonly string[]): boolean {
  return pending.includes(sheet);
}

function appThemeBlock(selector: string): readonly CssRule[] {
  return parsed.rules.filter(
    (rule) =>
      rule.sheet === APP_SHEET &&
      rule.context.length === 0 &&
      selectorParts(rule.selector).includes(selector),
  );
}

function literalProblem(name: string, value: string): string | null {
  if (SCHEME_SCALARS.has(name)) return null;
  if (COLOR_LITERAL.test(value)) return "colour literal";
  if (SHADOW_TOKEN.test(name) && value !== "none" && varListNames(value) === null) {
    return "shadow literal";
  }
  if (RADIUS_TOKEN.test(name) && !isSingleVar(value)) return "radius literal";
  if (FONT_SIZE_TOKEN.test(name) && !isSingleVar(value)) return "font-size literal";
  if (FONT_FAMILY_TOKEN.test(name) && !isSingleVar(value)) return "font-family literal";
  return null;
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

function lightnessStep(band: string, column: string): number {
  return lightness(column) - lightness(band);
}

describe("codevo token contract", () => {
  it("parses every stylesheet under src without issues", () => {
    expect(parsed.issues).toEqual([]);
  });

  it("declares the full codevo ladder on .app-shell in the token sheet only", () => {
    const declared = declaredNames(appShellRules(), "--codevo-");
    const missing = CODEVO_LADDER.filter((name) => !declared.has(name));
    const foreign = customPropertyDeclarations(parsed.rules, "--codevo-")
      .filter((entry) => entry.rule.sheet !== TOKEN_SHEET)
      .map((entry) => `${entry.rule.sheet} ${entry.property}`);

    expect(missing).toEqual([]);
    expect(foreign).toEqual([]);
  });

  it("declares every referenced codevo token on .app-shell", () => {
    const declared = declaredNames(appShellRules(), "--codevo-");
    const referenced = new Set(
      parsed.rules.flatMap((rule) =>
        rule.declarations.flatMap((declaration) => varReferences(declaration.value)),
      ),
    );
    const undeclared = [...referenced]
      .filter((name) => name.startsWith("--codevo-") && !declared.has(name))
      .sort();

    expect(undeclared).toEqual([]);
  });

  it("never declares a token in terms of itself", () => {
    const cycles = customPropertyDeclarations(parsed.rules, "--")
      .filter((entry) => referencesSelf(entry.property, entry.value))
      .map((entry) => `${entry.rule.sheet} ${entry.property}`);

    expect(cycles).toEqual([]);
  });

  it("resolves the codevo ladder to color tokens without cycles", () => {
    for (const name of CODEVO_LADDER) {
      const roots = resolveVarRoots(name, codevoTable);
      const codevoRoots = roots.filter((root) => root.startsWith("--codevo-"));
      expect(codevoRoots, name).toEqual([]);
      for (const root of roots) expect(root, name).toMatch(/^--color-/);
    }
  });

  it("resolves the ladder in every App.css theme block and the system light branch", () => {
    const appRules = parsed.rules.filter((rule) => rule.sheet === APP_SHEET);
    const needed = new Set(CODEVO_LADDER.flatMap((name) => resolveVarRoots(name, codevoTable)));

    for (const selector of APP_THEME_SELECTORS) {
      const block = appRules.filter(
        (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector),
      );
      const declared = declaredNames(block, "--color-");
      const missing = [...needed].filter((name) => !declared.has(name)).sort();
      expect(missing, selector).toEqual([]);
    }

    const system = appRules.filter(
      (rule) => rule.context[0] === SYSTEM_LIGHT_CONTEXT && rule.selector === SYSTEM_THEME_SELECTOR,
    );
    const declared = declaredNames(system, "--color-");
    expect([...needed].filter((name) => !declared.has(name)).sort(), "system light").toEqual([]);
  });

  it("redeclares the light ladder on every light selector and the system light branch", () => {
    const expected = [...LIGHT_LADDER].sort();
    for (const selector of LIGHT_THEME_SELECTORS) {
      const declared = [...declaredNames(lightRules(selector), "--codevo-")].sort();
      expect(declared, selector).toEqual(expected);
    }
    const system = [...declaredNames(systemLightRules(), "--codevo-")].sort();
    expect(system, "system light").toEqual(expected);
  });

  it("gives every scheme-dependent literal on .app-shell a light counterpart", () => {
    const schemeDependent = customPropertyDeclarations(appShellRules(), "--codevo-")
      .filter((entry) => COLOR_LITERAL.test(entry.value))
      .map((entry) => entry.property);
    const missing = schemeDependent.filter(
      (name) => !(LIGHT_LADDER as readonly string[]).includes(name),
    );

    expect(missing).toEqual([]);
  });

  it("keeps the card shadow flat in dark and soft in light", () => {
    expect(codevoValue("--codevo-shadow-card")).toBe("none");
    for (const selector of LIGHT_THEME_SELECTORS) {
      const card = customPropertyDeclarations(lightRules(selector), "--codevo-shadow-card");
      expect(lastOf(card)?.value, selector).not.toBe("none");
      expect(lastOf(card)?.value, selector).toContain("rgba(18, 20, 30");
    }
  });

  it("pins the focus ring and the separator inset to the design", () => {
    expect(codevoValue("--codevo-focus-ring")).toBe(
      "0 0 0 2px var(--codevo-canvas), 0 0 0 4px var(--codevo-primary)",
    );
    expect(codevoValue("--codevo-separator-inset")).toBe("0 -1px 0 var(--codevo-well)");
  });

  it("keeps the primary foreground theme-aware", () => {
    expect(codevoValue("--codevo-primary-fg")).toBe("var(--color-accent-text)");
  });

  it("keeps the well, hover and side tones distinct from the raised tone in every theme", () => {
    for (const selector of APP_THEME_SELECTORS) {
      const table = buildTokenTable(appThemeBlock(selector), "--color-");
      for (const [tone, raised] of DISTINCT_THEME_TONES) {
        const toneValue = lastOf(table.get(tone));
        const raisedValue = lastOf(table.get(raised));
        expect(toneValue, `${selector} ${tone}`).toBeDefined();
        expect(toneValue, `${selector} ${tone} vs ${raised}`).not.toBe(raisedValue);
      }
    }
  });

  it("lifts the prompt bubble off the thread column by tone wherever it has no card shadow", () => {
    const bubbleRule = parsed.rules.find(
      (rule) =>
        rule.context.length === 0 && selectorParts(rule.selector).includes(".agent-prompt__bubble"),
    );
    const bubbleBackground = lastOf(
      bubbleRule?.declarations.filter((entry) => entry.property === "background"),
    );
    expect(bubbleBackground?.value).toBe(`var(${PROMPT_BUBBLE_TONE})`);

    const agentTable = buildTokenTable(tokenRules);
    expect(resolveVarRoots(PROMPT_BUBBLE_TONE, agentTable)).toEqual(["--color-surface"]);
    expect(resolveVarRoots(THREAD_COLUMN_TONE, agentTable)).toEqual(["--color-app"]);

    const blocks: ReadonlyArray<readonly [string, readonly CssRule[], readonly CssRule[]]> = [
      ...APP_THEME_SELECTORS.map(
        (selector) =>
          [selector, appThemeBlock(selector), lightRules(selector)] as readonly [
            string,
            readonly CssRule[],
            readonly CssRule[],
          ],
      ),
      [
        SYSTEM_LIGHT_CONTEXT,
        parsed.rules.filter(
          (rule) =>
            rule.sheet === APP_SHEET &&
            rule.context[0] === SYSTEM_LIGHT_CONTEXT &&
            rule.selector === SYSTEM_THEME_SELECTOR,
        ),
        systemLightRules(),
      ] as readonly [string, readonly CssRule[], readonly CssRule[]],
    ];

    for (const [selector, block, shadowBlock] of blocks) {
      const table = buildTokenTable(block, "--color-");
      const bubble = lastOf(table.get("--color-surface"));
      const column = lastOf(table.get("--color-app"));
      expect(bubble, `${selector} bubble tone`).toBeDefined();
      expect(column, `${selector} column tone`).toBeDefined();
      expect(bubble, `${selector} bubble vs column`).not.toBe(column);
      expect(lightness(bubble ?? ""), `${selector} bubble is raised`).toBeGreaterThan(
        lightness(column ?? ""),
      );

      const light =
        selector === SYSTEM_LIGHT_CONTEXT ||
        (LIGHT_THEME_SELECTORS as readonly string[]).includes(selector);
      if (light) {
        const card = customPropertyDeclarations(shadowBlock, "--codevo-shadow-card");
        expect(lastOf(card)?.value, `${selector} bubble shadow`).not.toBe("none");
        continue;
      }

      expect(codevoValue("--codevo-shadow-card")).toBe("none");
      const step = lightnessStep(column ?? "", bubble ?? "");
      expect(step, `${selector} bubble vs column lightness step`).toBeGreaterThanOrEqual(
        PROMPT_BUBBLE_MIN_STEP,
      );
    }
  });

  it("keeps the pending token sheets empty", () => {
    expect([...PENDING_T3_SHEETS]).toEqual([]);
    expect([...PENDING_LITERAL_REMAP_SHEETS]).toEqual([]);
  });

  it("pins the tone roles to the amended surface model", () => {
    expect(codevoValue("--codevo-side")).toBe("var(--color-sidebar)");
    expect(codevoValue("--codevo-canvas")).toBe("var(--color-app)");
    expect(codevoValue("--codevo-raised")).toBe("var(--color-surface)");
    expect(codevoValue("--codevo-well")).toBe("var(--color-control)");
    expect(codevoValue("--codevo-primary")).toBe("var(--color-accent)");
  });

  it("pins the radii, the type scale, the icon metrics and the Inter stack", () => {
    expect(codevoValue("--codevo-r-sm")).toBe("8px");
    expect(codevoValue("--codevo-r-md")).toBe("10px");
    expect(codevoValue("--codevo-r-lg")).toBe("12px");
    expect(codevoValue("--codevo-r-xl")).toBe("14px");
    expect(codevoValue("--codevo-fs-scale")).toBe("1");
    expect(codevoValue("--codevo-fs-hero")).toBe("calc(28px * var(--codevo-fs-scale))");
    expect(codevoValue("--codevo-fs-title")).toBe("calc(22px * var(--codevo-fs-scale))");
    expect(codevoValue("--codevo-fs-heading")).toBe("calc(17px * var(--codevo-fs-scale))");
    expect(codevoValue("--codevo-fs-body")).toBe("calc(15px * var(--codevo-fs-scale))");
    expect(codevoValue("--codevo-fs-ui")).toBe("calc(14px * var(--codevo-fs-scale))");
    expect(codevoValue("--codevo-fs-meta")).toBe("calc(13px * var(--codevo-fs-scale))");
    expect(codevoValue("--codevo-fs-small")).toBe("calc(12px * var(--codevo-fs-scale))");
    expect(codevoValue("--codevo-fs-label")).toBe("calc(11px * var(--codevo-fs-scale))");
    expect(codevoValue("--codevo-sans")).toMatch(/^Inter,/);
    expect(codevoValue("--codevo-icon")).toBe("16px");
    expect(codevoValue("--codevo-icon-stroke")).toBe("1.75");
  });

  it("re-values the App.css root and light neutrals to the Airy ladder", () => {
    const appRules = parsed.rules.filter((rule) => rule.sheet === APP_SHEET);
    const root = buildTokenTable(appRules.filter((rule) => rule.selector === ":root"));
    const light = buildTokenTable(
      appRules.filter(
        (rule) => rule.context.length === 0 && rule.selector === '.app-shell[data-theme="light"]',
      ),
    );
    const expectation: ReadonlyArray<readonly [string, string, string]> = [
      ["--color-sidebar", "#0c0d10", "#fbfcfd"],
      ["--color-panel", "#0c0d10", "#fbfcfd"],
      ["--color-status", "#0c0d10", "#fbfcfd"],
      ["--color-app", "#13151a", "#f0f2f5"],
      ["--color-tabs", "#13151a", "#f0f2f5"],
      ["--color-surface", "#1a1d23", "#ffffff"],
      ["--color-modal", "#1a1d23", "#ffffff"],
      ["--color-tab-active", "#1a1d23", "#ffffff"],
      ["--color-control", "#0f1014", "#eaedf1"],
      ["--color-hover", "#20232a", "#e5e8ed"],
      ["--color-hover-strong", "#23262e", "#e1e4ea"],
      ["--color-active", "#292d35", "#dbdfe6"],
      ["--color-accent", "#4fcdb3", "#13836f"],
      ["--color-accent-text", "#08201b", "#ffffff"],
      ["--color-text-strong", "#f1f3f7", "#171a1f"],
      ["--color-text", "#d3d7de", "#333840"],
      ["--color-text-muted", "#9aa0ab", "#656d7b"],
      ["--color-text-subtle", "#6a7180", "#99a1ad"],
      ["--color-disabled", "#4a505c", "#c2c7cf"],
      ["--color-success", "#4cc38a", "#1f9d5f"],
      ["--color-warning", "#e5b354", "#b7791f"],
      ["--color-error", "#ef6f6f", "#d64545"],
    ];
    for (const [name, dark, lightValue] of expectation) {
      expect(lastOf(root.get(name)), name).toBe(dark);
      expect(lastOf(light.get(name)), name).toBe(lightValue);
    }
    expect(lastOf(root.get("--radius-sm"))).toBe("8px");
    expect(lastOf(root.get("--radius-md"))).toBe("10px");
    expect(lastOf(root.get("--radius-lg"))).toBe("12px");
    expect(lastOf(root.get("--radius-xl"))).toBe("14px");
  });

  it("routes the shell shadow and focus ring through the codevo tokens", () => {
    const shell = buildTokenTable(appShellRules());
    expect(lastOf(shell.get("--shadow-pop"))).toBe("var(--codevo-shadow-float)");
    expect(lastOf(shell.get("--focus-ring"))).toBe("var(--codevo-focus-ring)");
  });

  it("removes every t3 token", () => {
    const declared = customPropertyDeclarations(parsed.rules, "--t3-").map(
      (entry) => `${entry.rule.sheet} ${entry.property}`,
    );
    const referenced = sheets
      .filter((sheet) => !isPending(sheet.sheet, PENDING_T3_SHEETS))
      .filter((sheet) => sheet.source.includes("--t3-"))
      .map((sheet) => sheet.sheet);

    expect(declared).toEqual([]);
    expect(referenced).toEqual([]);
  });

  it("keeps the agent, settings and toast remaps free of literal colours, shadows, radii and fonts", () => {
    const problems = customPropertyDeclarations(parsed.rules, "--")
      .filter((entry) => REMAP_PREFIXES.some((prefix) => entry.property.startsWith(prefix)))
      .filter((entry) => entry.rule.sheet !== VARIANTS_SHEET)
      .filter((entry) => !isPending(entry.rule.sheet, PENDING_LITERAL_REMAP_SHEETS))
      .map((entry) => ({ entry, problem: literalProblem(entry.property, entry.value) }))
      .filter((candidate) => candidate.problem !== null)
      .map(
        (candidate) =>
          `${candidate.entry.rule.sheet} ${candidate.entry.property}: ${candidate.entry.value} (${candidate.problem})`,
      );

    expect(problems).toEqual([]);
  });

  it("keeps dimension-only agent tokens as plain dimensions", () => {
    const suspicious = customPropertyDeclarations(tokenRules, "--agent-")
      .filter((entry) => !isSingleVar(entry.value))
      .filter((entry) => !["none", "transparent"].includes(entry.value))
      .filter((entry) => !DIMENSION_TOKEN.test(entry.value))
      .filter((entry) => !/^[\d.]+(px|em)( [\d.]+(px|em))+$/.test(entry.value))
      .map((entry) => `${entry.property}: ${entry.value}`);

    expect(suspicious).toEqual([]);
  });
});
