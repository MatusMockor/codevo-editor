import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PERF_CAPTURE_CONTRACT,
  PERF_CAPTURE_CONTRACT_METADATA,
  validateCaptureRun,
} from "../../scripts/perf/perfCaptureContract.mjs";
import {
  captureExitBeforeOutputError,
  readBoundedCaptureFile,
  readBoundedJsonFile,
  resolveExecutableIdentity,
  terminateOwnedProcessTree,
  validateCapturedScenarios,
} from "./run.mjs";

const scratchDirectories = [];
const LARGE_FILE_IDS = [
  "tab-switch-cycle",
  "typing-large-5k",
  "typing-large-20k",
  "typing-large-100k",
  "completion-bounded",
  "completion-unbounded",
  "definition-medium-2k",
  "references-medium-2k",
  "rename-medium-2k",
  "completion-large-20k",
  "definition-large-20k",
  "references-large-20k",
  "rename-large-20k",
  "completion-large-100k",
  "definition-large-100k",
  "references-large-100k",
  "rename-large-100k",
];

function capture(ids = LARGE_FILE_IDS) {
  return {
    environment: { editor: "vscode" },
    scenarios: ids.map((id) => ({ id, status: "ok" })),
  };
}

function canonicalEnvironment() {
  return {
    editor: "vscode",
    version: "1.131.0",
    bundleMode: "production",
    captureFlavor: "production-instrumented",
    sourceRevision: "a".repeat(40),
    artifactSha256: "b".repeat(64),
    hostPlatform: "darwin",
    hostArch: "arm64",
    osRelease: "25.5.0",
    launchState: "cold-fresh-profile",
    workspaceState: "fixture-clean",
    timerQuantizationMs: 0.001,
    capturedAt: "2026-08-04T12:00:00.000Z",
  };
}

function canonicalScenario(contract) {
  const capability = contract.comparisonKind === "capability";
  const samples = Array.from({ length: contract.minSamples }, () => ({ ms: 1, resultCount: 1 }));
  return {
    id: contract.id,
    cutPoint: contract.cutPointByEditor.vscode,
    comparisonKind: contract.comparisonKind,
    cacheState: contract.cacheState,
    workScope: contract.workScope,
    warmups: contract.requiredWarmups,
    targets: Array(contract.requiredTargets).fill(contract.id),
    samples,
    ...(capability ? {} : { p50: 1, p95: 1 }),
    status: "ok",
  };
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("validateCapturedScenarios", () => {
  it("accepts the exact scenario partition for each fixture root", () => {
    expect(validateCapturedScenarios("large-files", capture()).scenarios).toHaveLength(17);
    expect(
      validateCapturedScenarios("monorepo", capture(["file-search-engine"])).scenarios,
    ).toHaveLength(1);
  });

  it("rejects duplicate scenario ids", () => {
    expect(() =>
      validateCapturedScenarios("large-files", capture([...LARGE_FILE_IDS, LARGE_FILE_IDS[0]])),
    ).toThrow(/duplicate scenario id/);
  });

  it("rejects foreign scenario ids in either fixture root", () => {
    expect(() =>
      validateCapturedScenarios("monorepo", capture(["file-search-engine", "typing-large-5k"])),
    ).toThrow(/foreign scenario id/);
    expect(() =>
      validateCapturedScenarios("large-files", capture([...LARGE_FILE_IDS, "future-scenario"])),
    ).toThrow(/foreign scenario id/);
  });

  it("rejects missing scenario ids", () => {
    expect(() =>
      validateCapturedScenarios("large-files", capture(LARGE_FILE_IDS.slice(1))),
    ).toThrow(/missing scenario ids: tab-switch-cycle/);
  });

  it("accepts the complete canonical VS Code scenario set for the frozen contract", () => {
    const scenarios = PERF_CAPTURE_CONTRACT.scenarios
      .filter((scenario) => scenario.cutPointByEditor.vscode !== null)
      .map(canonicalScenario);
    expect(
      validateCaptureRun(
        {
          captureContract: PERF_CAPTURE_CONTRACT_METADATA,
          environment: canonicalEnvironment(),
          scenarios,
        },
        { expectedEditor: "vscode" },
      ),
    ).toEqual([]);
  });
});

describe("readBoundedJsonFile", () => {
  it("parses an output within the configured byte limit", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "vscode-baseline-test-"));
    scratchDirectories.push(directory);
    const outputPath = path.join(directory, "result.json");
    writeFileSync(outputPath, '{"ok":true}\n');
    expect(readBoundedJsonFile(outputPath, 64)).toEqual({ ok: true });
  });

  it("rejects output before reading it when the byte limit is exceeded", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "vscode-baseline-test-"));
    scratchDirectories.push(directory);
    const outputPath = path.join(directory, "result.json");
    writeFileSync(outputPath, '{"payload":"too-large"}\n');
    expect(() => readBoundedJsonFile(outputPath, 8)).toThrow(/exceeds the 8 byte limit/);
  });

  it("rejects duplicate JSON object keys before accepting a capture", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "vscode-baseline-test-"));
    scratchDirectories.push(directory);
    const outputPath = path.join(directory, "result.json");
    writeFileSync(outputPath, '{"captureContract":{},"captureContract":{}}');
    expect(() => readBoundedCaptureFile(outputPath)).toThrow(/duplicate object key/);
  });

  it("accepts a contract-valid per-root capture without requiring the other root partition", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "vscode-baseline-test-"));
    scratchDirectories.push(directory);
    const outputPath = path.join(directory, "result.json");
    writeFileSync(
      outputPath,
      JSON.stringify({
        captureContract: PERF_CAPTURE_CONTRACT_METADATA,
        environment: canonicalEnvironment(),
        scenarios: [
          {
            id: "file-search-engine",
            cutPoint: "workspace-find-files-resolved",
            comparisonKind: "informational-asymmetric",
            cacheState: "warm-explicit",
            workScope: "asymmetric-codevo-fuzzy-ranked-vs-vscode-glob-substring",
            warmups: 2,
            targets: Array(10).fill("index"),
            samples: Array.from({ length: 10 }, () => ({ ms: 1, resultCount: 1 })),
            p50: 1,
            p95: 1,
            status: "ok",
          },
        ],
      }),
    );
    expect(readBoundedCaptureFile(outputPath).scenarios).toHaveLength(1);
  });

  it("accepts and partition-validates the complete large-files fragment", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "vscode-baseline-test-"));
    scratchDirectories.push(directory);
    const outputPath = path.join(directory, "result.json");
    const scenarios = PERF_CAPTURE_CONTRACT.scenarios
      .filter((scenario) => LARGE_FILE_IDS.includes(scenario.id))
      .map(canonicalScenario);
    writeFileSync(
      outputPath,
      JSON.stringify({
        captureContract: PERF_CAPTURE_CONTRACT_METADATA,
        environment: canonicalEnvironment(),
        scenarios,
      }),
    );
    const parsed = readBoundedCaptureFile(outputPath);
    expect(validateCapturedScenarios("large-files", parsed).scenarios).toHaveLength(17);
  });
});

