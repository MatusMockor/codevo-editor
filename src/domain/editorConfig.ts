import type { LanguageServerFormattingOptions } from "./languageServerFeatures";

/**
 * Pure EditorConfig (`.editorconfig`) support: INI parsing, glob matching, and
 * cascade resolution, plus helpers that map the resolved settings onto editor
 * concepts (Monaco formatting options, EOL, on-save content transforms).
 *
 * This module is intentionally free of any I/O or workspace state. The caller
 * (the workbench controller) is responsible for reading the `.editorconfig`
 * files from the workspace gateway, per-workspace isolation (capture + re-check
 * the active root after every await), and applying the resolved settings to the
 * editor / save flow.
 */

export type EditorConfigIndentStyle = "space" | "tab";
export type EditorConfigEndOfLine = "lf" | "crlf";

/** Raw property bag for a single `[glob]` section, keys lower-cased. */
export type EditorConfigProperties = Record<string, string>;

export interface EditorConfigSection {
  glob: string;
  properties: EditorConfigProperties;
}

export interface ParsedEditorConfig {
  root: boolean;
  sections: EditorConfigSection[];
}

/** A parsed `.editorconfig` together with the directory it lives in. */
export interface EditorConfigFile {
  /** Absolute directory containing the `.editorconfig` file. */
  directory: string;
  parsed: ParsedEditorConfig;
}

/**
 * Resolved, typed settings for a single file path after cascade resolution.
 * Every field is optional: an unset field means "no override — keep the editor
 * default". This is the contract that lets EditorConfig override editor
 * defaults only when (and exactly where) it actually matches.
 */
export interface ResolvedEditorConfig {
  indentStyle?: EditorConfigIndentStyle;
  indentSize?: number;
  tabWidth?: number;
  endOfLine?: EditorConfigEndOfLine;
  charset?: string;
  trimTrailingWhitespace?: boolean;
  insertFinalNewline?: boolean;
}

/**
 * Property keys whose values are case-insensitive enums (e.g. `space`, `LF`).
 * Their values are lower-cased on parse so downstream comparisons are simple.
 * Arbitrary values (sizes, charset) are preserved verbatim.
 */
const LOWERCASE_VALUE_KEYS = new Set([
  "indent_style",
  "end_of_line",
  "trim_trailing_whitespace",
  "insert_final_newline",
  "indent_size",
]);

export function parseEditorConfig(content: string): ParsedEditorConfig {
  const sections: EditorConfigSection[] = [];
  let root = false;
  let current: EditorConfigSection | null = null;

  for (const rawLine of content.split(/\r\n|\r|\n/)) {
    const line = stripComment(rawLine).trim();

    if (line.length === 0) {
      continue;
    }

    const section = matchSectionHeader(line);

    if (section) {
      current = { glob: section, properties: {} };
      sections.push(current);
      continue;
    }

    const pair = parseProperty(line);

    if (!pair) {
      continue;
    }

    if (!current) {
      if (pair.key === "root") {
        root = pair.value.toLowerCase() === "true";
      }
      continue;
    }

    current.properties[pair.key] = pair.value;
  }

  return { root, sections };
}

function stripComment(line: string): string {
  const hashIndex = indexOfUnquoted(line, "#");
  const semiIndex = indexOfUnquoted(line, ";");
  const indices = [hashIndex, semiIndex].filter((index) => index >= 0);

  if (indices.length === 0) {
    return line;
  }

  return line.slice(0, Math.min(...indices));
}

function indexOfUnquoted(line: string, marker: string): number {
  return line.indexOf(marker);
}

function matchSectionHeader(line: string): string | null {
  if (!line.startsWith("[") || !line.endsWith("]")) {
    return null;
  }

  return line.slice(1, -1).trim();
}

function parseProperty(
  line: string,
): { key: string; value: string } | null {
  const equalsIndex = line.indexOf("=");

  if (equalsIndex < 0) {
    return null;
  }

  const key = line.slice(0, equalsIndex).trim().toLowerCase();
  const rawValue = line.slice(equalsIndex + 1).trim();

  if (key.length === 0) {
    return null;
  }

  const value = LOWERCASE_VALUE_KEYS.has(key) ? rawValue.toLowerCase() : rawValue;

  return { key, value };
}

