// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentMcpServersManagementWiring,
  AgentMcpServersRemoteGateway,
} from "../../../application/agentMcpServersSurface";
import type { AgentMcpServerLoginStep } from "../../../domain/agentMcpServerManagement";
import type { RemoteRunnerDescriptor, RemoteRunnerServer } from "../../../domain/remoteRunner";
import { TauriRemoteRunnerGateway } from "../../../infrastructure/tauriRemoteRunnerGateway";
import {
  DeferredAgentMcpServerManagementGateway,
  DeferredRemoteAgentMcpServerManagementGateway,
  ManualScheduler,
  RecordingUrlOpener,
} from "../../../test/agentMcpServerManagementTestSupport";
import {
  DeferredAgentMcpServersGateway,
  DeferredRunnerTunnel,
  agentMcpServersFixture,
  mcpRunnerFixture,
} from "../../../test/agentMcpServersTestSupport";
import { click } from "../../../ui/foundation/foundationTestSupport";
import { AgentMcpServersProvider } from "../../agentMode/AgentMcpServersProvider";
import { useAgentMcpServersSurface } from "../../agentMode/useAgentMcpServersSurface";
import {
  RemoteRunnerContext,
  type RemoteRunnerContextValue,
} from "../../remoteRunner/remoteRunnerContext";
import type { SettingsPageProps } from "../settingsPageProps";
import { SettingsPageHost } from "../settingsPages";
import { settingsPagePropsFixture } from "./settingsPageTestSupport";

const LOGIN_ID = "login-0123456789";
const AUTHORIZE = "https://auth.example.com/authorize?state=secret-state";
const CALLBACK = "http://localhost:53682/callback?code=secret-code&state=secret-state";
const LINUX: RemoteRunnerServer = {
  id: "linux",
  name: "Linux box",
  host: "linux.example",
  username: "dev",
  port: 22,
  connected: true,
};
const REMOTE_BASE = {
  serverId: "linux",
  runnerId: "runner-home",
  projectId: "codevo-editor",
  provider: "claude",
};
const projects = [{ id: "codevo-editor", name: "Codevo Editor" }];
const claudeServers = agentMcpServersFixture("claudeCode", [
  { name: "linear", status: "needsAuth", scope: "local", transport: "http" },
]);
const paste: AgentMcpServerLoginStep = {
  kind: "awaitingCallback",
  loginId: LOGIN_ID,
  authorizationUrl: AUTHORIZE,
  delivery: "paste",
};

function Scene({ props }: { readonly props: SettingsPageProps }) {
  const env = { ...props.env, agentMcpServers: useAgentMcpServersSurface() };
  return <SettingsPageHost actions={props.actions} draft={props.draft} env={env} section="mcp" />;
}

