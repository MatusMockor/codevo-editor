import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const agentCss = readFileSync(resolve(import.meta.dirname, "./agentMode.css"), "utf8");

const DECLARATION = /(--agent-[\w-]+)\s*:\s*([^;{}]*);/g;
const REFERENCE = /var\(\s*(--agent-[\w-]+)/g;

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
    const cycles = declarations(agentCss)
      .filter((declaration) => references(declaration.value).has(declaration.name))
      .map((declaration) => declaration.name);

    expect(cycles).toEqual([]);
  });

  it("defines every agent token it references", () => {
    const defined = new Set(declarations(agentCss).map((declaration) => declaration.name));
    const undefinedTokens = [...references(agentCss)].filter((name) => !defined.has(name)).sort();

    expect(undefinedTokens).toEqual([]);
  });

  it("gives the focus ring and well shadow real base values", () => {
    const base = declarations(agentCss);
    const focusRing = base.find((declaration) => declaration.name === "--agent-focus-ring");
    const shadowWell = base.find((declaration) => declaration.name === "--agent-shadow-well");

    expect(focusRing?.value).toContain("0 0 0 1px var(--agent-live)");
    expect(shadowWell?.value).toContain("inset 0 1px 0");
  });
});
