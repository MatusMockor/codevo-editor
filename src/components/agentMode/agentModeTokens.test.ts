import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const agentCss = readFileSync(resolve(import.meta.dirname, "./agentMode.css"), "utf8");
const frameCss = readFileSync(resolve(import.meta.dirname, "../workbenchShellFrame.css"), "utf8");
const agentStyles = `${agentCss}\n${frameCss}`;

const DECLARATION = /(--agent-[\w-]+)\s*:\s*([^;{}]*);/g;
const REFERENCE = /var\(\s*(--agent-[\w-]+)/g;
const BLOCK = /([^{}]*)\{([^{}]*)\}/g;
const DECLARES_TOKEN = /--agent-[\w-]+\s*:/;
const TOKEN_SCOPE = /\.workbench-frame|\.app-shell|\.editor-workbench/;

function declarations(source: string): ReadonlyArray<{ name: string; value: string }> {
  return [...source.matchAll(DECLARATION)].map((match) => ({
    name: match[1] ?? "",
    value: match[2] ?? "",
  }));
}

function references(source: string): ReadonlySet<string> {
  return new Set([...source.matchAll(REFERENCE)].map((match) => match[1] ?? ""));
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

  it("gives the focus ring and well shadow real base values", () => {
    const base = declarations(agentCss);
    const focusRing = base.find((declaration) => declaration.name === "--agent-focus-ring");
    const shadowWell = base.find((declaration) => declaration.name === "--agent-shadow-well");

    expect(focusRing?.value).toContain("0 0 0 1px var(--agent-live)");
    expect(shadowWell?.value).toContain("inset 0 1px 0");
  });
});
