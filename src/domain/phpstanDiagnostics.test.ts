import { describe, expect, it } from "vitest";
import { parsePhpstanDiagnostics } from "./phpstanDiagnostics";

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