describe("captureExitBeforeOutputError", () => {
  it("fails promptly and clearly when VS Code exits before publication", () => {
    const error = captureExitBeforeOutputError(
      "large-files",
      "/tmp/missing-vscode-capture.json",
      0,
      null,
      { existsSync: () => false },
    );
    expect(error?.message).toMatch(
      /large-files VS Code process exited before publishing.*exit code 0/i,
    );
  });

  it("does not replace a capture that was published before process exit", () => {
    expect(
      captureExitBeforeOutputError("large-files", "/tmp/result.json", 0, null, {
        existsSync: () => true,
      }),
    ).toBeNull();
  });
});

describe("resolveExecutableIdentity", () => {
  it("records the exact invoked executable path and a content digest", () => {
    const identity = resolveExecutableIdentity(process.execPath);
    expect(identity.realPath).toBe(path.resolve(process.execPath));
    expect(identity.artifactSha256).toMatch(/^[a-f\d]{64}$/);
  });

  it("attests the native macOS payload and product identity instead of only its CLI wrapper", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "vscode-baseline-test-"));
    scratchDirectories.push(directory);
    const appRoot = path.join(directory, "Visual Studio Code.app");
    const launcher = path.join(appRoot, "Contents/Resources/app/bin/code");
    const nativeExecutable = path.join(appRoot, "Contents/MacOS/Code");
    mkdirSync(path.dirname(launcher), { recursive: true });
    mkdirSync(path.dirname(nativeExecutable), { recursive: true });
    writeFileSync(launcher, "launcher-v1");
    writeFileSync(nativeExecutable, "native-v1");
    writeFileSync(path.join(appRoot, "Contents/Resources/app/product.json"), '{"name":"Code"}');
    writeFileSync(path.join(appRoot, "Contents/Resources/app/package.json"), '{"version":"1"}');

    const before = resolveExecutableIdentity(launcher);
    writeFileSync(nativeExecutable, "native-v2");
    const after = resolveExecutableIdentity(launcher);

    expect(before.command).toBe(realpathSync(launcher));
    expect(before.realPath).toBe(realpathSync(nativeExecutable));
    expect(before.artifactIdentity).toBe("macos-app-native+product+package+launcher");
    expect(after.artifactSha256).not.toBe(before.artifactSha256);
  });
});

describe("terminateOwnedProcessTree", () => {
  it.runIf(process.platform !== "win32")(
    "terminates only the explicitly owned process group",
    async () => {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        detached: true,
        stdio: "ignore",
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      await terminateOwnedProcessTree(child, 1000);
      expect(child.signalCode ?? child.exitCode).not.toBeNull();
    },
  );

  it.runIf(process.platform !== "win32")(
    "terminates an owned descendant even after the process-group leader exits",
    async () => {
      const leader = spawn(
        process.execPath,
        [
          "-e",
          [
            'const { spawn } = require("node:child_process");',
            'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
            "console.log(child.pid);",
            "child.unref();",
          ].join(" "),
        ],
        { detached: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      const descendantPid = await new Promise((resolve, reject) => {
        let output = "";
        leader.stdout.setEncoding("utf8");
        leader.stdout.on("data", (chunk) => {
          output += chunk;
        });
        leader.once("error", reject);
        leader.once("exit", () => resolve(Number(output.trim())));
      });
      expect(Number.isInteger(descendantPid)).toBe(true);
      expect(() => process.kill(descendantPid, 0)).not.toThrow();

      await terminateOwnedProcessTree(leader, 100);

      await expect
        .poll(() => {
          try {
            process.kill(descendantPid, 0);
            return true;
          } catch (error) {
            return error?.code !== "ESRCH";
          }
        })
        .toBe(false);
    },
  );

  it.runIf(process.platform !== "win32")(
    "escalates cleanup for an owned process that ignores graceful termination",
    async () => {
      const child = spawn(
        process.execPath,
        ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'],
        { detached: true, stdio: "ignore" },
      );
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      await terminateOwnedProcessTree(child, 100);

      expect(child.signalCode).toBe("SIGKILL");
    },
  );
});
