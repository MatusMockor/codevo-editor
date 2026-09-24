// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildTokenTable,
  COLOR_LITERAL,
  collectBorderViolations,
  lastOf,
  parseCssRules,
  selectorParts,
  parseAllStyleSheets,
  type CssRule,
} from "./components/cssContractTestSupport";
import { DEFAULT_AGENT_RAIL_WIDTH } from "./domain/agentWorkbenchLayout";
import {
  PALETTE_IDS,
  RESOLVED_COLOR_SCHEMES,
  type PaletteId,
  type ResolvedColorScheme,
} from "./domain/appearance";
import { paletteTokens, surfaceColor } from "./domain/appearancePalettes";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const STARTUP_SHEET = "public/startup.css";
const STARTUP_SKELETON_SELECTOR = "[data-startup-skeleton]";
const HEX_TONE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const TONE_KEYS = [
  "--startup-side",
  "--startup-canvas",
  "--startup-well",
  "--startup-accent",
  "--startup-text",
  "--startup-text-muted",
  "--startup-danger",
] as const;
type StartupTone = (typeof TONE_KEYS)[number];
const SURFACE_TONE_KEYS = ["--startup-side", "--startup-canvas"] as const;
const AIRY_RADII = new Set(["8px", "10px", "12px", "14px"]);

function hexChannels(value: string): readonly number[] | null {
  const digits = value.trim().slice(1);
  const width = digits.length <= 4 ? 1 : 2;
  const channels: number[] = [];
  for (let index = 0; index + width <= digits.length && channels.length < 3; index += width) {
    const chunk = digits.slice(index, index + width);
    channels.push(Number.parseInt(width === 1 ? `${chunk}${chunk}` : chunk, 16));
  }
  return channels.length === 3 ? channels : null;
}

function functionalChannels(value: string): readonly number[] | null {
  const match = /^(rgba?|hsla?)\(([^)]*)\)$/i.exec(value.trim());
  if (match === null) return null;
  const parts = (match[2] ?? "")
    .split(/[\s,/]+/)
    .filter((part) => part.length > 0)
    .slice(0, 3);
  if (parts.length < 3) return null;
  const numbers = parts.map((part) => Number.parseFloat(part));
  if (numbers.some((number) => Number.isNaN(number))) return null;
  if (match[1]?.toLowerCase().startsWith("hsl")) {
    return numbers[2] === 100 ? [255, 255, 255] : [0, 0, 0];
  }
  return parts.map((part, index) =>
    part.endsWith("%") ? ((numbers[index] ?? 0) * 255) / 100 : (numbers[index] ?? 0),
  );
}

function isPureWhite(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "white") return true;
  const channels = normalized.startsWith("#")
    ? hexChannels(normalized)
    : functionalChannels(normalized);
  if (channels === null) return false;
  return channels.every((channel) => channel === 255);
}

function frameRules(): readonly CssRule[] {
  return parseAllStyleSheets().rules.filter(
    (rule) => rule.sheet === "components/workbenchShellFrame.css",
  );
}

function railTrackBreakpoints(): ReadonlyArray<readonly [string, string]> {
  return frameRules()
    .filter((rule) => rule.context.length === 1 && rule.context[0]?.startsWith("@media (max-width"))
    .flatMap((rule) =>
      rule.declarations
        .filter((declaration) => declaration.property === "--agent-rail-track")
        .map((declaration) => [rule.context[0] ?? "", declaration.value] as const),
    )
    .map(
      ([context, value]) =>
        [context, value.replace(/^min\(var\(--agent-rail-width\), /, "")] as const,
    )
    .map(([context, value]) => [context, value.replace(/\)$/, "")] as const)
    .sort();
}

function startupRailBreakpoints(): ReadonlyArray<readonly [string, string]> {
  return startupCss.rules
    .filter(
      (rule) =>
        rule.context.length === 1 &&
        rule.context[0]?.startsWith("@media (max-width") &&
        rule.selector === ":root",
    )
    .flatMap((rule) =>
      rule.declarations
        .filter((declaration) => declaration.property === "--startup-rail-width")
        .map((declaration) => [rule.context[0] ?? "", declaration.value] as const),
    )
    .sort();
}

function cssVar(name: string): string {
  return `var(${name})`;
}

const documentSource = readFileSync(resolve(REPOSITORY_ROOT, "index.html"), "utf8");
const startupStyle = readFileSync(resolve(REPOSITORY_ROOT, STARTUP_SHEET), "utf8");
const startupCss = parseCssRules(startupStyle, STARTUP_SHEET);
const startupDocument = new DOMParser().parseFromString(documentSource, "text/html");
const appCss = parseAllStyleSheets().rules.filter((rule) => rule.sheet === "App.css");

