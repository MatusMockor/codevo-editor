import { describe, expect, it } from "vitest";
import parityFixtures from "./nodeBuiltInTestRunner.fixtures.json";
import {
  detectNodeBuiltInTestManifest,
  MAX_NODE_TEST_PACKAGE_JSON_BYTES,
  MAX_NODE_TEST_SCRIPT_COUNT,
  nodeTestRuntimeCapability,
} from "./nodeBuiltInTestRunner";

describe("detectNodeBuiltInTestManifest", () => {
  it("detects only explicit, package-owned node --test commands", () => {
    expect(
      detectNodeBuiltInTestManifest(
        JSON.stringify({
          scripts: {
            check: "node --test test/*.test.mjs",
            test: "node --test",
            unit: "vitest run",
          },
        }),
      ),
    ).toEqual({ scriptNames: ["check", "test"] });
  });

  it.each([
    ["source imports are not a manifest", JSON.stringify({ dependencies: { "node:test": "*" } })],
    ["shell composition", JSON.stringify({ scripts: { test: "node --test && echo done" } })],
    ["environment expansion", JSON.stringify({ scripts: { test: "$NODE --test" } })],
    ["wrapper ambiguity", JSON.stringify({ scripts: { test: "npm exec node -- --test" } })],
    ["argument resemblance", JSON.stringify({ scripts: { test: "node app.mjs --test" } })],
    ["malformed JSON", "{"],
  ])("fails closed for %s", (_label, source) => {
    expect(detectNodeBuiltInTestManifest(source)).toBeNull();
  });

  it.each(parityFixtures.commands)(
    "keeps the shared backend grammar parity for $command",
    ({ command, supported }) => {
      expect(
        detectNodeBuiltInTestManifest(JSON.stringify({ scripts: { test: command } })) !== null,
      ).toBe(supported);
    },
  );

  it("enforces manifest and script-count bounds before selection", () => {
    expect(
      detectNodeBuiltInTestManifest(" ".repeat(MAX_NODE_TEST_PACKAGE_JSON_BYTES + 1)),
    ).toBeNull();
    expect(
      detectNodeBuiltInTestManifest(
        JSON.stringify({
          scripts: Object.fromEntries(
            Array.from({ length: MAX_NODE_TEST_SCRIPT_COUNT + 1 }, (_, index) => [
              `test:${index}`,
              "node --test",
            ]),
          ),
        }),
      ),
    ).toBeNull();
  });
});

describe("nodeTestRuntimeCapability", () => {
  it("accepts a supported absolute Node runtime identity", () => {
    expect(nodeTestRuntimeCapability("/opt/node/bin/node", "v20.13.1\n")).toEqual({
      executablePath: "/opt/node/bin/node",
      version: { major: 20, minor: 13, patch: 1 },
    });
  });

  it.each([
    ["relative executable", "node", "v22.0.0"],
    ["unsupported runtime", "/usr/bin/node", "v18.20.0"],
    ["non-exact output", "/usr/bin/node", "node v22.0.0"],
    ["prerelease ambiguity", "/usr/bin/node", "v22.0.0-rc.1"],
  ])("fails closed for %s", (_label, executable, version) => {
    expect(nodeTestRuntimeCapability(executable, version)).toBeNull();
  });
});
