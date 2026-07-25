import { workspaceRelativePath } from "./workspace";

export const JS_TEST_COVERAGE_LIMITS = {
  maxFiles: 20_000,
  maxLcovBytes: 8 * 1024 * 1024,
  maxLineRecords: 500_000,
  maxBranchRecords: 500_000,
  maxFunctionRecords: 500_000,
  maxPathBytes: 16 * 1024,
} as const;

export interface JsTestCoverageMetric {
  readonly covered: number;
  readonly total: number;
  readonly percentage: number | null;
}

export interface JsTestCoverageLine {
  readonly lineNumber: number;
  readonly hits: number;
}

export interface JsTestFileCoverage {
  readonly path: string;
  readonly lines: readonly JsTestCoverageLine[];
  readonly summary: JsTestCoverageMetric;
  readonly branches: JsTestCoverageMetric;
  readonly functions: JsTestCoverageMetric;
  readonly firstUncoveredLine: number | null;
}

export interface JsTestCoverageReport {
  readonly summary: JsTestCoverageMetric;
  readonly branches: JsTestCoverageMetric;
  readonly functions: JsTestCoverageMetric;
  readonly files: readonly JsTestFileCoverage[];
  readonly truncated: boolean;
}

export type JsTestCoverageResponse =
  | { readonly status: "ok"; readonly report: JsTestCoverageReport }
  | { readonly status: "unavailable" | "error"; readonly message: string };

export interface JsTestCoverageGateway {
  run(rootPath: string): Promise<JsTestCoverageResponse>;
}

export interface LcovParseLimits {
  readonly maxFiles?: number;
  readonly maxLcovBytes?: number;
  readonly maxLineRecords?: number;
  readonly maxBranchRecords?: number;
  readonly maxFunctionRecords?: number;
  readonly maxPathBytes?: number;
}

