// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import packageMetadata from "../package.json";
import { sessionRestoreFlushRegistry } from "./application/sessionRestorePersistence";
import { TauriAgentCliDiscoveryGateway } from "./infrastructure/tauriAgentCliDiscoveryGateway";
import { TauriAgentProviderGateway } from "./infrastructure/tauriAgentProviderGateway";
import { TauriAgentProviderSignInGateway } from "./infrastructure/tauriAgentProviderSignInGateway";
import { TauriAgentQuestionGateway } from "./infrastructure/tauriAgentQuestionGateway";
import { TauriAgentRootLeaseGateway } from "./infrastructure/tauriAgentRootLeaseGateway";
import { TauriAgentTaskGateway } from "./infrastructure/tauriAgentTaskGateway";
import { TauriAgentTurnChangesGateway } from "./infrastructure/tauriAgentTurnChangesGateway";
import { TauriAppUpdaterGateway } from "./infrastructure/tauriAppUpdaterGateway";
import { SettingsAppUpdaterPreferencesGateway } from "./infrastructure/settingsAppUpdaterPreferencesGateway";
import { TauriGitWorktreeGateway } from "./infrastructure/tauriGitWorktreeGateway";
import { tauriWindowZoomGateway } from "./infrastructure/tauriWindowZoomGateway";
import { AGENT_APP_VERSION, createAgentAppComposition } from "./agentAppComposition";
import { standaloneAgentWorkbenchPorts } from "./agentWorkbenchPortsComposition";
import { RemoteRepositoryIdentityCoordinator } from "./application/remoteRepositoryIdentityCoordinator";

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

const AGENT_APP_COMPOSITION_KEYS = [
  "agentGateways",
  "agentSurfaceGateways",
  "agentWorkbenchPorts",
  "appUpdater",
  "gitGateway",
  "isBenignError",
  "nativeWindow",
  "nodePackageScriptsGateway",
  "quickInputCoordinator",
  "settingsGateway",
  "systemFontGateway",
  "terminalGateway",
  "vscodeProcessTasksGateway",
  "workbenchPrompter",
  "workspace",
  "workspaceRuntimeLifecycleGateway",
  "workspaceTrustGateway",
  "workspaceTrustPrompt",
];