describe("McpServersSettingsPage management of server projects", () => {
  let host: HTMLDivElement;
  let root: Root;
  let tunnel: DeferredRunnerTunnel;
  let runnerGateway: TauriRemoteRunnerGateway;
  let remoteManagement: DeferredRemoteAgentMcpServerManagementGateway;
  let localManagement: DeferredAgentMcpServerManagementGateway;
  let scheduler: ManualScheduler;
  let urlOpener: RecordingUrlOpener;
  let wiring: AgentMcpServersManagementWiring;
  const local = new DeferredAgentMcpServersGateway();
  const props = settingsPagePropsFixture({ env: { hasWorkspace: false, workspaceRoot: null } });

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    tunnel = new DeferredRunnerTunnel();
    runnerGateway = new TauriRemoteRunnerGateway(tunnel.invoke);
    remoteManagement = new DeferredRemoteAgentMcpServerManagementGateway();
    localManagement = new DeferredAgentMcpServerManagementGateway();
    scheduler = new ManualScheduler();
    urlOpener = new RecordingUrlOpener();
    wiring = { gateway: localManagement, urlOpener, scheduler };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function statusOnlyGateway(): AgentMcpServersRemoteGateway {
    return {
      getRunner: (request) => runnerGateway.getRunner(request),
      listProjects: (request) => runnerGateway.listProjects(request),
      getMcpServers: (request) => runnerGateway.getMcpServers(request),
    };
  }

  function managingGateway(): AgentMcpServersRemoteGateway {
    return {
      getRunner: (request) => runnerGateway.getRunner(request),
      listProjects: (request) => runnerGateway.listProjects(request),
      getMcpServers: (request) => runnerGateway.getMcpServers(request),
      changeMcpServer: (request) => remoteManagement.changeMcpServer(request),
      startMcpServerLogin: (request) => remoteManagement.startMcpServerLogin(request),
      getMcpServerLogin: (request) => remoteManagement.getMcpServerLogin(request),
      submitMcpServerLoginCallback: (request) =>
        remoteManagement.submitMcpServerLoginCallback(request),
      cancelMcpServerLogin: (request) => remoteManagement.cancelMcpServerLogin(request),
    };
  }

  function remoteContext(gateway: AgentMcpServersRemoteGateway): RemoteRunnerContextValue {
    return {
      gateway: gateway as RemoteRunnerContextValue["gateway"],
      servers: [LINUX],
      status: "ready",
      error: null,
      refresh: async () => undefined,
      connect: async () => null,
      disconnect: async () => undefined,
      remove: async () => undefined,
      selectedServerId: null,
      selectServer: () => undefined,
    };
  }

  async function settle(): Promise<void> {
    await act(async () => {
      for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
    });
  }

  async function show(
    gateway: AgentMcpServersRemoteGateway,
    runner: RemoteRunnerDescriptor,
  ): Promise<void> {
    const context = remoteContext(gateway);
    act(() =>
      root.render(
        <RemoteRunnerContext.Provider value={context}>
          <AgentMcpServersProvider gateway={local} management={wiring} remoteGateway={gateway}>
            <Scene props={props} />
          </AgentMcpServersProvider>
        </RemoteRunnerContext.Provider>,
      ),
    );
    await settle();
    act(() => tunnel.serve("linux", runner, projects));
    await settle();
    act(() => tunnel.pendingChecks("linux", "claude")[0]?.resolve(claudeServers));
    await settle();
  }

  function row(): HTMLElement {
    const found = host.querySelector<HTMLElement>(
      '[data-mcp-provider="claudeCode"] [data-mcp-server="linear"]',
    );
    expect(found, "Missing the linear server row").not.toBeNull();
    return found ?? document.createElement("div");
  }

  function button(label: string): HTMLButtonElement | null {
    return (
      [...host.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) =>
          candidate.getAttribute("aria-label") === label || candidate.textContent === label,
      ) ?? null
    );
  }

  function pressButton(label: string): void {
    const target = button(label);
    expect(target, `Missing button ${label}`).not.toBeNull();
    if (target !== null) click(target);
  }

  function expectUnsupported(): void {
    expect(row().textContent).toContain("On the server, run");
    expect(row().textContent).toContain("claude mcp login -- 'linear'");
    expect(button("Copy sign-in command for linear")).not.toBeNull();
    expect(button("Sign in to linear")).toBeNull();
    expect(button("More actions for linear")).toBeNull();
    expect(button("Add Claude Code MCP server")).toBeNull();
  }

  it("keeps the copy-command hint for a runner without the management capability", async () => {
    await show(managingGateway(), mcpRunnerFixture("runner-home"));
    expectUnsupported();
    expect(remoteManagement.starts.calls).toEqual([]);
  });

  it("keeps the copy-command hint while the remote gateway cannot manage servers", async () => {
    await show(statusOnlyGateway(), mcpRunnerFixture("runner-home", true, true));
    expectUnsupported();
  });

  it("signs in on a capable runner by pasting the address the browser ended on", async () => {
    await show(managingGateway(), mcpRunnerFixture("runner-home", true, true));
    expect(row().textContent).not.toContain("On the server, run");
    expect(button("Add Claude Code MCP server")).not.toBeNull();
    pressButton("Sign in to linear");
    await settle();
    expect(remoteManagement.starts.requests()).toEqual([
      { ...REMOTE_BASE, name: "linear", mode: "signIn" },
    ]);
    expect(localManagement.starts.calls).toEqual([]);

    remoteManagement.starts.latest()?.resolve(paste);
    await settle();
    expect(urlOpener.opened.requests()).toEqual([AUTHORIZE]);
    urlOpener.opened.latest()?.resolve();
    await settle();
    const input = row().querySelector<HTMLInputElement>("input");
    expect(input).not.toBeNull();
    act(() => {
      if (input === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        CALLBACK,
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    pressButton("Finish sign-in");
    await settle();
    expect(remoteManagement.callbacks.requests()).toEqual([
      { ...REMOTE_BASE, loginId: LOGIN_ID, callbackUrl: CALLBACK },
    ]);
    remoteManagement.callbacks.latest()?.resolve();
    act(() => scheduler.advance(1500));
    await settle();
    expect(remoteManagement.states.requests()).toEqual([{ ...REMOTE_BASE, loginId: LOGIN_ID }]);
    for (const secret of [LOGIN_ID, "secret-state", "secret-code"])
      expect(document.body.innerHTML).not.toContain(secret);

    remoteManagement.states.latest()?.resolve("succeeded");
    await settle();
    expect(tunnel.pendingChecks("linux", "claude")).toHaveLength(1);
    expect(remoteManagement.cancels.calls).toEqual([]);
  });

  it("cancels the login on the runner when the provider goes away", async () => {
    await show(managingGateway(), mcpRunnerFixture("runner-home", true, true));
    pressButton("Sign in to linear");
    await settle();
    remoteManagement.starts.latest()?.resolve(paste);
    await settle();
    act(() => root.unmount());
    await settle();
    expect(remoteManagement.cancels.requests()).toEqual([{ ...REMOTE_BASE, loginId: LOGIN_ID }]);
    expect(scheduler.pending()).toBe(0);
    root = createRoot(host);
  });
});
