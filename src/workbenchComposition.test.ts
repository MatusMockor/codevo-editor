// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { LiveDocumentRuntime } from "./application/liveDocumentRuntime";
import { TauriIncrementalLanguageServerDocumentSyncGateway } from "./infrastructure/tauriIncrementalLanguageServerDocumentSyncGateway";
import { TauriAgentProviderGateway } from "./infrastructure/tauriAgentProviderGateway";
import { TauriAgentProviderSignInGateway } from "./infrastructure/tauriAgentProviderSignInGateway";
import { TauriAgentCliDiscoveryGateway } from "./infrastructure/tauriAgentCliDiscoveryGateway";
import { TauriAppUpdaterGateway } from "./infrastructure/tauriAppUpdaterGateway";
import { BrowserTextClipboardGateway } from "./infrastructure/browserTextClipboardGateway";
import packageMetadata from "../package.json";
import {
  CODEVO_APP_VERSION,
  createWorkbenchComposition,
  workbenchComposition,
} from "./workbenchComposition";

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
    expect(first.agentProviderSignInGateway).toBeInstanceOf(TauriAgentProviderSignInGateway);
    expect(first.agentProviderSignInGateway).not.toBe(second.agentProviderSignInGateway);
    expect(first.agentCliDiscoveryGateway).toBeInstanceOf(TauriAgentCliDiscoveryGateway);
    expect(first.agentCliDiscoveryGateway).not.toBe(second.agentCliDiscoveryGateway);
    expect("agentCliVersionGateway" in first).toBe(false);
  });

  it("constructs the updater from the package-authoritative application version", () => {
    const first = createWorkbenchComposition();
    const second = createWorkbenchComposition();

    expect(CODEVO_APP_VERSION).toBe(packageMetadata.version);
    expect(first.appUpdater.appVersion).toBe(packageMetadata.version);
    expect(first.appUpdater.appUpdaterGateway).toBeInstanceOf(TauriAppUpdaterGateway);
    expect(first.appUpdater.appUpdaterGateway).not.toBe(second.appUpdater.appUpdaterGateway);
    expect(Object.keys(first.appUpdater).sort()).toEqual(["appUpdaterGateway", "appVersion"]);
  });

  it("owns one text clipboard instance per workbench composition", () => {
    const first = createWorkbenchComposition();
    const second = createWorkbenchComposition();

    expect(first.debugTextClipboard).toBeInstanceOf(BrowserTextClipboardGateway);
    expect(first.debugTextClipboard).toBe(first.debugTextClipboard);
    expect(first.debugTextClipboard).not.toBe(second.debugTextClipboard);
  });
});
