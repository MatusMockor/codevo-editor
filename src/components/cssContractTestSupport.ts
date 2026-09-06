import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export type CssDeclaration = {
  readonly property: string;
  readonly value: string;
};

export type CssRule = {
  readonly sheet: string;
  readonly selector: string;
  readonly context: readonly string[];
  readonly declarations: readonly CssDeclaration[];
};

export type CssParseResult = {
  readonly rules: readonly CssRule[];
  readonly issues: readonly string[];
};

export type StyleSheet = {
  readonly sheet: string;
  readonly path: string;
  readonly source: string;
};

export type TokenTable = ReadonlyMap<string, readonly string[]>;

export const SRC_ROOT = resolve(import.meta.dirname, "..");
export const TOKEN_SHEETS = [
  "components/agentMode/agentModeTokens.css",
  "components/settings/settings.css",
  "components/toastNotification.css",
] as const;
export const LIGHT_THEME_SELECTORS = [
  '.app-shell[data-theme="light"]',
  '.app-shell[data-theme="catppuccinLatte"]',
  '.app-shell[data-theme="oneLight"]',
] as const;
export const SYSTEM_LIGHT_CONTEXT = "@media (prefers-color-scheme: light)";
export const SYSTEM_THEME_SELECTOR = '.app-shell[data-theme="system"]';

const MAX_SHEETS = 500;
const MAX_WALK_DEPTH = 8;
const MAX_VAR_DEPTH = 6;
const NESTING_AT_RULES =
  /^@(media|supports|container|layer|document|keyframes|-webkit-keyframes)\b/;
const VAR_REFERENCE = /var\(\s*(--[\w-]+)/g;
const SINGLE_VAR = /^var\(\s*(--[\w-]+)\s*\)$/;

export function lastOf<T>(items: readonly T[] | undefined): T | undefined {
  if (items === undefined || items.length === 0) return undefined;
  return items[items.length - 1];
}

const NAMED_COLORS =
  "aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen";

export const COLOR_LITERAL = new RegExp(
  `#[0-9a-f]{3,8}\\b|\\b(rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\\(|\\b(${NAMED_COLORS})\\b`,
  "i",
);

export function stripCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function listStyleSheets(root: string = SRC_ROOT): readonly string[] {
  const found: string[] = [];
  walk(root, root, 0, found);
  return found.sort();
}

export function readStyleSheet(sheet: string, root: string = SRC_ROOT): StyleSheet {
  const path = resolve(root, sheet);
  return { sheet, path, source: readFileSync(path, "utf8") };
}

export function readAllStyleSheets(root: string = SRC_ROOT): readonly StyleSheet[] {
  return listStyleSheets(root).map((sheet) => readStyleSheet(sheet, root));
}

export function parseCssRules(source: string, sheet: string): CssParseResult {
  const rules: CssRule[] = [];
  const issues: string[] = [];
  const text = stripCssComments(source);
  const end = parseBlockList(text, 0, [], sheet, rules, issues);
  const trailing = text.slice(end).trim();
  if (trailing.length > 0) issues.push(`${sheet}: unparsed trailing content "${trailing}"`);
  return { rules, issues };
}

export function parseAllStyleSheets(root: string = SRC_ROOT): CssParseResult {
  const rules: CssRule[] = [];
  const issues: string[] = [];
  for (const sheet of readAllStyleSheets(root)) {
    const parsed = parseCssRules(sheet.source, sheet.sheet);
    rules.push(...parsed.rules);
    issues.push(...parsed.issues);
  }
  return { rules, issues };
}

export function selectorParts(selector: string): readonly string[] {
  return splitTopLevel(selector, ",")
    .map(normalizeWhitespace)
    .filter((part) => part.length > 0);
}

export function varReferences(value: string): readonly string[] {
  return [...value.matchAll(VAR_REFERENCE)].map((match) => match[1] ?? "");
}

export function isSingleVar(value: string): boolean {
  return SINGLE_VAR.test(value.trim());
}

export function varListNames(value: string): readonly string[] | null {
  const parts = splitTopLevel(value, ",").map((part) => part.trim());
  const names: string[] = [];
  for (const part of parts) {
    const match = SINGLE_VAR.exec(part);
    if (match === null) return null;
    names.push(match[1] ?? "");
  }
  return names;
}

export function customPropertyDeclarations(
  rules: readonly CssRule[],
  prefix: string,
): readonly (CssDeclaration & { readonly rule: CssRule })[] {
  return rules.flatMap((rule) =>
    rule.declarations
      .filter((declaration) => declaration.property.startsWith(prefix))
      .map((declaration) => ({ ...declaration, rule })),
  );
}

export function buildTokenTable(rules: readonly CssRule[], prefix: string = "--"): TokenTable {
  const table = new Map<string, string[]>();
  for (const declaration of customPropertyDeclarations(rules, prefix)) {
    const values = table.get(declaration.property) ?? [];
    values.push(declaration.value);
    table.set(declaration.property, values);
  }
  return table;
}

export function resolveVarRoots(name: string, table: TokenTable): readonly string[] {
  const roots = new Set<string>();
  collectRoots(name, table, 0, new Set(), roots);
  return [...roots].sort();
}

export function referencesSelf(name: string, value: string): boolean {
  return varReferences(value).includes(name);
}

export type BorderViolationKind = "border" | "outline" | "box-shadow" | "text-shadow" | "filter";

export function focusVisibleOnly(selector: string): boolean {
  const parts = selectorParts(selector);
  if (parts.length === 0) return false;
  return parts.every((part) => /:focus-visible/.test(part.replace(/:not\([^)]*\)/g, "")));
}

