import { invoke } from "@tauri-apps/api/core";
import {
  coverageMetric,
  JS_TEST_COVERAGE_LIMITS,
  type JsTestCoverageGateway,
  type JsTestCoverageLine,
  type JsTestCoverageMetric,
  type JsTestCoverageReport,
  type JsTestCoverageResponse,
} from "../domain/jsTestCoverage";
import {
  validatedJsTestExecutionAuthority,
  type JsTestExecutionAuthority,
} from "../domain/jsTestExecutionAuthority";

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);
const COMMAND = "run_js_test_coverage_json";
const MAX_MESSAGE_BYTES = 64 * 1024;
const PERCENTAGE_EPSILON = 1e-9;

export class TauriJsTestCoverageGateway implements JsTestCoverageGateway {
  constructor(private readonly invokeCoverageCommand: InvokeCommand = invokeCommand) {}

  async run(
    rootPath: string,
    authority: JsTestExecutionAuthority = { packageRootRelativePath: "" },
  ): Promise<JsTestCoverageResponse> {
    if (!rootPath || hasControlCharacter(rootPath)) {
      throw new TypeError("JavaScript coverage workspace root must be a non-empty path.");
    }
    const packageRootRelativePath =
      validatedJsTestExecutionAuthority(authority).packageRootRelativePath;
    return decodeJsTestCoverageResponse(
      await this.invokeCoverageCommand(COMMAND, { packageRootRelativePath, rootPath }),
    );
  }
}

export function decodeJsTestCoverageResponse(value: unknown): JsTestCoverageResponse {
  const response = record(value, "response");
  if (response.status === "unavailable" || response.status === "error") {
    exactKeys(response, ["status", "message"], "response");
    return {
      status: response.status,
      message: boundedString(response.message, "response.message", MAX_MESSAGE_BYTES),
    };
  }
  if (response.status !== "ok")
    return invalid("response.status", '"ok", "unavailable", or "error"');
  exactKeys(response, ["status", "report"], "response");
  return { status: "ok", report: decodeReport(response.report) };
}

function decodeReport(value: unknown): JsTestCoverageReport {
  const report = record(value, "response.report");
  exactKeys(report, ["summary", "branches", "functions", "files", "truncated"], "response.report");
  if (!Array.isArray(report.files) || report.files.length > JS_TEST_COVERAGE_LIMITS.maxFiles) {
    return invalid(
      "response.report.files",
      `an array of at most ${JS_TEST_COVERAGE_LIMITS.maxFiles} files`,
    );
  }

  const seenPaths = new Set<string>();
  let lineRecords = 0;
  let covered = 0;
  let total = 0;
  let branchesCovered = 0;
  let branchesTotal = 0;
  let functionsCovered = 0;
  let functionsTotal = 0;
  const files = report.files.map((value, index) => {
    const path = `response.report.files[${index}]`;
    const file = record(value, path);
    exactKeys(
      file,
      ["path", "lines", "summary", "branches", "functions", "firstUncoveredLine"],
      path,
    );
    const filePath = workspaceRelativePath(file.path, `${path}.path`);
    if (seenPaths.has(filePath)) invalid(`${path}.path`, "a unique file path");
    seenPaths.add(filePath);
    if (!Array.isArray(file.lines)) invalid(`${path}.lines`, "an array");
    lineRecords += file.lines.length;
    if (lineRecords > JS_TEST_COVERAGE_LIMITS.maxLineRecords) {
      invalid(
        "response.report.files",
        `at most ${JS_TEST_COVERAGE_LIMITS.maxLineRecords} line records`,
      );
    }

    let previousLineNumber = 0;
    const lines = file.lines.map((line, lineIndex) => {
      const decoded = decodeLine(line, `${path}.lines[${lineIndex}]`);
      if (decoded.lineNumber <= previousLineNumber) {
        invalid(`${path}.lines[${lineIndex}].lineNumber`, "strictly increasing line numbers");
      }
      previousLineNumber = decoded.lineNumber;
      return decoded;
    });
    const computedCovered = lines.filter((line) => line.hits > 0).length;
    const summary = decodeMetric(file.summary, `${path}.summary`);
    assertMetricEquals(summary, computedCovered, lines.length, `${path}.summary`);
    const branches = decodeMetric(file.branches, `${path}.branches`);
    const functions = decodeMetric(file.functions, `${path}.functions`);
    const computedFirstUncovered = lines.find((line) => line.hits === 0)?.lineNumber ?? null;
    if (file.firstUncoveredLine !== computedFirstUncovered) {
      invalid(`${path}.firstUncoveredLine`, `the derived value ${String(computedFirstUncovered)}`);
    }
    covered = safeSum(covered, computedCovered, "response.report.summary.covered");
    total = safeSum(total, lines.length, "response.report.summary.total");
    branchesCovered = safeSum(
      branchesCovered,
      branches.covered,
      "response.report.branches.covered",
    );
    branchesTotal = safeSum(branchesTotal, branches.total, "response.report.branches.total");
    functionsCovered = safeSum(
      functionsCovered,
      functions.covered,
      "response.report.functions.covered",
    );
    functionsTotal = safeSum(functionsTotal, functions.total, "response.report.functions.total");
    return {
      path: filePath,
      lines,
      summary,
      branches,
      functions,
      firstUncoveredLine: computedFirstUncovered,
    };
  });

  const summary = decodeMetric(report.summary, "response.report.summary");
  assertMetricEquals(summary, covered, total, "response.report.summary");
  const branches = decodeMetric(report.branches, "response.report.branches");
  assertMetricEquals(branches, branchesCovered, branchesTotal, "response.report.branches");
  if (branchesTotal > JS_TEST_COVERAGE_LIMITS.maxBranchRecords) {
    invalid(
      "response.report.branches.total",
      `at most ${JS_TEST_COVERAGE_LIMITS.maxBranchRecords} branch records`,
    );
  }
  const functions = decodeMetric(report.functions, "response.report.functions");
  assertMetricEquals(functions, functionsCovered, functionsTotal, "response.report.functions");
  if (functionsTotal > JS_TEST_COVERAGE_LIMITS.maxFunctionRecords) {
    invalid(
      "response.report.functions.total",
      `at most ${JS_TEST_COVERAGE_LIMITS.maxFunctionRecords} function records`,
    );
  }
  if (typeof report.truncated !== "boolean") {
    invalid("response.report.truncated", "a boolean");
  }
  return { summary, branches, functions, files, truncated: report.truncated };
}