/**
 * EditorConfig glob matcher. Supports `*`, `**`, `?`, `[set]`, `[!set]`, and
 * `{a,b}` brace alternation, with EditorConfig's anchoring rules:
 * - A glob containing a `/` is anchored to the config file's directory.
 * - A glob with no `/` matches the file's basename at any depth.
 * - `*` matches anything except a path separator; `**` matches across them.
 *
 * `relativePath` is the file path relative to the config file's directory,
 * using forward slashes and no leading slash.
 */
export function editorConfigGlobMatches(
  glob: string,
  relativePath: string,
): boolean {
  const candidate = relativePath.split("\\").join("/").replace(/^\/+/, "");

  for (const pattern of expandBraces(glob)) {
    if (matchSinglePattern(pattern, candidate)) {
      return true;
    }
  }

  return false;
}

function matchSinglePattern(pattern: string, candidate: string): boolean {
  const anchored = pattern.includes("/");
  const regexSource = globToRegExpSource(pattern);
  const prefix = anchored ? "^" : "^(?:.*/)?";
  const regex = new RegExp(`${prefix}${regexSource}$`);

  return regex.test(candidate);
}

/**
 * Expands `{a,b,c}` alternations into a flat list of brace-free patterns.
 * Nested/multiple groups expand combinatorially. A group with no comma is left
 * intact (EditorConfig treats `{single}` literally).
 */
function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");

  if (open < 0) {
    return [pattern];
  }

  const close = matchingBrace(pattern, open);

  if (close < 0) {
    return [pattern];
  }

  const inner = pattern.slice(open + 1, close);
  const options = splitTopLevelCommas(inner);

  if (options.length < 2) {
    // No real alternation; keep braces literal and expand the rest.
    const rest = expandBraces(pattern.slice(close + 1));
    return rest.map((suffix) => pattern.slice(0, close + 1) + suffix);
  }

  const before = pattern.slice(0, open);
  const afterExpansions = expandBraces(pattern.slice(close + 1));
  const results: string[] = [];

  for (const option of options) {
    for (const optionExpansion of expandBraces(option)) {
      for (const after of afterExpansions) {
        results.push(before + optionExpansion + after);
      }
    }
  }

  return results;
}

function matchingBrace(pattern: string, openIndex: number): number {
  let depth = 0;

  for (let index = openIndex; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function splitTopLevelCommas(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of inner) {
    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;
    }

    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);

  return parts;
}

function globToRegExpSource(pattern: string): string {
  let source = "";
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];

    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 2;
        continue;
      }

      source += "[^/]*";
      index += 1;
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }

    if (char === "[") {
      const classResult = readCharacterClass(pattern, index);

      if (classResult) {
        source += classResult.regex;
        index = classResult.nextIndex;
        continue;
      }

      source += "\\[";
      index += 1;
      continue;
    }

    source += escapeRegExpChar(char);
    index += 1;
  }

  return source;
}

function readCharacterClass(
  pattern: string,
  openIndex: number,
): { regex: string; nextIndex: number } | null {
  let close = openIndex + 1;

  if (pattern[close] === "!" || pattern[close] === "^") {
    close += 1;
  }

  if (pattern[close] === "]") {
    close += 1;
  }

  while (close < pattern.length && pattern[close] !== "]") {
    close += 1;
  }

  if (close >= pattern.length) {
    return null;
  }

  const inner = pattern.slice(openIndex + 1, close);
  const negated = inner.startsWith("!") || inner.startsWith("^");
  const body = negated ? inner.slice(1) : inner;

  return {
    regex: `[${negated ? "^" : ""}${body}]`,
    nextIndex: close + 1,
  };
}

