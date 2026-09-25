import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC_ROOT, parseAllStyleSheets } from "../../components/cssContractTestSupport";

const VENDOR_CLASS = /^(?:monaco-|codicon|xterm-|mtk\d)/;
const VENDOR_CLASSES: ReadonlySet<string> = new Set([
  "cldr",
  "margin-view-overlays",
  "lightBulbWidget",
  "action-widget",
  "context-view",
  "suggest-details",
  "hover-row",
  "action-container",
  "action-item",
  "action-menu-item",
  "details-label",
  "find-part",
  "group-header",
  "label-description",
  "matchesCount",
  "peekview-title",
  "quick-input-widget",
  "ref-tree",
  "replace-part",
  "replaceToggled",
  "synthetic-focus",
]);
const DYNAMIC_CLASSES: ReadonlySet<string> = new Set([
  "xxx",
  "fixme",
  "hack",
  "todo",
  "note",
  "bug",
]);
const STYLE_CONTRACT_FILES: ReadonlySet<string> = new Set(["cssBorderAllowlist.ts"]);
const MAX_DEPTH = 12;

function productionSource(directory: string, depth: number, parts: string[]): string[] {
  expect(depth).toBeLessThanOrEqual(MAX_DEPTH);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) productionSource(path, depth + 1, parts);
    else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.includes(".test.") &&
      !STYLE_CONTRACT_FILES.has(entry.name)
    ) {
      parts.push(readFileSync(path, "utf8"));
    }
  }
  return parts;
}

describe("stylesheets", () => {
  it("style only classes that production code can render", () => {
    const source = productionSource(SRC_ROOT, 0, []).join("\n");
    const tokens = new Set(source.match(/[A-Za-z_][\w-]*/g) ?? []);
    const dynamicPrefixes = [...source.matchAll(/([A-Za-z][\w-]*-)\$\{/g)].map(
      (match) => match[1] ?? "",
    );
    const dead = new Set<string>();
    for (const rule of parseAllStyleSheets().rules) {
      for (const [, name] of rule.selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
        if (name === undefined || tokens.has(name) || VENDOR_CLASSES.has(name)) continue;
        if (VENDOR_CLASS.test(name) || DYNAMIC_CLASSES.has(name)) continue;
        if (dynamicPrefixes.some((prefix) => prefix.length > 0 && name.startsWith(prefix)))
          continue;
        dead.add(`${rule.sheet} .${name}`);
      }
    }

    expect([...dead].sort()).toEqual([]);
  });
});
