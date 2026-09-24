import { describe, expect, it } from "vitest";
import {
  PALETTE_IDS,
  RESOLVED_COLOR_SCHEMES,
  type PaletteId,
  type ResolvedColorScheme,
} from "../../domain/appearance";
import {
  PALETTE_TOKEN_NAMES,
  cssTokenName,
  paletteTokens,
  surfaceColor,
  type PaletteTokenName,
} from "../../domain/appearancePalettes";
import { cssColorToHex } from "../../domain/cssColor";
import {
  buildTokenTable,
  isSingleVar,
  lastOf,
  parseAllStyleSheets,
  readStyleSheet,
  selectorParts,
  varReferences,
} from "../../components/cssContractTestSupport";

const parsed = parseAllStyleSheets();
const BRIDGE_SHEET = "ui/tokens/legacyBridge.css";
const BRIDGE_SELECTORS = [":root[data-cv-scheme]", ":root[data-cv-scheme] .app-shell"];
const UNBRIDGED_LEGACY = new Set(["--color-accent-soft", "--color-accent-bar", "--color-white"]);
const EXPECTED_BRIDGE: Readonly<Record<string, string>> = {
  "--color-accent": "var(--cv-accent)",
  "--color-accent-text": "var(--cv-legacy-on-accent)",
  "--color-active": "var(--cv-s3)",
  "--color-active-muted": "var(--cv-s2)",
  "--color-active-text": "var(--cv-fg-strong)",
  "--color-app": "var(--cv-canvas)",
  "--color-border": "var(--cv-hair)",
  "--color-border-strong": "var(--cv-hair-strong)",
  "--color-control": "var(--cv-raised)",
  "--color-disabled": "var(--cv-fg-disabled)",
  "--color-error": "var(--cv-danger)",
  "--color-hover": "var(--cv-tint-2)",
  "--color-hover-strong": "var(--cv-row-active)",
  "--color-modal": "var(--cv-popover)",
  "--color-panel": "var(--cv-side)",
  "--color-panel-deep": "var(--cv-side)",
  "--color-sidebar": "var(--cv-side)",
  "--color-status": "var(--cv-side)",
  "--color-success": "var(--cv-ok)",
  "--color-surface": "var(--cv-raised)",
  "--color-tab": "var(--cv-canvas)",
  "--color-tab-active": "var(--cv-raised)",
  "--color-tabs": "var(--cv-canvas)",
  "--color-text": "var(--cv-fg)",
  "--color-text-muted": "var(--cv-fg-muted)",
  "--color-text-strong": "var(--cv-fg-strong)",
  "--color-text-subtle": "var(--cv-fg-subtle)",
  "--color-warning": "var(--cv-warn)",
  "--change-added": "var(--cv-ok)",
  "--change-added-soft": "var(--cv-add-bg)",
  "--change-added-strong": "var(--cv-ok)",
  "--change-deleted": "var(--cv-danger)",
  "--change-deleted-soft": "var(--cv-del-bg)",
  "--change-deleted-strong": "var(--cv-danger)",
  "--change-modified": "var(--cv-warn)",
  "--change-modified-soft": "var(--cv-warn-soft)",
  "--change-modified-strong": "var(--cv-warn)",
};

const bridgeRules = parsed.rules.filter(
  (rule) =>
    rule.sheet === BRIDGE_SHEET &&
    rule.context.length === 0 &&
    selectorParts(rule.selector).join(" | ") === BRIDGE_SELECTORS.join(" | "),
);
const bridge = buildTokenTable(bridgeRules);
const declaredTokens = new Set(
  parsed.rules
    .filter((rule) => rule.sheet.startsWith("ui/tokens/"))
    .flatMap((rule) => rule.declarations.map((declaration) => declaration.property))
    .filter((property) => property.startsWith("--cv-")),
);

const PALETTE_TOKEN_BY_CSS_NAME: ReadonlyMap<string, PaletteTokenName> = new Map(
  PALETTE_TOKEN_NAMES.map((name) => [cssTokenName(name), name]),
);
const MAX_VAR_DEPTH = 8;

function semanticSchemeValue(name: string, scheme: ResolvedColorScheme): string | undefined {
  const rules = parsed.rules.filter(
    (rule) =>
      rule.sheet === "ui/tokens/semantic.css" &&
      rule.context.length === 0 &&
      selectorParts(rule.selector).includes(`:root[data-cv-scheme="${scheme}"]`),
  );
  return lastOf(buildTokenTable(rules).get(name));
}

