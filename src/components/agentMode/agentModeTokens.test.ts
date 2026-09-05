import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readAgentModeStyles } from "./agentModeCssTestSupport";

const agentCss = readAgentModeStyles();
const frameCss = readFileSync(resolve(import.meta.dirname, "../workbenchShellFrame.css"), "utf8");
const agentStyles = `${agentCss}\n${frameCss}`;

const DECLARATION = /(--agent-[\w-]+)\s*:\s*([^;{}]*);/g;
const REFERENCE = /var\(\s*(--agent-[\w-]+)/g;
const ANY_DECLARATION = /(--[\w-]+)\s*:\s*([^;{}]*);/g;
const T3_REFERENCE = /var\(\s*(--t3-[\w-]+)/g;
const BLOCK = /([^{}]*)\{([^{}]*)\}/g;
const DECLARES_TOKEN = /--agent-[\w-]+\s*:/;
const TOKEN_SCOPE = /\.workbench-frame|\.app-shell|\.editor-workbench/;
const LIGHT_SELECTORS = [
  '.app-shell[data-theme="light"]',
  '.app-shell[data-theme="catppuccinLatte"]',
  '.app-shell[data-theme="oneLight"]',
] as const;

function declarations(source: string): ReadonlyArray<{ name: string; value: string }> {
  return [...source.matchAll(DECLARATION)].map((match) => ({
    name: match[1] ?? "",
    value: match[2] ?? "",
  }));
}

function anyDeclarations(source: string): ReadonlyArray<{ name: string; value: string }> {
  return [...source.matchAll(ANY_DECLARATION)].map((match) => ({
    name: match[1] ?? "",
    value: match[2] ?? "",
  }));
}

function references(source: string): ReadonlySet<string> {
  return new Set([...source.matchAll(REFERENCE)].map((match) => match[1] ?? ""));
}

function anyReferences(pattern: RegExp, source: string): ReadonlySet<string> {
  return new Set([...source.matchAll(pattern)].map((match) => match[1] ?? ""));
}

function blocks(source: string): ReadonlyArray<{ selector: string; body: string }> {
  return [...source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(BLOCK)].map((match) => ({
    selector: (match[1] ?? "").trim(),
    body: match[2] ?? "",
  }));
}

function appShellBodies(source: string): ReadonlyArray<{ selector: string; body: string }> {
  return blocks(source).filter((entry) =>
    entry.selector.split(",").every((part) => part.trim().startsWith(".app-shell")),
  );
}

describe("agent mode token contract", () => {
  it("never declares a token in terms of itself", () => {
    const cycles = declarations(agentStyles)
      .filter((declaration) => references(declaration.value).has(declaration.name))
      .map((declaration) => declaration.name);

    expect(cycles).toEqual([]);
  });

  it("defines every agent token it references across the agent styles and the shell frame", () => {
    const defined = new Set(declarations(agentStyles).map((declaration) => declaration.name));
    const undefinedTokens = [...references(agentStyles)]
      .filter((name) => !defined.has(name))
      .sort();

    expect(undefinedTokens).toEqual([]);
  });

  it("keeps the frame-owned layout tokens out of the agent visual styles", () => {
    const agentDefined = new Set(declarations(agentCss).map((declaration) => declaration.name));
    const frameDefined = new Set(declarations(frameCss).map((declaration) => declaration.name));

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
    const scopes = [...agentStyles.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(BLOCK)]
      .filter((match) => DECLARES_TOKEN.test(match[2] ?? ""))
      .map((match) => (match[1] ?? "").trim())
      .filter((selector) => !selector.startsWith("@") && selector.length > 0);

    const unscoped = scopes.filter((selector) =>
      selector.split(",").some((part: string) => !TOKEN_SCOPE.test(part)),
    );

    expect(unscoped).toEqual([]);
  });

  it("never declares a t3 or shell token in terms of itself", () => {
    const cycles = anyDeclarations(agentStyles)
      .filter((declaration) =>
        anyReferences(/var\(\s*(--[\w-]+)/g, declaration.value).has(declaration.name),
      )
      .map((declaration) => declaration.name);

    expect(cycles).toEqual([]);
  });

  it("declares every referenced t3 token on the app shell", () => {
    const declared = new Set(
      appShellBodies(agentStyles).flatMap((entry) =>
        anyDeclarations(entry.body)
          .map((declaration) => declaration.name)
          .filter((name) => name.startsWith("--t3-")),
      ),
    );
    const missing = [...anyReferences(T3_REFERENCE, agentStyles)]
      .filter((name) => !declared.has(name))
      .sort();

    expect(missing).toEqual([]);
  });

  it("overrides the t3 palette for every light theme selector", () => {
    for (const selector of LIGHT_SELECTORS) {
      const light = appShellBodies(agentStyles).filter(
        (entry) =>
          entry.selector.split(",").some((part) => part.trim() === selector) &&
          /--t3-[\w-]+\s*:/.test(entry.body),
      );

      expect(light.length, selector).toBeGreaterThan(0);
      const declared = new Set(
        light.flatMap((entry) =>
          anyDeclarations(entry.body).map((declaration) => declaration.name),
        ),
      );
      for (const token of ["--t3-background", "--t3-primary", "--t3-border"]) {
        expect(declared.has(token), `${selector} ${token}`).toBe(true);
      }
    }
  });

  it("retires the ambient gradient and the scanline on the frame base scope", () => {
    const base = blocks(agentCss)
      .filter((entry) => entry.selector === ".workbench-frame")
      .flatMap((entry) => declarations(entry.body));
    const ambient = base.filter((entry) => entry.name === "--agent-ambient");
    const scanline = base.filter((entry) => entry.name === "--agent-scanline");

    expect(ambient[ambient.length - 1]?.value.trim()).toBe("none");
    expect(scanline[scanline.length - 1]?.value.trim()).toBe("transparent");
  });

  it("raises the subtle text mix on every light surface", () => {
    const MIX = /color-mix\(in srgb, var\(--t3-muted-foreground\) (\d+)%, transparent\)/;
    const lightFrames = blocks(agentCss).filter(
      (entry) =>
        entry.selector
          .split(",")
          .every((part) => LIGHT_SELECTORS.some((light) => part.trim().startsWith(light))) &&
        /--agent-text-subtle\s*:/.test(entry.body),
    );
    const systemFrame = blocks(agentCss).filter(
      (entry) =>
        entry.selector.trim() === '.app-shell[data-theme="system"] .workbench-frame' &&
        /--agent-text-subtle\s*:/.test(entry.body),
    );

    expect(lightFrames.length).toBeGreaterThan(0);
    expect(systemFrame.length).toBeGreaterThan(0);
    for (const entry of [...lightFrames, ...systemFrame]) {
      const subtle = declarations(entry.body).find(
        (declaration) => declaration.name === "--agent-text-subtle",
      );
      const mix = MIX.exec(subtle?.value ?? "");
      expect(mix, entry.selector).not.toBeNull();
      expect(Number(mix?.[1] ?? 0), entry.selector).toBeGreaterThanOrEqual(85);
    }
  });

  it("keeps the rail track at the t3 width", () => {
    const railWidth = declarations(frameCss).find((entry) => entry.name === "--agent-rail-width");

    expect(railWidth?.value.trim()).toBe("256px");
  });

  it("gives the focus ring and well shadow real base values", () => {
    const base = declarations(agentCss);
    const focusRing = base.find((declaration) => declaration.name === "--agent-focus-ring");
    const shadowWell = base.find((declaration) => declaration.name === "--agent-shadow-well");

    expect(focusRing?.value).toContain("0 0 0 1px var(--agent-live)");
    expect(shadowWell?.value).toContain("inset 0 1px 0");
  });
});
