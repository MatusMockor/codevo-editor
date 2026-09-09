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
  SYSTEM_LIGHT_CONTEXT,
  SYSTEM_THEME_SELECTOR,
  type CssRule,
} from "./components/cssContractTestSupport";
import { DEFAULT_AGENT_RAIL_WIDTH } from "./domain/agentWorkbenchLayout";
import { STARTUP_THEME_IDS } from "./domain/startupTheme";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const STARTUP_SHEET = "index.html";
const STARTUP_SKELETON_SELECTOR = "[data-startup-skeleton]";
const HEX_TONE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const APP_TOKEN_FOR_TONE = {
  "--startup-side": "--color-sidebar",
  "--startup-canvas": "--color-app",
  "--startup-well": "--color-control",
  "--startup-accent": "--color-accent",
  "--startup-text": "--color-text-strong",
  "--startup-text-muted": "--color-text-muted",
  "--startup-danger": "--color-error",
} as const;
const TONE_KEYS = Object.keys(APP_TOKEN_FOR_TONE) as ReadonlyArray<keyof typeof APP_TOKEN_FOR_TONE>;
const SURFACE_TONE_KEYS = ["--startup-side", "--startup-canvas", "--startup-well"] as const;
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
const startupStyle = extractStartupStyle(documentSource);
const startupCss = parseCssRules(startupStyle, STARTUP_SHEET);
const startupDocument = new DOMParser().parseFromString(documentSource, "text/html");
const appCss = parseAllStyleSheets().rules.filter((rule) => rule.sheet === "App.css");

function extractStartupStyle(source: string): string {
  const match = /<style>([\s\S]*?)<\/style>/.exec(source);
  expect(match, "index.html must carry the startup stylesheet inline").not.toBeNull();
  return match?.[1] ?? "";
}

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

function startupTone(theme: string, tone: string): string | undefined {
  const themed = lastOf(
    buildTokenTable(startupRules(`:root[data-startup-theme="${theme}"]`)).get(tone),
  );
  if (themed !== undefined) {
    return themed;
  }

  return lastOf(buildTokenTable(startupRules(":root")).get(tone));
}

function appTone(theme: string, token: string): string | undefined {
  const selector = theme === "dark" ? ":root" : `.app-shell[data-theme="${theme}"]`;
  const themed = lastOf(
    buildTokenTable(
      appCss.filter(
        (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector),
      ),
    ).get(token),
  );
  if (themed !== undefined) {
    return themed;
  }

  return lastOf(buildTokenTable(appCss.filter((rule) => rule.selector === ":root")).get(token));
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

  it("tones every theme from the same values the real theme declares", () => {
    for (const theme of STARTUP_THEME_IDS) {
      if (theme === "system") continue;
      for (const tone of TONE_KEYS) {
        const startup = startupTone(theme, tone);
        expect(startup, `${theme} ${tone}`).toBeDefined();
        expect(startup, `${theme} ${tone}`).toBe(appTone(theme, APP_TOKEN_FOR_TONE[tone]));
      }
    }
  });

  it("never paints a white surface in any theme", () => {
    for (const theme of STARTUP_THEME_IDS) {
      if (theme === "system") continue;
      for (const tone of SURFACE_TONE_KEYS) {
        const value = startupTone(theme, tone) ?? "";
        expect(value, `${theme} ${tone}`).toMatch(HEX_TONE);
        expect(isPureWhite(value), `${theme} ${tone}`).toBe(false);
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

  it("keeps the resolved system theme in step with the light theme block", () => {
    const systemLight = buildTokenTable(
      appCss.filter(
        (rule) =>
          rule.context.length === 1 &&
          rule.context[0] === SYSTEM_LIGHT_CONTEXT &&
          rule.selector === SYSTEM_THEME_SELECTOR,
      ),
    );
    for (const tone of TONE_KEYS) {
      const appToken = APP_TOKEN_FOR_TONE[tone];
      expect(lastOf(systemLight.get(appToken)), appToken).toBeDefined();
      expect(lastOf(systemLight.get(appToken)), appToken).toBe(startupTone("light", tone));
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
    const darkSide = startupTone("dark", "--startup-side");
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
