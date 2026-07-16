import { maskPhpSource } from "./phpSourceMask";

export type NettePresenterMappingMask =
  | string
  | readonly [string, string, string];

export interface NettePresenterMappingInput {
  module: string;
  mask: NettePresenterMappingMask;
}

export interface NettePresenterMapping {
  module: string;
  namespace: string;
  moduleMask: string;
  presenterMask: string;
}

type PhpLiteral = string | PhpArray;

interface PhpArrayEntry {
  key: string | null;
  value: PhpLiteral;
}

type PhpArray = PhpArrayEntry[];

const MAX_CALL_CHARACTERS = 100_000;
const MAX_TOTAL_CALL_CHARACTERS = 500_000;
const MAX_NESTING_DEPTH = 32;
const MAX_CALLS = 1_000;
const MAX_DECLARATIONS = 10_000;
const IDENTIFIER = String.raw`[A-Za-z_][A-Za-z0-9_]*`;
const MASK_SEGMENT = String.raw`[A-Za-z0-9_]*\*{1,2}[A-Za-z0-9_]*`;

/**
 * Extracts literal Nette presenter mappings from direct `setMapping([...])`
 * calls and DI `addSetup('setMapping', [[...]])` calls. Dynamic PHP
 * expressions are deliberately ignored.
 */
export function nettePresenterMappingsFromPhpSource(
  source: string,
): NettePresenterMapping[] {
  const masked = maskPhpSource(source);
  const callPattern = new RegExp(
    String.raw`(\$${IDENTIFIER}|\\?${IDENTIFIER}(?:\\${IDENTIFIER})*)\s*(?:->|::)\s*(setMapping|addSetup)\s*\(`,
    "g",
  );
  const declarations: NettePresenterMappingInput[] = [];
  let calls = 0;
  let totalCallCharacters = 0;

  for (const match of masked.matchAll(callPattern)) {
    if (calls >= MAX_CALLS) {
      break;
    }

    calls += 1;
    const openOffset = (match.index ?? 0) + match[0].lastIndexOf("(");
    const closeOffset = matchingDelimiter(masked, openOffset, "(", ")");
    const callCharacters = closeOffset === null
      ? Math.min(MAX_CALL_CHARACTERS, masked.length - openOffset)
      : closeOffset - openOffset + 1;
    totalCallCharacters += callCharacters;

    if (totalCallCharacters > MAX_TOTAL_CALL_CHARACTERS) {
      break;
    }

    if (closeOffset === null) {
      continue;
    }

    const argumentsSource = source.slice(openOffset + 1, closeOffset);
    const argumentsValue = parsePhpArguments(argumentsSource);

    if (!argumentsValue) {
      continue;
    }

    const method = match[2] || "";

    if (!isCrediblePresenterMappingCall(source, match[1] || "", method)) {
      continue;
    }

    const mappingArray = mappingArrayFromCall(method, argumentsValue);

    if (!mappingArray) {
      continue;
    }

    const remainingDeclarations = MAX_DECLARATIONS - declarations.length;

    if (remainingDeclarations <= 0) {
      break;
    }

    const callDeclarations = mappingInputsFromPhpArray(
      mappingArray,
      remainingDeclarations,
    );
    declarations.push(...callDeclarations);

    if (callDeclarations.length >= remainingDeclarations) {
      break;
    }
  }

  return normalizeNettePresenterMappings(declarations);
}

/** Alias spelling for callers that prefer an explicit parser verb. */
export const parseNettePresenterMappingsFromPhp =
  nettePresenterMappingsFromPhpSource;

/**
 * Normalizes mapping data supplied by callers. Accepted shapes are an object
 * or Map of `module => mask`, and ordered `{ module, mask }` / `[module, mask]`
 * entries. Invalid and dynamic-looking values are dropped. A later declaration
 * for the same module replaces the earlier one.
 */
export function normalizeNettePresenterMappings(
  raw: unknown,
): NettePresenterMapping[] {
  const inputs = mappingInputsFromUnknown(raw);
  const normalizedByModule = new Map<string, NettePresenterMapping>();

  for (const input of inputs) {
    const mapping = normalizeMapping(input.module, input.mask);

    if (!mapping) {
      continue;
    }

    if (normalizedByModule.has(mapping.module)) {
      normalizedByModule.delete(mapping.module);
    }

    normalizedByModule.set(mapping.module, mapping);
  }

  return [...normalizedByModule.values()];
}