function resolveColor(
  value: string,
  palette: PaletteId,
  scheme: ResolvedColorScheme,
  depth = 0,
): string {
  expect(depth, value).toBeLessThan(MAX_VAR_DEPTH);
  if (!isSingleVar(value)) return value;
  const reference = varReferences(value)[0] ?? "";
  const paletteToken = PALETTE_TOKEN_BY_CSS_NAME.get(reference);
  if (paletteToken !== undefined) return paletteTokens(palette, scheme)[paletteToken];
  const next = semanticSchemeValue(reference, scheme);
  expect(next, reference).toBeDefined();
  return resolveColor(next ?? "", palette, scheme, depth + 1);
}

function hexChannels(hex: string): readonly number[] {
  return [1, 3, 5, 7]
    .map((offset) => hex.slice(offset, offset + 2))
    .filter((pair) => pair.length === 2)
    .map((pair) => Number.parseInt(pair, 16));
}

function paintedOver(color: string, backdrop: string): string {
  const [red = 0, green = 0, blue = 0, alpha = 255] = hexChannels(cssColorToHex(color));
  const under = hexChannels(cssColorToHex(backdrop));
  const opacity = alpha / 255;
  return [red, green, blue]
    .map((channel, index) => Math.round(channel * opacity + (under[index] ?? 0) * (1 - opacity)))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("");
}

function classLevelSpecificity(selector: string): number {
  return (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
}

function schemeValue(scheme: "dark" | "light"): string | undefined {
  const rules = parsed.rules.filter(
    (rule) => rule.sheet === BRIDGE_SHEET && rule.selector === `:root[data-cv-scheme="${scheme}"]`,
  );
  return lastOf(buildTokenTable(rules).get("--cv-legacy-on-accent"));
}

describe("legacy token bridge", () => {
  it("declares one bridge rule on the document root and the app shell", () => {
    expect(bridgeRules).toHaveLength(1);
  });

  it("maps every legacy colour token to its palette token", () => {
    expect(
      Object.fromEntries([...bridge.entries()].map(([name, values]) => [name, lastOf(values)])),
    ).toEqual(EXPECTED_BRIDGE);
  });

  it("bridges every colour and change token the legacy root declares", () => {
    const legacy = parsed.rules
      .filter((rule) => rule.sheet === "App.css" && rule.context.length === 0)
      .filter((rule) => rule.selector === ":root")
      .flatMap((rule) => rule.declarations.map((declaration) => declaration.property))
      .filter((property) => property.startsWith("--color-") || property.startsWith("--change-"))
      .filter((property) => !UNBRIDGED_LEGACY.has(property));

    expect([...new Set(legacy)].filter((name) => !bridge.has(name)).sort()).toEqual([]);
  });

  it("points only at declared palette tokens", () => {
    for (const [name, values] of bridge) {
      const value = lastOf(values) ?? "";
      expect(isSingleVar(value), name).toBe(true);
      for (const reference of varReferences(value)) {
        expect(declaredTokens.has(reference), `${name} -> ${reference}`).toBe(true);
      }
    }
  });

  it("outranks every legacy theme block that targets the app shell", () => {
    const legacyThemeSelectors = new Set(
      parsed.rules
        .filter((rule) => rule.sheet === "App.css")
        .flatMap((rule) => selectorParts(rule.selector))
        .filter((part) => part.startsWith(".app-shell[data-theme=") && !part.includes(" ")),
    );
    const bridgeOnShell = classLevelSpecificity(":root[data-cv-scheme] .app-shell");

    expect(legacyThemeSelectors.size).toBeGreaterThan(0);
    for (const selector of legacyThemeSelectors) {
      expect(bridgeOnShell, selector).toBeGreaterThan(classLevelSpecificity(selector));
    }
  });

  it("paints hover visibly over the canvas and side surfaces in every palette and scheme", () => {
    const hover = lastOf(bridge.get("--color-hover")) ?? "";
    const invisible = PALETTE_IDS.flatMap((palette) =>
      RESOLVED_COLOR_SCHEMES.flatMap((scheme) =>
        (["canvas", "side"] as const)
          .map((role) => ({ role, surface: surfaceColor(palette, scheme, role) }))
          .filter(
            ({ surface }) =>
              paintedOver(resolveColor(hover, palette, scheme), surface) ===
              paintedOver(surface, surface),
          )
          .map(({ role }) => `${palette} ${scheme} over ${role}`),
      ),
    );

    expect(invisible).toEqual([]);
  });

  it("keeps the legacy on-accent pairing the contrast gate checks", () => {
    expect(schemeValue("dark")).toBe("var(--cv-s0)");
    expect(schemeValue("light")).toBe("#ffffff");
  });

  it("loads the tokens before every legacy sheet and drops the agent variants", () => {
    const appCss = readStyleSheet("App.css").source;
    const tokens = readStyleSheet("ui/tokens/tokens.css").source;

    expect(appCss.split("\n")[0]).toBe('@import "./ui/tokens/tokens.css";');
    expect(appCss).not.toContain("agentModeVariants.css");
    expect(tokens).toContain('@import "./legacyBridge.css";');
  });
});