function availableUpdate(rid: number, version: string) {
  updaterBridge.invoke.mockResolvedValueOnce("prepareBeforeRestart").mockResolvedValueOnce({
    kind: "available",
    rid,
    currentVersion: packageMetadata.version,
    version,
    date: null,
    body: null,
    rawJson: { version },
  });
  const update = {
    currentVersion: packageMetadata.version,
    version,
    download: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  updaterBridge.construct.mockReturnValueOnce(update);
  return update;
}

describe("agent app composition", () => {
  it("constructs only the gateways the agent app keeps", () => {
    const composition = createAgentAppComposition();

    expect(Object.keys(composition).sort()).toEqual(AGENT_APP_COMPOSITION_KEYS);
    expect(Object.keys(composition.workspace).sort()).toEqual([
      "fileChanges",
      "fileSearch",
      "files",
      "identity",
      "ownerFiles",
    ]);
    expect(Object.keys(composition.agentSurfaceGateways).sort()).toEqual([
      "fileChanges",
      "fileSearch",
      "gitBranchGateway",
      "gitHistoryGateway",
      "questionGateway",
    ]);
    const keys = JSON.stringify(Object.keys({ ...composition, ...composition.agentGateways }));
    expect(keys).not.toMatch(
      /languageServer|javaScriptTypeScript|jsTest|php|eslint|prettier|pint|index|smartMode|localHistory|liveDocument|cursorStore|dirtyClose|artisan|nette|symfony|runtimeObservability|packageOperations/i,
    );
  });

  it("composes the workbench adapter ports once per composition", () => {
    const first = createAgentAppComposition().agentWorkbenchPorts;
    const second = createAgentAppComposition().agentWorkbenchPorts;

    expect(Object.keys(first).sort()).toEqual([
      "artifactFileLocator",
      "artifactLoader",
      "artifactPreview",
      "codexRateLimitResets",
      "directoryListing",
      "filePreviewReader",
      "imageSurface",
      "localClone",
      "outsideLinkedFiles",
      "projectCollapsePreference",
      "projectFocusPreference",
      "projectIdentity",
      "remoteAttachmentEncoder",
      "remoteCompareUrlOpener",
      "remoteGitSync",
      "remotePortPreview",
      "remoteRepositoryIdentity",
      "resolveWorkspaceHome",
      "revealPath",
      "rightPanelGateways",
      "sessionRestore",
      "textClipboard",
      "threadBranchMemory",
      "threadNotificationPorts",
      "workingSectionPreference",
    ]);
    expect(first.remoteRepositoryIdentity).toBeInstanceOf(RemoteRepositoryIdentityCoordinator);
    expect(second.remoteRepositoryIdentity).not.toBe(first.remoteRepositoryIdentity);
    expect(standaloneAgentWorkbenchPorts()).toBe(standaloneAgentWorkbenchPorts());
    expect(standaloneAgentWorkbenchPorts()).not.toBe(first);
  });

  it("hands the agent controller its gateways and shares the identity-aware file search", () => {
    const composition = createAgentAppComposition();
    const { agentGateways } = composition;

    expect(agentGateways.windowZoomGateway).toBe(tauriWindowZoomGateway);
    expect(agentGateways.agentRootLeaseGateway).toBeInstanceOf(TauriAgentRootLeaseGateway);
    expect(agentGateways.agentTaskGateway).toBeInstanceOf(TauriAgentTaskGateway);
    expect(agentGateways.gitWorktreeGateway).toBeInstanceOf(TauriGitWorktreeGateway);
    expect(agentGateways.turnChangesGateway).toBeInstanceOf(TauriAgentTurnChangesGateway);
    expect(agentGateways.agentCliDiscoveryGateway).toBeInstanceOf(TauriAgentCliDiscoveryGateway);
    expect("agentCliVersionGateway" in agentGateways).toBe(false);
    expect(composition.agentSurfaceGateways.fileSearch).toBe(composition.workspace.fileSearch);
    expect(composition.agentSurfaceGateways.fileChanges).toBe(composition.workspace.fileChanges);
  });

  it("constructs independent provider and question gateways per composition", () => {
    const first = createAgentAppComposition();
    const second = createAgentAppComposition();

    expect(first.agentGateways.agentProviderGateway).toBeInstanceOf(TauriAgentProviderGateway);
    expect(first.agentGateways.agentProviderGateway).not.toBe(
      second.agentGateways.agentProviderGateway,
    );
    expect(first.agentGateways.agentProviderSignInGateway).toBeInstanceOf(
      TauriAgentProviderSignInGateway,
    );
    const question = first.agentSurfaceGateways.questionGateway;
    expect(question).toBeInstanceOf(TauriAgentQuestionGateway);
    expect(question?.answerApproval).toBeTypeOf("function");
    expect(second.agentSurfaceGateways.questionGateway).not.toBe(question);
  });

  it("constructs the updater from the package version", () => {
    const first = createAgentAppComposition();
    const second = createAgentAppComposition();

    expect(AGENT_APP_VERSION).toBe(packageMetadata.version);
    expect(first.appUpdater.appVersion).toBe(packageMetadata.version);
    expect(first.appUpdater.appUpdaterGateway).toBeInstanceOf(TauriAppUpdaterGateway);
    expect(first.appUpdater.appUpdaterPreferencesGateway).toBeInstanceOf(
      SettingsAppUpdaterPreferencesGateway,
    );
    expect(first.appUpdater.appUpdaterGateway).not.toBe(second.appUpdater.appUpdaterGateway);
  });

  it("asks Rust for the install mode before installing a downloaded update", async () => {
    const update = availableUpdate(4, "9.0.0");
    const gateway = createAgentAppComposition().appUpdater.appUpdaterGateway;
    const result = await gateway.check();
    expect(result.kind).toBe("available");
    if (result.kind !== "available") return;

    await expect(gateway.download(result.candidate.candidateRevision)).resolves.toBe(
      "readyToRestart",
    );

    expect(updaterBridge.invoke).toHaveBeenCalledWith("app_update_check");
    expect(updaterBridge.invoke).toHaveBeenCalledWith("app_update_install_mode");
    expect(update.install).toHaveBeenCalledOnce();
    expect(updaterBridge.relaunch).not.toHaveBeenCalled();
    await gateway.dispose();
  });

  it("writes pending session-restore state before relaunching into an installed update", async () => {
    availableUpdate(5, "9.0.1");
    const order: string[] = [];
    const unregister = sessionRestoreFlushRegistry.register(() => order.push("flush"));
    updaterBridge.relaunch.mockImplementationOnce(async () => {
      order.push("relaunch");
    });
    const gateway = createAgentAppComposition().appUpdater.appUpdaterGateway;
    const result = await gateway.check();
    expect(result.kind).toBe("available");
    if (result.kind !== "available") return;

    await gateway.installAndRestart(result.candidate.candidateRevision);

    unregister();
    expect(order).toEqual(["flush", "relaunch"]);
    await gateway.dispose();
  });

  it("purges stored state of the removed debugger when the composition module loads", async () => {
    window.localStorage.setItem("mockor.debug.breakpoints./workspace", "[]");
    window.localStorage.setItem("mockor.settings.keep", "{}");
    vi.resetModules();

    await import("./agentAppComposition");

    expect(window.localStorage.getItem("mockor.debug.breakpoints./workspace")).toBeNull();
    expect(window.localStorage.getItem("mockor.settings.keep")).toBe("{}");
  });

  it("owns one updater in the agent controller and shares it with the agent screen and toasts", () => {
    const app = readFileSync(resolve(import.meta.dirname, "./AgentApp.tsx"), "utf8");
    const controller = readFileSync(
      resolve(import.meta.dirname, "./application/agentApp/useAgentAppController.ts"),
      "utf8",
    );
    const overlays = readFileSync(
      resolve(import.meta.dirname, "./components/agentApp/AgentOverlayDialogsHost.tsx"),
      "utf8",
    );

    expect(controller.match(/useAppUpdater\(/gu)).toHaveLength(1);
    expect(app).toContain("<AppUpdaterContext.Provider value={workbench.appUpdater}>");
    expect(app.match(/appUpdater=\{workbench\.appUpdater\}/gu)).toHaveLength(1);
    expect(overlays).not.toContain("useAppUpdater(");
    expect(overlays).toContain("presentAppUpdateToast(appUpdater.state)");
    expect(overlays.search(/<NoticeToastHost\b/u)).toBeLessThan(
      overlays.search(/<AgentSettingsHost\b/u),
    );
  });
});