/** Resolves a Nette presenter name such as `Admin:Orders` to its class name. */
export function nettePresenterClassFromName(
  presenterName: string,
  mappings: readonly NettePresenterMapping[],
): string | null {
  const parts = presenterName.split(":");

  if (!parts.length || parts.some((part) => !isIdentifier(part))) {
    return null;
  }

  const exact = parts.length > 1
    ? lastMappingForModule(mappings, parts[0] || "")
    : null;
  const mapping = exact ?? lastMappingForModule(mappings, "*");

  if (!mapping) {
    return null;
  }

  const mappedParts = exact ? parts.slice(1) : parts;
  const presenter = mappedParts[mappedParts.length - 1];

  if (!presenter) {
    return null;
  }

  if (mappedParts.length > 1 && mapping.moduleMask.length === 0) {
    return null;
  }

  let className = mapping.namespace;

  for (const moduleName of mappedParts.slice(0, -1)) {
    className += expandMask(mapping.moduleMask, moduleName);
    className += "\\";
  }

  return normalizeClassName(
    className + expandMask(mapping.presenterMask, presenter),
  );
}

/** Alias matching Nette's own `formatPresenterClass` terminology. */
export const formatNettePresenterClass = nettePresenterClassFromName;

/**
 * Resolves a presenter class back to its canonical presenter name. Exact
 * module mappings are considered before `*`; among equally specific matches,
 * the later declaration wins.
 */
export function nettePresenterNameFromClass(
  className: string,
  mappings: readonly NettePresenterMapping[],
): string | null {
  const normalizedClassName = normalizeClassName(className);

  if (!normalizedClassName || !isClassName(normalizedClassName)) {
    return null;
  }

  const exactMappings = mappings.filter((mapping) => mapping.module !== "*");
  const wildcardMappings = mappings.filter((mapping) => mapping.module === "*");

  for (const mapping of [...exactMappings.reverse(), ...wildcardMappings.reverse()]) {
    const mappedParts = mappedPresenterPartsFromClass(
      normalizedClassName,
      mapping,
    );

    if (!mappedParts) {
      continue;
    }

    return mapping.module === "*"
      ? mappedParts.join(":")
      : [mapping.module, ...mappedParts].join(":");
  }

  return null;
}

function normalizeMapping(
  rawModule: string,
  rawMask: NettePresenterMappingMask,
): NettePresenterMapping | null {
  const module = rawModule.trim();

  if (module !== "*" && !isIdentifier(module)) {
    return null;
  }

  if (typeof rawMask === "string") {
    return mappingFromStringMask(module, rawMask);
  }

  if (rawMask.length !== 3 || rawMask.some((part) => typeof part !== "string")) {
    return null;
  }

  const namespace = normalizeNamespace(rawMask[0]);
  const moduleMask = trimBackslashes(rawMask[1]);
  const presenterMask = trimBackslashes(rawMask[2]);

  if (
    namespace === null ||
    !isValidModuleMask(moduleMask) ||
    !isValidMask(presenterMask)
  ) {
    return null;
  }

  return { module, namespace, moduleMask, presenterMask };
}

function mappingFromStringMask(
  module: string,
  rawMask: string,
): NettePresenterMapping | null {
  const mask = trimBackslashes(rawMask.trim());

  if (!mask || !/^[A-Za-z0-9_\\*]+$/.test(mask)) {
    return null;
  }

  const segments = mask.split("\\");

  if (segments.some((segment) => !segment)) {
    return null;
  }

  const wildcardOffsets = segments
    .map((segment, index) => segment.includes("*") ? index : -1)
    .filter((index) => index >= 0);

  if (!wildcardOffsets.length || wildcardOffsets.length > 2) {
    return null;
  }

  const presenterOffset = wildcardOffsets[wildcardOffsets.length - 1];
  const moduleOffset = wildcardOffsets.length === 2
    ? wildcardOffsets[0]
    : null;
  const namespaceEnd = moduleOffset ?? presenterOffset;
  const namespace = segments.slice(0, namespaceEnd).join("\\");
  const moduleMask = moduleOffset === null
    ? "*Module"
    : segments[moduleOffset] || "";
  const presenterMask = segments.slice(
    moduleOffset === null ? presenterOffset : moduleOffset + 1,
  ).join("\\");

  if (!isValidMask(moduleMask) || !isValidMask(presenterMask)) {
    return null;
  }

  return {
    module,
    namespace: namespace ? `${namespace}\\` : "",
    moduleMask,
    presenterMask,
  };
}

