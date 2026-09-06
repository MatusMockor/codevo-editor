import { describe, expect, it } from "vitest";
import {
  buildTokenTable,
  customPropertyDeclarations,
  lastOf,
  parseCssRules,
  readStyleSheet,
  referencesSelf,
  selectorParts,
  varReferences,
  type CssRule,
} from "../cssContractTestSupport";
import { AGENT_MODE_STYLE_SHEETS, agentModeSheetPath } from "./agentModeCssTestSupport";

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
      ["--agent-rail", "var(--codevo-side)"],
      ["--agent-raised", "var(--codevo-raised)"],
      ["--agent-well", "var(--codevo-well)"],
      ["--agent-fill", "var(--codevo-active)"],
      ["--agent-hover", "var(--codevo-hover)"],
      ["--agent-hairline", "var(--codevo-hover)"],
      ["--agent-hairline-strong", "var(--codevo-active)"],
      ["--agent-text-strong", "var(--codevo-fg-strong)"],
      ["--agent-text", "var(--codevo-fg)"],
      ["--agent-text-muted", "var(--codevo-fg-muted)"],
      ["--agent-text-subtle", "var(--codevo-fg-subtle)"],
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

  it("keeps the light frame overrides down to the shadow alpha scalar", () => {
    for (const selector of LIGHT_FRAME_SELECTORS) {
      const rules = tokenRules.filter(
        (rule) => rule.context.length === 0 && selectorParts(rule.selector).includes(selector),
      );
      const declared = [...declaredNames(rules, "--agent-")];
      expect(declared, selector).toEqual(["--agent-shadow-alpha"]);
    }
  });

  it("keeps the rail track at the frame width", () => {
    const railWidth = buildTokenTable(frameRules, "--agent-rail-width").get("--agent-rail-width");

    expect(lastOf(railWidth)).toBe("256px");
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
