// @vitest-environment jsdom
import { StrictMode, act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import wireContract from "../../../../contracts/agent-mcp-servers-wire.json";
import type { AgentMcpServersSurface } from "../../../application/agentMcpServersSurface";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { RemoteRunnerDescriptor, RemoteRunnerServer } from "../../../domain/remoteRunner";
import type { AgentCliKind } from "../../../domain/agentTask";
import {
  REMOTE_RUNNER_COMMANDS,
  TauriRemoteRunnerGateway,
} from "../../../infrastructure/tauriRemoteRunnerGateway";
import {
  DeferredAgentMcpServersGateway,
  DeferredRunnerTunnel,
  agentMcpServersFixture,
  mcpRunnerFixture,
} from "../../../test/agentMcpServersTestSupport";
import { AgentMcpServersProvider } from "../../agentMode/AgentMcpServersProvider";
import { useAgentMcpServersSurface } from "../../agentMode/useAgentMcpServersSurface";
import {
  RemoteRunnerContext,
  useRemoteRunnerContext,
  type RemoteRunnerContextValue,
} from "../../remoteRunner/remoteRunnerContext";
import { RemoteRunnerProvider } from "../../remoteRunner/RemoteRunnerProvider";
import { SettingsPageActions } from "../SettingsPageActions";
import type { SettingsEnvironment, SettingsPageProps } from "../settingsPageProps";
import { SettingsPageHost } from "../settingsPages";
import type { SettingsSectionId } from "../settingsRegistry";
import { settingsPagePropsFixture } from "./settingsPageTestSupport";

const APP = "/work/app";
const UNSUPPORTED =
  "This server's runner does not support MCP checks yet. Update the runner on the server.";
const UNREACHABLE = "Could not reach the server. Check the connection, then check again.";
const projects = [
  { id: "codevo-editor", name: "Codevo Editor" },
  { id: "api", name: "api" },
];
const claudeMixed = wireContract.responses[0].value;
const codexPair = wireContract.responses[1].value;

function server(id: string, name: string, connected = true): RemoteRunnerServer {
  return { id, name, host: "linux.example", username: "dev", port: 22, connected };
}

const LINUX = server("linux", "Linux box");

function localProject(rootPath: string, label: string): AgentProjectDescriptor {
  return { rootKey: rootPath, rootPath, label } as AgentProjectDescriptor;
}

function check(runnerId: string, projectId: string, provider: "claude" | "codex") {
  return { serverId: "linux", runnerId, projectId, provider };
}

interface Captured {
  surface: AgentMcpServersSurface | null;
  connections: RemoteRunnerContextValue | null;
}

function Scene({
  captured,
  props,
  section,
}: {
  readonly captured: Captured;
  readonly props: SettingsPageProps;
  readonly section: SettingsSectionId;
}) {
  const surface = useAgentMcpServersSurface();
  const connections = useRemoteRunnerContext();
  useEffect(() => {
    captured.surface = surface;
    captured.connections = connections;
  }, [captured, connections, surface]);
  const env = { ...props.env, agentMcpServers: surface };
  return (
    <>
      <header>
        <SettingsPageActions
          actions={props.actions}
          draft={props.draft}
          env={env}
          section={section}
        />
      </header>
      <main>
        <SettingsPageHost actions={props.actions} draft={props.draft} env={env} section={section} />
      </main>
    </>
  );
}

describe("McpServersSettingsPage with server projects", () => {
  let host: HTMLDivElement;
  let root: Root;
  let local: DeferredAgentMcpServersGateway;
  let tunnel: DeferredRunnerTunnel;
  let remote: TauriRemoteRunnerGateway;
  let props: SettingsPageProps;
  let captured: Captured;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    local = new DeferredAgentMcpServersGateway();
    tunnel = new DeferredRunnerTunnel();
    remote = new TauriRemoteRunnerGateway(tunnel.invoke);
    props = fixture();
    captured = { surface: null, connections: null };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function fixture(env: Partial<SettingsEnvironment> = {}): SettingsPageProps {
    return settingsPagePropsFixture({ env: { hasWorkspace: false, workspaceRoot: null, ...env } });
  }

  function remoteContext(servers: ReadonlyArray<RemoteRunnerServer>): RemoteRunnerContextValue {
    return {
      gateway: remote,
      servers,
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
    for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
  }

  async function acting(action: () => void): Promise<void> {
    await act(async () => {
      action();
      await settle();
    });
    await act(settle);
  }

  async function show(
    servers: ReadonlyArray<RemoteRunnerServer> = [LINUX],
    section: SettingsSectionId = "mcp",
    wrap: (children: ReactNode) => ReactNode = (children) => children,
  ): Promise<void> {
    await acting(() =>
      root.render(
        wrap(
          <RemoteRunnerContext.Provider value={remoteContext(servers)}>
            <AgentMcpServersProvider gateway={local} remoteGateway={remote}>
              <Scene captured={captured} props={props} section={section} />
            </AgentMcpServersProvider>
          </RemoteRunnerContext.Provider>,
        ),
      ),
    );
  }

  async function showLive(): Promise<void> {
    await acting(() =>
      root.render(
        <RemoteRunnerProvider gateway={remote}>
          <AgentMcpServersProvider gateway={local} remoteGateway={remote}>
            <Scene captured={captured} props={props} section="mcp" />
          </AgentMcpServersProvider>
        </RemoteRunnerProvider>,
      ),
    );
  }

  async function settleTunnel(command: string, value: unknown): Promise<void> {
    const waiting = tunnel.waiting(command);
    expect(waiting.length, `Nothing is waiting for ${command}`).toBeGreaterThan(0);
    await acting(() => waiting[0]?.resolve(value));
  }

  async function serve(
    runner: RemoteRunnerDescriptor = mcpRunnerFixture("runner-home"),
    serverId = "linux",
  ): Promise<void> {
    await acting(() => tunnel.serve(serverId, runner, projects));
  }

  async function answer(provider: "claude" | "codex", result: unknown): Promise<void> {
    const pending = tunnel.pendingChecks("linux", provider);
    expect(pending.length, `No server check is pending for ${provider}`).toBeGreaterThan(0);
    await acting(() => {
      if (typeof result === "string") pending[0]?.reject(result);
      if (typeof result !== "string") pending[0]?.resolve(result);
    });
  }

  async function answerBoth(): Promise<void> {
    await answer("claude", claudeMixed);
    await answer("codex", codexPair);
  }

  function projectSelect(): HTMLSelectElement | null {
    return host.querySelector<HTMLSelectElement>('select[aria-label="Project"]');
  }

  function optionLabels(): ReadonlyArray<string | null> {
    return [...(projectSelect()?.options ?? [])].map((option) => option.textContent);
  }

  function selectedLabel(): string | null {
    const select = projectSelect();
    return select?.selectedOptions[0]?.textContent ?? null;
  }

  async function choose(label: string): Promise<void> {
    const select = projectSelect();
    const option = [...(select?.options ?? [])].find((item) => item.textContent === label);
    expect(option, `No project option ${label}`).toBeDefined();
    await acting(() => {
      if (select === null || option === undefined) return;
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function group(provider: AgentCliKind): HTMLElement {
    const element = host.querySelector<HTMLElement>(`[data-mcp-provider="${provider}"]`);
    expect(element, `Missing ${provider} group`).not.toBeNull();
    return element ?? document.createElement("div");
  }

  function summary(provider: AgentCliKind): string {
    return group(provider).querySelector(".settings-mcp-summary")?.textContent ?? "";
  }

  function alerts(provider: AgentCliKind): ReadonlyArray<string | null> {
    return [...group(provider).querySelectorAll('[role="alert"]')].map((item) => item.textContent);
  }

  function serverNames(provider: AgentCliKind): ReadonlyArray<string | undefined> {
    return [...group(provider).querySelectorAll<HTMLElement>("[data-mcp-server]")].map(
      (row) => row.dataset.mcpServer,
    );
  }

  function projectNotes(): ReadonlyArray<string | null> {
    return [...host.querySelectorAll("[data-mcp-project-note]")].map((note) => note.textContent);
  }

  function refreshButton(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>('button[aria-label="Check MCP servers"]');
  }

  async function refresh(): Promise<void> {
    await acting(() => refreshButton()?.click());
  }

  it("reads no server while another settings page is shown", async () => {
    await show([LINUX], "usage");
    expect(tunnel.calls).toEqual([]);
    expect(local.requests()).toEqual([]);
  });

  it("lists local projects and the projects of connected servers together", async () => {
    props = fixture({
      agentProjects: [localProject("/work/api", "api")],
      hasWorkspace: true,
      workspaceRoot: APP,
    });
    await show([LINUX, server("mac", "Mac mini", false)]);

    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toEqual([{ serverId: "linux" }]);
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.listProjects)).toEqual([{ serverId: "linux" }]);
    expect(optionLabels()).toEqual(["app", "api"]);
    expect(projectNotes()).toEqual(["Loading projects on Linux box…"]);

    await serve();
    expect(optionLabels()).toEqual(["app", "api", "Codevo Editor — Linux box", "api — Linux box"]);
    expect(selectedLabel()).toBe("app");
    expect(projectNotes()).toEqual([]);
    expect(host.textContent).not.toContain("Mac mini");
    expect(host.textContent).not.toContain("Projects on servers are not checked yet.");
    expect(local.requests()).toEqual([
      { repositoryRoot: APP, provider: "claudeCode" },
      { repositoryRoot: APP, provider: "codex" },
    ]);
    expect(tunnel.checks()).toEqual([]);
  });

  it("defaults to the first local project when no workspace is open", async () => {
    props = fixture({ agentProjects: [localProject("/work/api", "api")] });
    await show();
    await serve();
    expect(selectedLabel()).toBe("api");
    expect(tunnel.checks()).toEqual([]);
  });

  it("defaults to the first server project when there is no local one and checks it", async () => {
    await show();
    expect(host.textContent).toContain("Open a project to see its MCP servers.");
    expect(projectNotes()).toEqual(["Loading projects on Linux box…"]);
    expect(refreshButton()).not.toBeNull();

    await serve();
    expect(selectedLabel()).toBe("Codevo Editor — Linux box");
    expect(host.querySelector(".settings-mcp-project__location")?.textContent).toBe(
      "Linux box · Server checkout",
    );
    expect(host.querySelector(".settings-row__title")?.textContent).toBe("Codevo Editor");
    expect(tunnel.checks()).toEqual([
      check("runner-home", "codevo-editor", "claude"),
      check("runner-home", "codevo-editor", "codex"),
    ]);
    expect(local.requests()).toEqual([]);
    expect(host.textContent).toContain(
      "Checking starts each configured server once on the server, the same way an agent session does.",
    );
  });

  it("starts a single check per provider for a server project under StrictMode", async () => {
    await show([LINUX], "mcp", (children) => <StrictMode>{children}</StrictMode>);
    await serve();
    expect(tunnel.checks()).toEqual([
      check("runner-home", "codevo-editor", "claude"),
      check("runner-home", "codevo-editor", "codex"),
    ]);
  });

  it("checks a server project only once it is chosen and shows the same states", async () => {
    props = fixture({ hasWorkspace: true, workspaceRoot: APP });
    await show();
    await serve();
    expect(tunnel.checks()).toEqual([]);
    expect(host.textContent).toContain(
      "Checking starts each configured server once, the same way an agent session does.",
    );

    await choose("api — Linux box");
    expect(tunnel.checks()).toEqual([
      check("runner-home", "api", "claude"),
      check("runner-home", "api", "codex"),
    ]);
    expect(summary("claudeCode")).toBe("Checking MCP servers…");
    expect(group("claudeCode").getAttribute("aria-busy")).toBe("true");
    expect(serverNames("claudeCode")).toEqual([]);
    expect(refreshButton()?.disabled).toBe(true);

    await answer("claude", claudeMixed);
    expect(serverNames("claudeCode")).toEqual([
      "sentry",
      "claude.ai Gmail",
      "slow-indexer",
      "filesystem",
      "legacy-events",
    ]);
    expect(summary("claudeCode")).toBe("5 servers, 2 need attention");
    expect(summary("codex")).toBe("Checking MCP servers…");
    expect(refreshButton()?.disabled).toBe(true);

    await answer("codex", codexPair);
    expect(serverNames("codex")).toEqual(["codex_apps", "docs"]);
    expect(refreshButton()?.disabled).toBe(false);
    expect(group("claudeCode").closest("section")?.textContent).toContain("Checked just now");

    await choose("app");
    expect(serverNames("claudeCode")).toEqual([]);
    await choose("api — Linux box");
    expect(serverNames("claudeCode")).toHaveLength(5);
    expect(tunnel.checks()).toHaveLength(2);
  });

  it("says a sign-in or add command has to be run on the server and copies it", async () => {
    await show();
    await serve();
    await answer("claude", claudeMixed);
    await answer("codex", agentMcpServersFixture("codex", []));

    const row = group("claudeCode").querySelector<HTMLElement>(
      '[data-mcp-server="claude.ai Gmail"]',
    );
    expect(row?.querySelector(".settings-mcp-signin")?.textContent).toBe(
      "On the server, runclaude mcp login -- 'claude.ai Gmail'",
    );
    expect(row?.textContent).not.toContain("To sign in, run");
    const copy = row?.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy sign-in command for claude.ai Gmail"]',
    );
    expect(copy).not.toBeNull();
    act(() => copy?.click());
    expect(props.env.onCopyInstallCommand).toHaveBeenCalledExactlyOnceWith(
      "claude mcp login -- 'claude.ai Gmail'",
    );

    expect(summary("codex")).toBe("No MCP servers are configured for Codex in this project.");
    expect(group("codex").textContent).toContain(
      "On the server, add one with codex mcp add, then check again.",
    );
  });

  it("keeps the local wording for a local project next to connected servers", async () => {
    props = fixture({ hasWorkspace: true, workspaceRoot: APP });
    await show();
    await serve();
    await acting(() => {
      local.checks[0]?.resolve(
        agentMcpServersFixture("claudeCode", [
          { name: "gmail", status: "needsAuth", transport: "http" },
        ]),
      );
      local.checks[1]?.resolve(agentMcpServersFixture("codex", []));
    });
    expect(group("claudeCode").querySelector(".settings-mcp-signin")?.textContent).toBe(
      "To sign in, runclaude mcp login -- 'gmail'",
    );
    expect(group("codex").textContent).toContain("Add one with codex mcp add, then check again.");
    expect(host.textContent).not.toContain("On the server");
  });

  it("says once per provider that the runner cannot check yet and never calls it", async () => {
    await show();
    await serve(mcpRunnerFixture("runner-home", "absent"));

    expect(selectedLabel()).toBe("Codevo Editor — Linux box");
    expect(alerts("claudeCode")).toEqual([UNSUPPORTED]);
    expect(alerts("codex")).toEqual([UNSUPPORTED]);
    expect(host.textContent?.split(UNSUPPORTED)).toHaveLength(3);
    expect(serverNames("claudeCode")).toEqual([]);
    expect(tunnel.checks()).toEqual([]);
    expect(refreshButton()?.disabled).toBe(false);
  });

  it("checks again after the runner was updated and the user asks", async () => {
    await show();
    await serve(mcpRunnerFixture("runner-home", false));
    expect(alerts("codex")).toEqual([UNSUPPORTED]);

    await refresh();
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(2);
    expect(tunnel.checks()).toEqual([]);
    expect(summary("codex")).toBe("Checking MCP servers…");

    await serve(mcpRunnerFixture("runner-home", true));
    expect(tunnel.checks()).toEqual([
      check("runner-home", "codevo-editor", "claude"),
      check("runner-home", "codevo-editor", "codex"),
    ]);
    await answerBoth();
    expect(alerts("codex")).toEqual([]);
    expect(serverNames("codex")).toEqual(["codex_apps", "docs"]);
  });

  it("reports the runner's own refusal the same way", async () => {
    await show();
    await serve();
    await answer("claude", wireContract.errors.unsupportedRunner);
    expect(alerts("claudeCode")).toEqual([UNSUPPORTED]);
    expect(summary("codex")).toBe("Checking MCP servers…");
  });

  it("keeps the last rows when the server cannot be reached and says so", async () => {
    await show();
    await serve();
    await answerBoth();

    await refresh();
    await serve();
    await answer("claude", wireContract.errors.serverUnavailable);
    await answer("codex", codexPair);
    expect(alerts("claudeCode")).toEqual([UNREACHABLE]);
    expect(serverNames("claudeCode")).toHaveLength(5);
    expect(alerts("codex")).toEqual([]);
    expect(refreshButton()?.disabled).toBe(false);
  });

  it("rejects an answer for the other provider instead of showing it", async () => {
    await show();
    await serve();
    await answer("claude", codexPair);
    expect(alerts("claudeCode")).toEqual(["Could not read MCP servers from Claude Code."]);
    expect(serverNames("claudeCode")).toEqual([]);
  });

  it("falls back to the local project when the selected server disconnects", async () => {
    props = fixture({ hasWorkspace: true, workspaceRoot: APP });
    await show();
    await serve();
    await choose("Codevo Editor — Linux box");
    await answer("claude", claudeMixed);
    expect(serverNames("claudeCode")).toHaveLength(5);
    expect(summary("codex")).toBe("Checking MCP servers…");

    await show([server("linux", "Linux box", false)]);
    expect(projectSelect()).toBeNull();
    expect(host.querySelector(".settings-mcp-project__location")?.textContent).toBe(APP);
    expect(serverNames("claudeCode")).toEqual([]);
    expect(serverNames("codex")).toEqual([]);
    expect(summary("claudeCode")).toBe("Checking MCP servers…");
    expect(host.textContent).not.toContain("Linux box");

    await answer("codex", codexPair);
    expect(serverNames("codex")).toEqual([]);
    expect(summary("codex")).toBe("Checking MCP servers…");
  });

  it("shows nothing but the empty notice when the only project's server disconnects", async () => {
    await show();
    await serve();
    await answerBoth();
    expect(serverNames("claudeCode")).toHaveLength(5);

    await show([]);
    expect(host.querySelector("[data-mcp-provider]")).toBeNull();
    expect(host.querySelector("[data-mcp-server]")).toBeNull();
    expect(host.textContent).toContain("Open a project to see its MCP servers.");
    expect(refreshButton()).toBeNull();
  });

  it("never shows the old runner's rows after the server reconnects to another runner", async () => {
    props = fixture({ hasWorkspace: true, workspaceRoot: APP });
    await show();
    await serve();
    await choose("api — Linux box");
    await answer("claude", claudeMixed);
    const [lateCodex] = tunnel.pendingChecks("linux");

    await show([server("linux", "Linux box", false)]);
    await show([LINUX]);
    await serve(mcpRunnerFixture("runner-replaced"));
    await acting(() => lateCodex?.resolve(codexPair));

    expect(selectedLabel()).toBe("app");
    expect(optionLabels()).toContain("api — Linux box");
    await choose("api — Linux box");
    expect(serverNames("claudeCode")).toEqual([]);
    expect(serverNames("codex")).toEqual([]);
    expect(summary("claudeCode")).toBe("Checking MCP servers…");
    expect(tunnel.checks().slice(2)).toEqual([
      check("runner-replaced", "api", "claude"),
      check("runner-replaced", "api", "codex"),
    ]);
  });

  it("returns to the chosen server project when the same runner reconnects", async () => {
    props = fixture({ hasWorkspace: true, workspaceRoot: APP });
    await show();
    await serve();
    await choose("api — Linux box");
    await answerBoth();

    await show([server("linux", "Linux box", false)]);
    expect(host.querySelector(".settings-mcp-project__location")?.textContent).toBe(APP);
    await show([LINUX]);
    await serve();
    expect(selectedLabel()).toBe("api — Linux box");
    expect(serverNames("codex")).toEqual(["codex_apps", "docs"]);
    expect(tunnel.checks()).toHaveLength(2);
  });

  it("says when a server's projects could not be loaded and retries on Check again", async () => {
    await show();
    await acting(() => tunnel.refuse("linux", "Server connection changed during request"));
    expect(projectNotes()).toEqual(["Could not load projects on Linux box. Check again to retry."]);
    expect(host.querySelector('[data-mcp-project-note="problem"]')?.getAttribute("role")).toBe(
      "alert",
    );
    expect(host.textContent).toContain("Open a project to see its MCP servers.");

    await refresh();
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(2);
    expect(projectNotes()).toEqual(["Loading projects on Linux box…"]);
    await serve();
    expect(optionLabels()).toEqual(["Codevo Editor — Linux box", "api — Linux box"]);
    expect(projectNotes()).toEqual([]);
  });

  it("reads a failed server again when the page is reopened", async () => {
    props = fixture({ hasWorkspace: true, workspaceRoot: APP });
    await show();
    await acting(() => tunnel.refuse("linux", "Server connection changed during request"));
    expect(projectSelect()).toBeNull();

    await show([LINUX], "usage");
    await show([LINUX], "mcp");
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(2);
    await serve();
    expect(optionLabels()).toEqual(["app", "Codevo Editor — Linux box", "api — Linux box"]);
  });

  it("keeps the selected server project and its rows when its list cannot be refreshed", async () => {
    props = fixture({ hasWorkspace: true, workspaceRoot: APP });
    await show();
    await serve();
    await choose("api — Linux box");
    await answerBoth();
    const localChecks = local.requests().length;

    await refresh();
    await acting(() => tunnel.refuse("linux", "Server connection changed during request"));
    expect(selectedLabel()).toBe("api — Linux box");
    expect(optionLabels()).toEqual(["app", "Codevo Editor — Linux box", "api — Linux box"]);
    expect(serverNames("claudeCode")).toHaveLength(5);
    expect(serverNames("codex")).toEqual(["codex_apps", "docs"]);
    expect(projectNotes()).toEqual([
      "Could not refresh projects on Linux box. Check again to retry.",
    ]);
    expect(local.requests()).toHaveLength(localChecks);
    expect(tunnel.checks().slice(2)).toEqual([
      check("runner-home", "api", "claude"),
      check("runner-home", "api", "codex"),
    ]);

    await answer("claude", wireContract.errors.serverUnavailable);
    expect(alerts("claudeCode")).toEqual([UNREACHABLE]);
    expect(serverNames("claudeCode")).toHaveLength(5);

    await answer("codex", codexPair);
    await refresh();
    await serve();
    expect(projectNotes()).toEqual([]);
    expect(selectedLabel()).toBe("api — Linux box");
  });

  it("holds a chosen server project while its list loads instead of checking a local one", async () => {
    props = fixture({ hasWorkspace: true, workspaceRoot: APP });
    await show([LINUX], "usage");
    act(() =>
      captured.surface?.projectChoice.choose(APP, {
        kind: "server",
        serverId: "linux",
        runnerId: "runner-home",
        projectId: "api",
      }),
    );

    await show([LINUX], "mcp");
    expect(projectNotes()).toEqual(["Loading projects on Linux box…"]);
    expect(host.querySelector("[data-mcp-provider]")).toBeNull();
    expect(projectSelect()).toBeNull();
    expect(host.textContent).not.toContain("Open a project to see its MCP servers.");
    expect(local.requests()).toEqual([]);
    expect(tunnel.checks()).toEqual([]);

    await serve();
    expect(selectedLabel()).toBe("api — Linux box");
    expect(tunnel.checks()).toEqual([
      check("runner-home", "api", "claude"),
      check("runner-home", "api", "codex"),
    ]);
    await answerBoth();

    await show([{ ...LINUX }]);
    expect(projectNotes()).toEqual(["Loading projects on Linux box…"]);
    expect(host.querySelector("[data-mcp-server]")).toBeNull();
    expect(host.querySelector("[data-mcp-provider]")).toBeNull();
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(2);

    await serve();
    expect(selectedLabel()).toBe("api — Linux box");
    expect(serverNames("claudeCode")).toHaveLength(5);
    expect(tunnel.checks()).toHaveLength(2);
    expect(local.requests()).toEqual([]);
  });

  it("re-reads the runner when the real connection layer reconnects without a disconnect", async () => {
    props = fixture({ hasWorkspace: true, workspaceRoot: APP });
    await showLive();
    await settleTunnel(REMOTE_RUNNER_COMMANDS.listServers, [LINUX]);
    await serve();
    await choose("api — Linux box");
    await answerBoth();
    expect(serverNames("claudeCode")).toHaveLength(5);
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(1);
    const before = captured.connections?.servers[0];

    await acting(() => {
      void captured.connections?.connect({
        id: LINUX.id,
        name: LINUX.name,
        host: LINUX.host,
        username: LINUX.username,
        port: LINUX.port,
      });
    });
    expect(captured.connections?.servers.map((item) => item.connected)).toEqual([true]);
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(1);
    await settleTunnel(REMOTE_RUNNER_COMMANDS.connectServer, { ...LINUX });

    expect(captured.connections?.servers).toEqual([LINUX]);
    expect(captured.connections?.servers[0]).not.toBe(before);
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(2);
    expect(projectNotes()).toEqual(["Loading projects on Linux box…"]);
    expect(host.querySelector("[data-mcp-server]")).toBeNull();
    expect(host.querySelector("[data-mcp-provider]")).toBeNull();
    expect(tunnel.checks()).toHaveLength(2);
    expect(local.requests()).toHaveLength(2);

    await serve(mcpRunnerFixture("runner-replaced"));
    expect(selectedLabel()).toBe("app");
    await choose("api — Linux box");
    expect(serverNames("claudeCode")).toEqual([]);
    expect(tunnel.checks().slice(2)).toEqual([
      check("runner-replaced", "api", "claude"),
      check("runner-replaced", "api", "codex"),
    ]);
  });

  it("does not read a server again when the page only renders again", async () => {
    await show();
    await serve();
    await show();
    await show([LINUX]);
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.getRunner)).toHaveLength(1);
    expect(tunnel.requests(REMOTE_RUNNER_COMMANDS.listProjects)).toHaveLength(1);
  });

  it("keeps the selected target when an unrelated server finishes loading", async () => {
    await show([LINUX, server("mac", "Mac mini")]);
    await serve();
    await answerBoth();
    const surface = captured.surface;
    expect(surface).not.toBeNull();
    const subscribe = surface === null ? null : vi.spyOn(surface.store, "subscribe");

    await serve(mcpRunnerFixture("runner-mac"), "mac");
    expect(optionLabels()).toEqual([
      "Codevo Editor — Linux box",
      "api — Linux box",
      "Codevo Editor — Mac mini",
      "api — Mac mini",
    ]);
    expect(subscribe?.mock.calls ?? null).toEqual([]);
    expect(serverNames("claudeCode")).toHaveLength(5);
    expect(tunnel.checks()).toHaveLength(2);
  });

  it("tells two servers with the same name apart in notes and options", async () => {
    const errors = vi.spyOn(console, "error");
    await show([server("linux-a", "Linux box"), server("linux-b", "Linux box")]);
    expect(projectNotes()).toEqual([
      "Loading projects on Linux box (linux-a)…",
      "Loading projects on Linux box (linux-b)…",
    ]);
    await serve(mcpRunnerFixture("runner-a"), "linux-a");
    await serve(mcpRunnerFixture("runner-b"), "linux-b");
    expect(optionLabels()).toEqual([
      "Codevo Editor — Linux box (linux-a)",
      "api — Linux box (linux-a)",
      "Codevo Editor — Linux box (linux-b)",
      "api — Linux box (linux-b)",
    ]);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("lists the projects of a server that connects while the page is shown", async () => {
    props = fixture({ hasWorkspace: true, workspaceRoot: APP });
    await show([server("linux", "Linux box", false)]);
    expect(tunnel.calls).toEqual([]);
    expect(projectSelect()).toBeNull();

    await show([LINUX]);
    await serve();
    expect(optionLabels()).toEqual(["app", "Codevo Editor — Linux box", "api — Linux box"]);
  });
});
