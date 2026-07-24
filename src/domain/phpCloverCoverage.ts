import {
  canonicalPhpCoverageRelativePath,
  canonicalPhpCoverageRootPath,
  phpCoverageRelativePathIdentityKey,
  phpCoverageRelativePath,
} from "./phpCoveragePath";

export const PHP_CLOVER_COVERAGE_LIMITS = Object.freeze({
  maxAttributesPerElement: 32,
  maxFiles: 20_000,
  maxInputBytes: 8 * 1024 * 1024,
  maxLineRecords: 1_000_000,
  maxPathBytes: 16 * 1024,
  maxTokens: 2_000_000,
});

export interface PhpCoverageMetric {
  readonly covered: number;
  readonly total: number;
  readonly percentage: number | null;
}

export interface PhpCoverageLine {
  readonly lineNumber: number;
  readonly hits: number;
}

export interface PhpFileCoverage {
  readonly path: string;
  readonly lines: readonly PhpCoverageLine[];
  readonly summary: PhpCoverageMetric;
  readonly firstUncoveredLine: number | null;
}

export interface PhpCloverCoverageReport {
  readonly files: readonly PhpFileCoverage[];
  readonly summary: PhpCoverageMetric;
}

export interface PhpCloverParseLimits {
  readonly maxAttributesPerElement?: number;
  readonly maxFiles?: number;
  readonly maxInputBytes?: number;
  readonly maxLineRecords?: number;
  readonly maxPathBytes?: number;
  readonly maxTokens?: number;
}

interface XmlElement {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly selfClosing: boolean;
}

interface OpenElement {
  readonly name: string;
  readonly filePath: string | null;
}

const allowedParent = new Map<string, ReadonlySet<string | null>>([
  ["coverage", new Set([null])],
  ["project", new Set(["coverage"])],
  ["package", new Set(["project"])],
  ["file", new Set(["project", "package"])],
  ["class", new Set(["file"])],
  ["line", new Set(["file"])],
  ["metrics", new Set(["project", "package", "file", "class"])],
]);

