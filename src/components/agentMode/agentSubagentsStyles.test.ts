import { describe, expect, it } from "vitest";
import {
  PALETTE_IDS,
  RESOLVED_COLOR_SCHEMES,
  type PaletteId,
  type ResolvedColorScheme,
} from "../../domain/appearance";
import { paletteTokens, surfaceColor, type SurfaceRole } from "../../domain/appearancePalettes";
import { compositeOver } from "../../domain/appearanceShellStates";
import { contrastRatio } from "../../domain/themeContrast";
import {
  COLOR_LITERAL,
  buildTokenTable,
  lastOf,
  parseCssRules,
  readStyleSheet,
  selectorParts,
  varReferences,
  type CssRule,
} from "../cssContractTestSupport";

const SHEET = "components/agentMode/agentSubagents.css";
const SURFACE_SHEET = "components/agentMode/agentSurface.css";
const SEMANTIC_SHEET = "ui/tokens/semantic.css";
const AA_TEXT = 4.5;
const WEAK_FILL = 0.05;
const STRONGER_FILL = 0.3;
const CONTROL_DANGER = "#C03030";
const CONTROL_SURFACE = "#FFFFFF";
const PANEL_SURFACE: SurfaceRole = "canvas";
const BACKDROP_PROPERTIES = ["background", "background-color", "background-image"];
const SURFACE_CONTAINERS = [".agent-surface", ".agent-surface__body", ".agent-surface__tabpanel"];
const PANEL_CONTAINERS = [
  ".agents-dock",
  ".agents-dock__main",
  ".cv-agents",
  ".cv-agents__body",
  ".cv-agents__section",
  ".cv-agents__list",
  ".cv-agents-item",
  ".cv-agents-row",
];
const BACKDROP_OFFENDERS = [
  ".cv-agents-row:hover { background: var(--cv-tint-2); }",
  '.cv-agents-row[data-status="failed"] { background-color: var(--cv-danger-soft); }',
  ".cv-agents-item:focus-within { background-image: none; }",
  ".cv-agents__section > .cv-agents__list { background: var(--cv-tint-1); }",
  "@media (hover: hover) { .cv-agents__label, .cv-agents__body:hover { background: none; } }",
];
const BACKDROP_BYSTANDERS = [
  ".cv-agents-row__stop:hover { background: var(--cv-danger-soft); }",
  '.cv-agents-row[data-status="stopping"] .cv-agents-row__dot { background: var(--cv-work); }',
  ".cv-agents-row > .cv-agents-row__title { background-color: var(--cv-tint-1); }",
  ".cv-agents-rowdy:hover { background: var(--cv-tint-2); }",
  ".cv-agents-row:hover { color: var(--cv-fg-strong); }",
];
const DANGER_SOFT = /^color-mix\(in srgb, var\(--cv-danger\) (\d+(?:\.\d+)?)%, transparent\)$/;
const sheet = readStyleSheet(SHEET);
const parsed = parseCssRules(sheet.source, SHEET);
const surfaceRules = parseCssRules(readStyleSheet(SURFACE_SHEET).source, SURFACE_SHEET).rules;
const semanticRules = parseCssRules(readStyleSheet(SEMANTIC_SHEET).source, SEMANTIC_SHEET).rules;

function declaration(selector: string, property: string): string | undefined {
  const values = parsed.rules
    .filter(
      (rule) =>
        rule.context.length === 0 &&
        rule.selector.split(",").some((part) => part.trim() === selector),
    )
    .flatMap((rule) => rule.declarations)
    .filter((entry) => entry.property === property)
    .map((entry) => entry.value);
  return values[values.length - 1];
}

function dangerSoftAlpha(scheme: ResolvedColorScheme): number {
  const rules = semanticRules.filter(
    (rule) =>
      rule.context.length === 0 &&
      selectorParts(rule.selector).includes(`:root[data-cv-scheme="${scheme}"]`),
  );
  const value = lastOf(buildTokenTable(rules, "--cv-").get("--cv-danger-soft")) ?? "";
  const match = DANGER_SOFT.exec(value);
  expect(match, `${scheme} --cv-danger-soft: ${value}`).not.toBeNull();
  return Number(match?.[1]) / 100;
}

function translucent(hex: string, alpha: number): string {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return `rgba(${channels.join(", ")}, ${alpha})`;
}

function pillContrast(danger: string, surface: string, alpha: number): number {
  return contrastRatio(danger, compositeOver(translucent(danger, alpha), surface));
}

function stopPillContrast(palette: PaletteId, scheme: ResolvedColorScheme, alpha: number): number {
  return pillContrast(
    paletteTokens(palette, scheme).danger,
    surfaceColor(palette, scheme, PANEL_SURFACE),
    alpha,
  );
}

