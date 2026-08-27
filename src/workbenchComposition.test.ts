// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { LiveDocumentRuntime } from "./application/liveDocumentRuntime";
import { TauriIncrementalLanguageServerDocumentSyncGateway } from "./infrastructure/tauriIncrementalLanguageServerDocumentSyncGateway";
import { TauriAgentProviderGateway } from "./infrastructure/tauriAgentProviderGateway";
import { createWorkbenchComposition, workbenchComposition } from "./workbenchComposition";

describe("workbench live-document runtime composition", () => {
  it("owns one stable runtime for the exported workbench composition", () => {
    expect(workbenchComposition.liveDocumentRuntime).toBeInstanceOf(LiveDocumentRuntime);
    expect(workbenchComposition.liveDocumentRuntime).toBe(workbenchComposition.liveDocumentRuntime);
  });

  it("does not share a runtime between independently created workbenches", () => {
    const first = createWorkbenchComposition();
    const second = createWorkbenchComposition();

    expect(first.liveDocumentRuntime).toBeInstanceOf(LiveDocumentRuntime);
    expect(second.liveDocumentRuntime).toBeInstanceOf(LiveDocumentRuntime);
    expect(first.liveDocumentRuntime).not.toBe(second.liveDocumentRuntime);
    expect(first.liveDocumentRuntime).not.toBe(workbenchComposition.liveDocumentRuntime);
  });

  it("constructs one independent bounded incremental JS/TS document-sync gateway per workbench", () => {
    const first = createWorkbenchComposition();
    const second = createWorkbenchComposition();

    expect(first.javaScriptTypeScriptIncrementalLanguageServerDocumentSyncGateway).toBeInstanceOf(
      TauriIncrementalLanguageServerDocumentSyncGateway,
    );
    expect(first.javaScriptTypeScriptIncrementalLanguageServerDocumentSyncGateway).not.toBe(
      second.javaScriptTypeScriptIncrementalLanguageServerDocumentSyncGateway,
    );
  });

  it("constructs one independent provider gateway per workbench", () => {
    const first = createWorkbenchComposition();
    const second = createWorkbenchComposition();

    expect(first.agentProviderGateway).toBeInstanceOf(TauriAgentProviderGateway);
    expect(first.agentProviderGateway).not.toBe(second.agentProviderGateway);
  });
});