function mappedPresenterPartsFromClass(
  className: string,
  mapping: NettePresenterMapping,
): string[] | null {
  if (!className.startsWith(mapping.namespace)) {
    return null;
  }

  const relativeClass = className.slice(mapping.namespace.length);
  const presenterMatch = matchTrailingMask(relativeClass, mapping.presenterMask);

  if (!presenterMatch) {
    return null;
  }

  const modules = matchRepeatedModuleMask(
    presenterMatch.prefix,
    mapping.moduleMask,
  );

  if (!modules) {
    return null;
  }

  return [...modules, presenterMatch.name];
}

function matchTrailingMask(
  value: string,
  mask: string,
): { prefix: string; name: string } | null {
  const pattern = maskPattern(mask, 1);

  if (!pattern) {
    return null;
  }

  const match = new RegExp(`^(.*?)${pattern.source}$`).exec(value);
  const name = match?.[2] || match?.[1];

  if (!match || !name || !isIdentifier(name)) {
    return null;
  }

  return { prefix: match[1] || "", name };
}

function matchRepeatedModuleMask(value: string, mask: string): string[] | null {
  if (!value) {
    return [];
  }

  const pattern = maskPattern(mask);

  if (!pattern) {
    return null;
  }

  const matcher = new RegExp(`^${pattern.source}\\\\`);
  const modules: string[] = [];
  let remaining = value;

  while (remaining) {
    const match = matcher.exec(remaining);
    const name = match?.[1];

    if (!match || !name || !isIdentifier(name)) {
      return null;
    }

    modules.push(name);
    remaining = remaining.slice(match[0].length);
  }

  return modules;
}

function maskPattern(
  mask: string,
  captureOffset = 0,
): { source: string } | null {
  const wildcard = mask.includes("**") ? "**" : "*";
  const wildcardOffset = mask.indexOf(wildcard);

  if (wildcardOffset < 0) {
    return null;
  }

  const before = escapeRegExp(mask.slice(0, wildcardOffset));
  const after = escapeRegExp(mask.slice(wildcardOffset + wildcard.length));
  const capture = `(${IDENTIFIER})`;
  const replacement = wildcard === "**"
    ? `${capture}\\\\\\${captureOffset + 1}`
    : capture;

  return { source: `${before}${replacement}${after}` };
}

function mappingInputsFromUnknown(raw: unknown): NettePresenterMappingInput[] {
  if (raw instanceof Map) {
    return [...raw.entries()].flatMap(([module, mask]) =>
      mappingInput(module, mask) ? [mappingInput(module, mask)!] : []
    );
  }

  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => mappingInputsFromArrayEntry(entry));
  }

  if (!raw || typeof raw !== "object") {
    return [];
  }

  if ("module" in raw && "mask" in raw) {
    const input = mappingInput(raw.module, raw.mask);
    return input ? [input] : [];
  }

  return Object.entries(raw).flatMap(([module, mask]) => {
    const input = mappingInput(module, mask);
    return input ? [input] : [];
  });
}

function mappingInputsFromArrayEntry(raw: unknown): NettePresenterMappingInput[] {
  if (Array.isArray(raw) && raw.length === 2) {
    const input = mappingInput(raw[0], raw[1]);
    return input ? [input] : [];
  }

  return mappingInputsFromUnknown(raw);
}

function mappingInput(
  module: unknown,
  mask: unknown,
): NettePresenterMappingInput | null {
  if (typeof module !== "string") {
    return null;
  }

  if (typeof mask === "string") {
    return { module, mask };
  }

  if (!Array.isArray(mask) || mask.length !== 3) {
    return null;
  }

  if (mask.some((part) => typeof part !== "string")) {
    return null;
  }

  return { module, mask: [mask[0], mask[1], mask[2]] };
}

