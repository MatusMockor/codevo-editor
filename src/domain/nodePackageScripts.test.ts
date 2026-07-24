import { describe, expect, it } from "vitest";
import {
  compareNodePackageScripts,
  nodePackageScriptIdentity,
  parseNodePackageTaskEvent,
  parseNodePackageScriptsResult,
  parseStartNodePackageTaskResult,
} from "./nodePackageScripts";

const limits = { maxManifests: 2, maxScripts: 4, maxVisited: 10 };

describe("Node package scripts", () => {
  it("strictly parses, identifies, and deterministically sorts scripts", () => {
    expect(
      parseNodePackageScriptsResult(
        {
          scripts: [
            rawScript({ scriptName: "test" }),
            rawScript({
              manifestRelativePath: "apps/web/package.json",
              packageName: "@demo/web",
              packageManager: "pnpm",
              packageRootRelativePath: "apps/web",
              scriptName: "dev",
            }),
            rawScript({ scriptName: "build" }),
          ],
          total: 3,
          truncated: false,
          visited: 8,
        },
        limits,
      ),
    ).toEqual({
      scripts: [
        expect.objectContaining({
          key: nodePackageScriptIdentity({
            manifestRelativePath: "apps/web/package.json",
            scriptName: "dev",
          }),
          scriptName: "dev",
        }),
        expect.objectContaining({ scriptName: "build" }),
        expect.objectContaining({ scriptName: "test" }),
      ],
      total: 3,
      truncated: false,
      visited: 8,
    });
  });

  it("uses manifest path and script name as identity and sort tie breakers", () => {
    expect(
      nodePackageScriptIdentity({ manifestRelativePath: "package.json", scriptName: "a:b" }),
    ).not.toBe(
      nodePackageScriptIdentity({
        manifestRelativePath: "packages/a/package.json",
        scriptName: "a:b",
      }),
    );
    expect(
      compareNodePackageScripts(
        { manifestRelativePath: "package.json", scriptName: "b" },
        { manifestRelativePath: "package.json", scriptName: "a" },
      ),
    ).toBeGreaterThan(0);
  });

  it.each([
    { ...result(), extra: true },
    { scripts: [], total: 0, truncated: false },
    { ...result(), scripts: [{ ...rawScript(), extra: true }] },
    { ...result(), scripts: [{ ...rawScript(), scriptName: "-bad" }] },
    { ...result(), scripts: [{ ...rawScript(), packageManager: "corepack" }] },
    { ...result(), scripts: [{ ...rawScript(), manifestRelativePath: "/package.json" }] },
    {
      ...result(),
      scripts: [
        {
          ...rawScript(),
          manifestRelativePath: "other/package.json",
          packageRootRelativePath: "packages/app",
        },
      ],
    },
    { ...result(), scripts: [rawScript(), rawScript()], total: 2 },
  ])("rejects malformed or ambiguous values", (value) => {
    expect(() => parseNodePackageScriptsResult(value, limits)).toThrow(TypeError);
  });

  it("preserves safe npm script names with spaces and Unicode", () => {
    const parsed = parseNodePackageScriptsResult(
      {
        scripts: [rawScript({ scriptName: "build prod ✓" })],
        total: 1,
        truncated: false,
        visited: 1,
      },
      limits,
    );

    expect(parsed.scripts[0]?.scriptName).toBe("build prod ✓");
  });

  it("enforces every requested response bound and count invariant", () => {
    expect(() =>
      parseNodePackageScriptsResult(
        { ...result(), scripts: [rawScript(), rawScript({ scriptName: "b" })], total: 2 },
        { ...limits, maxScripts: 1 },
      ),
    ).toThrow("requested 1");
    expect(() => parseNodePackageScriptsResult({ ...result(), visited: 11 }, limits)).toThrow(
      "result.visited",
    );
    expect(() => parseNodePackageScriptsResult({ ...result(), total: 2 }, limits)).toThrow(
      "returned script count",
    );
    expect(() =>
      parseNodePackageScriptsResult({ ...result(), total: 0, truncated: true }, limits),
    ).toThrow("at least");
  });

  it("strictly parses task results and every status event variant", () => {
    expect(parseStartNodePackageTaskResult({ runId: "run-1" })).toEqual({ runId: "run-1" });
    expect(parseNodePackageTaskEvent(taskEvent({ status: "running" }))).toMatchObject({
      status: "running",
      sessionId: 7,
    });
    expect(parseNodePackageTaskEvent(taskEvent({ status: "exited", exitCode: -1 }))).toMatchObject({
      status: "exited",
      exitCode: -1,
    });
    expect(
      parseNodePackageTaskEvent(taskEvent({ status: "failed", message: "spawn failed" })),
    ).toMatchObject({
      status: "failed",
      message: "spawn failed",
    });
    expect(parseNodePackageTaskEvent(taskEvent({ status: "stopped" }))).toMatchObject({
      status: "stopped",
    });
  });

  it.each([
    { ...taskEvent({ status: "running" }), extra: true },
    { ...taskEvent({ status: "running" }), runId: "" },
    { ...taskEvent({ status: "running" }), sessionId: -1 },
    { ...taskEvent({ status: "running" }), manifestRelativePath: "../package.json" },
    { ...taskEvent({ status: "exited", exitCode: 0 }), exitCode: 2 ** 31 },
    { ...taskEvent({ status: "failed", message: "x" }), message: "x".repeat(4_097) },
    { ...taskEvent({ status: "stopped" }), message: "unexpected" },
  ])("rejects malformed, unknown, and oversized task event fields", (value) => {
    expect(() => parseNodePackageTaskEvent(value)).toThrow(TypeError);
  });
});

function rawScript(overrides: Record<string, unknown> = {}) {
  return {
    manifestRelativePath: "package.json",
    packageRootRelativePath: "",
    packageName: "demo",
    packageManager: "npm",
    scriptName: "test",
    ...overrides,
  };
}

function result() {
  return { scripts: [rawScript()], total: 1, truncated: false, visited: 3 };
}

function taskEvent(statusFields: Record<string, unknown>) {
  return {
    runId: "run-1",
    workspaceId: "ws-1",
    sessionId: 7,
    manifestRelativePath: "package.json",
    scriptName: "build",
    ...statusFields,
  };
}
