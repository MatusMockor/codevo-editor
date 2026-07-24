import { describe, expect, it } from "vitest";
import { createWorkbenchNotice, replaceNodePackageTaskProblemNotices } from "./workbenchNotice";
import { isCappableDiagnosticNotice } from "./diagnosticNotices";

describe("Node package task problem notice composition", () => {
  it("replaces every prior task owner group without touching unrelated notices", () => {
    const unrelated = createWorkbenchNotice("error", "PHP", "unrelated", "php-local-diagnostics:x");
    const stale = createWorkbenchNotice("error", "ESLint", "stale", "node-package-task-problems:ws:old");
    const current = createWorkbenchNotice("error", "TypeScript", "current", "node-package-task-problems:ws:new");
    expect(replaceNodePackageTaskProblemNotices([stale, unrelated], [current])).toEqual([
      current,
      unrelated,
    ]);
    expect(isCappableDiagnosticNotice(current)).toBe(true);
  });

});
