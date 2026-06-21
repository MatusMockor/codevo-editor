import { describe, expect, it } from "vitest";
import {
  isUsableLaravelConfigKey,
  phpLaravelConfigCompletionInsertText,
  phpLaravelConfigFileNameFromRelativePath,
  phpLaravelConfigKeyCandidateRelativePath,
  phpLaravelConfigKeysFromSource,
  phpLaravelConfigReferenceContextAt,
  phpLaravelConfigTargetFromSource,
} from "./phpLaravelConfig";

describe("phpLaravelConfig", () => {
  it("detects Laravel config helper strings", () => {
    const source = `<?php

return config('app.name');
`;

    expect(
      phpLaravelConfigReferenceContextAt(source, positionAfter(source, "app.na")),
    ).toEqual({
      call: "config",
      key: "app.name",
      position: { column: 16, lineNumber: 3 },
      prefix: "app.na",
    });
  });

  it("detects supported Laravel config repository calls", () => {
    const typedRepositoryMethods = [
      "string",
      "integer",
      "float",
      "boolean",
      "array",
      "collection",
    ];
    const samples: Array<[string, string]> = [
      ["Config::get('app.name')", "Config::get"],
      ["Config::has('app.name')", "Config::has"],
      ["config()->get('app.name')", "config()->get"],
      ["config()->has('app.name')", "config()->has"],
      ["config(key: 'app.name')", "config"],
    ];

    for (const method of typedRepositoryMethods) {
      samples.push([`Config::${method}('app.name')`, `Config::${method}`]);
      samples.push([`config()->${method}('app.name')`, `config()->${method}`]);
    }

    for (const [expression, call] of samples) {
      const source = `<?php\n\nreturn ${expression};\n`;

      expect(
        phpLaravelConfigReferenceContextAt(source, positionAfter(source, "app.na")),
      ).toMatchObject({
        call,
        key: "app.name",
        prefix: "app.na",
      });
    }
  });

  it("ignores interpolation, update arrays, and non-config calls", () => {
    const interpolated = `<?php\n\nreturn config("app.$name");\n`;
    const updateArray = `<?php\n\nconfig(['app.name' => 'Codevo']);\n`;
    const wrongCall = `<?php\n\nreturn trans('app.name');\n`;

    expect(
      phpLaravelConfigReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "app."),
      ),
    ).toBeNull();
    expect(
      phpLaravelConfigReferenceContextAt(
        updateArray,
        positionAfter(updateArray, "app.name"),
      ),
    ).toBeNull();
    expect(
      phpLaravelConfigReferenceContextAt(wrongCall, positionAfter(wrongCall, "app.na")),
    ).toBeNull();
  });

  it("maps config keys and config file paths", () => {
    expect(phpLaravelConfigKeyCandidateRelativePath("app.name")).toBe(
      "config/app.php",
    );
    expect(phpLaravelConfigFileNameFromRelativePath("config/app.php")).toBe(
      "app",
    );
    expect(phpLaravelConfigFileNameFromRelativePath("config/packages/app.php")).toBe(
      null,
    );
    expect(isUsableLaravelConfigKey("app.mail.from")).toBe(true);
    expect(isUsableLaravelConfigKey("app.")).toBe(false);
  });

  it("extracts nested config array keys with positions", () => {
    const source = `<?php

return [
    'name' => env('APP_NAME', 'Laravel'),
    'mail' => [
        'from' => [
            'address' => 'hello@example.com',
        ],
    ],
    'providers' => array(
        'log' => true,
    ),
];
`;

    expect(phpLaravelConfigKeysFromSource(source, "app")).toEqual([
      { key: "app.mail", position: { column: 6, lineNumber: 5 } },
      { key: "app.mail.from", position: { column: 10, lineNumber: 6 } },
      {
        key: "app.mail.from.address",
        position: { column: 14, lineNumber: 7 },
      },
      { key: "app.name", position: { column: 6, lineNumber: 4 } },
      { key: "app.providers", position: { column: 6, lineNumber: 10 } },
      { key: "app.providers.log", position: { column: 10, lineNumber: 11 } },
    ]);
    expect(phpLaravelConfigTargetFromSource(source, "app", "app.name")).toEqual({
      key: "app.name",
      position: { column: 6, lineNumber: 4 },
    });
    expect(phpLaravelConfigTargetFromSource(source, "app", "app")).toEqual({
      key: "app",
      position: { column: 1, lineNumber: 1 },
    });
  });

  it("uses dotted-prefix suffix insert text", () => {
    expect(phpLaravelConfigCompletionInsertText("app.name", "app.na")).toBe(
      "name",
    );
    expect(phpLaravelConfigCompletionInsertText("database", "data")).toBe(
      "database",
    );
  });
});

function positionAfter(source: string, token: string) {
  const offset = source.indexOf(token);

  if (offset < 0) {
    throw new Error(`Token not found: ${token}`);
  }

  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset + token.length; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
