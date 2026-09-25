import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC_ROOT, parseAllStyleSheets } from "../../components/cssContractTestSupport";

const SCANNED_EXTENSIONS = [".css", ".ts", ".tsx"] as const;
const SELF = "ui/tokens/legacyTokenRatchet.test.ts";
const MAX_FILES = 6000;
const MAX_DEPTH = 12;
const TOKEN = /(?<![\w-])--[a-z][a-z0-9-]*/g;
const LEGACY_FAMILY =
  /^--(?:color-|codevo-|symbol-|vis-|radius-|change-(?:added|deleted|modified))/;
const LAYOUT_VARIABLE =
  /^--agent-(?:rail-|right-panel-|bottom-panel-|find-pill-|minimap-|center-min-width$|surface-header-height$|surface-edge-width$|surface-editor-gutter$|surface-focus-gutter$|session-gutter$|find-inset$|turn-gap$|row-pad$)/;
const LEGACY_ALIASES: ReadonlySet<string> = new Set([
  "--accent",
  "--background-active",
  "--background-primary",
  "--border-color",
  "--border-strong",
  "--border-subtle",
  "--button-primary-bg",
  "--danger-border",
  "--danger-surface",
  "--danger-text",
  "--editor-background",
  "--editor-bg",
  "--input-background",
  "--panel-background",
  "--panel-bg",
  "--selection-background",
  "--selection-bg",
  "--status-error",
  "--status-success",
  "--success",
  "--surface-control",
  "--surface-input",
  "--surface-raised",
  "--text-danger",
  "--text-muted",
  "--text-primary",
  "--text-secondary",
  "--warning",
  "--shadow-pop",
  "--focus-ring",
  "--motion-fast",
  "--motion-base",
  "--ease-standard",
]);

function isLegacyTokenName(name: string): boolean {
  if (name.endsWith("-")) return false;
  if (LEGACY_FAMILY.test(name) || LEGACY_ALIASES.has(name)) return true;
  return name.startsWith("--agent-") && !LAYOUT_VARIABLE.test(name);
}

function sourceFiles(directory: string, depth: number, found: string[]): string[] {
  expect(depth, directory).toBeLessThanOrEqual(MAX_DEPTH);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(path, depth + 1, found);
      continue;
    }
    if (!SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;
    found.push(relative(SRC_ROOT, path).split(sep).join("/"));
  }
  expect(found.length).toBeLessThanOrEqual(MAX_FILES);
  return found;
}

function legacyTokenCounts(): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(SRC_ROOT, 0, []).sort()) {
    if (file === SELF) continue;
    const source = readFileSync(join(SRC_ROOT, file), "utf8");
    const count = (source.match(TOKEN) ?? []).filter(isLegacyTokenName).length;
    if (count > 0) counts[file] = count;
  }
  return counts;
}

describe("legacy token ratchet", () => {
  it("contains no legacy CSS variable anywhere in src", () => {
    expect(legacyTokenCounts()).toEqual({});
  });

  it("never selects on the classic syntax theme attribute", () => {
    const classic = parseAllStyleSheets()
      .rules.filter((rule) => rule.selector.includes("data-theme"))
      .map((rule) => `${rule.sheet} ${rule.selector}`);

    expect(classic).toEqual([]);
  });

  it("declares every referenced palette token at the document root", () => {
    const declared = new Set(
      parseAllStyleSheets()
        .rules.filter((rule) => rule.sheet.startsWith("ui/tokens/"))
        .filter((rule) => rule.selector.split(",").some((part) => part.trim().startsWith(":root")))
        .flatMap((rule) => rule.declarations.map((declaration) => declaration.property)),
    );
    const referenced = new Set(
      sourceFiles(SRC_ROOT, 0, [])
        .filter((file) => file !== SELF)
        .flatMap((file) => [
          ...readFileSync(join(SRC_ROOT, file), "utf8").matchAll(/var\(\s*(--cv-[a-z0-9-]+)/g),
        ])
        .map((match) => match[1] ?? "")
        .filter((name) => !name.endsWith("-")),
    );

    expect([...referenced].filter((name) => !declared.has(name)).sort()).toEqual([]);
  });

  it("classifies legacy families and leaves palette, layout and vendor variables alone", () => {
    const legacy = [
      "--color-text",
      "--change-added-soft",
      "--codevo-fg",
      "--agent-text-muted",
      "--text-muted",
      "--radius-sm",
      "--symbol-method",
    ];
    const allowed = [
      "--cv-fg",
      "--agent-rail-width",
      "--agent-right-panel-committed",
      "--change-popover-accent",
      "--vscode-editor-background",
      "--toast-surface",
      "--color-",
    ];

    expect(legacy.filter((name) => !isLegacyTokenName(name))).toEqual([]);
    expect(allowed.filter(isLegacyTokenName)).toEqual([]);
  });
});