function startupRules(selector: string, context: readonly string[] = []): readonly CssRule[] {
  return startupCss.rules.filter(
    (rule) =>
      rule.context.length === context.length &&
      rule.context.every((entry, index) => entry === context[index]) &&
      selectorParts(rule.selector).includes(selector),
  );
}

function startupDeclaration(selector: string, property: string): string | undefined {
  return lastOf(buildTokenTable(startupRules(selector), "").get(property));
}

function startupTone(
  palette: PaletteId,
  scheme: ResolvedColorScheme,
  tone: StartupTone,
): string | undefined {
  const selector = `:root[data-cv-palette="${palette}"][data-cv-scheme="${scheme}"]`;
  const themed = lastOf(buildTokenTable(startupRules(selector)).get(tone));
  if (themed !== undefined) {
    return themed;
  }

  return lastOf(buildTokenTable(startupRules(":root")).get(tone));
}

function expectedStartupTone(
  palette: PaletteId,
  scheme: ResolvedColorScheme,
  tone: StartupTone,
): string {
  const tokens = paletteTokens(palette, scheme);
  switch (tone) {
    case "--startup-side":
      return surfaceColor(palette, scheme, "side");
    case "--startup-canvas":
      return surfaceColor(palette, scheme, "canvas");
    case "--startup-well":
      return surfaceColor(palette, scheme, "raised");
    case "--startup-accent":
      return tokens.accent;
    case "--startup-text":
      return tokens.fgStrong;
    case "--startup-text-muted":
      return tokens.fgMuted;
    case "--startup-danger":
      return tokens.danger;
  }
}

function appShellDeclaration(property: string): string | undefined {
  return lastOf(
    buildTokenTable(
      appCss.filter(
        (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(".app-shell"),
      ),
      "",
    ).get(property),
  );
}

describe("startup document reset", () => {
  it("loads a render-blocking startup sheet without poisoning Monaco's runtime CSP styles", () => {
    // Tauri adds a nonce to inline <style> elements. A style-src nonce makes
    // browsers ignore unsafe-inline, rejecting Monaco's generated colors sheet.
    expect(startupDocument.querySelectorAll("style")).toHaveLength(0);
    const link = startupDocument.head.querySelector('link[rel="stylesheet"]');
    expect(link?.getAttribute("href")).toBe("/startup.css");
    expect(link?.hasAttribute("media")).toBe(false);
    expect(link?.hasAttribute("disabled")).toBe(false);
    expect(link?.hasAttribute("onload")).toBe(false);
    expect(startupStyle).not.toMatch(/@import\b/);
    expect(Buffer.byteLength(startupStyle, "utf8")).toBeLessThan(12_000);
    const config = JSON.parse(
      readFileSync(resolve(REPOSITORY_ROOT, "src-tauri/tauri.conf.json"), "utf8"),
    ) as { app: { security: { csp: string; dangerousDisableAssetCspModification?: unknown } } };
    const stylePolicy = config.app.security.csp
      .split(";")
      .find((part) => part.trim().startsWith("style-src "));
    expect(stylePolicy?.trim()).toBe("style-src 'self' 'unsafe-inline'");
    expect(config.app.security.csp).toContain("script-src 'self';");
    expect(config.app.security.dangerousDisableAssetCspModification).toBeUndefined();
  });

  it("paints the surface tones without waiting for App.css", () => {
    expect(startupStyle.length).toBeGreaterThan(0);
    expect(startupDeclaration("html", "margin")).toBe("0");
    expect(startupDeclaration("body", "margin")).toBe("0");
    expect(startupDeclaration("html", "background")).toBe(cssVar("--startup-side"));
    expect(startupDeclaration("body", "background")).toBe(cssVar("--startup-side"));
    expect(startupDeclaration("html", "height")).toBe("100%");
    expect(startupDeclaration("body", "height")).toBe("100%");
    expect(documentSource).not.toContain("App.css");
  });

  it("declares the fallback tones on the bare root so a missing theme cannot paint white", () => {
    const root = buildTokenTable(startupRules(":root"));
    for (const tone of TONE_KEYS) {
      expect(lastOf(root.get(tone)), tone).toBeDefined();
    }
    expect(startupDeclaration(":root", "color-scheme")).toBe("dark");
  });

  it("routes every painted value through the startup token ladder", () => {
    const literals = startupCss.rules
      .filter((rule) => !rule.selector.startsWith(":root"))
      .flatMap((rule) =>
        rule.declarations
          .filter((declaration) => COLOR_LITERAL.test(declaration.value))
          .map((declaration) => `${rule.selector} :: ${declaration.property}`),
      );

    expect(literals).toEqual([]);
  });

  it("keeps #root a full-size block so the skeleton cannot collapse to its content width", () => {
    expect(startupDeclaration("#root", "display")).toBe("block");
    expect(startupDeclaration("#root", "width")).toBe("100%");
    expect(startupDeclaration("#root", "height")).toBe("100%");
    expect(startupDeclaration("#root", "align-items")).toBeUndefined();
    expect(startupDeclaration("#root", "justify-content")).toBeUndefined();

    const root = startupDocument.getElementById("root");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("style")).toBeNull();

    expect(startupDeclaration(".startup-skeleton", "display")).toBe("grid");
    expect(startupDeclaration(".startup-skeleton", "width")).toBe("100%");
    expect(startupDeclaration(".startup-skeleton", "height")).toBe("100%");
  });

  it("adds no borders, outlines or shadows", () => {
    expect(collectBorderViolations(startupCss.rules, new Map())).toEqual([]);
    expect(startupCss.issues).toEqual([]);
  });

  it("keeps the content-security policy honest by shipping no inline script", () => {
    const scripts = [...startupDocument.querySelectorAll("script")];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.getAttribute("src")).toBe("/src/main.tsx");
    expect(scripts[0]?.textContent).toBe("");
  });
});