function escapeRegExpChar(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/** Name of an EditorConfig file, used to build candidate paths. */
export const EDITOR_CONFIG_FILENAME = ".editorconfig";

/**
 * Lists the directories whose `.editorconfig` files apply to `filePath`, from
 * the file's own directory up to (and including) the workspace root. The caller
 * reads `${directory}/${EDITOR_CONFIG_FILENAME}` for each, then feeds the ones
 * that exist into {@link resolveEditorConfigSettings}. Returned deepest-first so
 * a caller that stops at the first `root = true` can skip needless reads.
 */
export function editorConfigDirectoriesForFile(
  filePath: string,
  workspaceRoot: string,
): string[] {
  const normalizedFilePath = normalizePath(filePath);
  const normalizedRoot = normalizePath(workspaceRoot);

  if (!isAncestorDirectory(normalizedRoot, normalizedFilePath)) {
    return [];
  }

  const directories: string[] = [];
  let directory = parentDirectory(normalizedFilePath);

  while (directory && isAncestorDirectory(normalizedRoot, directory)) {
    directories.push(directory);

    if (directory === normalizedRoot) {
      break;
    }

    const parent = parentDirectory(directory);

    if (parent === directory) {
      break;
    }

    directory = parent;
  }

  return directories;
}

/** Absolute path to a directory's `.editorconfig` file. */
export function editorConfigPathForDirectory(directory: string): string {
  return `${normalizePath(directory)}/${EDITOR_CONFIG_FILENAME}`;
}

function parentDirectory(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");

  if (index <= 0) {
    return normalized;
  }

  return normalized.slice(0, index);
}

/**
 * Resolves the effective settings for `filePath` by cascading every applicable
 * `.editorconfig` file from the file's directory upward, stopping at the first
 * `root = true` file (or the workspace root). Within a file, later sections and
 * deeper directories override shallower ones; the standard EditorConfig
 * "closest wins" precedence.
 */
export function resolveEditorConfigSettings(
  files: EditorConfigFile[],
  filePath: string,
  workspaceRoot: string,
): ResolvedEditorConfig {
  const normalizedFilePath = normalizePath(filePath);
  const normalizedRoot = normalizePath(workspaceRoot);

  const ancestors = files
    .map((file) => ({ ...file, directory: normalizePath(file.directory) }))
    .filter((file) =>
      pathIsWithin(normalizedFilePath, file.directory, normalizedRoot),
    )
    // Deepest directory first so we can stop at the first root and so that we
    // apply shallowest-last (shallow properties fill gaps left by deep ones).
    .sort((a, b) => b.directory.length - a.directory.length);

  const applicable: EditorConfigFile[] = [];

  for (const file of ancestors) {
    applicable.push(file);

    if (file.parsed.root) {
      break;
    }
  }

  // Apply shallow-to-deep so deeper config files override shallower ones, and
  // within a file later sections override earlier ones.
  const ordered = [...applicable].reverse();
  const properties: EditorConfigProperties = {};

  for (const file of ordered) {
    const relativePath = relativeWithinDirectory(
      normalizedFilePath,
      file.directory,
    );

    if (relativePath === null) {
      continue;
    }

    for (const section of file.parsed.sections) {
      if (!editorConfigGlobMatches(section.glob, relativePath)) {
        continue;
      }

      Object.assign(properties, section.properties);
    }
  }

  return typedResolvedSettings(properties);
}

function typedResolvedSettings(
  properties: EditorConfigProperties,
): ResolvedEditorConfig {
  const resolved: ResolvedEditorConfig = {};

  const indentStyle = parseIndentStyle(properties.indent_style);

  if (indentStyle) {
    resolved.indentStyle = indentStyle;
  }

  const tabWidth = parsePositiveInteger(properties.tab_width);
  const indentSizeRaw = properties.indent_size;
  // Per the EditorConfig spec: when `indent_style = tab` and `indent_size` is
  // unset, `indent_size` defaults to `tab_width`.
  const indentSize =
    resolveIndentSize(indentSizeRaw, tabWidth) ??
    (indentStyle === "tab" ? tabWidth : undefined);

  if (indentSize !== undefined) {
    resolved.indentSize = indentSize;
  }

  const effectiveTabWidth = tabWidth ?? indentSize;

  if (effectiveTabWidth !== undefined) {
    resolved.tabWidth = effectiveTabWidth;
  }

  const endOfLine = parseEndOfLine(properties.end_of_line);

  if (endOfLine) {
    resolved.endOfLine = endOfLine;
  }

  if (typeof properties.charset === "string") {
    resolved.charset = properties.charset;
  }

  const trim = parseBoolean(properties.trim_trailing_whitespace);

  if (trim !== undefined) {
    resolved.trimTrailingWhitespace = trim;
  }

  const finalNewline = parseBoolean(properties.insert_final_newline);

  if (finalNewline !== undefined) {
    resolved.insertFinalNewline = finalNewline;
  }

  return resolved;
}

function resolveIndentSize(
  indentSizeRaw: string | undefined,
  tabWidth: number | undefined,
): number | undefined {
  if (indentSizeRaw === undefined) {
    return undefined;
  }

  if (indentSizeRaw === "tab") {
    return tabWidth;
  }

  return parsePositiveInteger(indentSizeRaw);
}

function parseIndentStyle(
  value: string | undefined,
): EditorConfigIndentStyle | null {
  if (value === "space" || value === "tab") {
    return value;
  }

  return null;
}

function parseEndOfLine(
  value: string | undefined,
): EditorConfigEndOfLine | null {
  if (value === "lf" || value === "crlf") {
    return value;
  }

  return null;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return parsed > 0 ? parsed : undefined;
}

/**
 * Maps resolved indent settings to Monaco-style formatting options. Returns
 * `null` when EditorConfig does not fully specify indentation (so the editor
 * keeps its own default / content-detected indentation). Both a style and a
 * size are required for a deterministic override.
 */
export function editorConfigFormattingOptions(
  resolved: ResolvedEditorConfig,
): LanguageServerFormattingOptions | null {
  if (!resolved.indentStyle) {
    return null;
  }

  if (resolved.indentStyle === "tab") {
    const tabSize = resolved.tabWidth ?? resolved.indentSize;

    if (tabSize === undefined) {
      return null;
    }

    return { insertSpaces: false, tabSize };
  }

  if (resolved.indentSize === undefined) {
    return null;
  }

  return { insertSpaces: true, tabSize: resolved.indentSize };
}

/** Maps `end_of_line` to a Monaco-style EOL string, or `null` when unset. */
export function editorConfigEol(resolved: ResolvedEditorConfig): string | null {
  if (resolved.endOfLine === "lf") {
    return "\n";
  }

  if (resolved.endOfLine === "crlf") {
    return "\r\n";
  }

  return null;
}

/**
 * Applies the on-save EditorConfig transforms to file content:
 * EOL normalization, trailing-whitespace trimming, and final-newline
 * insertion. Each is opt-in (driven by the resolved settings) and order is
 * chosen so they compose without fighting: normalize EOL, trim, then ensure a
 * single trailing newline using the configured EOL. Content is returned
 * unchanged when no on-save setting applies.
 */
export function applyEditorConfigOnSave(
  content: string,
  resolved: ResolvedEditorConfig,
): string {
  const eol = editorConfigEol(resolved);
  const trim = resolved.trimTrailingWhitespace === true;
  const insertFinalNewline = resolved.insertFinalNewline === true;

  if (!eol && !trim && !insertFinalNewline) {
    return content;
  }

  const targetEol = eol ?? detectDominantEol(content);
  const lines = content.split(/\r\n|\r|\n/);
  const trimmedLines = trim
    ? lines.map((line) => line.replace(/[ \t]+$/, ""))
    : lines;

  const hadTrailingNewline =
    content.length > 0 && /(\r\n|\r|\n)$/.test(content);

  // `split` produces a trailing empty element when the content ends with a
  // newline. Drop it so we control the final newline ourselves.
  const bodyLines =
    hadTrailingNewline && trimmedLines[trimmedLines.length - 1] === ""
      ? trimmedLines.slice(0, -1)
      : trimmedLines;

  let result = bodyLines.join(targetEol);

  if (content.length === 0) {
    return result;
  }

  const wantsFinalNewline = insertFinalNewline || hadTrailingNewline;

  if (wantsFinalNewline) {
    result += targetEol;
  }

  return result;
}

function detectDominantEol(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function normalizePath(path: string): string {
  return path.split("\\").join("/").replace(/\/+$/, "");
}

/**
 * True when `filePath` lives in `directory` or a subdirectory of it, and that
 * directory is at or under `workspaceRoot` (so we never walk above the
 * workspace boundary).
 */
function pathIsWithin(
  filePath: string,
  directory: string,
  workspaceRoot: string,
): boolean {
  if (!isAncestorDirectory(directory, filePath)) {
    return false;
  }

  return directory === workspaceRoot || isAncestorDirectory(workspaceRoot, directory);
}

function isAncestorDirectory(directory: string, descendant: string): boolean {
  if (directory === descendant) {
    return true;
  }

  return descendant.startsWith(`${directory}/`);
}

function relativeWithinDirectory(
  filePath: string,
  directory: string,
): string | null {
  if (!isAncestorDirectory(directory, filePath) || directory === filePath) {
    return filePath === directory ? "" : null;
  }

  return filePath.slice(directory.length + 1);
}
