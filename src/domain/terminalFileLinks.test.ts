import { describe, expect, it } from "vitest";
import { terminalFileLinks } from "./terminalFileLinks";

describe("terminalFileLinks", () => {
  it.each([
    ["src/Foo.php:12", "src/Foo.php:12", "src/Foo.php", 12, undefined],
    [
      "FAIL ./tests/x.spec.ts:3:5;",
      "./tests/x.spec.ts:3:5",
      "./tests/x.spec.ts",
      3,
      5,
    ],
    [
      "(/abs/path/File.php:7)",
      "/abs/path/File.php:7",
      "/abs/path/File.php",
      7,
      undefined,
    ],
    [
      "at src/Foo.php line 12",
      "src/Foo.php line 12",
      "src/Foo.php",
      12,
      undefined,
    ],
    [
      'PHPUnit: src/Foo.php on line 12"',
      "src/Foo.php on line 12",
      "src/Foo.php",
      12,
      undefined,
    ],
    ["changed src/Foo.php,", "src/Foo.php", "src/Foo.php", undefined, undefined],
  ])(
    "matches %s",
    (text, linkedText, path, line, column) => {
      const startIndex = text.indexOf(linkedText);

      expect(terminalFileLinks(text)).toEqual([
        {
          column,
          length: linkedText.length,
          line,
          path,
          startIndex,
        },
      ]);
    },
  );

  it("returns every file link in display order", () => {
    expect(terminalFileLinks("src/A.php:2 then tests/B.php:4:6")).toEqual([
      {
        column: undefined,
        length: 11,
        line: 2,
        path: "src/A.php",
        startIndex: 0,
      },
      {
        column: 6,
        length: 15,
        line: 4,
        path: "tests/B.php",
        startIndex: 17,
      },
    ]);
  });

  it.each([
    "https://example.com/src/Foo.php:12",
    "http://localhost/tests/x.spec.ts:3:5",
    "failure 12",
    "release v1.2.3",
    "finished at 12:30:45",
    "Foo.php",
    "notes/readme.txt",
  ])("does not match %s", (text) => {
    expect(terminalFileLinks(text)).toEqual([]);
  });
});