describe("startup skeleton", () => {
  it("is the only loading state and carries no splash furniture", () => {
    const skeletons = [...startupDocument.querySelectorAll(STARTUP_SKELETON_SELECTOR)];
    expect(skeletons).toHaveLength(1);
    expect(skeletons[0]?.getAttribute("role")).toBe("status");
    expect(skeletons[0]?.getAttribute("aria-label")).toBe("Starting Codevo Editor");

    const text = startupDocument.body.textContent ?? "";
    expect(text.trim()).toBe("");
    expect(documentSource).not.toContain("Starting Codevo Editor...");
    expect(documentSource).not.toContain("CODEVO");
    expect(startupStyle).not.toContain("border-radius: 50%");
    expect(startupStyle).not.toMatch(/spin|spinner|pulse/i);
  });

  it("matches the real shell geometry so mounting React does not move the frame", () => {
    const chromeHeight = startupDeclaration(":root", "--startup-chrome-height");
    expect(chromeHeight).toBe("36px");
    expect(chromeHeight).toBe(appShellDeclaration("--window-chrome-height"));

    const shellRows = appShellDeclaration("grid-template-rows") ?? "";
    const statusTrack = /(\S+)$/.exec(shellRows)?.[1];
    expect(statusTrack).toBe("28px");
    expect(startupDeclaration(":root", "--startup-status-height")).toBe("28px");
    expect(startupDeclaration(":root", "--startup-status-height")).toBe(statusTrack);

    expect(startupDeclaration(":root", "--startup-rail-width")).toBe(
      `${DEFAULT_AGENT_RAIL_WIDTH}px`,
    );
    expect(railTrackBreakpoints()).toEqual(startupRailBreakpoints());
    expect(startupDeclaration(".startup-skeleton", "grid-template-columns")).toBe(
      `${cssVar("--startup-rail-width")} minmax(0, 1fr)`,
    );
    expect(startupDeclaration(".startup-skeleton", "grid-template-rows")).toBe(
      `minmax(0, 1fr) ${cssVar("--startup-status-height")}`,
    );
  });

  it("tones every palette from the same values the real palette declares", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        for (const tone of TONE_KEYS) {
          expect(startupTone(palette, scheme, tone), `${palette} ${scheme} ${tone}`).toBe(
            expectedStartupTone(palette, scheme, tone),
          );
        }
      }
    }
  });

  it("never paints a white side or canvas in any palette", () => {
    for (const palette of PALETTE_IDS) {
      for (const scheme of RESOLVED_COLOR_SCHEMES) {
        for (const tone of SURFACE_TONE_KEYS) {
          const value = startupTone(palette, scheme, tone) ?? "";
          expect(value, `${palette} ${scheme} ${tone}`).toMatch(HEX_TONE);
          expect(isPureWhite(value), `${palette} ${scheme} ${tone}`).toBe(false);
        }
      }
    }
  });

  it("recognises every spelling of white so the surface guard cannot be fooled", () => {
    for (const white of [
      "#fff",
      "#ffff",
      "#ffffff",
      "#ffffffff",
      "WHITE",
      "rgb(255, 255, 255)",
      "rgb(255 255 255)",
      "rgba(255 255 255 / 0.5)",
      "rgb(100%, 100%, 100%)",
      "hsl(0 0% 100%)",
    ]) {
      expect(isPureWhite(white), white).toBe(true);
    }
    for (const notWhite of ["#fbfcfd", "#fefefe", "#eff1f5", "rgb(254 255 255)", "hsl(0 0% 99%)"]) {
      expect(isPureWhite(notWhite), notWhite).toBe(false);
    }
  });

  it("binds the startup type stack to the shell type stack", () => {
    const appRoot = buildTokenTable(
      appCss.filter((rule) => rule.context.length === 0 && rule.selector === ":root"),
      "",
    );
    expect(startupDeclaration(":root", "--startup-font")).toBe(lastOf(appRoot.get("font-family")));

    const codevo = buildTokenTable(
      parseAllStyleSheets().rules.filter(
        (rule) =>
          rule.sheet === "components/agentMode/agentModeTokens.css" &&
          rule.context.length === 0 &&
          rule.selector === ".app-shell",
      ),
    );
    expect(startupDeclaration(":root", "--startup-mono")).toBe(lastOf(codevo.get("--codevo-mono")));
  });

  it("stops the hairline animation under reduced motion", () => {
    const reduced = startupRules(".startup-skeleton__hairline::before", [
      "@media (prefers-reduced-motion: reduce)",
    ]);
    expect(reduced).toHaveLength(1);
    expect(lastOf(buildTokenTable(reduced, "").get("animation"))).toBe("none");
    expect(lastOf(buildTokenTable(reduced, "").get("background"))).toBe(cssVar("--startup-accent"));
  });

  it("draws the hairline from the accent tone only", () => {
    const hairline = startupDeclaration(".startup-skeleton__hairline::before", "background");
    expect(hairline).toContain(cssVar("--startup-accent"));
    expect(startupDeclaration(".startup-skeleton__hairline", "height")).toBe(
      cssVar("--startup-hairline-height"),
    );
    expect(startupDeclaration(":root", "--startup-hairline-height")).toBe("2px");
    expect(startupDeclaration(".startup-skeleton__hairline", "top")).toBe(
      cssVar("--startup-chrome-height"),
    );
  });
});

