import { describe, expect, it } from "vitest";
import {
  isUsableLaravelEnvName,
  phpLaravelEnvCompletionInsertText,
  phpLaravelEnvEntriesFromSource,
  phpLaravelEnvReferenceContextAt,
  phpLaravelEnvTargetFromSource,
} from "./phpLaravelEnv";

describe("phpLaravelEnv", () => {
  it("detects Laravel env helper strings", () => {
    const source = `<?php

return env('APP_NAME');
`;

    expect(
      phpLaravelEnvReferenceContextAt(source, positionAfter(source, "APP_NA")),
    ).toEqual({
      name: "APP_NAME",
      position: { column: 13, lineNumber: 3 },
      prefix: "APP_NA",
    });
  });

  it("detects named env helper key arguments", () => {
    const source = `<?php

return env(key: 'APP_NAME', default: 'Codevo');
`;

    expect(
      phpLaravelEnvReferenceContextAt(source, positionAfter(source, "APP_NA")),
    ).toMatchObject({
      name: "APP_NAME",
      prefix: "APP_NA",
    });
  });

  it("ignores interpolation, invalid names, and non-env calls", () => {
    const interpolated = `<?php\n\nreturn env("APP_$name");\n`;
    const invalid = `<?php\n\nreturn env('APP-NAME');\n`;
    const wrongCall = `<?php\n\nreturn config('APP_NAME');\n`;

    expect(
      phpLaravelEnvReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "APP_"),
      ),
    ).toBeNull();
    expect(
      phpLaravelEnvReferenceContextAt(invalid, positionAfter(invalid, "APP")),
    ).toBeNull();
    expect(
      phpLaravelEnvReferenceContextAt(wrongCall, positionAfter(wrongCall, "APP")),
    ).toBeNull();
  });

  it("extracts dotenv entries with positions", () => {
    const source = `# Comment
APP_NAME=Codevo
APP_ENV=local
export QUEUE_CONNECTION=sync
APP_NAME=Duplicate
 INVALID=value
`;

    expect(phpLaravelEnvEntriesFromSource(source)).toEqual([
      { name: "APP_ENV", position: { column: 1, lineNumber: 3 } },
      { name: "APP_NAME", position: { column: 1, lineNumber: 2 } },
      { name: "INVALID", position: { column: 2, lineNumber: 6 } },
      { name: "QUEUE_CONNECTION", position: { column: 8, lineNumber: 4 } },
    ]);
    expect(phpLaravelEnvTargetFromSource(source, "APP_NAME")).toEqual({
      name: "APP_NAME",
      position: { column: 1, lineNumber: 2 },
    });
    expect(phpLaravelEnvTargetFromSource(source, "MISSING")).toBeNull();
  });

  it("uses whole env key insert text", () => {
    expect(phpLaravelEnvCompletionInsertText("APP_NAME")).toBe("APP_NAME");
    expect(isUsableLaravelEnvName("APP_NAME")).toBe(true);
    expect(isUsableLaravelEnvName("APP-NAME")).toBe(false);
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