export function parseLcovReport(
  source: string,
  workspaceRoot: string,
  limits: LcovParseLimits = {},
): JsTestCoverageReport {
  const resolvedLimits = {
    maxFiles: positiveLimit(limits.maxFiles, JS_TEST_COVERAGE_LIMITS.maxFiles, "maxFiles"),
    maxLcovBytes: positiveLimit(
      limits.maxLcovBytes,
      JS_TEST_COVERAGE_LIMITS.maxLcovBytes,
      "maxLcovBytes",
    ),
    maxLineRecords: positiveLimit(
      limits.maxLineRecords,
      JS_TEST_COVERAGE_LIMITS.maxLineRecords,
      "maxLineRecords",
    ),
    maxBranchRecords: positiveLimit(
      limits.maxBranchRecords,
      JS_TEST_COVERAGE_LIMITS.maxBranchRecords,
      "maxBranchRecords",
    ),
    maxFunctionRecords: positiveLimit(
      limits.maxFunctionRecords,
      JS_TEST_COVERAGE_LIMITS.maxFunctionRecords,
      "maxFunctionRecords",
    ),
    maxPathBytes: positiveLimit(
      limits.maxPathBytes,
      JS_TEST_COVERAGE_LIMITS.maxPathBytes,
      "maxPathBytes",
    ),
  };
  if (utf8ByteLength(source) > resolvedLimits.maxLcovBytes) {
    throw invalidLcov(`input exceeds ${resolvedLimits.maxLcovBytes} UTF-8 bytes`);
  }

  const files = new Map<string, MutableFileCoverage>();
  let currentPath: string | null = null;
  let currentFile: MutableFileCoverage | null = null;
  let recordOpen = false;
  let lineRecords = 0;
  let branchRecords = 0;
  let functionRecords = 0;
  let truncated = false;

  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line || line.startsWith("TN:")) continue;

    if (line.startsWith("SF:")) {
      if (recordOpen) throw invalidLcov(`line ${lineNumber}: nested SF record`);
      currentPath = normalizedCoveragePath(
        line.slice(3),
        workspaceRoot,
        resolvedLimits.maxPathBytes,
        `line ${lineNumber}`,
      );
      currentFile = files.get(currentPath) ?? {
        branches: new Map<string, number>(),
        functions: new Map<string, number>(),
        lines: new Map<number, number>(),
      };
      if (!files.has(currentPath)) {
        if (files.size >= resolvedLimits.maxFiles) {
          throw invalidLcov(`report exceeds ${resolvedLimits.maxFiles} files`);
        }
        files.set(currentPath, currentFile);
      }
      recordOpen = true;
      continue;
    }

    if (line.startsWith("DA:")) {
      if (!recordOpen || !currentFile) {
        throw invalidLcov(`line ${lineNumber}: DA appears outside an SF record`);
      }
      if (++lineRecords > resolvedLimits.maxLineRecords) {
        throw invalidLcov(`report exceeds ${resolvedLimits.maxLineRecords} line records`);
      }
      const fields = line.slice(3).split(",");
      if (fields.length < 2 || fields.length > 3) {
        throw invalidLcov(`line ${lineNumber}: malformed DA record`);
      }
      const coveredLine = positiveSafeInteger(fields[0], `line ${lineNumber}: DA line`);
      const hits = nonNegativeSafeInteger(fields[1], `line ${lineNumber}: DA hits`);
      addHits(currentFile.lines, coveredLine, hits, `line ${lineNumber}`);
      continue;
    }

    if (line.startsWith("BRDA:")) {
      if (!recordOpen || !currentFile) {
        throw invalidLcov(`line ${lineNumber}: BRDA appears outside an SF record`);
      }
      if (++branchRecords > resolvedLimits.maxBranchRecords) {
        truncated = true;
        continue;
      }
      const fields = line.slice(5).split(",");
      if (fields.length !== 4) throw invalidLcov(`line ${lineNumber}: malformed BRDA record`);
      const coveredLine = positiveSafeInteger(fields[0], `line ${lineNumber}: BRDA line`);
      const block = nonNegativeSafeInteger(fields[1], `line ${lineNumber}: BRDA block`);
      const branch = nonNegativeSafeInteger(fields[2], `line ${lineNumber}: BRDA branch`);
      const hits =
        fields[3] === "-" ? 0 : nonNegativeSafeInteger(fields[3], `line ${lineNumber}: BRDA hits`);
      addHits(
        currentFile.branches,
        `${coveredLine}:${block}:${branch}`,
        hits,
        `line ${lineNumber}`,
      );
      continue;
    }

    if (line.startsWith("FN:")) {
      if (!recordOpen || !currentFile) {
        throw invalidLcov(`line ${lineNumber}: FN appears outside an SF record`);
      }
      if (++functionRecords > resolvedLimits.maxFunctionRecords) {
        truncated = true;
        continue;
      }
      const fields = splitOnce(line.slice(3));
      positiveSafeInteger(fields?.[0], `line ${lineNumber}: FN line`);
      const name = fields?.[1];
      if (!name) throw invalidLcov(`line ${lineNumber}: malformed FN record`);
      currentFile.functions.set(name, currentFile.functions.get(name) ?? 0);
      continue;
    }

    if (line.startsWith("FNDA:")) {
      if (!recordOpen || !currentFile) {
        throw invalidLcov(`line ${lineNumber}: FNDA appears outside an SF record`);
      }
      if (++functionRecords > resolvedLimits.maxFunctionRecords) {
        truncated = true;
        continue;
      }
      const fields = splitOnce(line.slice(5));
      const hits = nonNegativeSafeInteger(fields?.[0], `line ${lineNumber}: FNDA hits`);
      const name = fields?.[1];
      if (!name) throw invalidLcov(`line ${lineNumber}: malformed FNDA record`);
      addHits(currentFile.functions, name, hits, `line ${lineNumber}`);
      continue;
    }

    if (line === "end_of_record") {
      if (!recordOpen) throw invalidLcov(`line ${lineNumber}: unexpected end_of_record`);
      currentPath = null;
      currentFile = null;
      recordOpen = false;
      continue;
    }

    if (!recordOpen || !isSummaryLcovRecord(line, lineNumber)) {
      throw invalidLcov(`line ${lineNumber}: unsupported record`);
    }
  }
  if (recordOpen) throw invalidLcov("unterminated SF record");

  const resultFiles = [...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, file]) => fileCoverage(path, file));
  return {
    files: resultFiles,
    summary: coverageMetric(
      resultFiles.reduce((sum, file) => sum + file.summary.covered, 0),
      resultFiles.reduce((sum, file) => sum + file.summary.total, 0),
    ),
    branches: aggregateMetric(resultFiles, "branches"),
    functions: aggregateMetric(resultFiles, "functions"),
    truncated,
  };
}

