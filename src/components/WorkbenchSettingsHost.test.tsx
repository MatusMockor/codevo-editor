// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppUpdater } from "../application/useAppUpdater";
import type { AppUpdaterGateway } from "../domain/appUpdater";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import { settingsEnvironment } from "./settings/settingsEnvironment";
import { WorkbenchSettingsHost, type WorkbenchSettingsModel } from "./WorkbenchSettingsHost";

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

  it("renders the settings screen into the frame slot only while the route is open", async () => {
    await render({ ...settingsModel(), settingsOpen: false });

    expect(container.querySelector(".settings-screen")).toBeNull();

    await render(settingsModel());

    expect(container.querySelector(".settings-screen")).not.toBeNull();
    expect(host.querySelector(".settings-screen")).toBeNull();
  });

  it("remounts the screen for a workspace rekey so drafts never cross owners", async () => {
    await render(settingsModel());
    const first = container.querySelector(".settings-screen");

    await render(settingsModel("b"));
    const second = container.querySelector(".settings-screen");

    await render(settingsModel());
    const third = container.querySelector(".settings-screen");

    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
  });

  it("restores focus to the previously active element when the route closes", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();

    await render(settingsModel());
    expect(document.activeElement?.textContent).toBe("Settings/General");

    await render({ ...settingsModel(), settingsOpen: false });
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  async function render(
    workbench: WorkbenchSettingsModel,
    appUpdaterGateway: AppUpdaterGateway = idleAppUpdaterGateway(),
  ) {
    await act(async () => {
      root.render(
        <ControlledSettingsHost
          appUpdaterGateway={appUpdaterGateway}
          container={container}
          workbench={workbench}
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
}: {
  readonly appUpdaterGateway: AppUpdaterGateway;
  readonly container: HTMLElement;
  readonly workbench: WorkbenchSettingsModel;
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
    gitRepositoryMappings: [],
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
