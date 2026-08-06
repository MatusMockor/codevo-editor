import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseAggregateArgs,
  runAggregateCli,
  writeAggregateArtifactExclusive,
} from "./aggregate-perf-runs.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("aggregate perf runs CLI arguments", () => {
  it("requires three explicit absolute clean paths and one confirmation per editor", () => {
    const args = validArgs();
    const parsed = parseAggregateArgs(args);

    expect(parsed.input.codevo.clean).toHaveLength(3);
    expect(parsed.input.vscode.clean).toHaveLength(3);
    expect(parsed.input.codevo.confirmation).toBe("/captures/codevo-confirm.json");
  });

  it.each([
    [[], /Exactly three/],
    [["--codevo-clean", "relative.json"], /absolute/],
    [["--unknown", "/capture.json"], /Unknown/],
    [["--output"], /requires/],
  ])("rejects malformed arguments %#", (args, expected) => {
    expect(() => parseAggregateArgs(args)).toThrow(expected);
  });

  it("rejects repeated singleton flags", () => {
    expect(() =>
      parseAggregateArgs([...validArgs(), "--codevo-confirmation", "/captures/another.json"]),
    ).toThrow(/only once/);
  });
});

describe("aggregate perf runs CLI output", () => {
  it("never opens an input path as aggregate output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codevo-perf-aggregate-cli-"));
    roots.push(root);
    const input = path.join(root, "input.json");
    await writeFile(input, "{}", "utf8");

    await expect(
      runAggregateCli(
        [
          "--codevo-clean",
          input,
          "--codevo-clean",
          input,
          "--codevo-clean",
          input,
          "--codevo-confirmation",
          input,
          "--vscode-clean",
          input,
          "--vscode-clean",
          input,
          "--vscode-clean",
          input,
          "--vscode-confirmation",
          input,
          "--output",
          input,
        ],
        { aggregate: async () => ({ schemaVersion: 1 }) },
      ),
    ).rejects.toThrow(/must not overwrite or alias/);
    await expect(writeFile(input, "still exists", { flag: "wx" })).rejects.toMatchObject({
      code: "EEXIST",
    });
  });

  it("cleans an exclusive temporary file when publication fails", async () => {
    const events = [];
    const descriptor = {
      writeFile: async () => {
        throw new Error("injected write failure");
      },
      sync: async () => events.push("sync"),
      close: async () => events.push("close"),
    };

    await expect(
      writeAggregateArtifactExclusive("/captures/aggregate.json", "{}\n", {
        openFile: async (temporaryPath, flag, mode) => {
          events.push(["open", temporaryPath, flag, mode]);
          return descriptor;
        },
        linkFile: async () => events.push("link"),
        unlinkFile: async (temporaryPath) => events.push(["unlink", temporaryPath]),
        createId: () => "fixed",
      }),
    ).rejects.toThrow(/injected write failure/);
    expect(events).toEqual([
      ["open", "/captures/.aggregate.json.fixed.tmp", "wx", 0o600],
      "close",
      ["unlink", "/captures/.aggregate.json.fixed.tmp"],
    ]);
  });
});

function validArgs() {
  return [
    "--codevo-clean",
    "/captures/codevo-1.json",
    "--codevo-clean",
    "/captures/codevo-2.json",
    "--codevo-clean",
    "/captures/codevo-3.json",
    "--codevo-confirmation",
    "/captures/codevo-confirm.json",
    "--vscode-clean",
    "/captures/vscode-1.json",
    "--vscode-clean",
    "/captures/vscode-2.json",
    "--vscode-clean",
    "/captures/vscode-3.json",
    "--vscode-confirmation",
    "/captures/vscode-confirm.json",
  ];
}