/** Strictly parses PHPUnit Clover line coverage into editor-neutral PHP data. */
export function parsePhpCloverCoverage(
  source: string,
  workspaceRoot: string,
  limits: PhpCloverParseLimits = {},
): PhpCloverCoverageReport {
  if (typeof source !== "string") throw invalidClover("input must be text");
  const root = validateWorkspaceRoot(workspaceRoot);
  const bounded = {
    maxAttributesPerElement: positiveLimit(
      limits.maxAttributesPerElement,
      PHP_CLOVER_COVERAGE_LIMITS.maxAttributesPerElement,
      "maxAttributesPerElement",
    ),
    maxFiles: positiveLimit(limits.maxFiles, PHP_CLOVER_COVERAGE_LIMITS.maxFiles, "maxFiles"),
    maxInputBytes: positiveLimit(
      limits.maxInputBytes,
      PHP_CLOVER_COVERAGE_LIMITS.maxInputBytes,
      "maxInputBytes",
    ),
    maxLineRecords: positiveLimit(
      limits.maxLineRecords,
      PHP_CLOVER_COVERAGE_LIMITS.maxLineRecords,
      "maxLineRecords",
    ),
    maxPathBytes: positiveLimit(
      limits.maxPathBytes,
      PHP_CLOVER_COVERAGE_LIMITS.maxPathBytes,
      "maxPathBytes",
    ),
    maxTokens: positiveLimit(limits.maxTokens, PHP_CLOVER_COVERAGE_LIMITS.maxTokens, "maxTokens"),
  };
  if (utf8ByteLength(source) > bounded.maxInputBytes) {
    throw invalidClover(`input exceeds ${bounded.maxInputBytes} UTF-8 bytes`);
  }

  const files = new Map<string, Map<number, number>>();
  const filePathsByIdentity = new Map<string, string>();
  const stack: OpenElement[] = [];
  let cursor = 0;
  let fileRecords = 0;
  let lineRecords = 0;
  let tokenCount = 0;
  let sawRoot = false;
  let closedRoot = false;

  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart < 0) {
      requireWhitespace(source.slice(cursor), "after the root element");
      break;
    }
    requireWhitespace(source.slice(cursor, tagStart), `offset ${cursor}`);
    cursor = tagStart;

    if (source.startsWith("<!--", cursor)) {
      const end = source.indexOf("-->", cursor + 4);
      if (end < 0) throw invalidClover("unterminated comment");
      if (source.slice(cursor + 4, end).includes("--")) {
        throw invalidClover("malformed comment");
      }
      cursor = end + 3;
      continue;
    }
    if (source.startsWith("<?", cursor)) {
      const end = source.indexOf("?>", cursor + 2);
      if (end < 0) throw invalidClover("unterminated processing instruction");
      const instruction = source.slice(cursor + 2, end).trim();
      if (sawRoot || !/^xml(?:\s|$)/i.test(instruction)) {
        throw invalidClover("unsupported processing instruction");
      }
      cursor = end + 2;
      continue;
    }
    if (source.startsWith("<!", cursor)) {
      throw invalidClover("declarations and CDATA are not supported");
    }

    const end = findTagEnd(source, cursor + 1);
    const body = source.slice(cursor + 1, end);
    cursor = end + 1;
    tokenCount += 1;
    if (tokenCount > bounded.maxTokens) {
      throw invalidClover(`document exceeds ${bounded.maxTokens} element tokens`);
    }

    if (body.trimStart().startsWith("/")) {
      const name = parseClosingTag(body);
      const open = stack.pop();
      if (!open || open.name !== name) throw invalidClover(`mismatched closing tag </${name}>`);
      if (name === "coverage") closedRoot = true;
      continue;
    }

    if (closedRoot) throw invalidClover("multiple root elements");
    const element = parseOpeningTag(body, bounded.maxAttributesPerElement);
    const parent = stack[stack.length - 1]?.name ?? null;
    if (!allowedParent.get(element.name)?.has(parent)) {
      throw invalidClover(`unsupported <${element.name}> placement`);
    }
    if (element.name === "coverage") {
      if (sawRoot) throw invalidClover("multiple root elements");
      sawRoot = true;
    }

    const inheritedFile = stack[stack.length - 1]?.filePath ?? null;
    let filePath = inheritedFile;
    if (element.name === "file") {
      fileRecords += 1;
      if (fileRecords > bounded.maxFiles) {
        throw invalidClover(`report exceeds ${bounded.maxFiles} file records`);
      }
      const parsedFilePath = normalizedCoveragePath(
        requiredAttribute(element, "name"),
        root,
        bounded.maxPathBytes,
      );
      const fileIdentity = phpCoverageRelativePathIdentityKey(root, parsedFilePath);
      if (!fileIdentity) throw invalidClover("file path has no workspace identity");
      filePath = filePathsByIdentity.get(fileIdentity) ?? parsedFilePath;
      filePathsByIdentity.set(fileIdentity, filePath);
      if (!files.has(filePath)) files.set(filePath, new Map());
    } else if (element.name === "line") {
      if (!filePath) throw invalidClover("line appears outside a file");
      if (!element.selfClosing) throw invalidClover("line elements must be self-closing");
      lineRecords += 1;
      if (lineRecords > bounded.maxLineRecords) {
        throw invalidClover(`report exceeds ${bounded.maxLineRecords} line records`);
      }
      const type = requiredAttribute(element, "type");
      if (type !== "stmt" && type !== "method") {
        throw invalidClover(`unsupported line type ${JSON.stringify(type)}`);
      }
      const lineNumber = positiveSafeInteger(requiredAttribute(element, "num"), "line num");
      const hits = nonNegativeSafeInteger(requiredAttribute(element, "count"), "line count");
      const byLine = files.get(filePath)!;
      byLine.set(lineNumber, Math.max(byLine.get(lineNumber) ?? 0, hits));
    }

    if (!element.selfClosing) stack.push({ name: element.name, filePath });
    else if (element.name === "coverage") closedRoot = true;
  }

  if (stack.length > 0) {
    throw invalidClover(`unterminated <${stack[stack.length - 1]!.name}> element`);
  }
  if (!sawRoot || !closedRoot) throw invalidClover("missing coverage root element");

  const resultFiles = [...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, lines]) => fileCoverage(path, lines));
  return Object.freeze({
    files: Object.freeze(resultFiles),
    summary: coverageMetric(
      resultFiles.reduce((total, file) => total + file.summary.covered, 0),
      resultFiles.reduce((total, file) => total + file.summary.total, 0),
    ),
  });
}

export function phpCoverageMetric(covered: number, total: number): PhpCoverageMetric {
  return coverageMetric(covered, total);
}

function fileCoverage(path: string, byLine: ReadonlyMap<number, number>): PhpFileCoverage {
  const lines = Object.freeze(
    [...byLine.entries()]
      .sort(([left], [right]) => left - right)
      .map(([lineNumber, hits]) => Object.freeze({ lineNumber, hits })),
  );
  const covered = lines.filter(({ hits }) => hits > 0).length;
  return Object.freeze({
    path,
    lines,
    summary: coverageMetric(covered, lines.length),
    firstUncoveredLine: lines.find(({ hits }) => hits === 0)?.lineNumber ?? null,
  });
}

function coverageMetric(covered: number, total: number): PhpCoverageMetric {
  if (!Number.isSafeInteger(covered) || covered < 0 || !Number.isSafeInteger(total) || total < 0) {
    throw new TypeError("PHP coverage counts must be non-negative safe integers.");
  }
  if (covered > total) throw new TypeError("Covered PHP lines cannot exceed total PHP lines.");
  return Object.freeze({
    covered,
    total,
    percentage: total === 0 ? null : (covered / total) * 100,
  });
}

