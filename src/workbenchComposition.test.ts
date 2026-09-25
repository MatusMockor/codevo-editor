// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { LiveDocumentRuntime } from "./application/liveDocumentRuntime";
import { TauriIncrementalLanguageServerDocumentSyncGateway } from "./infrastructure/tauriIncrementalLanguageServerDocumentSyncGateway";
import { TauriAgentProviderGateway } from "./infrastructure/tauriAgentProviderGateway";
import { TauriAgentProviderSignInGateway } from "./infrastructure/tauriAgentProviderSignInGateway";
import { TauriAgentCliDiscoveryGateway } from "./infrastructure/tauriAgentCliDiscoveryGateway";
import { TauriAgentTurnChangesGateway } from "./infrastructure/tauriAgentTurnChangesGateway";
import { TauriAgentTaskGateway } from "./infrastructure/tauriAgentTaskGateway";
import { TauriGitWorktreeGateway } from "./infrastructure/tauriGitWorktreeGateway";
import { TauriAppUpdaterGateway } from "./infrastructure/tauriAppUpdaterGateway";
import { SettingsAppUpdaterPreferencesGateway } from "./infrastructure/settingsAppUpdaterPreferencesGateway";
import { BrowserTextClipboardGateway } from "./infrastructure/browserTextClipboardGateway";
import packageMetadata from "../package.json";
import {
  CODEVO_APP_VERSION,
  createWorkbenchComposition,
  workbenchComposition,
} from "./workbenchComposition";

const updaterBridge = vi.hoisted(() => {
  const construct = vi.fn();
  return {
    invoke: vi.fn(),
    construct,
    Update: vi.fn(function (metadata: unknown) {
      return construct(metadata);
    }),
    relaunch: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  invoke: updaterBridge.invoke,
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ Update: updaterBridge.Update }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: updaterBridge.relaunch }));

describe("workbench live-document runtime composition", () => {
  it("checks the single configured update source through Rust and prepares an update without restarting", async () => {
    updaterBridge.invoke.mockResolvedValueOnce("prepareBeforeRestart").mockResolvedValueOnce({
      kind: "available",
      rid: 4,
      currentVersion: packageMetadata.version,
      version: "9.0.0",
      date: null,
      body: null,
      rawJson: { version: "9.0.0" },
    });
    const update = {
      currentVersion: packageMetadata.version,
      version: "9.0.0",
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    updaterBridge.construct.mockReturnValueOnce(update);
    const gateway = createWorkbenchComposition().appUpdater.appUpdaterGateway;
    const result = await gateway.check();
    expect(result.kind).toBe("available");
    if (result.kind !== "available") return;
    expect(updaterBridge.invoke).toHaveBeenCalledWith("app_update_check");
    expect(
      updaterBridge.invoke.mock.calls.find(([command]) => command === "app_update_check"),
    ).toEqual(["app_update_check"]);
    expect(updaterBridge.construct).toHaveBeenCalledWith({
      rid: 4,
      currentVersion: packageMetadata.version,
      version: "9.0.0",
      rawJson: { version: "9.0.0" },
    });
    await expect(gateway.download(result.candidate.candidateRevision)).resolves.toBe(
      "readyToRestart",
    );
    expect(updaterBridge.invoke).toHaveBeenCalledWith("app_update_install_mode");
    expect(update.install).toHaveBeenCalledOnce();
    expect(updaterBridge.relaunch).not.toHaveBeenCalled();
    await gateway.dispose();
  });

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

  it("hands the identity-aware workspace file search to the agent surfaces", () => {
    const composition = createWorkbenchComposition();

    expect(composition.agentSurfaceGateways.fileSearch).toBe(
      composition.workspaceGateways.fileSearch,
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

  it("hands the agent task, worktree and turn changes gateways to the agent controller", () => {
    const composition = createWorkbenchComposition();

    expect(composition.agentControllerGateways.turnChangesGateway).toBeInstanceOf(
      TauriAgentTurnChangesGateway,
    );
    expect(composition.turnChangesGateway).toBe(
      composition.agentControllerGateways.turnChangesGateway,
    );
    expect(composition.agentControllerGateways.agentTaskGateway).toBeInstanceOf(
      TauriAgentTaskGateway,
    );
    expect(composition.agentControllerGateways.gitWorktreeGateway).toBeInstanceOf(
      TauriGitWorktreeGateway,
    );
  });

  it("constructs the updater from the package-authoritative application version", () => {
    const first = createWorkbenchComposition();
    const second = createWorkbenchComposition();

    expect(CODEVO_APP_VERSION).toBe(packageMetadata.version);
    expect(first.appUpdater.appVersion).toBe(packageMetadata.version);
    expect(first.appUpdater.appUpdaterGateway).toBeInstanceOf(TauriAppUpdaterGateway);
    expect(first.appUpdater.appUpdaterPreferencesGateway).toBeInstanceOf(
      SettingsAppUpdaterPreferencesGateway,
    );
    expect(first.appUpdater.appUpdaterGateway).not.toBe(second.appUpdater.appUpdaterGateway);
    expect(Object.keys(first.appUpdater).sort()).toEqual([
      "appUpdaterGateway",
      "appUpdaterPreferencesGateway",
      "appVersion",
    ]);
  });

  it("owns one text clipboard instance per workbench composition", () => {
    const first = createWorkbenchComposition();
    const second = createWorkbenchComposition();

    expect(first.debugTextClipboard).toBeInstanceOf(BrowserTextClipboardGateway);
    expect(first.debugTextClipboard).toBe(first.debugTextClipboard);
    expect(first.debugTextClipboard).not.toBe(second.debugTextClipboard);
  });
});