export function borderRuleKey(rule: Pick<CssRule, "context" | "selector">): string {
  const keyframes = rule.context.filter((entry) => /^@(-webkit-)?keyframes\b/.test(entry));
  return [...keyframes, rule.selector].join(" ");
}

export type BorderViolation = {
  readonly sheet: string;
  readonly selector: string;
  readonly kind: BorderViolationKind;
  readonly property: string;
  readonly value: string;
};

export const SHADOW_TOKEN_ROOTS = [
  "--codevo-shadow-card",
  "--codevo-shadow-float",
  "--codevo-shadow-window",
  "--codevo-focus-ring",
  "--codevo-separator-inset",
] as const;

const BORDER_PROPERTY =
  /^border(-(top|right|bottom|left|inline|block)(-(start|end))?)?(-(color|width|style))?$/;
const OUTLINE_PROPERTY = /^outline(-(color|width|style))?$/;
const ZERO_BORDER = /^(0|none|0 none|none 0)$/;
const REMAP_PREFIXES = ["--agent-", "--settings-", "--toast-", "--shadow-", "--focus-"] as const;

export function collectBorderViolations(
  rules: readonly CssRule[],
  tokens: TokenTable,
): readonly BorderViolation[] {
  const violations: BorderViolation[] = [];
  for (const rule of rules) {
    for (const declaration of rule.declarations) {
      const kind = borderViolationKind(rule, declaration, tokens);
      if (kind === null) continue;
      violations.push({
        sheet: rule.sheet,
        selector: borderRuleKey(rule),
        kind,
        property: declaration.property,
        value: declaration.value,
      });
    }
  }
  return violations;
}

export function isAllowedShadowValue(value: string, tokens: TokenTable, depth = 0): boolean {
  if (value.trim() === "none") return true;
  const names = varListNames(value);
  if (names === null) return false;
  return names.every((name) => isAllowedShadowToken(name, tokens, depth));
}