describe("startup error screen", () => {
  it("paints from the startup ladder with no border and no hairline", () => {
    expect(startupDeclaration(".startup-error", "background")).toBe(cssVar("--startup-canvas"));
    expect(startupDeclaration(".startup-error", "color")).toBe(cssVar("--startup-text-muted"));
    expect(startupDeclaration(".startup-error", "font-family")).toBe(cssVar("--startup-font"));
    expect(startupDeclaration(".startup-error__title", "color")).toBe(cssVar("--startup-danger"));
    expect(startupDeclaration(".startup-error__details", "background")).toBe(
      cssVar("--startup-well"),
    );
    expect(startupDeclaration(".startup-error__details", "color")).toBe(cssVar("--startup-text"));
    expect(startupDeclaration(".startup-error__details", "font-family")).toBe(
      cssVar("--startup-mono"),
    );

    const errorRules = startupCss.rules.filter((rule) =>
      rule.selector.startsWith(".startup-error"),
    );
    expect(errorRules.length).toBeGreaterThan(0);
    expect(collectBorderViolations(errorRules, new Map())).toEqual([]);
    for (const rule of errorRules) {
      for (const declaration of rule.declarations) {
        expect(declaration.property, rule.selector).not.toMatch(
          /^(border(?!-radius)|outline|box-shadow|text-shadow)/,
        );
      }
    }
  });

  it("keeps the details region readable, scrollable and wrapping", () => {
    expect(startupDeclaration(".startup-error__details", "overflow")).toBe("auto");
    expect(startupDeclaration(".startup-error__details", "white-space")).toBe("pre-wrap");
    expect(startupDeclaration(".startup-error__details", "overflow-wrap")).toBe("anywhere");
    expect(startupDeclaration(".startup-error__details", "min-height")).toBe("0");
    expect(startupDeclaration(".startup-error__details", "flex")).toBe("1");
    expect(startupDeclaration(".startup-error", "height")).toBe("100%");
    expect(AIRY_RADII).toContain(startupDeclaration(".startup-error__details", "border-radius"));
  });
});

describe("native window background", () => {
  it("uses the dark side tone in both window configurations", () => {
    const darkSide = startupTone("graphite-teal", "dark", "--startup-side");
    for (const file of ["tauri.conf.json", "tauri.macos.conf.json"]) {
      const config: unknown = JSON.parse(
        readFileSync(resolve(REPOSITORY_ROOT, "src-tauri", file), "utf8"),
      );
      const windows = (config as { app?: { windows?: readonly Record<string, unknown>[] } }).app
        ?.windows;
      const main = windows?.find((entry) => entry.label === "main");
      expect(main, file).toBeDefined();
      expect(main?.backgroundColor, file).toBe(darkSide);
    }
  });
});