export function coverageMetric(covered: number, total: number): JsTestCoverageMetric {
  if (!Number.isSafeInteger(covered) || covered < 0 || !Number.isSafeInteger(total) || total < 0) {
    throw new TypeError("Coverage counts must be non-negative safe integers.");
  }
  if (covered > total) throw new TypeError("Covered lines cannot exceed total lines.");
  return { covered, total, percentage: total === 0 ? null : (covered / total) * 100 };
}

function fileCoverage(path: string, file: MutableFileCoverage): JsTestFileCoverage {
  const lines = [...file.lines.entries()]
    .sort(([left], [right]) => left - right)
    .map(([lineNumber, hits]) => ({ lineNumber, hits }));
  const covered = lines.filter((line) => line.hits > 0).length;
  return {
    path,
    lines,
    summary: coverageMetric(covered, lines.length),
    branches: mapMetric(file.branches),
    functions: mapMetric(file.functions),
    firstUncoveredLine: lines.find((line) => line.hits === 0)?.lineNumber ?? null,
  };
}

function aggregateMetric(
  files: readonly JsTestFileCoverage[],
  key: "branches" | "functions",
): JsTestCoverageMetric {
  return coverageMetric(
    files.reduce((sum, file) => sum + file[key].covered, 0),
    files.reduce((sum, file) => sum + file[key].total, 0),
  );
}

function mapMetric<K>(entries: Map<K, number>): JsTestCoverageMetric {
  return coverageMetric([...entries.values()].filter((hits) => hits > 0).length, entries.size);
}

function normalizedCoveragePath(
  value: string,
  workspaceRoot: string,
  maxPathBytes: number,
  location: string,
): string {
  if (!value || hasControlCharacter(value) || utf8ByteLength(value) > maxPathBytes) {
    throw invalidLcov(`${location}: invalid SF path`);
  }
  const normalized = value.replace(/\\/g, "/");
  const relative = isAbsolutePath(normalized)
    ? workspaceRelativePath(workspaceRoot, normalized)
    : normalized;
  if (
    relative === null ||
    !relative ||
    relative.startsWith("/") ||
    /^[A-Za-z]:\//.test(relative) ||
    relative.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw invalidLcov(`${location}: SF path must be a workspace-relative descendant`);
  }
  return relative;
}

function isSummaryLcovRecord(line: string, lineNumber: number): boolean {
  const match = /^(?:FNF|FNH|BRF|BRH|LF|LH):(.*)$/.exec(line);
  if (!match) return false;
  nonNegativeSafeInteger(match[1], `line ${lineNumber}: summary count`);
  return true;
}

function addHits<K>(entries: Map<K, number>, key: K, hits: number, location: string): void {
  const previousHits = entries.get(key) ?? 0;
  if (previousHits > Number.MAX_SAFE_INTEGER - hits) {
    throw invalidLcov(`${location}: accumulated hit count is unsafe`);
  }
  entries.set(key, previousHits + hits);
}

function splitOnce(value: string): readonly [string, string] | null {
  const separator = value.indexOf(",");
  return separator < 0 ? null : [value.slice(0, separator), value.slice(separator + 1)];
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return result;
}

function positiveSafeInteger(value: string | undefined, location: string): number {
  if (!value || !/^[1-9]\d*$/.test(value)) throw invalidLcov(`${location} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw invalidLcov(`${location} is unsafe`);
  return parsed;
}

function nonNegativeSafeInteger(value: string | undefined, location: string): number {
  if (value === undefined || !/^\d+$/.test(value)) throw invalidLcov(`${location} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw invalidLcov(`${location} is unsafe`);
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

function invalidLcov(message: string): TypeError {
  return new TypeError(`Invalid LCOV report: ${message}.`);
}

interface MutableFileCoverage {
  readonly branches: Map<string, number>;
  readonly functions: Map<string, number>;
  readonly lines: Map<number, number>;
}