function parseOpeningTag(body: string, maxAttributes: number): XmlElement {
  let source = body.trim();
  const selfClosing = source.endsWith("/");
  if (selfClosing) source = source.slice(0, -1).trimEnd();
  const nameMatch = /^[A-Za-z_][\w.-]*/.exec(source);
  if (!nameMatch) throw invalidClover("malformed opening tag");
  const name = nameMatch[0];
  let cursor = name.length;
  const attributes = new Map<string, string>();
  while (cursor < source.length) {
    const whitespace = /^\s+/.exec(source.slice(cursor));
    if (!whitespace) throw invalidClover(`malformed <${name}> attributes`);
    cursor += whitespace[0].length;
    if (cursor === source.length) break;
    const attributeMatch = /^[A-Za-z_][\w.:-]*/.exec(source.slice(cursor));
    if (!attributeMatch) throw invalidClover(`malformed <${name}> attribute name`);
    const attribute = attributeMatch[0];
    cursor += attribute.length;
    const equals = /^\s*=\s*/.exec(source.slice(cursor));
    if (!equals) throw invalidClover(`attribute ${attribute} has no value`);
    cursor += equals[0].length;
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") throw invalidClover(`attribute ${attribute} is unquoted`);
    const valueEnd = source.indexOf(quote, cursor + 1);
    if (valueEnd < 0) throw invalidClover(`attribute ${attribute} is unterminated`);
    if (attributes.has(attribute)) throw invalidClover(`duplicate attribute ${attribute}`);
    attributes.set(attribute, decodeXmlEntities(source.slice(cursor + 1, valueEnd)));
    if (attributes.size > maxAttributes) {
      throw invalidClover(`element exceeds ${maxAttributes} attributes`);
    }
    cursor = valueEnd + 1;
  }
  return { name, attributes, selfClosing };
}

function parseClosingTag(body: string): string {
  const match = /^\s*\/\s*([A-Za-z_][\w.-]*)\s*$/.exec(body);
  if (!match) throw invalidClover("malformed closing tag");
  return match[1]!;
}

function requiredAttribute(element: XmlElement, name: string): string {
  const value = element.attributes.get(name);
  if (value === undefined) throw invalidClover(`<${element.name}> is missing ${name}`);
  return value;
}

function decodeXmlEntities(value: string): string {
  if (value.includes("<")) throw invalidClover("attribute contains an unescaped < character");
  let cursor = 0;
  let decoded = "";
  for (const match of value.matchAll(/&([^;]+);/g)) {
    const start = match.index;
    const plain = value.slice(cursor, start);
    if (plain.includes("&")) throw invalidClover("malformed XML entity");
    decoded += plain;
    const entity = match[1]!;
    decoded += decodeXmlEntity(entity);
    cursor = start + match[0].length;
  }
  const tail = value.slice(cursor);
  if (tail.includes("&")) throw invalidClover("malformed XML entity");
  return decoded + tail;
}

function decodeXmlEntity(entity: string): string {
  if (entity === "amp") return "&";
  if (entity === "lt") return "<";
  if (entity === "gt") return ">";
  if (entity === "quot") return '"';
  if (entity === "apos") return "'";
  const decimal = /^#(\d+)$/.exec(entity);
  const hexadecimal = /^#x([\da-f]+)$/i.exec(entity);
  const codePoint = decimal
    ? Number(decimal[1])
    : hexadecimal
      ? Number.parseInt(hexadecimal[1]!, 16)
      : Number.NaN;
  if (
    !Number.isSafeInteger(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    throw invalidClover(`unsupported XML entity &${entity};`);
  }
  return String.fromCodePoint(codePoint);
}

function normalizedCoveragePath(
  value: string,
  workspaceRoot: string,
  maxPathBytes: number,
): string {
  if (!value || hasControlCharacter(value) || utf8ByteLength(value) > maxPathBytes) {
    throw invalidClover("invalid file path");
  }
  const normalized = value.replace(/\\/g, "/");
  const relative = isAbsolutePath(normalized)
    ? phpCoverageRelativePath(workspaceRoot, normalized)
    : canonicalPhpCoverageRelativePath(normalized);
  if (relative === null) {
    throw invalidClover("file path must be a workspace-relative descendant");
  }
  return relative;
}

function validateWorkspaceRoot(value: string): string {
  const root = canonicalPhpCoverageRootPath(value);
  if (!root) {
    throw new TypeError("PHP coverage workspace root must be an absolute clean path.");
  }
  return root;
}

function findTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  throw invalidClover("unterminated tag");
}

function requireWhitespace(value: string, location: string): void {
  if (/\S/.test(value)) throw invalidClover(`unexpected text at ${location}`);
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return result;
}

function positiveSafeInteger(value: string, field: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw invalidClover(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw invalidClover(`${field} is unsafe`);
  return parsed;
}

function nonNegativeSafeInteger(value: string, field: string): number {
  if (!/^\d+$/.test(value)) throw invalidClover(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw invalidClover(`${field} is unsafe`);
  return parsed;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}

function hasControlCharacter(value: string): boolean {
  return /[\x00-\x1f\x7f]/.test(value);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalidClover(message: string): TypeError {
  return new TypeError(`Invalid PHP Clover report: ${message}.`);
}
