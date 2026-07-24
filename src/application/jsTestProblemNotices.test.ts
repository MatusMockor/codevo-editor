import { describe, expect, it } from "vitest";
import { isCappableDiagnosticNotice } from "./diagnosticNotices";
import { createWorkbenchNotice, replaceJsTestProblemNotices } from "./workbenchNotice";

describe("JavaScript test problem notice composition", () => {
  it("replaces every prior snapshot group and retains unrelated diagnostics", () => {
    const unrelated = createWorkbenchNotice(
      "error",
      "phpactor",
      "keep",
      "language-server-diagnostics:file:///workspace/a.php",
    );
    const oldFirst = createWorkbenchNotice(
      "error",
      "JavaScript Tests",
      "old first",
      "js-test-problems:workspace:first",
    );
    const oldSecond = createWorkbenchNotice(
      "error",
      "JavaScript Tests",
      "old second",
      "js-test-problems:workspace:second",
    );
    const active = createWorkbenchNotice(
      "error",
      "JavaScript Tests",
      "active",
      "js-test-problems:workspace:active",
    );

    expect(replaceJsTestProblemNotices([oldFirst, unrelated, oldSecond], [active])).toEqual([
      active,
      unrelated,
    ]);
    expect(isCappableDiagnosticNotice(active)).toBe(true);
  });
});
