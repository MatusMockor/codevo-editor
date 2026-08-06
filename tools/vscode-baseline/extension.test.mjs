import { existsSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PERF_CAPTURE_CONTRACT,
  PERF_CAPTURE_CONTRACT_METADATA,
  validateCaptureRun,
} from "../../scripts/perf/perfCaptureContract.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const originalEnvironment = { ...process.env };

function loadExtension(vscodeApi = { version: "1.131.0" }) {
  const source = readFileSync(path.join(directory, "extension.js"), "utf8");
  const nativeRequire = createRequire(import.meta.url);
  const module = { exports: {} };
  const localRequire = (id) => (id === "vscode" ? vscodeApi : nativeRequire(id));
  const evaluate = new Function("require", "module", "exports", "__dirname", source);
  evaluate(localRequire, module, module.exports, directory);
  return module.exports.__test;
}

afterEach(() => {
  process.env = { ...originalEnvironment };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("VS Code capture contract metadata", () => {
  it("uses the canonical version and hash rather than a hand-maintained copy", () => {
    const extension = loadExtension();
    expect(extension.CAPTURE_CONTRACT_METADATA).toEqual(PERF_CAPTURE_CONTRACT_METADATA);
  });

  it("accepts only a finite strictly positive bounded timer quantum", () => {
    const extension = loadExtension();
    const readings = [100, 100, 100.25, 100.75];
    expect(extension.measureTimerQuantizationMs(3, () => readings.shift())).toBe(0.25);
    expect(extension.buildEnvironment(0.25).timerQuantizationMs).toBe(0.25);
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => extension.buildEnvironment(invalid)).toThrow(
        /finite, strictly positive value of at most 1000 ms/,
      );
    }
    expect(() => extension.buildEnvironment(1000.001)).toThrow(/at most 1000 ms/);
  });

  it("fails clearly instead of emitting zero when timer calibration sees no positive delta", () => {
    const extension = loadExtension();
    expect(() => extension.measureTimerQuantizationMs(4, () => 42)).toThrow(
      /timer quantization calibration.*observed Infinity/i,
    );
  });

  it("closes without publishing a capture when timer calibration cannot establish a quantum", async () => {
    const outputPath = "/tmp/codevo-vscode-invalid-timer-test-" + randomUUID() + ".json";
    rmSync(outputPath, { force: true });
    process.env.CODEVO_BASELINE_OUT = outputPath;
    vi.stubGlobal("performance", { now: () => 42 });
    const executeCommand = vi.fn(async () => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const extension = loadExtension({ version: "1.131.0", commands: { executeCommand } });

    try {
      extension.activate({});

      await expect.poll(() => executeCommand.mock.calls.length).toBe(1);
      expect(executeCommand).toHaveBeenCalledWith("workbench.action.closeWindow");
      expect(error).toHaveBeenCalledWith(
        expect.stringMatching(/timer quantization calibration.*observed Infinity/i),
      );
      expect(existsSync(outputPath)).toBe(false);
    } finally {
      rmSync(outputPath, { force: true });
    }
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

  it("records 20k provider work as informational latency with real samples", () => {
    const extension = loadExtension();
    expect(
      extension.scenarioResult({
        id: "definition-large-20k",
        cutPoint: "provider-command-resolved",
        warmups: 2,
        targets: ["ExampleKind"],
        samples: [{ ms: 7, resultCount: 1 }],
        method: "provider",
        languageServerStatus: "running",
      }),
    ).toMatchObject({
      comparisonKind: "informational-asymmetric",
      cacheState: "warm-explicit",
      workScope: "editor-specific-provider-result",
      samples: [{ ms: 7, resultCount: 1 }],
      p50: 7,
      p95: 7,
      status: "ok",
    });
  });

  it("measures the 20k provider after warmup instead of reducing it to a capability flag", async () => {
    const extension = loadExtension();
    const results = [];
    let calls = 0;
    await extension.captureProviderScenario(results, {
      id: "definition-large-20k",
      method: "provider",
      languageServerStatus: "running",
      targets: Array.from({ length: 10 }, (_, index) => "Kind" + index),
      countOf: (value) => value.length,
      invoke: async () => {
        calls += 1;
        return [{}];
      },
    });
    expect(calls).toBe(12);
    expect(results).toEqual([
      expect.objectContaining({
        id: "definition-large-20k",
        warmups: 2,
        samples: expect.arrayContaining([expect.objectContaining({ resultCount: 1 })]),
        status: "ok",
      }),
    ]);
    expect(results[0].samples).toHaveLength(10);
  });

  it("records 100k provider support as an observed capability without latency samples", () => {
    const extension = loadExtension();
    expect(
      extension.capabilityResult("definition-large-100k", "provider", 1, "running"),
    ).toMatchObject({
      cutPoint: "capability-observation",
      comparisonKind: "capability",
      cacheState: "capability-observation",
      workScope: "editor-specific-large-document-capability",
      samples: [],
      resultCount: 1,
      status: "ok",
    });
  });

  it("reports VS Code's observed 100k provider support without inheriting Codevo policy", async () => {
    const extension = loadExtension();
    const supported = [];
    await extension.captureProviderScenario(supported, {
      id: "definition-large-100k",
      method: "provider",
      languageServerStatus: "running",
      targets: Array.from({ length: 10 }, (_, index) => "Kind" + index),
      countOf: (value) => value.length,
      invoke: async () => [{}],
    });
    expect(supported).toEqual([
      expect.objectContaining({
        id: "definition-large-100k",
        resultCount: 1,
        samples: [],
        status: "ok",
      }),
    ]);

    const unsupported = [];
    await extension.captureProviderScenario(unsupported, {
      id: "definition-large-100k",
      method: "provider",
      languageServerStatus: "running",
      targets: Array.from({ length: 10 }, (_, index) => "Kind" + index),
      countOf: (value) => value.length,
      invoke: async () => [],
    });
    expect(unsupported).toEqual([
      expect.objectContaining({
        id: "definition-large-100k",
        status: "no-result",
        warmups: 0,
        samples: [],
        targets: [],
      }),
    ]);
    const genericFailure = extension.failureResult("definition-large-100k", "invalid", "failed");
    expect(genericFailure).not.toHaveProperty("warmups");
    expect(genericFailure).not.toHaveProperty("samples");
    expect(genericFailure).not.toHaveProperty("targets");
  });

  it("observes each 100k provider independently without a shared completion-readiness gate", async () => {
    const lines = [
      "",
      "",
      'export type ExampleKind = "a" | "b" | "c";',
      "export interface Example { readonly kind: ExampleKind; }",
    ];
    class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    }
    const document = {
      lineCount: 100_000,
      getText: () => {
        throw new Error("100k capability observations must not copy the full document");
      },
      lineAt: (lineNumber) => {
        if (lineNumber >= lines.length) {
          throw new Error("capability anchor discovery exceeded its local fixture window");
        }
        const text = lines[lineNumber];
        return {
          text,
          range: {
            start: new Position(lineNumber, 0),
            end: new Position(lineNumber, text.length),
          },
        };
      },
    };
    const calls = [];
    const vscodeApi = {
      version: "1.131.0",
      Position,
      Uri: { file: (filePath) => ({ fsPath: filePath }) },
      workspace: { openTextDocument: async () => document },
      commands: {
        executeCommand: async (command) => {
          calls.push(command);
          if (command === "vscode.executeCompletionItemProvider") return { items: [] };
          if (command === "vscode.executeDocumentRenameProvider") return { size: 1 };
          return [{}];
        },
      },
    };
    const extension = loadExtension(vscodeApi);
    const results = [];

    await extension.captureLspScenarios(results, "/fixture", "large-100k.ts", {
      completionBounded: null,
      completionUnbounded: "completion-large-100k",
      definition: "definition-large-100k",
      references: "references-large-100k",
      rename: "rename-large-100k",
    });

    expect(calls).toEqual([
      "vscode.executeCompletionItemProvider",
      "vscode.executeDefinitionProvider",
      "vscode.executeReferenceProvider",
      "vscode.executeDocumentRenameProvider",
    ]);
    expect(results).toEqual([
      expect.objectContaining({ id: "completion-large-100k", status: "no-result" }),
      expect.objectContaining({ id: "definition-large-100k", status: "ok", resultCount: 1 }),
      expect.objectContaining({ id: "references-large-100k", status: "ok", resultCount: 1 }),
      expect.objectContaining({ id: "rename-large-100k", status: "ok", resultCount: 1 }),
    ]);
  });

  it("emits canonical zero-shape capability no-result rows when bounded anchors are absent", async () => {
    class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    }
    const document = {
      lineCount: 1,
      getText: () => {
        throw new Error("100k capability observations must not copy the full document");
      },
      lineAt: () => ({
        text: "export const noCapabilityAnchor = true;",
        range: { start: new Position(0, 0), end: new Position(0, 39) },
      }),
    };
    const executeCommand = vi.fn(async () => {
      throw new Error("providers must not run without bounded anchors");
    });
    const extension = loadExtension({
      version: "1.131.0",
      Position,
      Uri: { file: (filePath) => ({ fsPath: filePath }) },
      workspace: { openTextDocument: async () => document },
      commands: { executeCommand },
    });
    const results = [];

    await extension.captureLspScenarios(results, "/fixture", "large-100k.ts", {
      completionBounded: null,
      completionUnbounded: "completion-large-100k",
      definition: "definition-large-100k",
      references: "references-large-100k",
      rename: "rename-large-100k",
    });

    expect(executeCommand).not.toHaveBeenCalled();
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result).toMatchObject({
        status: "no-result",
        warmups: 0,
        samples: [],
        targets: [],
      });
    }
    process.env.CODEVO_BASELINE_SOURCE_REVISION = "a".repeat(40);
    process.env.CODEVO_BASELINE_ARTIFACT_SHA256 = "b".repeat(64);
    process.env.CODEVO_BASELINE_EXECUTABLE_IDENTITY = "/Applications/Visual Studio Code.app";
    expect(
      validateCaptureRun(
        {
          captureContract: extension.CAPTURE_CONTRACT_METADATA,
          environment: extension.buildEnvironment(0.001),
          scenarios: results,
        },
        { expectedEditor: "vscode", enforceCanonicalScenarios: false },
      ),
    ).toEqual([]);
  });

  it("bounds an individual provider capability observation", async () => {
    const extension = loadExtension();
    await expect(
      extension.withTimeout(new Promise(() => {}), 1, "provider timed out"),
    ).rejects.toThrow("provider timed out");
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
      cutPoint: "workspace-find-files-resolved",
      warmups: 2,
      targets: Array(10).fill("index"),
      samples: Array.from({ length: 10 }, () => ({ ms: 2, resultCount: 1 })),
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
