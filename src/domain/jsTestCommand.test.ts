import { describe, expect, it } from "vitest";
import {
  MAX_JS_TEST_WATCH_OUTPUT_BYTES,
  jsTestRunCommand,
  parseJsTestWatchOutputEvent,
  parseJsTestWatchStatusEvent,
  parseStartJsTestWatchResult,
  validateJsTestWatchOwner,
  validateStartJsTestWatchRequest,
} from "./jsTestCommand";

describe("jsTestRunCommand", () => {
  it("runs the local vitest binary with the run subcommand, never npx", () => {
    expect(jsTestRunCommand({ runner: "vitest" })).toBe("node_modules/.bin/vitest run");
  });

  it("runs the local jest binary without a subcommand", () => {
    expect(jsTestRunCommand({ runner: "jest" })).toBe("node_modules/.bin/jest");
  });

  it("appends a quoted file path", () => {
    expect(jsTestRunCommand({ filePath: "src/math.test.ts", runner: "vitest" })).toBe(
      "node_modules/.bin/vitest run 'src/math.test.ts'",
    );
    expect(jsTestRunCommand({ filePath: "src/my tests/math.test.ts", runner: "jest" })).toBe(
      "node_modules/.bin/jest 'src/my tests/math.test.ts'",
    );
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
    expect(jsTestRunCommand({ filePath: "src/o'brien.test.ts", runner: "jest" })).toBe(
      "node_modules/.bin/jest 'src/o'\\''brien.test.ts'",
    );
  });

  it("neutralizes shell metacharacters in filters and paths", () => {
    expect(
      jsTestRunCommand({
        filter: "boom; rm -rf / && curl evil | sh `id` $(whoami)",
        runner: "vitest",
      }),
    ).toBe("node_modules/.bin/vitest run -t 'boom; rm -rf / && curl evil | sh `id` $(whoami)'");
  });

  it("returns null when the filter contains a newline or control character", () => {
    expect(jsTestRunCommand({ filter: "evil\nrm -rf /", runner: "vitest" })).toBeNull();
    expect(jsTestRunCommand({ filter: "tab\there", runner: "jest" })).toBeNull();
  });

  it("returns null when the file path contains a control character", () => {
    expect(jsTestRunCommand({ filePath: "src/evil\n.test.ts", runner: "vitest" })).toBeNull();
  });

  it("returns null for an empty filter or empty file path", () => {
    expect(jsTestRunCommand({ filter: "", runner: "vitest" })).toBeNull();
    expect(jsTestRunCommand({ filePath: "", runner: "jest" })).toBeNull();
  });

  it("treats a null filter and path as a whole-suite run", () => {
    expect(jsTestRunCommand({ filePath: null, filter: null, runner: "vitest" })).toBe(
      "node_modules/.bin/vitest run",
    );
  });

  it("runs inside a nested package with a package-relative test path", () => {
    expect(
      jsTestRunCommand({
        filePath: "src/math.test.ts",
        runner: "vitest",
        workingDirectory: "packages/accounting",
      }),
    ).toBe("cd 'packages/accounting' && node_modules/.bin/vitest run 'src/math.test.ts'");
  });

  it("rejects an absolute or escaping package working directory", () => {
    expect(jsTestRunCommand({ runner: "jest", workingDirectory: "../outside" })).toBeNull();
    expect(jsTestRunCommand({ runner: "jest", workingDirectory: "/outside" })).toBeNull();
  });

  it("uses a safely quoted hoisted runner selected by the resolver", () => {
    expect(
      jsTestRunCommand({
        executablePath: "../../node_modules/.bin/vitest",
        filePath: "src/math.test.ts",
        runner: "vitest",
        workingDirectory: "packages/accounting",
      }),
    ).toBe("cd 'packages/accounting' && '../../node_modules/.bin/vitest' run 'src/math.test.ts'");
  });
});

const watchOwner = {
  watchId: "watch-1",
  workspaceId: "workspace-1",
  epoch: 7,
} as const;

