import { describe, expect, it } from "vitest";
import { parsePhpCloverCoverage, phpCoverageMetric } from "./phpCloverCoverage";

const wrap = (body: string) =>
  `<?xml version="1.0"?><coverage><project name="app">${body}</project></coverage>`;

describe("parsePhpCloverCoverage", () => {
  it("parses package and direct files, merges line records, sorts, and derives metrics", () => {
    const report = parsePhpCloverCoverage(
      wrap(
        [
          '<file name="/workspace/src/B.php">',
          '<class name="B"><metrics methods="1"/></class>',
          '<line num="8" type="stmt" count="0"/>',
          '<line num="2" type="method" count="3"/>',
          '<metrics statements="999" coveredstatements="999"/>',
          "</file>",
          '<package name="App"><file name="/workspace/src/A.php">',
          '<line num="1" type="stmt" count="1"/>',
          "</file></package>",
          '<file name="/workspace/src/B.php"><line num="8" type="stmt" count="2"/></file>',
        ].join(""),
      ),
      "/workspace",
    );

    expect(report).toEqual({
      files: [
        {
          path: "src/A.php",
          lines: [{ lineNumber: 1, hits: 1 }],
          summary: { covered: 1, total: 1, percentage: 100 },
          firstUncoveredLine: null,
        },
        {
          path: "src/B.php",
          lines: [
            { lineNumber: 2, hits: 3 },
            { lineNumber: 8, hits: 2 },
          ],
          summary: { covered: 2, total: 2, percentage: 100 },
          firstUncoveredLine: null,
        },
      ],
      summary: { covered: 3, total: 3, percentage: 100 },
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.files)).toBe(true);
    expect(Object.isFrozen(report.files[0]!.lines[0])).toBe(true);
  });

  it("decodes safe XML entities and accepts relative and Windows descendant paths", () => {
    const report = parsePhpCloverCoverage(
      wrap(
        '<file name="src/Foo&amp;Bar.php"><line num="1" type="stmt" count="0"/></file>' +
          '<file name="C:\\workspace\\src\\Win.php"><line num="2" type="stmt" count="1"/></file>',
      ),
      "C:\\workspace",
    );
    expect(report.files.map(({ path }) => path)).toEqual(["src/Foo&Bar.php", "src/Win.php"]);
    expect(report.summary).toEqual({ covered: 1, total: 2, percentage: 50 });
  });

  it("contains Windows and UNC report paths through conservative case aliases", () => {
    expect(
      parsePhpCloverCoverage(wrap('<file name="c:\\WORKSPACE\\SRC\\Win.php"/>'), "C:\\workspace")
        .files[0]?.path,
    ).toBe("SRC/Win.php");
    expect(
      parsePhpCloverCoverage(
        wrap('<file name="\\\\server\\share\\workspace\\src\\Unc.php"/>'),
        "\\\\SERVER\\Share\\Workspace",
      ).files[0]?.path,
    ).toBe("src/Unc.php");
  });

  it("merges duplicate Windows file records across case aliases", () => {
    const parsed = parsePhpCloverCoverage(
      wrap(
        '<file name="C:\\Workspace\\src\\App.php"><line num="1" type="stmt" count="0"/></file>' +
          '<file name="c:\\workspace\\SRC\\APP.PHP"><line num="1" type="stmt" count="2"/></file>',
      ),
      "C:\\Workspace",
    );
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]).toMatchObject({
      lines: [{ hits: 2, lineNumber: 1 }],
      path: "src/App.php",
      summary: { covered: 1, total: 1 },
    });
    expect(parsed.summary).toMatchObject({ covered: 1, total: 1 });
  });

  it("represents empty reports and files without executable lines", () => {
    expect(
      parsePhpCloverCoverage(
        wrap('<file name="src/Types.php"><metrics statements="0"/></file>'),
        "/workspace",
      ),
    ).toEqual({
      files: [
        {
          path: "src/Types.php",
          lines: [],
          summary: { covered: 0, total: 0, percentage: null },
          firstUncoveredLine: null,
        },
      ],
      summary: { covered: 0, total: 0, percentage: null },
    });
  });

  it.each([
    ["empty", "", "missing coverage"],
    ["text", wrap("payload"), "unexpected text"],
    ["doctype", '<!DOCTYPE coverage SYSTEM "remote"><coverage/>', "declarations"],
    ["entity declaration", "<!ENTITY x SYSTEM 'file:///etc/passwd'><coverage/>", "declarations"],
    ["unknown element", wrap("<directory/>"), "unsupported <directory>"],
    ["wrong placement", '<coverage><file name="src/A.php"/></coverage>', "placement"],
    ["mismatched close", "<coverage><project></coverage>", "mismatched"],
    ["unterminated", "<coverage><project>", "unterminated"],
    ["duplicate attr", wrap('<file name="a.php" name="b.php"/>'), "duplicate attribute"],
    ["unquoted attr", wrap("<file name=a.php/>"), "unquoted"],
    [
      "non-self-closing line",
      wrap('<file name="a.php"><line num="1" type="stmt" count="1"></line></file>'),
      "self-closing",
    ],
    [
      "unsupported line",
      wrap('<file name="a.php"><line num="1" type="branch" count="1"/></file>'),
      "unsupported line type",
    ],
    [
      "zero line",
      wrap('<file name="a.php"><line num="0" type="stmt" count="1"/></file>'),
      "line num is invalid",
    ],
    [
      "negative hits",
      wrap('<file name="a.php"><line num="1" type="stmt" count="-1"/></file>'),
      "line count is invalid",
    ],
    [
      "unsafe hits",
      wrap(
        `<file name="a.php"><line num="1" type="stmt" count="${Number.MAX_SAFE_INTEGER + 1}"/></file>`,
      ),
      "line count is unsafe",
    ],
    ["unknown entity", wrap('<file name="src/&secret;.php"/>'), "unsupported XML entity"],
    ["bare ampersand", wrap('<file name="src/A&B.php"/>'), "malformed XML entity"],
    ["raw less-than", wrap('<file name="src/A<B.php"/>'), "unescaped <"],
    ["surrogate entity", wrap('<file name="src/&#xD800;.php"/>'), "unsupported XML entity"],
    ["outside absolute", wrap('<file name="/other/A.php"/>'), "workspace-relative descendant"],
    [
      "prefix collision",
      wrap('<file name="/workspace-other/A.php"/>'),
      "workspace-relative descendant",
    ],
    ["traversal", wrap('<file name="src/../secret.php"/>'), "workspace-relative descendant"],
    ["empty segment", wrap('<file name="src//A.php"/>'), "workspace-relative descendant"],
    ["control path", wrap('<file name="src/A&#10;.php"/>'), "invalid file path"],
  ])("rejects %s", (_case, source, message) => {
    expect(() => parsePhpCloverCoverage(source, "/workspace")).toThrow(message);
  });

  it("enforces input, path, file, line, token, and attribute bounds", () => {
    expect(() => parsePhpCloverCoverage("<coverage/>", "/workspace", { maxInputBytes: 4 })).toThrow(
      "exceeds 4 UTF-8 bytes",
    );
    expect(() =>
      parsePhpCloverCoverage(wrap('<file name="long.php"/>'), "/workspace", { maxPathBytes: 4 }),
    ).toThrow("invalid file path");
    expect(() =>
      parsePhpCloverCoverage(wrap('<file name="a.php"/><file name="b.php"/>'), "/workspace", {
        maxFiles: 1,
      }),
    ).toThrow("exceeds 1 file records");
    expect(() =>
      parsePhpCloverCoverage(
        wrap(
          '<file name="a.php"><line num="1" type="stmt" count="0"/><line num="2" type="stmt" count="0"/></file>',
        ),
        "/workspace",
        { maxLineRecords: 1 },
      ),
    ).toThrow("exceeds 1 line records");
    expect(() =>
      parsePhpCloverCoverage("<coverage/>", "/workspace", { maxTokens: 1 }),
    ).not.toThrow();
    expect(() => parsePhpCloverCoverage(wrap(""), "/workspace", { maxTokens: 2 })).toThrow(
      "exceeds 2 element tokens",
    );
    expect(() =>
      parsePhpCloverCoverage('<coverage a="1" b="2"/>', "/workspace", {
        maxAttributesPerElement: 1,
      }),
    ).toThrow("exceeds 1 attributes");
  });

  it("rejects invalid limits and workspace roots", () => {
    expect(() => parsePhpCloverCoverage("<coverage/>", "/workspace", { maxFiles: 0 })).toThrow(
      "maxFiles must be a positive safe integer",
    );
    expect(() => parsePhpCloverCoverage("<coverage/>", "relative/root")).toThrow(
      "workspace root must be an absolute clean path",
    );
  });
});

describe("phpCoverageMetric", () => {
  it("derives percentages without importing JavaScript coverage models", () => {
    expect(phpCoverageMetric(1, 4)).toEqual({ covered: 1, total: 4, percentage: 25 });
    expect(phpCoverageMetric(0, 0)).toEqual({ covered: 0, total: 0, percentage: null });
  });

  it.each([
    [-1, 1],
    [2, 1],
    [0.5, 1],
    [0, Number.POSITIVE_INFINITY],
  ])("rejects invalid counts %s/%s", (covered, total) => {
    expect(() => phpCoverageMetric(covered, total)).toThrow();
  });
});
