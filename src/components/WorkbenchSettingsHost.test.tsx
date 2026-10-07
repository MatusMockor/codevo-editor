// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppUpdater } from "../application/useAppUpdater";
import type { AppUpdaterGateway } from "../domain/appUpdater";
import { defaultAppSettings, defaultWorkspaceSettings } from "../domain/settings";
import {
  DeferredAgentMcpServersGateway,
  agentMcpServersFixture,
} from "../test/agentMcpServersTestSupport";
import { AgentMcpServersProvider } from "./agentMode/AgentMcpServersProvider";
import { createAgentMcpServersSurface } from "../application/agentMcpServersSurface";
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

  it("keeps MCP server status across the workspace remount and never mixes projects", async () => {
    const gateway = new DeferredAgentMcpServersGateway();
    const mcp = (id: string): WorkbenchSettingsModel => ({
      ...settingsModel(id),
      settingsInitialSection: "mcp",
    });
    const names = () =>
      [...container.querySelectorAll<HTMLElement>("[data-mcp-server]")].map(
        (row) => row.dataset.mcpServer,
      );

    await render(mcp("a"), idleAppUpdaterGateway(), gateway);
    expect(gateway.requests()).toEqual([
      { repositoryRoot: "/workspace/a", provider: "claudeCode" },
      { repositoryRoot: "/workspace/a", provider: "codex" },
    ]);
    await act(async () => {
      gateway.checks[0]?.resolve(agentMcpServersFixture("claudeCode", [{ name: "from-a" }]));
    });
    expect(names()).toEqual(["from-a"]);

    await render(mcp("b"), idleAppUpdaterGateway(), gateway);
    expect(names()).toEqual([]);
    expect(gateway.requests().slice(2)).toEqual([
      { repositoryRoot: "/workspace/b", provider: "claudeCode" },
      { repositoryRoot: "/workspace/b", provider: "codex" },
    ]);
    await act(async () => {
      gateway.checks[1]?.resolve(agentMcpServersFixture("codex", [{ name: "late-a-codex" }]));
    });
    expect(names()).toEqual([]);

    await render(mcp("a"), idleAppUpdaterGateway(), gateway);
    expect(names()).toEqual(["from-a", "late-a-codex"]);
    expect(gateway.requests()).toHaveLength(4);
  });

  it("shows the MCP page as unavailable when no status provider is mounted", async () => {
    await render({ ...settingsModel(), settingsInitialSection: "mcp" });

    expect(container.textContent).toContain("MCP server status is not available in this window.");
    expect(container.querySelector('button[aria-label="Check MCP servers"]')).toBeNull();
  });

  async function render(
    workbench: WorkbenchSettingsModel,
    appUpdaterGateway: AppUpdaterGateway = idleAppUpdaterGateway(),
    mcpGateway: DeferredAgentMcpServersGateway | null = null,
  ) {
    const settingsHost = (
      <ControlledSettingsHost
        appUpdaterGateway={appUpdaterGateway}
        container={container}
        workbench={workbench}
      />
    );
    await act(async () => {
      root.render(
        mcpGateway === null ? (
          settingsHost
        ) : (
          <AgentMcpServersProvider gateway={mcpGateway}>{settingsHost}</AgentMcpServersProvider>
        ),
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
    expect(env.agentMcpServers).toBeNull();
  });

  it("hands the MCP servers surface to the settings pages unchanged", () => {
    const agentMcpServers = createAgentMcpServersSurface(new DeferredAgentMcpServersGateway());
    const env = settingsEnvironment({
      agentMcpServers,
      appUpdater: null,
      providerManagement: null,
      systemFontGateway: { listMonospaceFontFamilies: async () => [] },
      workbench: settingsModel(),
    });

    expect(env.agentMcpServers).toBe(agentMcpServers);
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