function decodeLine(value: unknown, path: string): JsTestCoverageLine {
  const line = record(value, path);
  exactKeys(line, ["lineNumber", "hits"], path);
  return {
    lineNumber: positiveSafeInteger(line.lineNumber, `${path}.lineNumber`),
    hits: nonNegativeSafeInteger(line.hits, `${path}.hits`),
  };
}

function decodeMetric(value: unknown, path: string): JsTestCoverageMetric {
  const metric = record(value, path);
  exactKeys(metric, ["covered", "total", "percentage"], path);
  const covered = nonNegativeSafeInteger(metric.covered, `${path}.covered`);
  const total = nonNegativeSafeInteger(metric.total, `${path}.total`);
  if (covered > total) invalid(`${path}.covered`, "no greater than total");
  const expected = coverageMetric(covered, total).percentage;
  if (expected === null) {
    if (metric.percentage !== null) invalid(`${path}.percentage`, "null when total is zero");
  } else if (
    typeof metric.percentage !== "number" ||
    !Number.isFinite(metric.percentage) ||
    metric.percentage < 0 ||
    metric.percentage > 100 ||
    Math.abs(metric.percentage - expected) > PERCENTAGE_EPSILON
  ) {
    invalid(`${path}.percentage`, `the derived finite percentage ${expected}`);
  }
  return { covered, total, percentage: expected };
}

function assertMetricEquals(
  metric: JsTestCoverageMetric,
  covered: number,
  total: number,
  path: string,
): void {
  if (metric.covered !== covered || metric.total !== total) {
    invalid(path, `counts matching the decoded records (${covered}/${total})`);
  }
}

function workspaceRelativePath(value: unknown, path: string): string {
  const candidate = boundedString(value, path, JS_TEST_COVERAGE_LIMITS.maxPathBytes).replace(
    /\\/g,
    "/",
  );
  if (
    candidate.startsWith("/") ||
    /^[A-Za-z]:\//.test(candidate) ||
    candidate.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return invalid(path, "a workspace-relative descendant path");
  }
  return candidate;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) invalid(`${path}.${unexpected}`, "no unknown field");
  const missing = allowed.find((key) => !(key in value));
  if (missing) invalid(`${path}.${missing}`, "a required field");
}

function boundedString(value: unknown, path: string, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    hasControlCharacter(value) ||
    new TextEncoder().encode(value).byteLength > maxBytes
  ) {
    return invalid(path, `a non-empty control-free string of at most ${maxBytes} UTF-8 bytes`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, path: string): number {
  const result = nonNegativeSafeInteger(value, path);
  if (result === 0) return invalid(path, "a positive safe integer");
  return result;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return invalid(path, "a non-negative safe integer");
  }
  return value as number;
}

function safeSum(left: number, right: number, path: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) return invalid(path, "a safe aggregate count");
  return sum;
}

function hasControlCharacter(value: string): boolean {
  return /[\x00-\x1f\x7f]/.test(value);
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(
    `Invalid JavaScript test coverage response at ${path}: expected ${expectation}.`,
  );
}