function mappingArrayFromCall(method: string, args: PhpArray): PhpArray | null {
  if (method === "setMapping") {
    if (!hasExactPositionalEntries(args, 1)) {
      return null;
    }

    return phpArrayAt(args, 0);
  }

  if (
    method !== "addSetup" ||
    !hasExactPositionalEntries(args, 2) ||
    phpStringAt(args, 0) !== "setMapping"
  ) {
    return null;
  }

  const setupArguments = phpArrayAt(args, 1);

  if (!setupArguments || !hasExactPositionalEntries(setupArguments, 1)) {
    return null;
  }

  return phpArrayAt(setupArguments, 0);
}

function mappingInputsFromPhpArray(
  array: PhpArray,
  limit: number,
): NettePresenterMappingInput[] {
  const inputs: NettePresenterMappingInput[] = [];

  for (const entry of array) {
    if (inputs.length >= limit) {
      break;
    }

    if (entry.key === null) {
      continue;
    }

    if (typeof entry.value === "string") {
      inputs.push({ module: entry.key, mask: entry.value });
      continue;
    }

    const tuple = entry.value.map((item) => item.key === null ? item.value : null);

    if (tuple.length !== 3 || tuple.some((item) => typeof item !== "string")) {
      continue;
    }

    inputs.push({
      module: entry.key,
      mask: [tuple[0] as string, tuple[1] as string, tuple[2] as string],
    });
  }

  return inputs;
}

function hasExactPositionalEntries(array: PhpArray, length: number): boolean {
  return array.length === length && array.every((entry) => entry.key === null);
}

function phpArrayAt(array: PhpArray, index: number): PhpArray | null {
  const value = array[index]?.value;
  return Array.isArray(value) ? value : null;
}

function phpStringAt(array: PhpArray, index: number): string | null {
  const value = array[index]?.value;
  return typeof value === "string" ? value : null;
}

function parsePhpArguments(source: string): PhpArray | null {
  if (source.length > MAX_CALL_CHARACTERS) {
    return null;
  }

  const parser = new PhpLiteralParser(source);
  return parser.parseArguments();
}

class PhpLiteralParser {
  private offset = 0;

  constructor(private readonly source: string) {}

  parseArguments(): PhpArray | null {
    const entries = this.parseEntries(null, 0);

    if (!entries) {
      return null;
    }

    this.skipTrivia();
    return this.offset === this.source.length ? entries : null;
  }

  private parseEntries(closing: string | null, depth: number): PhpArray | null {
    if (depth > MAX_NESTING_DEPTH) {
      return null;
    }

    const entries: PhpArray = [];
    this.skipTrivia();

    while (this.offset < this.source.length) {
      if (closing && this.source.startsWith(closing, this.offset)) {
        this.offset += closing.length;
        return entries;
      }

      const first = this.parseValue(depth);

      if (first === null) {
        return null;
      }

      this.skipTrivia();
      let key: string | null = null;
      let value = first;

      if (this.source.startsWith("=>", this.offset)) {
        if (typeof first !== "string") {
          return null;
        }

        key = first;
        this.offset += 2;
        this.skipTrivia();
        const keyedValue = this.parseValue(depth);

        if (keyedValue === null) {
          return null;
        }

        value = keyedValue;
      }

      entries.push({ key, value });
      this.skipTrivia();

      if (closing && this.source.startsWith(closing, this.offset)) {
        this.offset += closing.length;
        return entries;
      }

      if (this.source[this.offset] !== ",") {
        return closing ? null : entries;
      }

      this.offset += 1;
      this.skipTrivia();

      if (closing && this.source.startsWith(closing, this.offset)) {
        this.offset += closing.length;
        return entries;
      }
    }

    return closing ? null : entries;
  }

