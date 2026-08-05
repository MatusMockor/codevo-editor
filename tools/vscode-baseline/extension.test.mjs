import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  PERF_CAPTURE_CONTRACT,
  PERF_CAPTURE_CONTRACT_METADATA,
  validateCaptureRun,
} from "../../scripts/perf/perfCaptureContract.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const originalEnvironment = { ...process.env };

function loadExtension() {
  const source = readFileSync(path.join(directory, "extension.js"), "utf8");
  const nativeRequire = createRequire(import.meta.url);
  const module = { exports: {} };
  const localRequire = (id) => (id === "vscode" ? { version: "1.131.0" } : nativeRequire(id));
  const evaluate = new Function("require", "module", "exports", "__dirname", source);
  evaluate(localRequire, module, module.exports, directory);
  return module.exports.__test;
}

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("VS Code capture contract metadata", () => {
  it("uses the canonical version and hash rather than a hand-maintained copy", () => {
    const extension = loadExtension();
    expect(extension.CAPTURE_CONTRACT_METADATA).toEqual(PERF_CAPTURE_CONTRACT_METADATA);
  });

  it("annotates provider measurements as warm and informational-asymmetric", () => {
    const extension = loadExtension();
    const scenario = extension.scenarioResult({
      id: "definition-medium-2k",
      cutPoint: "provider-command-resolved",
      warmups: 2,
      targets: ["ExampleKind"],
      samples: [{ ms: 2, resultCount: 1 }],
      method: "executeDefinitionProvider",
      languageServerStatus: "running",
    });
    expect(scenario).toMatchObject({
      comparisonKind: "informational-asymmetric",
      cacheState: "warm-explicit",
      workScope: "editor-specific-provider-result",
    });
  });

  it("records large-file support as a capability observation without latency samples", () => {
    const extension = loadExtension();
    expect(
      extension.capabilityResult("definition-large-20k", "provider", 1, "running"),
    ).toMatchObject({
      cutPoint: "capability-observation",
      comparisonKind: "capability",
      cacheState: "policy-observation",
      samples: [],
      status: "ok",
    });
  });

  it("bounds error metadata and replaces an oversized result before atomic publication", () => {
    const extension = loadExtension();
    const failure = extension.failureResult("harness", "invalid", "é".repeat(10_000));
    expect(Buffer.byteLength(failure.error, "utf8")).toBeLessThanOrEqual(
      PERF_CAPTURE_CONTRACT.limits.maxMetadataStringBytes,
    );

    const serialized = extension.serializeCaptureOutput({ editor: "vscode" }, [
      { id: "oversized", payload: "x".repeat(9 * 1024 * 1024) },
    ]);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThan(
      PERF_CAPTURE_CONTRACT.limits.maxCaptureJsonBytes,
    );
    expect(JSON.parse(serialized).scenarios).toEqual([
      expect.objectContaining({ id: "harness", status: "invalid" }),
    ]);
  });

  it("removes only its owned temporary output when atomic publication fails", () => {
    const extension = loadExtension();
    const removed = [];
    const fileSystem = {
      writeFileSync() {},
      renameSync() {
        throw new Error("rename failed");
      },
      rmSync(filePath) {
        removed.push(filePath);
      },
    };
    expect(() =>
      extension.writeCaptureOutputAtomic("/tmp/result.json", {}, [], {
        fileSystem,
        temporarySuffix: "owned-token",
      }),
    ).toThrow(/rename failed/);
    expect(removed).toEqual(["/tmp/result.json.writing-owned-token"]);
  });

  it("removes its uniquely owned temporary output when the write partially fails", () => {
    const extension = loadExtension();
    const removed = [];
    const fileSystem = {
      writeFileSync() {
        throw new Error("disk full after partial write");
      },
      renameSync() {
        throw new Error("must not rename");
      },
      rmSync(filePath) {
        removed.push(filePath);
      },
    };
    expect(() =>
      extension.writeCaptureOutputAtomic("/tmp/result.json", {}, [], {
        fileSystem,
        temporarySuffix: "owned-partial",
      }),
    ).toThrow(/disk full/);
    expect(removed).toEqual(["/tmp/result.json.writing-owned-partial"]);
  });

  it("emits truthful production-instrumented provenance while keeping UI state unknown", () => {
    process.env.CODEVO_BASELINE_SOURCE_REVISION = "a".repeat(40);
    process.env.CODEVO_BASELINE_ARTIFACT_SHA256 = "b".repeat(64);
    process.env.CODEVO_BASELINE_EXECUTABLE_IDENTITY = "/Applications/Visual Studio Code.app";
    const extension = loadExtension();
    const environment = extension.buildEnvironment(0.001);
    const scenario = extension.scenarioResult({
      id: "file-search-engine",
      cutPoint: "file-search-engine",
      warmups: 2,
      targets: ["index"],
      samples: [{ ms: 2, resultCount: 1 }],
      method: "workspace.findFiles",
    });
    const reasons = validateCaptureRun(
      {
        captureContract: extension.CAPTURE_CONTRACT_METADATA,
        environment,
        scenarios: [scenario],
      },
      { expectedEditor: "vscode", enforceCanonicalScenarios: false },
    );
    expect(reasons).toEqual([]);
    expect(environment).toMatchObject({
      bundleMode: "production",
      captureFlavor: "production-instrumented",
      launchState: "cold-fresh-profile",
      workspaceState: "fixture-clean",
      windowMode: "unknown",
    });
    expect(environment).not.toHaveProperty("windowSize");
  });
});
