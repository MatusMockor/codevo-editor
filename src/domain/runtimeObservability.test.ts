import { describe, expect, it } from "vitest";
import {
  formatRuntimeDebugBundle,
  formatRuntimeLatency,
  type RuntimeObservabilityReport,
} from "./runtimeObservability";

describe("formatRuntimeLatency", () => {
  it("renders sub-second latency in milliseconds", () => {
    expect(formatRuntimeLatency(42)).toBe("42 ms");
  });

  it("renders second-scale latency in seconds", () => {
    expect(formatRuntimeLatency(5000)).toBe("5.00 s");
  });
});

describe("formatRuntimeDebugBundle", () => {
  const report: RuntimeObservabilityReport = {
    rootPath: "/workspace",
    runtimes: [
      {
        kind: "phpactor",
        label: "PHPactor",
        lifecycle: "crashed",
        pid: 4242,
        crashReason: "phpactor exited unexpectedly.",
        stats: { memoryKb: 81920, cpuPercent: 3.5 },
        recentRequests: [
          { method: "textDocument/completion", latencyMs: 42, success: true },
          { method: "textDocument/hover", latencyMs: 5000, success: false },
        ],
        stderrTail: ["PHP Fatal error: boom", "Stack trace:"],
      },
    ],
  };

  it("includes project info, mode and per-runtime state", () => {
    const bundle = formatRuntimeDebugBundle(report, "fullSmart");

    expect(bundle).toContain("# Runtime debug bundle");
    expect(bundle).toContain("- Project: /workspace");
    expect(bundle).toContain("- Mode: fullSmart");
    expect(bundle).toContain("### PHPactor (phpactor)");
    expect(bundle).toContain("- PID: 4242");
    expect(bundle).toContain("- State: Crashed");
    expect(bundle).toContain("- Crash reason: phpactor exited unexpectedly.");
  });

  it("includes recent requests with latencies and outcomes", () => {
    const bundle = formatRuntimeDebugBundle(report, "fullSmart");

    expect(bundle).toContain("textDocument/completion — 42 ms (ok)");
    expect(bundle).toContain("textDocument/hover — 5.00 s (error)");
  });

  it("includes the stderr tail inline in a code block", () => {
    const bundle = formatRuntimeDebugBundle(report, "fullSmart");

    expect(bundle).toContain("PHP Fatal error: boom");
    expect(bundle).toContain("Stack trace:");
  });

  it("renders a placeholder when no runtimes exist", () => {
    const bundle = formatRuntimeDebugBundle(
      { rootPath: "/empty", runtimes: [] },
      "basic",
    );

    expect(bundle).toContain("_No managed runtimes for this project._");
    expect(bundle).toContain("- Mode: basic");
  });
});
