// @vitest-environment jsdom
import { StrictMode, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import wireContract from "../../../../contracts/agent-mcp-servers-wire.json";
import { UNSUPPORTED_AGENT_MCP_SERVER_MANAGEMENT } from "../../../application/agentMcpServerManagementStore";
import { AgentMcpServerProjectsStore } from "../../../application/agentMcpServerProjects";
import { agentMcpServersSource } from "../../../application/agentMcpServersGateway";
import { AgentMcpServersProjectChoiceStore } from "../../../application/agentMcpServersProjectChoice";
import { AgentMcpServersStatusStore } from "../../../application/agentMcpServersStore";
import type { AgentMcpServersSurface } from "../../../application/agentMcpServersSurface";
import {
  AGENT_MCP_SERVERS_ERROR_KINDS,
  parseAgentMcpServers,
  type AgentMcpServers,
  type AgentMcpServersRequest,
} from "../../../domain/agentMcpServers";
import { agentMcpServersProjectKey } from "../../../domain/agentMcpServersTarget";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { AgentCliKind } from "../../../domain/agentTask";
import {
  DeferredAgentMcpServersGateway,
  agentMcpServersFixture,
} from "../../../test/agentMcpServersTestSupport";
import { waitForReact } from "../../../test/reactTestLifecycle";
import { SettingsPageActions } from "../SettingsPageActions";
import type { SettingsEnvironment } from "../settingsPageProps";
import { SettingsPageHost } from "../settingsPages";
import type { SettingsSectionId } from "../settingsRegistry";
import { mcpErrorMessage } from "./mcpServersPresentation";
import { settingsPagePropsFixture } from "./settingsPageTestSupport";

const APP = "/work/app";
const API = "/work/api";
const claudeMixed = parseAgentMcpServers(wireContract.responses[0].value);
const codexPair = parseAgentMcpServers(wireContract.responses[1].value);
const claudeTruncated = parseAgentMcpServers(wireContract.responses[3].value);

function project(rootPath: string, label: string): AgentProjectDescriptor {
  return { rootKey: rootPath, rootPath, label } as AgentProjectDescriptor;
}

function request(repositoryRoot: string, provider: AgentCliKind): AgentMcpServersRequest {
  return { repositoryRoot, provider };
}

function projectKey(repositoryRoot: string): string {
  return agentMcpServersProjectKey({ kind: "local", repositoryRoot });
}

describe("McpServersSettingsPage", () => {
  let host: HTMLDivElement;
  let root: Root;
  let gateway: DeferredAgentMcpServersGateway;
  let surface: AgentMcpServersSurface;
  let checkedAgoMs: number;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    gateway = new DeferredAgentMcpServersGateway();
    checkedAgoMs = 0;
    const serverProjects = new AgentMcpServerProjectsStore(null);
    surface = {
      store: new AgentMcpServersStatusStore(
        agentMcpServersSource(gateway, null, serverProjects),
        undefined,
        () => Date.now() - checkedAgoMs,
      ),
      projectChoice: new AgentMcpServersProjectChoiceStore(),
      serverProjects,
      management: UNSUPPORTED_AGENT_MCP_SERVER_MANAGEMENT,
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function environment(overrides: Partial<SettingsEnvironment> = {}): SettingsEnvironment {
    return settingsPagePropsFixture({
      env: { agentMcpServers: surface, hasWorkspace: true, workspaceRoot: APP, ...overrides },
    }).env;
  }

  function scene(env: SettingsEnvironment, section: SettingsSectionId): ReactNode {
    const { actions, draft } = settingsPagePropsFixture();
    return (
      <>
        <header>
          <SettingsPageActions actions={actions} draft={draft} env={env} section={section} />
        </header>
        <main>
          <SettingsPageHost actions={actions} draft={draft} env={env} section={section} />
        </main>
      </>
    );
  }

  function show(
    env: SettingsEnvironment = environment(),
    section: SettingsSectionId = "mcp",
    wrap: (children: ReactNode) => ReactNode = (children) => children,
  ): SettingsEnvironment {
    act(() => root.render(wrap(scene(env, section))));
    return env;
  }

  async function answer(
    target: AgentMcpServersRequest,
    result: AgentMcpServers | string,
  ): Promise<void> {
    const pending = gateway.checks.filter(
      (check) =>
        check.request.repositoryRoot === target.repositoryRoot &&
        check.request.provider === target.provider,
    );
    const latest = pending[pending.length - 1];
    expect(
      pending.length,
      `No check was asked for ${target.provider} in ${target.repositoryRoot}`,
    ).toBeGreaterThan(0);
    await act(async () => {
      if (typeof result === "string") latest?.reject(result);
      if (typeof result !== "string") latest?.resolve(result);
    });
  }

  async function answerBoth(
    repositoryRoot: string = APP,
    claude: AgentMcpServers = claudeMixed,
    codex: AgentMcpServers = codexPair,
  ): Promise<void> {
    await answer(request(repositoryRoot, "claudeCode"), claude);
    await answer(request(repositoryRoot, "codex"), codex);
  }

  function group(provider: AgentCliKind): HTMLElement {
    const element = host.querySelector<HTMLElement>(`[data-mcp-provider="${provider}"]`);
    expect(element, `Missing ${provider} group`).not.toBeNull();
    return element ?? document.createElement("div");
  }

  function section(provider: AgentCliKind): HTMLElement {
    return group(provider).closest("section") ?? document.createElement("section");
  }

  function summary(provider: AgentCliKind): string {
    return group(provider).querySelector(".settings-mcp-summary")?.textContent ?? "";
  }

  function serverRows(provider: AgentCliKind): ReadonlyArray<HTMLElement> {
    return [...group(provider).querySelectorAll<HTMLElement>("[data-mcp-server]")];
  }

  function serverNames(provider: AgentCliKind): ReadonlyArray<string | undefined> {
    return serverRows(provider).map((row) => row.dataset.mcpServer);
  }

  function serverRow(provider: AgentCliKind, name: string): HTMLElement {
    const row = serverRows(provider).find((candidate) => candidate.dataset.mcpServer === name);
    expect(row, `Missing server ${name}`).toBeDefined();
    return row ?? document.createElement("div");
  }

  function headings(provider: AgentCliKind): ReadonlyArray<string> {
    return [...group(provider).querySelectorAll("h3, h4, h5")].map(
      (heading) => `${heading.tagName}:${heading.textContent}`,
    );
  }

  function labelledGroups(provider: AgentCliKind): ReadonlyArray<readonly [string, number]> {
    return [...group(provider).querySelectorAll('[role="group"]')].map((region) => {
      const label = document.getElementById(region.getAttribute("aria-labelledby") ?? "");
      return [label?.textContent ?? "", region.querySelectorAll("[data-mcp-server]").length];
    });
  }

  function refreshButton(): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>('button[aria-label="Check MCP servers"]');
  }

  function projectSelect(): HTMLSelectElement | null {
    return host.querySelector<HTMLSelectElement>('select[aria-label="Project"]');
  }

  function chooseProject(repositoryRoot: string): void {
    const select = projectSelect();
    expect(select).not.toBeNull();
    act(() => {
      if (select === null) return;
      select.value = projectKey(repositoryRoot);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("checks nothing while another settings page is shown, then both providers once", () => {
    const env = show(environment(), "usage");
    expect(gateway.requests()).toEqual([]);
    expect(refreshButton()).toBeNull();

    show(env, "mcp");
    expect(gateway.requests()).toEqual([request(APP, "claudeCode"), request(APP, "codex")]);

    show(env, "mcp");
    show(env, "usage");
    show(env, "mcp");
    expect(gateway.requests()).toHaveLength(2);
  });

  it("starts a single check per provider under StrictMode", () => {
    show(environment(), "mcp", (children) => <StrictMode>{children}</StrictMode>);
    expect(gateway.requests()).toEqual([request(APP, "claudeCode"), request(APP, "codex")]);
  });

  it("never checks on a timer", async () => {
    vi.useFakeTimers();
    try {
      show();
      await answerBoth();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1_000);
      });
      expect(gateway.requests()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says a check is running and disables refresh until both providers answer", async () => {
    show();
    expect(summary("claudeCode")).toBe("Checking MCP servers…");
    expect(summary("codex")).toBe("Checking MCP servers…");
    expect(group("claudeCode").getAttribute("aria-busy")).toBe("true");
    expect(serverRows("claudeCode")).toHaveLength(0);
    expect(refreshButton()?.disabled).toBe(true);

    await answer(request(APP, "claudeCode"), claudeMixed);
    expect(group("claudeCode").getAttribute("aria-busy")).toBe("false");
    expect(group("codex").getAttribute("aria-busy")).toBe("true");
    expect(refreshButton()?.disabled).toBe(true);

    await answer(request(APP, "codex"), codexPair);
    expect(refreshButton()?.disabled).toBe(false);
    expect(host.textContent).toContain(
      "Checking starts each configured server once, the same way an agent session does.",
    );
  });

  it("filters rows across providers and plugin groups and restores them with Escape", async () => {
    show();
    await answerBoth(
      APP,
      agentMcpServersFixture("claudeCode", [
        { name: "Café-files", scope: "project" },
        { name: "plugin:cloudflare:docs", scope: "plugin", transport: "http" },
        { name: "plugin:miro:boards", scope: "plugin", transport: "http" },
      ]),
      codexPair,
    );
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search MCP servers"]');
    expect(input?.type).toBe("search");
    expect(input?.placeholder).toBe("Search MCP servers");
    if (input === null) return;
    const original = [...host.querySelectorAll<HTMLElement>("[data-mcp-server]")].map(
      (row) => row.dataset.mcpServer,
    );
    const typeQuery = (query: string): void => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          input,
          query,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    typeQuery("CAFE");
    expect(serverNames("claudeCode")).toEqual(["Café-files"]);
    expect(host.querySelector('[data-mcp-provider="codex"]')).toBeNull();
    expect(host.querySelector(".settings-mcp-plugins")).toBeNull();
    typeQuery("cloudflare");
    expect(serverNames("claudeCode")).toEqual(["plugin:cloudflare:docs"]);
    expect(labelledGroups("claudeCode")).toEqual([
      ["From plugins", 1],
      ["cloudflare", 1],
    ]);
    typeQuery("HTTP");
    expect(serverNames("claudeCode")).toEqual(["plugin:cloudflare:docs", "plugin:miro:boards"]);
    expect(serverNames("codex")).toEqual(["codex_apps"]);
    typeQuery('missing "server"');
    expect(host.querySelectorAll("[data-mcp-server]")).toHaveLength(0);
    expect(host.querySelectorAll("[data-mcp-provider]")).toHaveLength(0);
    expect(host.textContent).toContain('No MCP servers match “missing "server"”');
    const escaped = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.focus();
      input.dispatchEvent(escaped);
    });
    expect(escaped.defaultPrevented).toBe(true);
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(
      [...host.querySelectorAll<HTMLElement>("[data-mcp-server]")].map(
        (row) => row.dataset.mcpServer,
      ),
    ).toEqual(original);
    expect(host.textContent).not.toContain("No MCP servers match");
    expect(gateway.requests()).toHaveLength(2);
  });

  it("clears the search from the field and from the no-match card", async () => {
    show();
    await answerBoth();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search MCP servers"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    const original = [...host.querySelectorAll<HTMLElement>("[data-mcp-server]")].length;
    const typeQuery = (query: string): void => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          input,
          query,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const clearButtons = (): ReadonlyArray<HTMLButtonElement> =>
      [...host.querySelectorAll<HTMLButtonElement>("button")].filter(
        (button) =>
          button.getAttribute("aria-label") === "Clear search" ||
          button.textContent === "Clear search",
      );
    expect(clearButtons()).toEqual([]);

    typeQuery("redis");
    const card = host.querySelector(".settings-mcp-empty");
    expect(card?.querySelector('[role="status"]')?.textContent).toBe(
      "No MCP servers match “redis”",
    );
    expect(card?.querySelector("strong")?.textContent).toBe("“redis”");
    expect(clearButtons()).toHaveLength(2);
    act(() => card?.querySelector<HTMLButtonElement>("button")?.click());
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(host.querySelector(".settings-mcp-empty")).toBeNull();
    expect(host.querySelectorAll("[data-mcp-server]")).toHaveLength(original);

    typeQuery("sentry");
    expect(host.querySelector(".settings-mcp-empty")).toBeNull();
    const inline = host.querySelector<HTMLButtonElement>(".settings-mcp-search__clear");
    expect(inline?.getAttribute("aria-label")).toBe("Clear search");
    act(() => inline?.click());
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(host.querySelector(".settings-mcp-search__clear")).toBeNull();
    expect(host.querySelectorAll("[data-mcp-server]")).toHaveLength(original);

    const escaped = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => input.dispatchEvent(escaped));
    expect(escaped.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(input);
  });

  it.each([
    ["FAILED", "problem", "Failed"],
    ["MCP LOGIN", "needs-login", "claude mcp login -- 'needs-login'"],
    ["To sign in, run", "needs-login", "To sign in, run"],
  ])("keeps rows whose displayed status or sign-in hint matches %s", async (query, name, text) => {
    show();
    await answerBoth(
      APP,
      agentMcpServersFixture("claudeCode", [
        { name: "problem", status: "failed" },
        { name: "needs-login", status: "needsAuth", transport: "http" },
        { name: "ready", status: "connected" },
      ]),
      agentMcpServersFixture("codex", []),
    );
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search MCP servers"]');
    expect(input).not.toBeNull();
    act(() => {
      if (input === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(serverNames("claudeCode")).toEqual([name]);
    expect(serverRow("claudeCode", name).textContent).toContain(text);
    expect(host.textContent).not.toContain("No MCP servers match");
  });

  it("keeps discovery notices while searching and waits for complete results before claiming no matches", async () => {
    show();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search MCP servers"]');
    expect(input).not.toBeNull();
    act(() => {
      if (input === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "missing",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(summary("claudeCode")).toBe("Checking MCP servers…");
    expect(host.textContent).not.toContain("No MCP servers match");
    await answer(request(APP, "claudeCode"), wireContract.errors.unavailable);
    await answer(request(APP, "codex"), codexPair);
    expect(group("claudeCode").querySelector('[role="alert"]')?.textContent).toBe(
      mcpErrorMessage("unavailable", "claudeCode"),
    );
    expect(host.textContent).not.toContain("No MCP servers match");
    act(() => refreshButton()?.click());
    await answerBoth(APP, claudeTruncated, codexPair);
    expect(group("claudeCode").textContent).toContain("Some servers are not shown.");
    expect(host.textContent).not.toContain("No MCP servers match");
    act(() => refreshButton()?.click());
    await answerBoth();
    expect(host.textContent).toContain("No MCP servers match “missing”");
    expect(host.querySelectorAll("[data-mcp-provider]")).toHaveLength(0);
  });

  it("lists servers needing attention first with worded statuses and known details only", async () => {
    show();
    await answerBoth();

    expect(serverNames("claudeCode")).toEqual([
      "sentry",
      "claude.ai Gmail",
      "slow-indexer",
      "filesystem",
      "legacy-events",
    ]);
    expect(summary("claudeCode")).toBe("5 servers, 2 need attention");
    expect(
      serverRows("claudeCode").map((row) => row.querySelector(".settings-mcp-status")?.textContent),
    ).toEqual(["Failed", "Needs sign-in", "Connecting", "Connected", "Disabled"]);
    for (const row of serverRows("claudeCode")) {
      expect(row.querySelector(".settings-mcp-status svg")).not.toBeNull();
    }
    expect(serverRow("claudeCode", "sentry").textContent).toContain(
      "User · HTTP · https://mcp.sentry.dev",
    );
    expect(serverRow("claudeCode", "sentry").textContent).toContain("Connection closed");
    expect(serverRow("claudeCode", "filesystem").textContent).toContain(
      "Project · stdio · 14 tools",
    );

    expect(serverNames("codex")).toEqual(["docs", "codex_apps"]);
    expect(serverRow("codex", "docs").textContent).toBe("docs0 toolsStatus unknown");
    expect(host.textContent).not.toMatch(/\bunknown ·|· unknown\b/);
  });

  it("lists the user's own servers first, then plugin servers under their plugin", async () => {
    const env = show();
    await answer(
      request(APP, "claudeCode"),
      agentMcpServersFixture("claudeCode", [
        { name: "plugin:miro:miro", status: "needsAuth", scope: "unknown", transport: "http" },
        {
          name: "plugin:cloudflare:cloudflare-docs",
          scope: "unknown",
          transport: "http",
          toolCount: 2,
        },
        { name: "sentry", scope: "user", transport: "stdio" },
        {
          name: "plugin:cloudflare:cloudflare-api",
          status: "needsAuth",
          scope: "unknown",
          transport: "http",
        },
        { name: "atlassian", scope: "user", transport: "http", toolCount: 25 },
      ]),
    );
    await answer(request(APP, "codex"), codexPair);

    expect(summary("claudeCode")).toBe("5 servers, 2 need attention");
    expect(serverNames("claudeCode")).toEqual([
      "atlassian",
      "sentry",
      "plugin:cloudflare:cloudflare-api",
      "plugin:cloudflare:cloudflare-docs",
      "plugin:miro:miro",
    ]);
    expect(headings("claudeCode")).toEqual([
      "H3:atlassian",
      "H3:sentry",
      "H3:From plugins",
      "H4:cloudflare",
      "H5:cloudflare-api",
      "H5:cloudflare-docs",
      "H4:miro",
      "H5:miro",
    ]);
    expect(labelledGroups("claudeCode")).toEqual([
      ["From plugins", 3],
      ["cloudflare", 2],
      ["miro", 1],
    ]);
    expect(serverRow("claudeCode", "atlassian").textContent).toBe(
      "atlassianUser · HTTP · 25 toolsConnected",
    );
    expect(serverRow("claudeCode", "plugin:cloudflare:cloudflare-docs").textContent).toBe(
      "cloudflare-docsHTTP · 2 toolsConnected",
    );
    expect(group("claudeCode").querySelector(".settings-mcp-plugins")?.textContent).toContain(
      "These servers are installed by plugins. To remove one, remove its plugin.",
    );
    expect(group("claudeCode").querySelectorAll(".settings-mcp-plugins button")).toHaveLength(2);

    const api = serverRow("claudeCode", "plugin:cloudflare:cloudflare-api");
    expect(api.querySelector("code")?.textContent).toBe(
      "claude mcp login -- 'plugin:cloudflare:cloudflare-api'",
    );
    act(() =>
      api
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Copy sign-in command for plugin:cloudflare:cloudflare-api"]',
        )
        ?.click(),
    );
    expect(env.onCopyInstallCommand).toHaveBeenCalledExactlyOnceWith(
      "claude mcp login -- 'plugin:cloudflare:cloudflare-api'",
    );

    expect(headings("codex")).toEqual([
      "H3:docs",
      "H3:From plugins",
      "H4:Unknown plugin",
      "H5:codex_apps",
    ]);
    expect(labelledGroups("codex")).toEqual([
      ["From plugins", 1],
      ["Unknown plugin", 1],
    ]);
    expect(serverRow("codex", "codex_apps").textContent).toBe(
      "codex_appsHTTP · https://chatgpt.com · 37 toolsConnected",
    );
  });

  it("shows no plugin heading when no server comes from a plugin", async () => {
    show();
    await answer(request(APP, "claudeCode"), claudeMixed);
    expect(serverNames("claudeCode")).toHaveLength(5);
    expect(group("claudeCode").querySelector(".settings-mcp-plugins")).toBeNull();
    expect(group("claudeCode").querySelector('[role="group"]')).toBeNull();
    expect(headings("claudeCode").every((heading) => heading.startsWith("H3:"))).toBe(true);
  });

  it("shows how to sign in and copies the exact command", async () => {
    const env = show();
    await answer(request(APP, "claudeCode"), claudeMixed);
    await answer(
      request(APP, "codex"),
      agentMcpServersFixture("codex", [
        { name: "it's $HOME", status: "needsAuth", transport: "http" },
      ]),
    );

    const connector = serverRow("claudeCode", "claude.ai Gmail");
    expect(connector.querySelector("code")?.textContent).toBe(
      "claude mcp login -- 'claude.ai Gmail'",
    );
    expect(
      connector.querySelector('button[aria-label="Copy sign-in command for claude.ai Gmail"]'),
    ).not.toBeNull();
    expect(host.textContent).not.toContain("claude.ai connector settings");

    const row = serverRow("codex", "it's $HOME");
    expect(row.querySelector("code")?.textContent).toBe("codex mcp login -- 'it'\\''s $HOME'");
    const copy = row.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy sign-in command for it\'s $HOME"]',
    );
    expect(copy).not.toBeNull();
    act(() => copy?.click());
    expect(env.onCopyInstallCommand).toHaveBeenCalledExactlyOnceWith(
      "codex mcp login -- 'it'\\''s $HOME'",
    );
    expect(gateway.requests()).toHaveLength(2);
  });

  it("offers a login command that survives a dash-led server name", async () => {
    const env = show();
    await answer(
      request(APP, "claudeCode"),
      agentMcpServersFixture("claudeCode", [
        { name: "-x", status: "needsAuth", transport: "http", scope: "user" },
      ]),
    );
    const row = serverRow("claudeCode", "-x");
    expect(row.querySelector("code")?.textContent).toBe("claude mcp login -- '-x'");
    act(() => row.querySelector<HTMLButtonElement>("button")?.click());
    expect(env.onCopyInstallCommand).toHaveBeenCalledExactlyOnceWith("claude mcp login -- '-x'");
  });

  it("offers no sign-in command for a server that does not need one", async () => {
    show();
    await answerBoth();
    for (const name of ["sentry", "filesystem", "slow-indexer", "legacy-events"]) {
      expect(serverRow("claudeCode", name).querySelector("code"), name).toBeNull();
      expect(serverRow("claudeCode", name).querySelector("button"), name).toBeNull();
    }
  });

  it("stamps each provider with the age of its own check", async () => {
    show();
    checkedAgoMs = 5 * 60_000 + 30_000;
    await answer(request(APP, "claudeCode"), claudeMixed);
    expect(section("claudeCode").querySelector(".settings-section__note")?.textContent).toBe(
      "Checked 5m ago",
    );
    expect(section("codex").querySelector(".settings-section__note")).toBeNull();

    checkedAgoMs = 0;
    await answer(request(APP, "codex"), codexPair);
    expect(section("codex").querySelector(".settings-section__note")?.textContent).toBe(
      "Checked just now",
    );
  });

  it("keeps the previous rows visible and marks the group busy while rechecking", async () => {
    show();
    await answerBoth();
    act(() => refreshButton()?.click());

    expect(gateway.requests()).toEqual([
      request(APP, "claudeCode"),
      request(APP, "codex"),
      request(APP, "claudeCode"),
      request(APP, "codex"),
    ]);
    expect(refreshButton()?.disabled).toBe(true);
    expect(group("claudeCode").getAttribute("aria-busy")).toBe("true");
    expect(summary("claudeCode")).toBe("Checking MCP servers…");
    expect(serverNames("claudeCode")).toHaveLength(5);
    expect(serverNames("codex")).toEqual(["docs", "codex_apps"]);

    await answer(
      request(APP, "claudeCode"),
      agentMcpServersFixture("claudeCode", [{ name: "only" }]),
    );
    expect(serverNames("claudeCode")).toEqual(["only"]);
    expect(summary("claudeCode")).toBe("1 server");
    expect(refreshButton()?.disabled).toBe(true);
    await answer(request(APP, "codex"), codexPair);
    expect(refreshButton()?.disabled).toBe(false);
  });

  it("explains an empty list per provider with that provider's add command", async () => {
    show();
    await answerBoth(
      APP,
      agentMcpServersFixture("claudeCode", []),
      agentMcpServersFixture("codex", []),
    );

    expect(summary("claudeCode")).toBe(
      "No MCP servers are configured for Claude Code in this project.",
    );
    expect(group("claudeCode").querySelector("code")?.textContent).toBe("claude mcp add");
    expect(summary("codex")).toBe("No MCP servers are configured for Codex in this project.");
    expect(group("codex").querySelector("code")?.textContent).toBe("codex mcp add");
    expect(serverRows("claudeCode")).toHaveLength(0);
  });

  it("says so when the backend could not list every server", async () => {
    show();
    await answerBoth(APP, claudeTruncated, codexPair);

    expect(group("claudeCode").textContent).toContain("Some servers are not shown.");
    expect(serverNames("claudeCode")).toEqual(["filesystem"]);
    expect(group("codex").textContent).not.toContain("Some servers are not shown.");
  });

  it.each(AGENT_MCP_SERVERS_ERROR_KINDS)(
    "reports the %s failure for one provider without hiding the other",
    async (kind) => {
      show();
      await answer(request(APP, "claudeCode"), wireContract.errors[kind]);

      const alert = group("claudeCode").querySelector('[role="alert"]');
      expect(alert?.textContent).toBe(mcpErrorMessage(kind, "claudeCode"));
      expect(group("claudeCode").getAttribute("aria-busy")).toBe("false");
      expect(serverRows("claudeCode")).toHaveLength(0);
      expect(summary("codex")).toBe("Checking MCP servers…");
      expect(group("codex").querySelector('[role="alert"]')).toBeNull();

      await answer(request(APP, "codex"), codexPair);
      expect(serverNames("codex")).toEqual(["docs", "codex_apps"]);
      expect(alert?.textContent).toBe(mcpErrorMessage(kind, "claudeCode"));
      expect(refreshButton()?.disabled).toBe(false);
    },
  );

  it("reports an unreadable answer as unavailable instead of showing partial data", async () => {
    show();
    await answer(request(APP, "claudeCode"), codexPair);
    expect(group("claudeCode").querySelector('[role="alert"]')?.textContent).toBe(
      "Could not read MCP servers from Claude Code.",
    );
    expect(serverRows("claudeCode")).toHaveLength(0);
  });

  it("keeps the last rows under a passing failure and drops them when access is refused", async () => {
    show();
    await answerBoth();
    act(() => refreshButton()?.click());
    await answer(request(APP, "claudeCode"), wireContract.errors.timedOut);
    await answer(request(APP, "codex"), wireContract.errors.untrustedWorkspace);

    expect(group("claudeCode").querySelector('[role="alert"]')?.textContent).toBe(
      "Claude Code did not answer in time. Check again.",
    );
    expect(serverNames("claudeCode")).toHaveLength(5);
    expect(section("claudeCode").querySelector(".settings-section__note")?.textContent).toBe(
      "Checked just now",
    );
    expect(group("codex").querySelector('[role="alert"]')?.textContent).toBe(
      "This project is not trusted. Trust it to check its MCP servers.",
    );
    expect(serverRows("codex")).toHaveLength(0);
    expect(section("codex").querySelector(".settings-section__note")).toBeNull();
  });

  it("does not recheck a failed or loaded target just because the page is shown again", async () => {
    const env = show();
    await answer(request(APP, "claudeCode"), wireContract.errors.busy);
    await answer(request(APP, "codex"), codexPair);

    show(env, "usage");
    show(env, "mcp");

    expect(gateway.requests()).toHaveLength(2);
    expect(group("claudeCode").querySelector('[role="alert"]')?.textContent).toBe(
      "A check is already running for this project. Try again in a moment.",
    );
    expect(serverNames("codex")).toEqual(["docs", "codex_apps"]);

    act(() => refreshButton()?.click());
    expect(gateway.requests()).toHaveLength(4);
  });

  it("offers no project selector for a single local project", async () => {
    show(environment({ agentProjects: [project(APP, "App")] }));
    expect(projectSelect()).toBeNull();
    expect(host.textContent).toContain("App");
    expect(host.textContent).toContain(APP);
  });

  it("defaults to the open workspace and checks another project only once it is chosen", async () => {
    show(environment({ agentProjects: [project(API, "api"), project(APP, "App")] }));

    expect(projectSelect()?.value).toBe(projectKey(APP));
    expect([...(projectSelect()?.options ?? [])].map((option) => option.textContent)).toEqual([
      "App",
      "api",
    ]);
    expect(gateway.requests()).toEqual([request(APP, "claudeCode"), request(APP, "codex")]);
    await answerBoth(APP);

    chooseProject(API);
    expect(projectSelect()?.value).toBe(projectKey(API));
    expect(gateway.requests().slice(2)).toEqual([
      request(API, "claudeCode"),
      request(API, "codex"),
    ]);
    expect(serverRows("claudeCode")).toHaveLength(0);
    expect(summary("claudeCode")).toBe("Checking MCP servers…");
    expect(refreshButton()?.disabled).toBe(true);

    await answerBoth(
      API,
      agentMcpServersFixture("claudeCode", [{ name: "api-only" }]),
      agentMcpServersFixture("codex", []),
    );
    expect(serverNames("claudeCode")).toEqual(["api-only"]);

    chooseProject(APP);
    expect(gateway.requests()).toHaveLength(4);
    expect(serverNames("claudeCode")).toHaveLength(5);
    expect(serverNames("codex")).toEqual(["docs", "codex_apps"]);

    act(() => refreshButton()?.click());
    expect(gateway.requests().slice(4)).toEqual([
      request(APP, "claudeCode"),
      request(APP, "codex"),
    ]);
  });

  it("never shows a late answer for the previous project under the chosen one", async () => {
    show(environment({ agentProjects: [project(API, "api")] }));
    chooseProject(API);

    await answerBoth(APP);
    expect(serverRows("claudeCode")).toHaveLength(0);
    expect(summary("claudeCode")).toBe("Checking MCP servers…");
    expect(summary("codex")).toBe("Checking MCP servers…");

    chooseProject(APP);
    expect(serverNames("claudeCode")).toHaveLength(5);
    expect(gateway.requests()).toHaveLength(4);
  });

  it("defaults to the first project when no workspace is open", () => {
    show(
      environment({
        agentProjects: [project(API, "api"), project(APP, "App")],
        hasWorkspace: false,
        workspaceRoot: null,
      }),
    );
    expect(projectSelect()?.value).toBe(projectKey(API));
    expect(gateway.requests()).toEqual([request(API, "claudeCode"), request(API, "codex")]);
  });

  it("scopes a project choice to the workspace it was made in", () => {
    const projects = [project(API, "api"), project(APP, "App"), project("/work/web", "web")];
    show(environment({ agentProjects: projects }));
    chooseProject("/work/web");
    expect(projectSelect()?.value).toBe(projectKey("/work/web"));

    show(environment({ agentProjects: projects, workspaceRoot: API }));
    expect(projectSelect()?.value).toBe(projectKey(API));

    show(environment({ agentProjects: projects, workspaceRoot: APP }));
    expect(projectSelect()?.value).toBe(projectKey("/work/web"));

    show(environment({ agentProjects: projects.slice(0, 2), workspaceRoot: APP }));
    expect(projectSelect()?.value).toBe(projectKey(APP));
  });

  it("asks to open a project when there is no local project and checks nothing", () => {
    show(environment({ agentProjects: [], hasWorkspace: false, workspaceRoot: null }));

    expect(host.textContent).toContain("Open a project to see its MCP servers.");
    expect(host.querySelector("[data-mcp-provider]")).toBeNull();
    expect(host.querySelector('[data-settings-row="mcp.servers"] h2')?.textContent).toBe(
      "MCP servers",
    );
    expect(refreshButton()).toBeNull();
    expect(gateway.requests()).toEqual([]);
    expect(host.textContent).not.toContain("Projects on servers are not checked yet.");
  });

  it("explains itself and offers no refresh when the status surface is missing", () => {
    show(environment({ agentMcpServers: null }));

    expect(host.textContent).toContain("MCP server status is not available in this window.");
    expect(host.querySelector('[data-settings-row="mcp.servers"]')).not.toBeNull();
    expect(refreshButton()).toBeNull();
    expect(gateway.requests()).toEqual([]);
  });

  it("renders a server name as text, never as markup", async () => {
    show();
    await answer(
      request(APP, "claudeCode"),
      agentMcpServersFixture("claudeCode", [{ name: "<img src=x onerror=alert(1)>" }]),
    );
    expect(group("claudeCode").querySelector("img")).toBeNull();
    expect(serverRow("claudeCode", "<img src=x onerror=alert(1)>").textContent).toContain(
      "<img src=x onerror=alert(1)>",
    );
  });

  it("settles the page after an answer that arrives outside an interaction", async () => {
    show();
    gateway.checks[0]?.resolve(claudeMixed);
    await waitForReact(() => expect(serverNames("claudeCode")).toHaveLength(5));
    expect(summary("codex")).toBe("Checking MCP servers…");
  });
});
