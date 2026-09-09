// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppUpdater } from "../application/useAppUpdater";
import type { AppUpdaterGateway } from "../domain/appUpdater";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import { waitForReact } from "../test/reactTestLifecycle";
import { settingsEnvironment } from "./settings/settingsEnvironment";
import { WorkbenchSettingsHost, type WorkbenchSettingsModel } from "./WorkbenchSettingsHost";
import type { NodeLaunchConfigurationFileGateway } from "./useNodeLaunchConfigurationsDialogController";

describe("WorkbenchSettingsHost", () => {
  let container: HTMLDivElement;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    container = document.createElement("div");
    document.body.append(host, container);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    container.remove();
  });

  it("hosts the Node launch configurations dialog for the owning workspace", async () => {
    const files = missingConfigurationGateway();
    const workbench = { ...settingsModel(), nodeLaunchConfigurationsOpen: true };
    await render(workbench, files);

    await waitForReact(() => expect(nodeLaunchDialog()).not.toBeNull());
    expect(files.readDirectory).toHaveBeenCalledWith("/workspace/a");

    clickButton("Close Node launch configurations");
    expect(workbench.closeNodeLaunchConfigurations).toHaveBeenCalledOnce();
  });

  it("reloads an open dialog for the newly selected workspace owner", async () => {
    const files = missingConfigurationGateway();
    await render({ ...settingsModel(), nodeLaunchConfigurationsOpen: true }, files);
    await waitForReact(() => expect(files.readDirectory).toHaveBeenCalledWith("/workspace/a"));

    await render({ ...settingsModel("b"), nodeLaunchConfigurationsOpen: true }, files);
    await waitForReact(() => expect(files.readDirectory).toHaveBeenCalledWith("/workspace/b"));

    expect(nodeLaunchDialog()).not.toBeNull();
  });

  it("keeps the Node launch dialog available while the settings route is closed", async () => {
    const files = missingConfigurationGateway();
    await render(
      { ...settingsModel(), nodeLaunchConfigurationsOpen: true, settingsOpen: false },
      files,
    );

    await waitForReact(() => expect(nodeLaunchDialog()).not.toBeNull());
    expect(container.querySelector(".settings-screen")).toBeNull();
  });

  it("renders the settings screen into the frame slot only while the route is open", async () => {
    await render({ ...settingsModel(), settingsOpen: false }, missingConfigurationGateway());

    expect(container.querySelector(".settings-screen")).toBeNull();

    await render(settingsModel(), missingConfigurationGateway());

    expect(container.querySelector(".settings-screen")).not.toBeNull();
    expect(host.querySelector(".settings-screen")).toBeNull();
  });

  it("remounts the screen for a workspace rekey so drafts never cross owners", async () => {
    await render(settingsModel(), missingConfigurationGateway());
    const first = container.querySelector(".settings-screen");

    await render(settingsModel("b"), missingConfigurationGateway());
    const second = container.querySelector(".settings-screen");

    await render(settingsModel(), missingConfigurationGateway());
    const third = container.querySelector(".settings-screen");

    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
  });

  it("restores focus to the previously active element when the route closes", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    await render(settingsModel(), missingConfigurationGateway());
    expect(document.activeElement?.textContent).toBe("Settings");

    await render({ ...settingsModel(), settingsOpen: false }, missingConfigurationGateway());
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  async function render(
    workbench: WorkbenchSettingsModel,
    workspaceFiles: NodeLaunchConfigurationFileGateway,
    appUpdaterGateway: AppUpdaterGateway = idleAppUpdaterGateway(),
  ) {
    await act(async () => {
      root.render(
        <ControlledSettingsHost
          appUpdaterGateway={appUpdaterGateway}
          container={container}
          workbench={workbench}
          workspaceFiles={workspaceFiles}
        />,
      );
      await Promise.resolve();
    });
  }
});

describe("settingsEnvironment", () => {
  it("maps the workbench model onto the closed settings page environment", () => {
    const workbench = settingsModel();
    const gateway = { listMonospaceFontFamilies: async () => [] };
    const env = settingsEnvironment({
      appUpdater: null,
      providerManagement: null,
      systemFontGateway: gateway,
      workbench: {
        ...workbench,
        gitRepositoryMappings: [{ rootRelativePath: "packages/api" }, { rootRelativePath: "" }],
      },
    });

    expect(env.gitDetectedRepositoryMappings).toEqual(["packages/api"]);
    expect(env.hasWorkspace).toBe(true);
    expect(env.workspaceRoot).toBe("/workspace/a");
    expect(env.systemFontGateway).toBe(gateway);
    expect(env.providerSignIn).toBeNull();
    expect(env.onOpenNodeLaunchConfigurations).toBe(workbench.openNodeLaunchConfigurations);
  });

  it("reports no workspace when the model carries no root", () => {
    const env = settingsEnvironment({
      appUpdater: null,
      providerManagement: null,
      systemFontGateway: { listMonospaceFontFamilies: async () => [] },
      workbench: { ...settingsModel(), workspaceRoot: null },
    });

    expect(env.hasWorkspace).toBe(false);
  });
});

