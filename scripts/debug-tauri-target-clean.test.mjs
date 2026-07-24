import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cleanTargetIfOversized,
  describeTargetClean,
  parseDuKilobytes,
  shouldCleanTarget,
  targetCleanThresholdBytes,
} from "./debug-tauri-target-clean.mjs";

const GIB = 1024 ** 3;

describe("parseDuKilobytes", () => {
  it("parses the leading kilobyte count from du -sk output", () => {
    expect(parseDuKilobytes("6501234\t/workspace/editor/src-tauri/target\n")).toBe(
      6501234 * 1024,
    );
  });

  it("returns null for unexpected output", () => {
    expect(parseDuKilobytes("")).toBeNull();
    expect(parseDuKilobytes("du: cannot access")).toBeNull();
  });
});

describe("targetCleanThresholdBytes", () => {
  it("defaults to 12 GiB", () => {
    expect(targetCleanThresholdBytes({})).toBe(12 * GIB);
  });

  it("honors CODEVO_EDITOR_TARGET_CLEAN_GB", () => {
    expect(targetCleanThresholdBytes({ CODEVO_EDITOR_TARGET_CLEAN_GB: "4" })).toBe(4 * GIB);
  });

  it("falls back to the default for invalid or blank values", () => {
    expect(targetCleanThresholdBytes({ CODEVO_EDITOR_TARGET_CLEAN_GB: "banana" })).toBe(12 * GIB);
    expect(targetCleanThresholdBytes({ CODEVO_EDITOR_TARGET_CLEAN_GB: "-3" })).toBe(12 * GIB);
    expect(targetCleanThresholdBytes({ CODEVO_EDITOR_TARGET_CLEAN_GB: "" })).toBe(12 * GIB);
    expect(targetCleanThresholdBytes({ CODEVO_EDITOR_TARGET_CLEAN_GB: "  " })).toBe(12 * GIB);
  });
});

describe("shouldCleanTarget", () => {
  it("cleans when the measured size exceeds the threshold", () => {
    expect(shouldCleanTarget({ forced: false, sizeBytes: 13 * GIB, thresholdBytes: 12 * GIB })).toBe(
      true,
    );
  });

  it("keeps the target below or at the threshold", () => {
    expect(shouldCleanTarget({ forced: false, sizeBytes: 12 * GIB, thresholdBytes: 12 * GIB })).toBe(
      false,
    );
  });

  it("always cleans when forced", () => {
    expect(shouldCleanTarget({ forced: true, sizeBytes: 0, thresholdBytes: 12 * GIB })).toBe(true);
  });

  it("never cleans when the size is unknown", () => {
    expect(
      shouldCleanTarget({ forced: false, sizeBytes: null, thresholdBytes: 12 * GIB }),
    ).toBe(false);
  });
});

describe("cleanTargetIfOversized", () => {
  const repoRoot = path.join(path.sep, "workspace", "editor");
  const targetDirectory = path.join(repoRoot, "src-tauri", "target");

  function recordingRun(duKilobytes) {
    const calls = [];
    const run = (command, commandArgs, options) => {
      calls.push({ command, commandArgs, options });
      if (command === "du") {
        return `${duKilobytes}\t${targetDirectory}\n`;
      }
      return "";
    };
    return { calls, run };
  }

  it("runs cargo clean inside src-tauri when the target is oversized", () => {
    const { calls, run } = recordingRun(20 * 1024 * 1024);

    const result = cleanTargetIfOversized({ env: {}, forced: false, repoRoot, run });

    expect(result).toEqual({ cleaned: true, sizeBytes: 20 * GIB });
    expect(calls[0]).toEqual({
      command: "du",
      commandArgs: ["-sk", targetDirectory],
      options: { encoding: "utf8" },
    });
    expect(calls[1].command).toBe("cargo");
    expect(calls[1].commandArgs).toEqual(["clean", "--target-dir", targetDirectory]);
    expect(calls[1].options.cwd).toBe(path.join(repoRoot, "src-tauri"));
  });

  it("leaves a small target untouched", () => {
    const { calls, run } = recordingRun(2 * 1024 * 1024);

    const result = cleanTargetIfOversized({ env: {}, forced: false, repoRoot, run });

    expect(result).toEqual({ cleaned: false, sizeBytes: 2 * GIB });
    expect(calls).toHaveLength(1);
  });

  it("cleans a small target when forced", () => {
    const { calls, run } = recordingRun(2 * 1024 * 1024);

    const result = cleanTargetIfOversized({ env: {}, forced: true, repoRoot, run });

    expect(result).toEqual({ cleaned: true, sizeBytes: 2 * GIB });
    expect(calls).toHaveLength(2);
  });

  it("skips cleaning when the size cannot be measured", () => {
    const calls = [];
    const run = (command, commandArgs, options) => {
      calls.push({ command, commandArgs, options });
      throw new Error("du failed");
    };

    const result = cleanTargetIfOversized({ env: {}, forced: false, repoRoot, run });

    expect(result).toEqual({ cleaned: false, sizeBytes: null });
    expect(calls).toHaveLength(1);
  });

  it("still cleans on a forced run when the size cannot be measured", () => {
    const calls = [];
    const run = (command, commandArgs, options) => {
      calls.push({ command, commandArgs, options });
      if (command === "du") {
        throw new Error("du failed");
      }
      return "";
    };

    const result = cleanTargetIfOversized({ env: {}, forced: true, repoRoot, run });

    expect(result).toEqual({ cleaned: true, sizeBytes: null });
    expect(calls).toHaveLength(2);
    expect(calls[1].commandArgs).toEqual(["clean", "--target-dir", targetDirectory]);
  });

  it("describes a completed clean with the reclaimed size", () => {
    expect(describeTargetClean({ cleaned: true, sizeBytes: 20 * GIB })).toBe(
      "Cleaned src-tauri/target (20.0 GiB) before the debug build.",
    );
    expect(describeTargetClean({ cleaned: true, sizeBytes: null })).toBe(
      "Cleaned src-tauri/target before the debug build.",
    );
    expect(describeTargetClean({ cleaned: false, sizeBytes: 20 * GIB })).toBeNull();
  });

  it("respects a lowered threshold from the environment", () => {
    const { calls, run } = recordingRun(2 * 1024 * 1024);

    const result = cleanTargetIfOversized({
      env: { CODEVO_EDITOR_TARGET_CLEAN_GB: "1" },
      forced: false,
      repoRoot,
      run,
    });

    expect(result).toEqual({ cleaned: true, sizeBytes: 2 * GIB });
    expect(calls).toHaveLength(2);
  });
});
