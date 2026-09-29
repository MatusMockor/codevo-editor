import { describe, expect, it } from "vitest";
import { ideActivitySummary } from "./ideActivity";
import { initialIndexProgress, type IndexProgressState } from "./indexProgress";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "./languageServerRuntime";

const ROOT = "/workspace";

function running(rootPath = ROOT): LanguageServerRuntimeStatus {
  return {
    capabilities: emptyLanguageServerCapabilities(),
    kind: "running",
    rootPath,
    sessionId: 1,
  };
}

function starting(rootPath = ROOT): LanguageServerRuntimeStatus {
  return { kind: "starting", rootPath, sessionId: 2 };
}

function index(overrides: Partial<IndexProgressState>): IndexProgressState {
  return { ...initialIndexProgress(), rootPath: ROOT, ...overrides };
}

describe("ideActivitySummary", () => {
  it("reports nothing while every engine is settled", () => {
    expect(
      ideActivitySummary(ROOT, null, running(), index({ status: "completed", indexedFiles: 12 })),
    ).toBeNull();
    expect(ideActivitySummary(ROOT, null, null, initialIndexProgress())).toBeNull();
  });

  it("names the TypeScript server while it starts for this workspace only", () => {
    expect(ideActivitySummary(ROOT, null, starting(), initialIndexProgress())).toEqual({
      kind: "busy",
      text: "Starting TypeScript…",
    });
    expect(ideActivitySummary(ROOT, null, starting("/other"), initialIndexProgress())).toBeNull();
  });

  it("names indexing with progress when the total is known", () => {
    expect(
      ideActivitySummary(
        ROOT,
        null,
        running(),
        index({ status: "scanning", processedFiles: 40, totalFiles: 100 }),
      ),
    ).toEqual({ kind: "busy", text: "Indexing 40%…" });
    expect(ideActivitySummary(ROOT, null, null, index({ status: "scanning" }))).toEqual({
      kind: "busy",
      text: "Indexing…",
    });
  });

  it("ignores runtimes without a root and index progress for another or no workspace", () => {
    expect(
      ideActivitySummary(
        ROOT,
        { kind: "starting", sessionId: 3 },
        { kind: "crashed", message: "boom" },
        initialIndexProgress(),
      ),
    ).toBeNull();
    expect(
      ideActivitySummary(ROOT, null, null, index({ rootPath: "/other", status: "failed" })),
    ).toBeNull();
    expect(
      ideActivitySummary(ROOT, null, null, index({ rootPath: "/other", status: "scanning" })),
    ).toBeNull();
    expect(
      ideActivitySummary(ROOT, null, null, index({ rootPath: null, erroredEntries: 2 })),
    ).toBeNull();
  });

  it("prefers a failure with its reason over busy work", () => {
    const crashed: LanguageServerRuntimeStatus = {
      kind: "crashed",
      message: "tsserver exited with code 1",
      rootPath: ROOT,
    };

    expect(ideActivitySummary(ROOT, null, crashed, index({ status: "scanning" }))).toEqual({
      kind: "problem",
      text: "TypeScript crashed",
      reason: "tsserver exited with code 1",
    });
    expect(
      ideActivitySummary(ROOT, null, null, index({ status: "failed", message: "disk full" })),
    ).toEqual({ kind: "problem", text: "Indexing failed", reason: "disk full" });
    expect(
      ideActivitySummary(ROOT, null, null, index({ status: "completed", erroredEntries: 3 })),
    ).toEqual({ kind: "problem", text: "3 files not indexed", reason: null });
  });
});
