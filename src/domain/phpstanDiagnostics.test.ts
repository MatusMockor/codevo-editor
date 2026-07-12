import { describe, expect, it } from "vitest";
import {
  clearPhpstanDiagnosticsForFile,
  parsePhpstanDiagnostics,
  replacePhpstanDiagnosticsForRoot,
} from "./phpstanDiagnostics";

const ROOT = "/workspace";

describe("parsePhpstanDiagnostics", () => {
  it("maps file diagnostics to navigable error notices", () => {
    const notices = parsePhpstanDiagnostics(
      {
        status: "ok",
        diagnostics: [
          {
            filePath: "src/User.php",
            line: 12,
            message: "Property User::$name is never read.",
            identifier: "property.onlyWritten",
            ignorable: true,
          },
        ],
        totals: { fileErrors: 1, generalErrors: 0, fileCount: 1 },
      },
      ROOT,
    );

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      groupKey: `phpstan:${ROOT}`,
      severity: "error",
      source: "PHPStan",
      message: "Property User::$name is never read.",
      navigationTarget: {
        path: "/workspace/src/User.php",
        range: {
          start: { lineNumber: 12, column: 1 },
          end: { lineNumber: 12, column: 1 },
        },
      },
    });
  });

  it("maps general errors to non-navigable notices", () => {
    const notices = parsePhpstanDiagnostics(
      {
        status: "ok",
        diagnostics: [
          {
            filePath: "",
            line: null,
            message: "Invalid configuration.",
            identifier: null,
            ignorable: false,
          },
        ],
        totals: { fileErrors: 0, generalErrors: 1, fileCount: 0 },
      },
      ROOT,
    );

    expect(notices[0]).toMatchObject({
      severity: "error",
      message: "Invalid configuration.",
      navigationTarget: undefined,
    });
  });

  it("returns no notices for an empty successful result", () => {
    expect(
      parsePhpstanDiagnostics(
        {
          status: "ok",
          diagnostics: [],
          totals: { fileErrors: 0, generalErrors: 0, fileCount: 0 },
        },
        ROOT,
      ),
    ).toEqual([]);
  });

  it("suggests configuration or Composer installation when unavailable", () => {
    expect(
      parsePhpstanDiagnostics({ status: "unavailable" }, ROOT)[0],
    ).toMatchObject({
      severity: "info",
      source: "PHPStan",
      message: expect.stringMatching(/phpstanPath.*Composer/i),
      navigationTarget: undefined,
    });
  });

  it("maps command errors to one error notice", () => {
    expect(
      parsePhpstanDiagnostics(
        { status: "error", message: "PHPStan process failed." },
        ROOT,
      )[0],
    ).toMatchObject({
      severity: "error",
      source: "PHPStan",
      message: "PHPStan process failed.",
      navigationTarget: undefined,
    });
  });
});

describe("PHPStan diagnostic retention", () => {
  const result = (identifier: string) => ({
    status: "ok" as const,
    diagnostics: [
      {
        filePath: "src/User.php",
        line: 12,
        message: "Issue",
        identifier,
        ignorable: true,
      },
    ],
    totals: { fileErrors: 1, generalErrors: 0, fileCount: 1 },
  });

  it("stores actionable diagnostics per root and file and replaces a root on each run", () => {
    const first = replacePhpstanDiagnosticsForRoot(
      {},
      ROOT,
      result("first.issue"),
    );
    const withOtherRoot = replacePhpstanDiagnosticsForRoot(
      first,
      "/other",
      result("other.issue"),
    );
    const replaced = replacePhpstanDiagnosticsForRoot(
      withOtherRoot,
      ROOT,
      result("second.issue"),
    );

    expect(replaced).toEqual({
      [ROOT]: {
        "/workspace/src/User.php": [
          { identifier: "second.issue", line: 12 },
        ],
      },
      "/other": {
        "/other/src/User.php": [{ identifier: "other.issue", line: 12 }],
      },
    });

    expect(
      replacePhpstanDiagnosticsForRoot(replaced, ROOT, {
        status: "error",
        message: "failed",
      }),
    ).toEqual({ [ROOT]: {}, "/other": replaced["/other"] });
  });

  it("drops non-actionable diagnostics and clears one closed file without affecting other roots", () => {
    const stored = replacePhpstanDiagnosticsForRoot({}, ROOT, {
      ...result("kept.issue"),
      diagnostics: [
        ...result("kept.issue").diagnostics,
        { ...result("missing.identifier").diagnostics[0], identifier: null },
        { ...result("missing.line").diagnostics[0], line: null },
        { ...result("not.ignorable").diagnostics[0], ignorable: false },
      ],
    });
    const withOtherRoot = replacePhpstanDiagnosticsForRoot(
      stored,
      "/other",
      result("other.issue"),
    );

    expect(stored).toEqual({
      [ROOT]: {
        "/workspace/src/User.php": [{ identifier: "kept.issue", line: 12 }],
      },
    });
    expect(
      clearPhpstanDiagnosticsForFile(
        withOtherRoot,
        ROOT,
        "/workspace/src/User.php",
      ),
    ).toEqual({ [ROOT]: {}, "/other": withOtherRoot["/other"] });
  });
});
