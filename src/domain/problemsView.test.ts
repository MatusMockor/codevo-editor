import { describe, expect, it } from "vitest";
import type { WorkbenchNotice } from "./workbenchNotice";
import {
  DIAGNOSTICS_RETENTION_RECEIPT_GROUP_KEY,
  MAX_PROBLEMS_VIEW_ROWS,
  buildProblemsView,
  problemFilePaths,
} from "./problemsView";
import {
  NO_PROBLEMS_PACKAGE,
  createProblemsPackageAttribution,
} from "./problemsPackageAttribution";
import type { WorkspacePackageManifestInput } from "./workspacePackageGraph";

const ROOT = "/workspace";
const PACKAGE_MANIFESTS: readonly WorkspacePackageManifestInput[] = [
  {
    packageJson: { name: "@repo/api" },
    relativeDirPath: "packages/api",
  },
  {
    packageJson: { name: "@repo/web" },
    relativeDirPath: "packages/web",
  },
];

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

function expectedUnownedRow<T extends WorkbenchNotice>(value: T) {
  return { ...value, packageIdentity: NO_PROBLEMS_PACKAGE };
}

describe("buildProblemsView", () => {
  it("package grouping preserves the same total row count as file grouping", () => {
    const notices = [
      notice("api-one", "/workspace/packages/api/src/one.ts", 1, "error", "one"),
      notice("api-two", "/workspace/packages/api/src/two.ts", 1, "warning", "two"),
      notice("web", "/workspace/packages/web/src/index.ts", 1, "error", "web"),
      notice("outside", "/workspace/tools/release.ts", 1, "warning", "outside"),
    ];
    const attribution = createProblemsPackageAttribution({
      filePaths: problemFilePaths(notices),
      packageManifests: PACKAGE_MANIFESTS,
      workspaceRoot: ROOT,
    });
    const view = buildProblemsView(notices, ROOT, { errors: true, warnings: true }, "", {
      attribution,
    });

    const fileRows = view.files.reduce((total, file) => total + file.entries.length, 0);
    const packageRows = view.packages.reduce(
      (total, packageView) =>
        total +
        packageView.files.reduce((packageTotal, file) => packageTotal + file.entries.length, 0),
      0,
    );

    expect(packageRows).toBe(fileRows);
    expect(
      view.files.flatMap((file) =>
        file.entries.map((entry) => [entry.id, entry.packageIdentity.key]),
      ),
    ).toEqual([
      ["api-one", "@repo/api"],
      ["api-two", "@repo/api"],
      ["web", "@repo/web"],
      ["outside", NO_PROBLEMS_PACKAGE.key],
    ]);
  });

  it("reports bounded package counts when the row cap truncates", () => {
    const notices = Array.from({ length: MAX_PROBLEMS_VIEW_ROWS + 50 }, (_, index) =>
      notice(
        `api-${index}`,
        `/workspace/packages/api/src/file-${index}.ts`,
        1,
        "error",
        `Diagnostic ${index}`,
      ),
    );
    const attribution = createProblemsPackageAttribution({
      filePaths: problemFilePaths(notices),
      packageManifests: PACKAGE_MANIFESTS,
      workspaceRoot: ROOT,
    });
    const view = buildProblemsView(notices, ROOT, { errors: true, warnings: true }, "", {
      attribution,
    });

    expect(view.packages).toEqual([
      expect.objectContaining({
        count: {
          kind: "bounded",
          value: MAX_PROBLEMS_VIEW_ROWS - 1,
        },
        identity: expect.objectContaining({ key: "@repo/api" }),
      }),
    ]);
  });

  it("filters to one package", () => {
    const notices = [
      notice("api", "/workspace/packages/api/src/index.ts", 1, "error", "api"),
      notice("web", "/workspace/packages/web/src/index.ts", 1, "error", "web"),
      notice("outside", "/workspace/tools/release.ts", 1, "error", "outside"),
    ];
    const attribution = createProblemsPackageAttribution({
      filePaths: problemFilePaths(notices),
      packageManifests: PACKAGE_MANIFESTS,
      workspaceRoot: ROOT,
    });
    const view = buildProblemsView(notices, ROOT, { errors: true, warnings: true }, "", {
      attribution,
      packageFilterKey: "@repo/api",
    });

    expect(view.files.flatMap((file) => file.entries.map((entry) => entry.id))).toEqual(["api"]);
    expect(view.packages).toEqual([
      expect.objectContaining({
        count: { kind: "matching", value: 1 },
        identity: expect.objectContaining({ key: "@repo/api" }),
      }),
    ]);
  });

  it("keeps package identity enumerable in copies and serialized rows", () => {
    const notices = [notice("api", "/workspace/packages/api/src/index.ts", 1, "error", "api")];
    const attribution = createProblemsPackageAttribution({
      filePaths: problemFilePaths(notices),
      packageManifests: PACKAGE_MANIFESTS,
      workspaceRoot: ROOT,
    });
    const view = buildProblemsView(notices, ROOT, { errors: true, warnings: true }, "", {
      attribution,
    });
    const row = view.files[0].entries[0];

    expect({ ...row }).toEqual(
      expect.objectContaining({
        packageIdentity: expect.objectContaining({ key: "@repo/api" }),
      }),
    );
    expect(JSON.parse(JSON.stringify(row))).toEqual(
      expect.objectContaining({
        packageIdentity: expect.objectContaining({ key: "@repo/api" }),
      }),
    );
  });

  it("an identical tsc error from the task matcher and the language server appears once, owned by the language server", () => {
    const path = "/workspace/src/index.ts";
    const taskMatcher = {
      ...notice(
        "task",
        "\\workspace\\src\\index.ts",
        4,
        "error",
        "Type 'string' is not assignable to type 'number'. (TS2322)",
      ),
      groupKey: "node-package-task-problems:workspace:run",
      source: "TypeScript",
    };
    const languageServer = {
      ...taskMatcher,
      groupKey: `javascript-typescript-diagnostics:file://${path}`,
      id: "language-server",
      message:
        "file:///workspace/src/index.ts 4:1 Type 'string' is not assignable to type 'number'.",
      navigationTarget: {
        path,
        range: {
          end: { column: 1, lineNumber: 4 },
          start: { column: 1, lineNumber: 4 },
        },
      },
      source: "typescript",
    };

    const view = buildProblemsView(
      [taskMatcher, languageServer],
      ROOT,
      { errors: true, warnings: true },
      "",
    );

    expect(view.files[0].entries).toEqual([expectedUnownedRow(languageServer)]);
    expect(view.totals).toEqual({ errors: 1, warnings: 0 });
  });

  it("keeps diagnostics with different codes, messages, or columns and never deduplicates overflow notices", () => {
    const path = "/workspace/src/index.ts";
    const notices = [
      {
        ...notice("task-code", path, 4, "error", "Assignment is invalid"),
        code: "TS2322",
        groupKey: "node-package-task-problems:workspace:run",
      },
      {
        ...notice("language-server-code", path, 4, "error", "Assignment is invalid"),
        code: "TS2345",
      },
      {
        ...notice("task-message", path, 5, "error", "Argument is invalid"),
        code: "TS2322",
        groupKey: "node-package-task-problems:workspace:run",
      },
      {
        ...notice("language-server-message", path, 5, "error", "Assignment is invalid"),
        code: "TS2322",
      },
      {
        ...notice("task-column", path, 6, "error", "Assignment is invalid"),
        code: "TS2322",
        groupKey: "node-package-task-problems:workspace:run",
      },
      {
        ...notice("language-server-column", path, 6, "error", "Assignment is invalid"),
        code: "TS2322",
        navigationTarget: {
          path,
          range: {
            end: { column: 2, lineNumber: 4 },
            start: { column: 2, lineNumber: 6 },
          },
        },
      },
      {
        ...notice("overflow-lsp", path, 0, "info", "More hidden", "overflow"),
        navigationTarget: {
          path,
          range: {
            end: { column: 1, lineNumber: 7 },
            start: { column: 1, lineNumber: 7 },
          },
        },
      },
      {
        ...notice("overflow-task", path, 0, "info", "More hidden", "overflow"),
        groupKey: "node-package-task-problems:workspace:run",
        navigationTarget: {
          path,
          range: {
            end: { column: 1, lineNumber: 7 },
            start: { column: 1, lineNumber: 7 },
          },
        },
      },
    ];

    const view = buildProblemsView(notices, ROOT, { errors: true, warnings: true }, "");

    expect(view.files[0].entries.map((entry) => entry.id)).toEqual([
      "language-server-code",
      "task-code",
      "language-server-message",
      "task-message",
      "language-server-column",
      "task-column",
      "overflow-lsp",
      "overflow-task",
    ]);
    expect(view.general).toEqual([]);
  });

  it("uses the complete diagnostic source priority regardless of input order", () => {
    const path = "/workspace/src/index.ts";
    const priority = [
      "javascript-typescript-diagnostics:file:///workspace/src/index.ts",
      "language-server-diagnostics:file:///workspace/src/index.ts",
      "php-local-diagnostics:file:///workspace/src/index.ts",
      "js-test-problems:workspace:%2Fworkspace",
      "node-package-task-problems:workspace:run",
    ];

    priority.forEach((_, expectedIndex) => {
      const candidates = priority
        .slice(expectedIndex)
        .map((groupKey, index) => ({
          ...notice(`priority-${expectedIndex + index}`, path, 8, "error", "Same diagnostic"),
          groupKey,
        }))
        .reverse();
      const view = buildProblemsView(candidates, ROOT, { errors: true, warnings: true }, "");

      expect(view.files[0].entries.map((entry) => entry.id)).toEqual([`priority-${expectedIndex}`]);
    });
  });

  it("js-test-problems notices group as a registered diagnostic source", () => {
    const path = "/workspace/tests/math.test.ts";
    const groupKey = "js-test-problems:workspace:%2Fworkspace";
    const testFailure = {
      ...notice("js-test-failure", path, 7, "error", "adds two numbers"),
      groupKey,
      source: "JavaScript Tests",
    };
    const taskFailure = {
      ...testFailure,
      groupKey: "node-package-task-problems:workspace:run",
      id: "task-failure",
      source: "Vitest",
    };
    const overflow: WorkbenchNotice = {
      groupKey,
      id: "js-test-overflow",
      kind: "overflow",
      message: "3 more test failures hidden",
      severity: "info",
      source: "JavaScript Tests",
    };

    const view = buildProblemsView(
      [taskFailure, overflow, testFailure],
      ROOT,
      {
        errors: true,
        warnings: true,
      },
      "",
    );

    expect(view.general).toEqual([expectedUnownedRow(overflow)]);
    expect(view.files).toEqual([
      {
        path,
        relativePath: "tests/math.test.ts",
        errorCount: 1,
        warningCount: 0,
        entries: [expectedUnownedRow(testFailure)],
        packageIdentity: NO_PROBLEMS_PACKAGE,
      },
    ]);
  });

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

    expect(view.general).toEqual([expectedUnownedRow(indexNotice)]);
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
    const warning = notice("warning", "/workspace/src/A.php", 2, "warning", "warning");

    const view = buildProblemsView(
      [globalOverflow, warning],
      ROOT,
      { errors: true, warnings: true },
      "",
    );

    expect(view.totals).toEqual({ errors: 0, warnings: 1 });
    expect(view.general).toEqual([expectedUnownedRow(globalOverflow)]);
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
    expect(
      view.files.map(({ path, relativePath, errorCount, warningCount }) => ({
        path,
        relativePath,
        errorCount,
        warningCount,
      })),
    ).toEqual([
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
    expect(view.files[0].entries).toEqual([lineTwo, lineNine, overflow].map(expectedUnownedRow));
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

  it("constructs a bounded view and one truthful receipt from 100,000 entries", () => {
    const notices = Array.from({ length: 100_000 }, (_, index) =>
      notice(
        `diagnostic-${index}`,
        `/workspace/src/file-${index}.ts`,
        1,
        "error",
        `Diagnostic ${index}`,
      ),
    );

    const view = buildProblemsView(notices, ROOT, { errors: true, warnings: true }, "");
    const rows = [...view.general, ...view.files.flatMap((file) => file.entries)];

    expect(rows).toHaveLength(MAX_PROBLEMS_VIEW_ROWS);
    expect(view.files).toHaveLength(MAX_PROBLEMS_VIEW_ROWS - 1);
    expect(view.totals).toEqual({
      errors: MAX_PROBLEMS_VIEW_ROWS - 1,
      warnings: 0,
    });
    expect(view.general).toEqual([
      expect.objectContaining({
        groupKey: DIAGNOSTICS_RETENTION_RECEIPT_GROUP_KEY,
        kind: "overflow",
        message: "Problems view retained 1999 of 100000 input rows.",
      }),
    ]);
  });

  it("preserves an upstream retention receipt when the UI projection is saturated", () => {
    const receipt: WorkbenchNotice = {
      groupKey: DIAGNOSTICS_RETENTION_RECEIPT_GROUP_KEY,
      id: "upstream-receipt",
      kind: "overflow",
      message: "Retained 20000 of 100000 published diagnostics.",
      severity: "info",
      source: "Diagnostics",
    };
    const notices = [
      receipt,
      ...Array.from({ length: MAX_PROBLEMS_VIEW_ROWS }, (_, index) =>
        notice(
          `diagnostic-${index}`,
          `/workspace/src/file-${index}.ts`,
          1,
          "error",
          `Diagnostic ${index}`,
        ),
      ),
    ];

    const view = buildProblemsView(notices, ROOT, { errors: true, warnings: true }, "");

    expect(view.general).toEqual([
      {
        ...receipt,
        message:
          "Retained 20000 of 100000 published diagnostics. Problems view retained 1999 of 2000 input rows.",
        packageIdentity: NO_PROBLEMS_PACKAGE,
      },
    ]);
    expect(view.files).toHaveLength(MAX_PROBLEMS_VIEW_ROWS - 1);
  });

  it("finds filtered diagnostics beyond the cutoff without inventing overflow", () => {
    const notices = Array.from({ length: 100_000 }, (_, index) =>
      notice(
        `diagnostic-${index}`,
        `/workspace/src/file-${index}.ts`,
        1,
        "error",
        index === 99_999 ? "Unique needle" : `Diagnostic ${index}`,
      ),
    );

    const view = buildProblemsView(
      notices,
      ROOT,
      { errors: true, warnings: true },
      "unique needle",
    );

    expect(view.files.flatMap((file) => file.entries)).toEqual([
      expect.objectContaining({ id: "diagnostic-99999" }),
    ]);
    expect(view.general).toEqual([]);
  });

  it("lets a later authoritative language-server duplicate replace a task row at cutoff", () => {
    const path = "/workspace/src/index.ts";
    const task = {
      ...notice("task", path, 4, "error", "Type mismatch (TS2322)"),
      code: "TS2322",
      groupKey: "node-package-task-problems:workspace:run",
    };
    const languageServer = {
      ...task,
      code: undefined,
      groupKey: `javascript-typescript-diagnostics:file://${path}`,
      id: "language-server",
      message: `file://${path} 4:1 Type mismatch`,
      source: "typescript",
    };
    const fillers = Array.from({ length: MAX_PROBLEMS_VIEW_ROWS - 1 }, (_, index) =>
      notice(
        `filler-${index}`,
        `/workspace/src/filler-${index}.ts`,
        1,
        "warning",
        `Filler ${index}`,
      ),
    );

    const view = buildProblemsView(
      [task, ...fillers, languageServer],
      ROOT,
      { errors: true, warnings: true },
      "",
    );
    const ids = view.files.flatMap((file) => file.entries.map((entry) => entry.id));

    expect(ids).toContain("language-server");
    expect(ids).not.toContain("task");
    expect(view.totals.errors).toBe(1);
  });

  it("reports the actual retained rows after duplicate-heavy projection", () => {
    const path = "/workspace/src/index.ts";
    const task = {
      ...notice("task", path, 4, "error", "Type mismatch"),
      groupKey: "node-package-task-problems:workspace:run",
    };
    const languageServer = {
      ...task,
      groupKey: `javascript-typescript-diagnostics:file://${path}`,
      id: "language-server",
      source: "typescript",
    };
    const notices = Array.from({ length: 50_000 }, (_, index) =>
      index % 2 === 0
        ? { ...task, id: `task-${index}` }
        : {
            ...languageServer,
            id: `language-server-${index}`,
          },
    );

    const view = buildProblemsView(notices, ROOT, { errors: true, warnings: true }, "");
    const retainedRows = view.files.flatMap((file) => file.entries).length;
    const receipt = view.general[0];

    expect(retainedRows).toBeLessThanOrEqual(MAX_PROBLEMS_VIEW_ROWS - 1);
    expect(receipt?.message).toBe(`Problems view retained ${retainedRows} of 50000 input rows.`);
  });

  it("recognizes an exact-owner retention receipt prefix", () => {
    const receipt: WorkbenchNotice = {
      groupKey: `${DIAGNOSTICS_RETENTION_RECEIPT_GROUP_KEY}:php:owner:7:3`,
      id: "owned-receipt",
      kind: "overflow",
      message: "Retained 2000 of 100000 published diagnostics.",
      severity: "info",
      source: "Diagnostics",
    };
    const notices = [
      receipt,
      ...Array.from({ length: MAX_PROBLEMS_VIEW_ROWS }, (_, index) =>
        notice(
          `diagnostic-${index}`,
          `/workspace/src/file-${index}.ts`,
          1,
          "error",
          `Diagnostic ${index}`,
        ),
      ),
    ];

    const view = buildProblemsView(
      notices,
      ROOT,
      { errors: false, warnings: false },
      "does not match receipt",
    );

    expect(view.general).toEqual([expectedUnownedRow(receipt)]);
    expect(view.files).toEqual([]);
  });
});