function subjectCompound(part: string): string {
  let depth = 0;
  let quote: string | null = null;
  let compound = "";
  for (const character of part) {
    if (quote !== null) {
      compound += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth -= 1;
    if (depth === 0 && /[\s>+~]/.test(character)) {
      compound = "";
      continue;
    }
    compound += character;
  }
  return compound;
}

function targetsContainer(part: string, containers: readonly string[]): boolean {
  const classes = subjectCompound(part).match(/\.[\w-]+/g) ?? [];
  return classes.some((name) => containers.includes(name));
}

function backdropPaints(rules: readonly CssRule[], containers: readonly string[]): string[] {
  return rules.flatMap((rule) =>
    selectorParts(rule.selector)
      .filter((part) => targetsContainer(part, containers))
      .flatMap((part) =>
        rule.declarations
          .filter((entry) => BACKDROP_PROPERTIES.includes(entry.property))
          .map((entry) => [...rule.context, part, `${entry.property}: ${entry.value}`].join(" ")),
      ),
  );
}

function panelBackdropPaints(extra: string): string[] {
  return backdropPaints(parseCssRules(`${sheet.source}\n${extra}`, SHEET).rules, PANEL_CONTAINERS);
}

describe("agent subagent styles", () => {
  it("parses cleanly and uses theme tokens instead of color literals", () => {
    expect(parsed.issues).toEqual([]);
    for (const rule of parsed.rules) {
      for (const entry of rule.declarations) {
        expect(COLOR_LITERAL.test(entry.value), `${rule.selector} ${entry.property}`).toBe(false);
      }
    }
  });

  it("only references agent tokens so light and dark themes both resolve", () => {
    const names = new Set(
      parsed.rules.flatMap((rule) =>
        rule.declarations.flatMap((entry) => varReferences(entry.value)),
      ),
    );
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) expect(name, name).toMatch(/^--(cv-|agent-|ease-standard$)/);
  });

  it("keeps the chat row and the indicator quiet: no frame, no card", () => {
    for (const selector of [".cv-spawn__head"]) {
      expect(declaration(selector, "background"), selector).toBe("transparent");
      expect(declaration(selector, "border"), selector).toBe("0");
      expect(declaration(selector, "box-shadow"), selector).toBeUndefined();
    }
  });

  it("gives panel rows the mockup three-line 62px anatomy and a 32px footer", () => {
    expect(declaration(".cv-agents-row", "height")).toBe("62px");
    expect(declaration(".cv-agents-row", "grid-template-rows")).toBe("20px 18px 16px");
    expect(declaration(".cv-agents-row", "box-sizing")).toBe("border-box");
    expect(declaration(".cv-agents__foot", "height")).toBe("32px");
  });

  it("paints the row stop as a danger pill and quiets it while stopping", () => {
    const stop = ".cv-agents-row__stop";
    const stopping = '.cv-agents-row__stop[aria-disabled="true"]';
    const hover = '.cv-agents-row__stop:hover:enabled:not([aria-disabled="true"])';
    expect(declaration(stop, "color")).toBe("var(--cv-danger)");
    expect(declaration(stop, "background")).toBe("var(--cv-danger-soft)");
    expect(declaration(stop, "box-shadow")).toBe("var(--cv-ring-danger-soft)");
    expect(declaration(stop, "border")).toBe("0");
    expect(declaration(stop, "height")).toBe("24px");
    expect(declaration(hover, "box-shadow")).toBe("var(--cv-ring-danger)");
    expect(declaration(hover, "background")).toBeUndefined();
    expect(declaration(hover, "color")).toBeUndefined();
    expect(declaration(stopping, "color")).toBe("var(--cv-fg-subtle)");
    expect(declaration(stopping, "box-shadow")).toBe("none");
    expect(declaration(stopping, "cursor")).toBe("default");
    expect(declaration(stopping, "background")).toBe("var(--cv-tint-1)");
    expect(declaration(stopping, "height")).toBeUndefined();
    expect(sheet.source).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.cv-agents-row__stop,[\s\S]*transition: none/,
    );
  });

  it("reserves the stop column so Stop and Stopping… rows keep the same elapsed position", () => {
    expect(declaration('.cv-agents-row[data-action="stop"]', "grid-template-columns")).toBe(
      "6px minmax(0, 1fr) auto minmax(80px, auto)",
    );
    expect(declaration(".cv-agents-row__stop", "justify-self")).toBe("end");
    expect(declaration(".cv-agents-row__stop", "grid-column")).toBe("4");
    expect(declaration(".cv-agents-row__stop", "min-width")).toBeUndefined();
    expect(declaration(".cv-agents-row__stop", "width")).toBeUndefined();
    expect(declaration(".cv-agents-row__activity", "grid-column")).toBe("2 / 4");
    expect(declaration(".cv-agents-row__metrics", "grid-column")).toBe("2 / 4");
  });

  it("sits on the right panel canvas without painting a backdrop of its own", () => {
    expect(backdropPaints(surfaceRules, SURFACE_CONTAINERS)).toEqual([
      `.agent-surface background: var(--cv-${PANEL_SURFACE})`,
    ]);
    expect(panelBackdropPaints("")).toEqual([]);
  });

  it("flags a backdrop on any panel container state and ignores the row's own children", () => {
    expect(panelBackdropPaints(BACKDROP_OFFENDERS.join("\n"))).toEqual([
      ".cv-agents-row:hover background: var(--cv-tint-2)",
      '.cv-agents-row[data-status="failed"] background-color: var(--cv-danger-soft)',
      ".cv-agents-item:focus-within background-image: none",
      ".cv-agents__section > .cv-agents__list background: var(--cv-tint-1)",
      "@media (hover: hover) .cv-agents__body:hover background: none",
    ]);
    for (const offender of BACKDROP_OFFENDERS) {
      expect(panelBackdropPaints(offender), offender).toHaveLength(1);
    }
    expect(panelBackdropPaints(BACKDROP_BYSTANDERS.join("\n"))).toEqual([]);
  });

  it("keeps the stop label at AA on the danger-soft fill over the panel surface", () => {
    const failing = RESOLVED_COLOR_SCHEMES.flatMap((scheme) => {
      const alpha = dangerSoftAlpha(scheme);
      return PALETTE_IDS.map((palette) => ({
        label: `${palette} ${scheme}`,
        ratio: stopPillContrast(palette, scheme, alpha),
      }));
    })
      .filter((entry) => entry.ratio < AA_TEXT)
      .map((entry) => `${entry.label} = ${entry.ratio.toFixed(2)}`);

    expect(failing).toEqual([]);
  });

  it("fails on a stronger fill so the stop label gate is not vacuous", () => {
    for (const scheme of RESOLVED_COLOR_SCHEMES) {
      expect(dangerSoftAlpha(scheme), scheme).toBeGreaterThan(0);
    }
    expect(pillContrast(CONTROL_DANGER, CONTROL_SURFACE, WEAK_FILL)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(pillContrast(CONTROL_DANGER, CONTROL_SURFACE, STRONGER_FILL)).toBeLessThan(AA_TEXT);
  });

  it("uses static status dots and animates only the live spawn lead", () => {
    const animated = parsed.rules.filter((rule) =>
      rule.declarations.some((entry) => entry.property === "animation" && entry.value !== "none"),
    );
    expect(animated.map((rule) => rule.selector)).toEqual([
      '.cv-spawn[data-live="true"] .cv-spawn__lead',
    ]);
    expect(declaration(".cv-agents-row__dot", "background")).toBe("var(--cv-work)");
    expect(
      declaration('.cv-agents-row[data-status="failed"] .cv-agents-row__dot', "background"),
    ).toBe("var(--cv-danger)");
    expect(sheet.source).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("fills the right panel as a flex column without an overlay or docked column", () => {
    expect(declaration(".agents-dock", "display")).toBe("flex");
    expect(declaration(".agents-dock__main", "flex-direction")).toBe("column");
    expect(sheet.source).not.toContain("data-agents");
    expect(sheet.source).not.toContain(".agents-panel");
  });

  it("mirrors the mockup spawn row geometry and honours reduced motion", () => {
    expect(declaration(".cv-spawn__head", "min-height")).toBe("26px");
    expect(declaration(".cv-spawn__members", "margin")).toBe("2px 0 0 28px");
    expect(declaration(".cv-spawn__open", "height")).toBe("22px");
    expect(sheet.source).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.cv-spawn\[data-live="true"\] \.cv-spawn__lead[\s\S]*animation: none/,
    );
  });

  it("shows keyboard focus as a 2px accent underline on the title instead of a ring", () => {
    for (const selector of [
      ".cv-spawn__head:focus-visible",
      ".cv-spawn-member__head:focus-visible",
      ".cv-spawn__open:focus-visible",
    ]) {
      expect(declaration(selector, "box-shadow"), selector).toBe("none");
      expect(declaration(selector, "outline"), selector).toBe("none");
    }
    for (const selector of [
      ".cv-spawn__head:focus-visible > .cv-spawn__lead",
      ".cv-spawn-member__head:focus-visible > .cv-spawn-member__title",
      ".cv-spawn__open:focus-visible",
    ]) {
      expect(declaration(selector, "text-decoration"), selector).toBe("underline");
      expect(declaration(selector, "text-decoration-color"), selector).toBe("var(--cv-focus)");
      expect(declaration(selector, "text-decoration-thickness"), selector).toBe("2px");
    }
    expect(declaration(".cv-spawn__head:hover", "text-decoration")).toBeUndefined();
  });
});
