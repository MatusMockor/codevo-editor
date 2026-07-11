import { describe, expect, it } from "vitest";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import { buildProblemsView } from "./problemsView";

const ROOT = "/workspace";

function notice(
  id: string,
  path: string,
  lineNumber: number,
  severity: WorkbenchNotice["severity"],
  message: string,
  kind?: WorkbenchNotice["kind"],
): WorkbenchNotice {
  return {
    groupKey: `language-server-diagnostics:file://${path}`,
    id,
    kind,
    message,
    navigationTarget: kind
      ? undefined
      : {
          path,
          range: {
            end: { column: 1, lineNumber },
            start: { column: 1, lineNumber },
          },
        },
    severity,
    source: "test",
  };
}

describe("buildProblemsView", () => {
  it("keeps notices without a real file path in a filtered general section", () => {
    const crashNotice: WorkbenchNotice = {
      id: "crash",
      message: "Language server stopped",
      severity: "error",
      source: "PHP",
    };
    const indexNotice: WorkbenchNotice = {
      id: "index",
      message: "Index is warming up",
      severity: "info",
      source: "Index",
    };

    const view = buildProblemsView(
      [crashNotice, indexNotice],
      ROOT,
      { errors: true, warnings: true },
      "INDEX",
    );

    expect(view.general).toEqual([indexNotice]);
    expect(view.files).toEqual([]);
  });

  it("excludes the global overflow sentinel from totals without dropping it", () => {
    const globalOverflow: WorkbenchNotice = {
      groupKey: "workbench-notice-overflow",
      id: "global-overflow",
      kind: "overflow",
      message: "More notices hidden",
      severity: "warning",
      source: "Notices",
    };
    const warning = notice(
      "warning",
      "/workspace/src/A.php",
      2,
      "warning",
      "warning",
    );

    const view = buildProblemsView(
      [globalOverflow, warning],
      ROOT,
      { errors: true, warnings: true },
      "",
    );

    expect(view.totals).toEqual({ errors: 0, warnings: 1 });
    expect(view.general).toEqual([globalOverflow]);
  });

  it("groups by path, uses workspace-relative labels, counts severities, and sorts entries by line", () => {
    const lineNine = notice("line-9", "/workspace/src/A.php", 9, "warning", "later");
    const otherFile = notice("other", "/workspace/tests/B.php", 4, "error", "other");
    const lineTwo = notice("line-2", "/workspace/src/A.php", 2, "error", "earlier");
    const overflow = notice("overflow", "/workspace/src/A.php", 0, "info", "more", "overflow");

    const view = buildProblemsView(
      [lineNine, otherFile, overflow, lineTwo],
      ROOT,
      { errors: true, warnings: true },
      "",
    );

    expect(view.totals).toEqual({ errors: 2, warnings: 1 });
    expect(view.files.map(({ path, relativePath, errorCount, warningCount }) => ({
      path,
      relativePath,
      errorCount,
      warningCount,
    }))).toEqual([
      {
        path: "/workspace/src/A.php",
        relativePath: "src/A.php",
        errorCount: 1,
        warningCount: 1,
      },
      {
        path: "/workspace/tests/B.php",
        relativePath: "tests/B.php",
        errorCount: 1,
        warningCount: 0,
      },
    ]);
    expect(view.files[0].entries).toEqual([lineTwo, lineNine, overflow]);
  });

  it.each([
    {
      name: "errors only",
      visibility: { errors: true, warnings: false },
      filter: "",
      ids: ["error"],
    },
    {
      name: "warnings only",
      visibility: { errors: false, warnings: true },
      filter: "",
      ids: ["warning"],
    },
    {
      name: "message substring",
      visibility: { errors: true, warnings: true },
      filter: "UNUSED var",
      ids: ["warning"],
    },
    {
      name: "path substring",
      visibility: { errors: true, warnings: true },
      filter: "SERVICE.PHP",
      ids: ["warning"],
    },
    {
      name: "empty result",
      visibility: { errors: false, warnings: false },
      filter: "",
      ids: [],
    },
  ])("filters $name while retaining unfiltered totals", ({ visibility, filter, ids }) => {
    const notices = [
      notice("error", "/workspace/src/User.php", 3, "error", "Missing method"),
      notice("warning", "/workspace/src/Service.php", 7, "warning", "Unused variable"),
    ];

    const view = buildProblemsView(notices, ROOT, visibility, filter);

    expect(view.files.flatMap((file) => file.entries.map((entry) => entry.id))).toEqual(ids);
    expect(view.totals).toEqual({ errors: 1, warnings: 1 });
  });
});
