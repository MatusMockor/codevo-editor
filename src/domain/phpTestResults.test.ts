import { describe, expect, it } from "vitest";
import {
  phpTestCaseCanNavigate,
  phpTestCaseNavigationTarget,
  phpTestSuiteStatus,
  phpTestTotalsSummary,
  type PhpTestCase,
  type PhpTestSuite,
} from "./phpTestResults";

describe("PHP test result helpers", () => {
  it.each([
    [{ errors: 1, failures: 2, skipped: 0, tests: 3 }, "error"],
    [{ errors: 0, failures: 2, skipped: 0, tests: 3 }, "failed"],
    [{ errors: 0, failures: 0, skipped: 3, tests: 3 }, "skipped"],
    [{ errors: 0, failures: 0, skipped: 1, tests: 3 }, "passed"],
  ] as const)("derives suite status from aggregate counts %#", (counts, status) => {
    expect(phpTestSuiteStatus(suite(counts))).toBe(status);
  });

  it("uses totals for the summary instead of retained case count", () => {
    expect(
      phpTestTotalsSummary({
        errors: 2,
        failures: 3,
        skipped: 4,
        tests: 6000,
        time: 1.25,
      }),
    ).toBe("6,000 tests · 5 failed · 4 skipped · 1.25s");
  });

  it.each([
    ["failed", "tests/Unit/FooTest.php", true],
    ["error", "tests/Unit/FooTest.php", true],
    ["passed", "tests/Unit/FooTest.php", false],
    ["skipped", "tests/Unit/FooTest.php", false],
    ["failed", null, false],
    ["failed", "/other/FooTest.php", false],
  ] as const)("checks whether a case is navigable %#", (status, file, expected) => {
    expect(
      phpTestCaseCanNavigate("/workspace", testCase(status, file)),
    ).toBe(expected);
  });

  it.each([
    [
      "/workspace",
      "tests/Unit/FooTest.php",
      12,
      { path: "/workspace/tests/Unit/FooTest.php", position: { column: 1, lineNumber: 12 } },
    ],
    [
      "/workspace",
      "/workspace/tests/Unit/FooTest.php",
      12,
      { path: "/workspace/tests/Unit/FooTest.php", position: { column: 1, lineNumber: 12 } },
    ],
    ["/workspace", "/other/FooTest.php", 12, null],
    [
      "C:\\workspace",
      "C:\\workspace\\tests\\Unit\\FooTest.php",
      12,
      { path: "C:/workspace/tests/Unit/FooTest.php", position: { column: 1, lineNumber: 12 } },
    ],
    [
      "C:\\workspace",
      "tests\\Unit\\FooTest.php",
      0,
      { path: "C:/workspace/tests/Unit/FooTest.php", position: { column: 1, lineNumber: 1 } },
    ],
    [
      "/workspace",
      "tests/Unit/FooTest.php",
      null,
      { path: "/workspace/tests/Unit/FooTest.php", position: { column: 1, lineNumber: 1 } },
    ],
  ] as const)(
    "resolves safe PHP test navigation targets %#",
    (rootPath, file, line, expected) => {
      expect(
        phpTestCaseNavigationTarget(
          rootPath,
          testCase("failed", file, line),
        ),
      ).toEqual(expected);
    },
  );
});

function suite(
  counts: Pick<PhpTestSuite, "errors" | "failures" | "skipped" | "tests">,
): PhpTestSuite {
  return { ...counts, cases: [], name: "Suite", time: null };
}

function testCase(
  status: PhpTestCase["status"],
  file: string | null,
  line: number | null = null,
): PhpTestCase {
  return {
    classname: null,
    file,
    line,
    message: null,
    name: "testItWorks",
    status,
    time: null,
  };
}
