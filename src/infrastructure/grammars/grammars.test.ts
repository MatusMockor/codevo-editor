import { describe, expect, it } from "vitest";
import type { LanguageRegistration } from "shiki/core";
import latteLangs, { latteGrammar } from "./latteGrammar";
import neonLangs, { neonGrammar } from "./neonGrammar";

/**
 * Collects every `{ include: "#name" }` reference reachable from a grammar's
 * top-level `patterns`, its `injections`, and every repository entry, so a test
 * can prove no rule points at a repository key that does not exist. A dangling
 * internal include silently drops highlighting for that construct, so this is a
 * cheap structural guard that runs without booting a highlighter.
 */
function collectInternalIncludes(grammar: LanguageRegistration): string[] {
  const includes: string[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) {
        walk(child);
      }
      return;
    }
    if (!node || typeof node !== "object") {
      return;
    }
    const record = node as Record<string, unknown>;
    const include = record.include;
    if (typeof include === "string" && include.startsWith("#")) {
      includes.push(include.slice(1));
    }
    for (const value of Object.values(record)) {
      walk(value);
    }
  };

  walk(grammar.patterns);
  walk(grammar.injections);
  walk(grammar.repository);

  return includes;
}

describe("Latte TextMate grammar", () => {
  it("exposes a stable language id and HTML-based scope name", () => {
    expect(latteGrammar.name).toBe("latte");
    expect(latteGrammar.scopeName).toBe("text.html.latte");
    expect(latteGrammar.embeddedLangs).toContain("html");
  });

  it("bundles the grammar as a default array so Shiki can load it", () => {
    expect(Array.isArray(latteLangs)).toBe(true);
    expect(latteLangs).toContain(latteGrammar);
  });

  it("resolves every internal include against its repository", () => {
    const repositoryKeys = new Set(Object.keys(latteGrammar.repository ?? {}));
    for (const include of collectInternalIncludes(latteGrammar)) {
      expect(repositoryKeys.has(include), `missing repository key #${include}`).toBe(
        true,
      );
    }
  });

  it("includes the HTML base grammar so markup keeps highlighting", () => {
    const serialized = JSON.stringify(latteGrammar);
    expect(serialized).toContain("text.html.basic");
  });
});

describe("NEON TextMate grammar", () => {
  it("exposes a stable language id and YAML-style scope name", () => {
    expect(neonGrammar.name).toBe("neon");
    expect(neonGrammar.scopeName).toBe("source.neon");
  });

  it("bundles the grammar as a default array so Shiki can load it", () => {
    expect(Array.isArray(neonLangs)).toBe(true);
    expect(neonLangs).toContain(neonGrammar);
  });

  it("resolves every internal include against its repository", () => {
    const repositoryKeys = new Set(Object.keys(neonGrammar.repository ?? {}));
    for (const include of collectInternalIncludes(neonGrammar)) {
      expect(repositoryKeys.has(include), `missing repository key #${include}`).toBe(
        true,
      );
    }
  });
});