function ControlledSettingsHost({
  appUpdaterGateway,
  container,
  workbench,
  workspaceFiles,
}: {
  readonly appUpdaterGateway: AppUpdaterGateway;
  readonly container: HTMLElement;
  readonly workbench: WorkbenchSettingsModel;
  readonly workspaceFiles: NodeLaunchConfigurationFileGateway;
}) {
  const preferencesGatewayRef = useState(() => ({
    loadSkippedVersion: async () => null,
    saveSkippedVersion: async () => undefined,
  }))[0];
  const appUpdater = useAppUpdater({
    currentVersion: "0.2.0-beta.1",
    gateway: appUpdaterGateway,
    preferencesGateway: preferencesGatewayRef,
    persistSkippedVersion: vi.fn(async () => undefined),
    scheduleAfterUiInteractive: neverSchedule,
  });
  return (
    <WorkbenchSettingsHost
      appUpdater={appUpdater}
      container={container}
      systemFontGateway={{ listMonospaceFontFamilies: async () => [] }}
      workbench={workbench}
      workspaceFiles={workspaceFiles}
    />
  );
}

const neverSchedule = () => () => undefined;

function idleAppUpdaterGateway(): AppUpdaterGateway {
  return {
    check: vi.fn<AppUpdaterGateway["check"]>(async () => ({
      kind: "upToDate",
      currentVersion: "0.2.0-beta.1",
    })),
    dispose: vi.fn(async () => undefined),
    download: vi.fn(async () => "readyToInstall" as const),
    installAndRestart: vi.fn(async () => undefined),
  };
}

function settingsModel(id = "a"): WorkbenchSettingsModel {
  const rootPath = `/workspace/${id}`;
  return {
    appSettings: defaultAppSettings(),
    closeNodeLaunchConfigurations: vi.fn(),
    gitRepositoryMappings: [],
    nodeLaunchConfigurationsOpen: false,
    openNodeLaunchConfigurations: vi.fn(),
    openJavaScriptTypeScriptServiceLog: vi.fn(async () => undefined),
    phpTools: null,
    restartJavaScriptTypeScriptService: vi.fn(async () => undefined),
    saveWorkbenchSettings: vi.fn(async () => undefined),
    settingsInitialSection: "general",
    settingsOpen: true,
    setSettingsOpen: vi.fn(),
    workspaceDescriptor: null,
    workspaceIdentityDescriptor: { workspaceId: `workspace-${id}` },
    workspaceRoot: rootPath,
    workspaceSettings: defaultWorkspaceSettings(),
    workspaceTrust: { rootPath, trusted: true },
  };
}

function missingConfigurationGateway(): NodeLaunchConfigurationFileGateway & {
  readDirectory: ReturnType<typeof vi.fn<NodeLaunchConfigurationFileGateway["readDirectory"]>>;
} {
  return {
    createDirectoryForWorkspace: vi.fn<
      NodeLaunchConfigurationFileGateway["createDirectoryForWorkspace"]
    >(async () => undefined),
    createTextFileWithContentForWorkspace: vi.fn<
      NodeLaunchConfigurationFileGateway["createTextFileWithContentForWorkspace"]
    >(async () => ({ status: "success", revision: null })),
    readDirectory: vi.fn<NodeLaunchConfigurationFileGateway["readDirectory"]>(async () => []),
    readTextFileSnapshot: vi.fn(async () => ({ content: "", revision: null })),
    writeTextFileForWorkspace: vi.fn<
      NodeLaunchConfigurationFileGateway["writeTextFileForWorkspace"]
    >(async () => ({
      status: "success",
      revision: null,
    })),
  };
}

function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label || candidate.ariaLabel === label,
  );
  expect(button, `Button not found: ${label}`).toBeDefined();
  act(() => button?.click());
}

function nodeLaunchDialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"][aria-label="Node launch configurations"]');
}