  private parseValue(depth: number): PhpLiteral | null {
    this.skipTrivia();
    const character = this.source[this.offset];

    if (character === "'" || character === '"') {
      return this.parseString(character);
    }

    if (character === "[") {
      this.offset += 1;
      return this.parseEntries("]", depth + 1);
    }

    const arrayMatch = /^array\s*\(/i.exec(this.source.slice(this.offset));

    if (!arrayMatch) {
      return null;
    }

    this.offset += arrayMatch[0].length;
    return this.parseEntries(")", depth + 1);
  }

  private parseString(quote: string): string | null {
    this.offset += 1;
    let value = "";

    while (this.offset < this.source.length) {
      const character = this.source[this.offset] || "";

      if (character === quote) {
        this.offset += 1;
        return value;
      }

      if (quote === '"' && (character === "$" || character === "{")) {
        return null;
      }

      if (character !== "\\") {
        value += character;
        this.offset += 1;
        continue;
      }

      const next = this.source[this.offset + 1];

      if (next === undefined) {
        return null;
      }

      if (quote === "'" && next !== "'" && next !== "\\") {
        value += `\\${next}`;
        this.offset += 2;
        continue;
      }

      const escapes: Record<string, string> = {
        "\\": "\\",
        '"': '"',
        "$": "$",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      value += escapes[next] ?? `\\${next}`;
      this.offset += 2;
    }

    return null;
  }

  private skipTrivia(): void {
    while (this.offset < this.source.length) {
      if (/\s/.test(this.source[this.offset] || "")) {
        this.offset += 1;
        continue;
      }

      if (this.source.startsWith("//", this.offset) || this.source[this.offset] === "#") {
        const lineEnd = this.source.indexOf("\n", this.offset + 1);
        this.offset = lineEnd < 0 ? this.source.length : lineEnd + 1;
        continue;
      }

      if (!this.source.startsWith("/*", this.offset)) {
        return;
      }

      const commentEnd = this.source.indexOf("*/", this.offset + 2);
      this.offset = commentEnd < 0 ? this.source.length : commentEnd + 2;
    }
  }
}

function matchingDelimiter(
  masked: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;
  const end = Math.min(masked.length, openOffset + MAX_CALL_CHARACTERS + 1);

  for (let offset = openOffset; offset < end; offset += 1) {
    if (masked[offset] === open) {
      depth += 1;

      if (depth > MAX_NESTING_DEPTH) {
        return null;
      }

      continue;
    }

    if (masked[offset] !== close) {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return offset;
    }
  }

  return null;
}

function lastMappingForModule(
  mappings: readonly NettePresenterMapping[],
  module: string,
): NettePresenterMapping | null {
  for (let index = mappings.length - 1; index >= 0; index -= 1) {
    if (mappings[index]?.module === module) {
      return mappings[index] || null;
    }
  }

  return null;
}

function expandMask(mask: string, name: string): string {
  return mask.includes("**")
    ? mask.replace("**", `${name}\\${name}`)
    : mask.replace("*", name);
}

function normalizeNamespace(value: string): string | null {
  const normalized = trimBackslashes(value.trim());

  if (!normalized) {
    return "";
  }

  if (!isClassName(normalized)) {
    return null;
  }

  return `${normalized}\\`;
}

function normalizeClassName(value: string): string {
  return trimBackslashes(value.trim()).replace(/\\{2,}/g, "\\");
}

function trimBackslashes(value: string): string {
  return value.replace(/^\\+|\\+$/g, "");
}

function isValidMask(mask: string): boolean {
  if (!new RegExp(`^(?:${IDENTIFIER}\\\\)*${MASK_SEGMENT}(?:\\\\${IDENTIFIER})*$`).test(mask)) {
    return false;
  }

  return (mask.match(/\*/g) || []).length <= 2;
}

function isValidModuleMask(mask: string): boolean {
  return mask.length === 0 || isValidMask(mask);
}

function isCrediblePresenterMappingCall(
  source: string,
  receiver: string,
  method: string,
): boolean {
  const normalizedReceiver = receiver.replace(/^\\/, "").toLowerCase();
  const hasPresenterFactoryType =
    /\bI?PresenterFactory\b|Nette\\Application\\(?:UI\\)?I?PresenterFactory/.test(
      source,
    );

  if (method === "setMapping") {
    if (normalizedReceiver.endsWith("presenterfactory")) {
      return true;
    }

    return normalizedReceiver.includes("factory") && hasPresenterFactoryType;
  }

  if (method !== "addSetup" || !normalizedReceiver.includes("definition")) {
    return false;
  }

  if (!hasPresenterFactoryType) {
    return false;
  }

  return /\b(?:CompilerExtension|Configurator)\b|\bgetByType\s*\(/.test(source);
}

function isIdentifier(value: string): boolean {
  return new RegExp(`^${IDENTIFIER}$`).test(value);
}

function isClassName(value: string): boolean {
  return new RegExp(`^${IDENTIFIER}(?:\\\\${IDENTIFIER})*$`).test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