function isAllowedShadowToken(name: string, tokens: TokenTable, depth: number): boolean {
  if ((SHADOW_TOKEN_ROOTS as readonly string[]).includes(name)) return true;
  if (depth >= 1) return false;
  if (!REMAP_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;
  const values = tokens.get(name);
  if (values === undefined || values.length === 0) return false;
  return values.every((value) => isAllowedShadowValue(value, tokens, depth + 1));
}

function borderViolationKind(
  rule: CssRule,
  declaration: CssDeclaration,
  tokens: TokenTable,
): BorderViolationKind | null {
  const { property, value } = declaration;
  if (BORDER_PROPERTY.test(property)) return ZERO_BORDER.test(value) ? null : "border";
  if (OUTLINE_PROPERTY.test(property)) {
    if (ZERO_BORDER.test(value)) return null;
    return focusVisibleOnly(rule.selector) ? null : "outline";
  }
  if (property === "filter") return value.includes("drop-shadow(") ? "filter" : null;
  if (property === "text-shadow") return isAllowedShadowValue(value, tokens) ? null : "text-shadow";
  if (property !== "box-shadow") return null;
  return isAllowedShadowValue(value, tokens) ? null : "box-shadow";
}

function walk(root: string, directory: string, depth: number, found: string[]): void {
  if (depth > MAX_WALK_DEPTH || found.length >= MAX_SHEETS) return;
  for (const entry of readdirSync(directory).sort()) {
    if (entry === "node_modules") continue;
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      walk(root, path, depth + 1, found);
      continue;
    }
    if (!entry.endsWith(".css")) continue;
    if (found.length >= MAX_SHEETS) return;
    found.push(relative(root, path).split("\\").join("/"));
  }
}

function parseBlockList(
  text: string,
  start: number,
  context: readonly string[],
  sheet: string,
  rules: CssRule[],
  issues: string[],
): number {
  let index = start;
  while (index < text.length) {
    const character = text[index] ?? "";
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "}") return index + 1;
    const preludeEnd = scanUntil(text, index, "{;");
    const prelude = normalizeWhitespace(text.slice(index, preludeEnd));
    if (preludeEnd >= text.length) {
      issues.push(`${sheet}: unterminated prelude "${prelude}"`);
      return text.length;
    }
    if (text[preludeEnd] === ";") {
      index = preludeEnd + 1;
      continue;
    }
    const bodyStart = preludeEnd + 1;
    if (NESTING_AT_RULES.test(prelude)) {
      index = parseBlockList(text, bodyStart, [...context, prelude], sheet, rules, issues);
      continue;
    }
    const bodyEnd = scanUntil(text, bodyStart, "{}");
    if (bodyEnd >= text.length || text[bodyEnd] === "{") {
      issues.push(`${sheet}: nested block inside "${prelude}"`);
      return text.length;
    }
    rules.push({
      sheet,
      selector: prelude,
      context,
      declarations: parseDeclarations(text.slice(bodyStart, bodyEnd)),
    });
    index = bodyEnd + 1;
  }
  return index;
}

function scanUntil(text: string, start: number, stops: string): number {
  let index = start;
  let quote: string | null = null;
  while (index < text.length) {
    const character = text[index] ?? "";
    if (quote !== null) {
      if (character === "\\") index += 1;
      if (character === quote) quote = null;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      index += 1;
      continue;
    }
    if (stops.includes(character)) return index;
    index += 1;
  }
  return text.length;
}

function parseDeclarations(body: string): readonly CssDeclaration[] {
  return splitTopLevel(body, ";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const colon = entry.indexOf(":");
      if (colon < 0) return { property: normalizeWhitespace(entry), value: "" };
      return {
        property: entry.slice(0, colon).trim(),
        value: normalizeWhitespace(entry.slice(colon + 1)),
      };
    });
}

function splitTopLevel(value: string, separator: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quote !== null) {
      current += character;
      if (character === "\\") {
        current += value[index + 1] ?? "";
        index += 1;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

function collectRoots(
  name: string,
  table: TokenTable,
  depth: number,
  seen: Set<string>,
  roots: Set<string>,
): void {
  if (depth > MAX_VAR_DEPTH || seen.has(name)) return;
  seen.add(name);
  const values = table.get(name);
  if (values === undefined) {
    roots.add(name);
    return;
  }
  for (const value of values) {
    for (const reference of varReferences(value)) {
      collectRoots(reference, table, depth + 1, seen, roots);
    }
  }
}