const watchRequest = {
  ...watchOwner,
  command: {
    kind: "vitest-watch",
    packageRootRelativePath: "packages/accounting",
    scope: {
      kind: "test",
      relativeFilePath: "src/math.test.ts",
      fullName: "math adds",
    },
  },
} as const;

describe("JavaScript test watch domain contract", () => {
  it("validates a bounded semantic command without executable strings or flags", () => {
    expect(validateStartJsTestWatchRequest(watchRequest)).toEqual(watchRequest);
    expect(
      validateStartJsTestWatchRequest({
        ...watchRequest,
        command: {
          kind: "jest-watch",
          packageRootRelativePath: "",
          scope: { kind: "all" },
        },
      }),
    ).toMatchObject({
      command: {
        kind: "jest-watch",
        packageRootRelativePath: "",
        scope: { kind: "all" },
      },
    });
  });

  it.each([
    { ...watchRequest, shell: "vitest --watch" },
    { ...watchRequest, epoch: 0 },
    {
      ...watchRequest,
      command: { ...watchRequest.command, args: ["--watch"] },
    },
    {
      ...watchRequest,
      command: {
        ...watchRequest.command,
        packageRootRelativePath: "../outside",
      },
    },
    {
      ...watchRequest,
      command: {
        ...watchRequest.command,
        scope: { kind: "all", file: "src/math.test.ts" },
      },
    },
  ])("rejects unknown, executable, stale, or escaping command data", (invalid) => {
    expect(() => validateStartJsTestWatchRequest(invalid)).toThrow(TypeError);
  });

  it("requires exact owner and start-result shapes", () => {
    expect(validateJsTestWatchOwner(watchOwner)).toEqual(watchOwner);
    expect(
      parseStartJsTestWatchResult({
        owner: watchOwner,
        structuredResults: "unavailable-in-watch-mode",
      }),
    ).toEqual({
      owner: watchOwner,
      structuredResults: "unavailable-in-watch-mode",
    });
    expect(() => validateJsTestWatchOwner({ ...watchOwner, foreign: true })).toThrow(TypeError);
    expect(() =>
      parseStartJsTestWatchResult({
        owner: watchOwner,
        structuredResults: "available",
      }),
    ).toThrow(TypeError);
    expect(() =>
      parseStartJsTestWatchResult({
        owner: watchOwner,
        structuredResults: "unavailable-in-watch-mode",
        extra: true,
      }),
    ).toThrow(TypeError);
  });

  it("strictly decodes bounded status variants", () => {
    expect(
      parseJsTestWatchStatusEvent({
        owner: watchOwner,
        status: "exited",
        exitCode: 0,
      }),
    ).toEqual({ owner: watchOwner, status: "exited", exitCode: 0 });
    expect(
      parseJsTestWatchStatusEvent({
        owner: watchOwner,
        status: "failed",
        message: "runner failed",
      }),
    ).toEqual({
      owner: watchOwner,
      status: "failed",
      message: "runner failed",
    });
    expect(() =>
      parseJsTestWatchStatusEvent({
        owner: watchOwner,
        status: "running",
        exitCode: null,
      }),
    ).toThrow(TypeError);
  });

  it("strictly decodes bounded output and empty truncation markers", () => {
    expect(
      parseJsTestWatchOutputEvent({
        owner: watchOwner,
        sequence: 9,
        stream: "stdout",
        data: "ready",
        truncated: false,
      }),
    ).toEqual({
      owner: watchOwner,
      sequence: 9,
      stream: "stdout",
      data: "ready",
      truncated: false,
    });
    expect(() =>
      parseJsTestWatchOutputEvent({
        owner: watchOwner,
        sequence: 10,
        stream: "stderr",
        data: "x",
        truncated: true,
      }),
    ).toThrow(TypeError);
    expect(() =>
      parseJsTestWatchOutputEvent({
        owner: watchOwner,
        sequence: 10,
        stream: "stderr",
        data: "x".repeat(MAX_JS_TEST_WATCH_OUTPUT_BYTES + 1),
        truncated: false,
      }),
    ).toThrow(TypeError);
  });
});
