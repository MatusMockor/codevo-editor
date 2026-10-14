// @vitest-environment jsdom
import { StrictMode, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentMcpServerManagementCoordinator } from "../../../application/agentMcpServerManagementStore";
import { AgentMcpServerProjectsStore } from "../../../application/agentMcpServerProjects";
import { agentMcpServersSource } from "../../../application/agentMcpServersGateway";
import { AgentMcpServersProjectChoiceStore } from "../../../application/agentMcpServersProjectChoice";
import { AgentMcpServersStatusStore } from "../../../application/agentMcpServersStore";
import type { AgentMcpServersSurface } from "../../../application/agentMcpServersSurface";
import {
  AGENT_MCP_SERVER_MANAGEMENT_ERRORS,
  type AgentMcpServerLoginStep,
} from "../../../domain/agentMcpServerManagement";
import type { AgentMcpServer, AgentMcpServers } from "../../../domain/agentMcpServers";
import {
  agentMcpServersProjectKey,
  localAgentMcpServersTarget,
} from "../../../domain/agentMcpServersTarget";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { AgentCliKind } from "../../../domain/agentTask";
import {
  DeferredAgentMcpServerManagement,
  ManualScheduler,
  RecordingUrlOpener,
} from "../../../test/agentMcpServerManagementTestSupport";
import {
  DeferredAgentMcpServersGateway,
  agentMcpServersFixture,
} from "../../../test/agentMcpServersTestSupport";
import { click, press } from "../../../ui/foundation/foundationTestSupport";
import type { SettingsEnvironment } from "../settingsPageProps";
import { SettingsPageHost } from "../settingsPages";
import { settingsPagePropsFixture } from "./settingsPageTestSupport";

const APP = "/work/app";
const API = "/work/api";
const LOGIN_ID = "login-0123456789";
const SECRET_QUERY = "client_id=abc&state=secret-state";
const AUTHORIZE = `https://auth.example.com/authorize?${SECRET_QUERY}`;
const CALLBACK = "http://localhost:53682/callback?code=secret-code&state=secret-state";
const POLL_MS = 1500;
const HINT = "To sign in, run";

type Listed = Partial<AgentMcpServer> & { readonly name: string };

const linear: Listed = {
  name: "linear",
  status: "needsAuth",
  scope: "local",
  transport: "http",
  endpointOrigin: "https://mcp.linear.app",
};
const sentry: Listed = { name: "sentry", status: "connected", scope: "user", transport: "http" };
const files: Listed = { name: "files", status: "connected", scope: "project", transport: "stdio" };
const pluginServer: Listed = {
  name: "plugin:docs",
  status: "needsAuth",
  scope: "plugin",
  transport: "http",
};

function awaiting(delivery: "automatic" | "paste" = "automatic"): AgentMcpServerLoginStep {
  return { kind: "awaitingCallback", loginId: LOGIN_ID, authorizationUrl: AUTHORIZE, delivery };
}

describe("McpServersSettingsPage management", () => {
  let host: HTMLDivElement;
  let root: Root;
  let checks: DeferredAgentMcpServersGateway;
  let management: DeferredAgentMcpServerManagement;
  let scheduler: ManualScheduler;
  let urlOpener: RecordingUrlOpener;
  let surface: AgentMcpServersSurface;
  let copied: Array<string>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    checks = new DeferredAgentMcpServersGateway();
    management = new DeferredAgentMcpServerManagement();
    scheduler = new ManualScheduler();
    urlOpener = new RecordingUrlOpener();
    copied = [];
    const serverProjects = new AgentMcpServerProjectsStore(null);
    const store = new AgentMcpServersStatusStore(
      agentMcpServersSource(checks, null, serverProjects),
    );
    surface = {
      store,
      projectChoice: new AgentMcpServersProjectChoiceStore(),
      serverProjects,
      management: new AgentMcpServerManagementCoordinator({
        management,
        statuses: store,
        urlOpener,
        scheduler,
      }),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function environment(): SettingsEnvironment {
    return settingsPagePropsFixture({
      env: {
        agentMcpServers: surface,
        agentProjects: [{ rootKey: API, rootPath: API, label: "api" } as AgentProjectDescriptor],
        hasWorkspace: true,
        workspaceRoot: APP,
        onCopyInstallCommand: (command) => copied.push(command),
      },
    }).env;
  }

  function show(wrap: (children: ReactNode) => ReactNode = (children) => children): void {
    const { actions, draft } = settingsPagePropsFixture();
    act(() =>
      root.render(
        wrap(
          <SettingsPageHost actions={actions} draft={draft} env={environment()} section="mcp" />,
        ),
      ),
    );
  }

  async function settle(): Promise<void> {
    await act(async () => {
      for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
    });
  }

  async function answer(provider: AgentCliKind, result: AgentMcpServers): Promise<void> {
    const pending = checks.checks.filter((check) => check.request.provider === provider);
    expect(pending.length, `No check was asked for ${provider}`).toBeGreaterThan(0);
    pending[pending.length - 1]?.resolve(result);
    await settle();
  }

  async function showServers(
    claude: ReadonlyArray<Listed> = [linear, sentry, files, pluginServer],
    codex: ReadonlyArray<Listed> = [{ ...sentry, name: "codex-http" }],
  ): Promise<void> {
    show();
    await answer("claudeCode", agentMcpServersFixture("claudeCode", claude));
    await answer("codex", agentMcpServersFixture("codex", codex));
  }

  async function chooseProject(repositoryRoot: string): Promise<void> {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Project"]');
    expect(select, "Missing the project select").not.toBeNull();
    act(() => {
      if (select === null) return;
      select.value = agentMcpServersProjectKey({ kind: "local", repositoryRoot });
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
  }

  async function showBothProjects(servers: ReadonlyArray<Listed> = [linear, sentry]) {
    await showServers(servers, []);
    await chooseProject(API);
    await answer("claudeCode", agentMcpServersFixture("claudeCode", servers));
    await answer("codex", agentMcpServersFixture("codex", []));
    await chooseProject(APP);
  }

  function checksFor(repositoryRoot: string): number {
    return checks.requests().filter((request) => request.repositoryRoot === repositoryRoot).length;
  }

  function section(provider: AgentCliKind): HTMLElement {
    const group = host.querySelector<HTMLElement>(`[data-mcp-provider="${provider}"]`);
    expect(group, `Missing ${provider} group`).not.toBeNull();
    return group?.closest("section") ?? document.createElement("section");
  }

  function row(name: string, provider: AgentCliKind = "claudeCode"): HTMLElement {
    const found = [...section(provider).querySelectorAll<HTMLElement>("[data-mcp-server]")].find(
      (candidate) => candidate.dataset.mcpServer === name,
    );
    expect(found, `Missing server ${name}`).toBeDefined();
    return found ?? document.createElement("div");
  }

  function button(scope: ParentNode, label: string): HTMLButtonElement | null {
    return (
      [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
        (candidate) =>
          candidate.getAttribute("aria-label") === label || candidate.textContent === label,
      ) ?? null
    );
  }

  function pressButton(scope: ParentNode, label: string): void {
    const target = button(scope, label);
    expect(target, `Missing button ${label}`).not.toBeNull();
    expect(target?.disabled, `Button ${label} is disabled`).toBe(false);
    if (target !== null) click(target);
  }

  function field(scope: ParentNode, label: string): HTMLInputElement | null {
    const caption = [...scope.querySelectorAll<HTMLLabelElement>("label")].find(
      (candidate) => candidate.textContent === label,
    );
    if (caption === undefined) return null;
    return document.getElementById(caption.htmlFor) as HTMLInputElement | null;
  }

  function type(scope: ParentNode, label: string, text: string): void {
    const input = field(scope, label);
    expect(input, `Missing field ${label}`).not.toBeNull();
    act(() => {
      if (input === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function texts(scope: ParentNode, role: "status" | "alert"): ReadonlyArray<string> {
    return [...scope.querySelectorAll(`[role="${role}"]`)].map((node) => node.textContent ?? "");
  }

  function dialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  }

  function menuItems(): ReadonlyArray<string> {
    return [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(
      (item) => item.textContent ?? "",
    );
  }

  function chooseMenuItem(label: string): void {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === label,
    );
    expect(item, `Missing menu item ${label}`).toBeDefined();
    if (item !== undefined) click(item);
  }

  function radio(scope: ParentNode, label: string): HTMLButtonElement | null {
    return (
      [...scope.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
        (candidate) => candidate.textContent === label,
      ) ?? null
    );
  }

  async function startSignIn(step: AgentMcpServerLoginStep): Promise<void> {
    pressButton(row("linear"), "Sign in to linear");
    await settle();
    management.starts.latest()?.resolve(step);
    await settle();
    urlOpener.opened.latest()?.resolve();
    await settle();
  }

  async function poll(state: "pending" | "succeeded" | "failed"): Promise<void> {
    act(() => scheduler.advance(POLL_MS));
    await settle();
    management.states.latest()?.resolve(state);
    await settle();
  }

  it("keeps the copy-command hint and offers no actions while management is unsupported", async () => {
    management.supported = "unsupported";
    await showServers();
    expect(row("linear").textContent).toContain(HINT);
    expect(row("linear").textContent).toContain("claude mcp login -- 'linear'");
    pressButton(row("linear"), "Copy sign-in command for linear");
    expect(copied).toEqual(["claude mcp login -- 'linear'"]);
    for (const name of ["linear", "sentry", "files", "plugin:docs"]) {
      expect(button(row(name), `Sign in to ${name}`)).toBeNull();
      expect(button(row(name), `More actions for ${name}`)).toBeNull();
    }
    expect(button(host, "Add Claude Code MCP server")).toBeNull();
    expect(button(host, "Add Codex MCP server")).toBeNull();
    expect(host.querySelector("[data-mcp-activity]")).toBeNull();
  });

  it("keeps the add hint for an empty list only while management is unsupported", async () => {
    management.supported = "unsupported";
    await showServers([], []);
    expect(section("claudeCode").textContent).toContain("claude mcp add");
    expect(button(host, "Add Claude Code MCP server")).toBeNull();
    management.supported = "supported";
    show();
    expect(section("claudeCode").textContent).not.toContain("claude mcp add");
    expect(button(host, "Add Claude Code MCP server")).not.toBeNull();
  });

  it("replaces the hint with a Sign in button where the policy allows signing in", async () => {
    await showServers();
    expect(button(row("linear"), "Sign in to linear")?.textContent).toBe("Sign in");
    expect(row("linear").textContent).not.toContain(HINT);
    expect(row("linear").textContent).toContain("Needs sign-in");
    expect(button(row("linear"), "Sign in to linear")?.classList).toContain("cv-button--primary");
    expect(button(row("sentry"), "Sign in to sentry")).toBeNull();
    expect(button(row("plugin:docs"), "Sign in to plugin:docs")?.textContent).toBe("Sign in");
    expect(button(row("plugin:docs"), "More actions for plugin:docs")).toBeNull();
    expect(row("plugin:docs").textContent).not.toContain(HINT);
  });

  it("keeps the hint where a server that needs sign-in has no sign-in action", async () => {
    await showServers([
      { name: "local-tool", status: "needsAuth", scope: "user", transport: "stdio" },
      { name: "policy", status: "needsAuth", scope: "managed", transport: "http" },
    ]);
    for (const name of ["local-tool", "policy"]) {
      expect(button(row(name), `Sign in to ${name}`), name).toBeNull();
      expect(row(name).textContent, name).toContain(`${HINT}claude mcp login -- '${name}'`);
      expect(button(row(name), `Copy sign-in command for ${name}`), name).not.toBeNull();
    }
    expect(button(row("policy"), "More actions for policy")).toBeNull();
  });

  it("signs in to and out of servers that plugins provide without offering to remove them", async () => {
    const api = "plugin:cloudflare:cloudflare-api";
    const docs = "plugin:cloudflare:cloudflare-docs";
    await showServers([
      { name: api, status: "needsAuth", scope: "unknown", transport: "http" },
      { name: docs, status: "connected", scope: "unknown", transport: "http" },
      sentry,
    ]);
    expect(row(api).textContent).not.toContain(HINT);
    expect(button(row(api), `More actions for ${api}`)).toBeNull();
    pressButton(row(docs), `More actions for ${docs}`);
    expect(menuItems()).toEqual(["Sign in again", "Sign out"]);
    chooseMenuItem("Sign out");
    await settle();
    expect(management.changes.requests().map((request) => request.change)).toEqual([
      { kind: "signOut", name: docs },
    ]);

    pressButton(row(api), `Sign in to ${api}`);
    await settle();
    expect(management.starts.requests().map(({ name, mode }) => [name, mode])).toEqual([
      [api, "signIn"],
    ]);
    management.starts.latest()?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.loginUnsupported);
    await settle();
    expect(texts(row(api), "alert")).toEqual(["This server does not support sign-in."]);
  });

  it("removes a Codex server of unknown scope from the user configuration", async () => {
    await showServers(
      [sentry],
      [{ name: "computer-use", status: "disabled", scope: "unknown", transport: "stdio" }],
    );
    const computerUse = row("computer-use", "codex");
    pressButton(computerUse, "More actions for computer-use");
    expect(menuItems()).toEqual(["Remove…"]);
    chooseMenuItem("Remove…");
    expect(dialog()?.textContent).toContain("Remove computer-use?");
    expect(dialog()?.textContent).toContain(
      "It will be removed from your Codex configuration for all projects.",
    );
    pressButton(document.body, "Remove");
    await settle();
    expect(
      management.changes.requests().map(({ change, target }) => [target.provider, change]),
    ).toEqual([["codex", { kind: "remove", name: "computer-use", scope: "user" }]]);
  });

  it("keeps one menu slot in every row so the statuses line up", async () => {
    await showServers(
      [linear, sentry, files, pluginServer, { name: "policy", scope: "managed" }],
      [{ name: "computer-use", status: "disabled", scope: "unknown", transport: "stdio" }],
    );
    const slots = (name: string, provider: AgentCliKind = "claudeCode") =>
      [...row(name, provider).querySelectorAll(".settings-mcp-server__menu")].map(
        (slot) => `${slot.tagName}:${slot.getAttribute("aria-hidden") ?? "shown"}`,
      );
    for (const name of ["linear", "sentry", "files"])
      expect(slots(name), name).toEqual(["BUTTON:shown"]);
    for (const name of ["plugin:docs", "policy"]) {
      expect(slots(name), name).toEqual(["SPAN:true"]);
      expect(row(name).querySelector("[data-mcp-menu-slot]")?.textContent, name).toBe("");
      expect(row(name).querySelector("[data-mcp-menu-slot]")?.hasAttribute("tabindex")).toBe(false);
    }
    expect(slots("computer-use", "codex")).toEqual(["BUTTON:shown"]);

    pressButton(row("linear"), "Sign in to linear");
    await settle();
    expect(button(row("linear"), "Sign in to linear")).toBeNull();
    expect(slots("linear")).toEqual(["SPAN:true"]);
  });

  it("says that plugin servers are signed in to here and removed with their plugin", async () => {
    await showServers();
    const plugins = section("claudeCode").querySelector(".settings-mcp-plugins");
    expect(plugins?.textContent).toContain(
      "These servers are installed by plugins. Sign in to them here; to remove one, remove its plugin.",
    );
    expect(section("codex").querySelector(".settings-mcp-plugins")).toBeNull();
  });

  it("signs in through the browser and refreshes the server status", async () => {
    await showServers();
    pressButton(row("linear"), "Sign in to linear");
    expect(texts(row("linear"), "status")).toEqual(["Opening the sign-in page…"]);
    expect(button(row("linear"), "Sign in to linear")).toBeNull();
    expect(button(row("linear"), "More actions for linear")).toBeNull();
    expect(document.activeElement).toBe(button(row("linear"), "Cancel"));
    await settle();
    expect(management.starts.requests().map(({ name, mode }) => [name, mode])).toEqual([
      ["linear", "signIn"],
    ]);

    management.starts.latest()?.resolve(awaiting());
    await settle();
    expect(texts(row("linear"), "status")).toEqual(["Opening the sign-in page…"]);
    expect(urlOpener.opened.requests()).toEqual([AUTHORIZE]);
    urlOpener.opened.latest()?.resolve();
    await settle();
    expect(texts(row("linear"), "status")).toEqual(["Finish signing in in your browser."]);
    expect(row("linear").textContent).toContain("Sign-in page: auth.example.com");
    expect(button(row("linear"), "Open page again")).not.toBeNull();
    expect(field(row("linear"), "Address from the browser")).toBeNull();
    for (const secret of [LOGIN_ID, SECRET_QUERY, "secret-state", "/authorize"])
      expect(document.body.innerHTML).not.toContain(secret);

    pressButton(row("linear"), "Open page again");
    await settle();
    expect(urlOpener.opened.requests()).toEqual([AUTHORIZE, AUTHORIZE]);
    urlOpener.opened.latest()?.resolve();
    await poll("pending");
    await poll("succeeded");
    expect(texts(row("linear"), "status")).toEqual(["Signed in. Checking the server…"]);

    await answer(
      "claudeCode",
      agentMcpServersFixture("claudeCode", [{ ...linear, status: "connected" }]),
    );
    expect(row("linear").textContent).toContain("Connected");
    expect(row("linear").querySelector("[data-mcp-activity]")).toBeNull();
    expect(button(row("linear"), "Sign in to linear")).toBeNull();
    expect(button(row("linear"), "More actions for linear")).not.toBeNull();
  });

  it("cancels a sign-in and gives the Sign in button back with focus", async () => {
    await showServers();
    await startSignIn(awaiting());
    pressButton(row("linear"), "Cancel");
    expect(management.cancels.map((cancel) => cancel.loginId)).toEqual([LOGIN_ID]);
    expect(row("linear").querySelector("[data-mcp-activity]")).toBeNull();
    expect(document.activeElement).toBe(button(row("linear"), "Sign in to linear"));
  });

  it("explains a blocked sign-in page and a failed sign-in, and tries again", async () => {
    await showServers();
    pressButton(row("linear"), "Sign in to linear");
    await settle();
    management.starts.latest()?.resolve(awaiting());
    await settle();
    urlOpener.opened.latest()?.reject(new Error("no browser"));
    await settle();
    expect(texts(row("linear"), "alert")).toEqual(["The sign-in page did not open."]);
    expect(texts(row("linear"), "status")).toEqual([]);

    await poll("failed");
    expect(texts(row("linear"), "alert")).toEqual(["Sign-in did not complete."]);
    expect(button(row("linear"), "Sign in to linear")).toBeNull();
    pressButton(row("linear"), "Try again");
    expect(texts(row("linear"), "status")).toEqual(["Opening the sign-in page…"]);
    await settle();
    expect(management.starts.calls).toHaveLength(2);

    management.starts.latest()?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.loginUnsupported);
    await settle();
    expect(texts(row("linear"), "alert")).toEqual(["This server does not support sign-in."]);
    pressButton(row("linear"), "Dismiss");
    expect(row("linear").querySelector("[data-mcp-activity]")).toBeNull();
    expect(button(row("linear"), "Sign in to linear")).not.toBeNull();
  });

  it("asks for the address from the browser when the callback has to be pasted", async () => {
    await showServers();
    await startSignIn(awaiting("paste"));
    const panel = row("linear");
    expect(panel.textContent).toContain(
      "After you approve, your browser will try to open an address that starts with http://localhost and fail to load it. Copy that address from the address bar and paste it here.",
    );
    expect(field(panel, "Address from the browser")).not.toBeNull();
    expect(button(panel, "Finish sign-in")?.disabled).toBe(true);
    expect(texts(panel, "alert")).toEqual([]);

    type(panel, "Address from the browser", "https://evil.example/callback?code=abc");
    expect(texts(row("linear"), "alert")).toEqual([
      "The address must start with http://localhost or http://127.0.0.1.",
    ]);
    expect(field(row("linear"), "Address from the browser")?.getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(button(row("linear"), "Finish sign-in")?.disabled).toBe(true);
    type(row("linear"), "Address from the browser", "http://localhost:53682/callback");
    expect(texts(row("linear"), "alert")).toEqual([
      "This address has no sign-in result. Copy the full address from the address bar.",
    ]);

    type(row("linear"), "Address from the browser", ` ${CALLBACK} `);
    expect(texts(row("linear"), "alert")).toEqual([]);
    pressButton(row("linear"), "Finish sign-in");
    expect(texts(row("linear"), "status")).toEqual(["Finishing sign-in…"]);
    expect(field(row("linear"), "Address from the browser")).toBeNull();
    await settle();
    expect(management.callbacks.requests().map((request) => request.callbackUrl)).toEqual([
      CALLBACK,
    ]);
    expect(document.body.innerHTML).not.toContain("secret-code");

    management.callbacks.latest()?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.callbackRejected);
    await settle();
    expect(field(row("linear"), "Address from the browser")?.value).toBe("");
    expect(texts(row("linear"), "alert")).toEqual([
      "The sign-in did not accept this address. Copy the full address from the browser and try again.",
    ]);

    type(row("linear"), "Address from the browser", CALLBACK);
    pressButton(row("linear"), "Finish sign-in");
    await settle();
    management.callbacks.latest()?.resolve();
    await poll("succeeded");
    expect(texts(row("linear"), "status")).toEqual(["Signed in. Checking the server…"]);
  });

  it("lets the user finish connecting in the browser and check again", async () => {
    await showServers();
    await startSignIn({
      kind: "finishInBrowser",
      authorizationUrl: "https://claude.ai/settings/connectors?secret=1",
    });
    expect(texts(row("linear"), "status")).toEqual([
      "Finish connecting in your browser, then check again.",
    ]);
    expect(row("linear").textContent).toContain("Sign-in page: claude.ai");
    expect(document.body.innerHTML).not.toContain("secret=1");
    act(() => scheduler.advance(10 * POLL_MS));
    await settle();
    expect(management.states.calls).toEqual([]);

    const before = checks.checks.length;
    pressButton(row("linear"), "Check again");
    expect(texts(row("linear"), "status")).toEqual(["Checking…"]);
    expect(button(row("linear"), "Check again")?.disabled).toBe(true);
    expect(checks.checks).toHaveLength(before + 1);
    await answer(
      "claudeCode",
      agentMcpServersFixture("claudeCode", [{ ...linear, status: "connected" }]),
    );
    expect(row("linear").textContent).toContain("Connected");
    expect(row("linear").querySelector("[data-mcp-activity]")).toBeNull();
  });

  it("offers only the menu actions the policy allows", async () => {
    await showServers();
    expect(button(row("linear"), "More actions for linear")?.getAttribute("aria-haspopup")).toBe(
      "menu",
    );
    pressButton(row("sentry"), "More actions for sentry");
    expect(document.querySelector('[role="menu"]')?.getAttribute("aria-label")).toBe(
      "More actions for sentry",
    );
    expect(menuItems()).toEqual(["Sign in again", "Sign out", "Remove…"]);
    const openMenu = document.querySelector('[role="menu"]');
    if (openMenu !== null) press(openMenu, "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button(row("sentry"), "More actions for sentry"));

    pressButton(row("files"), "More actions for files");
    expect(menuItems()).toEqual(["Remove…"]);
    chooseMenuItem("Remove…");
    pressButton(document.body, "Cancel");

    pressButton(row("linear"), "More actions for linear");
    expect(menuItems()).toEqual(["Remove…"]);
    chooseMenuItem("Remove…");
    pressButton(document.body, "Cancel");

    pressButton(row("codex-http", "codex"), "More actions for codex-http");
    expect(menuItems()).toEqual(["Sign in again", "Sign out", "Remove…"]);
  });

  it("signs out and signs in again from the menu", async () => {
    await showServers();
    pressButton(row("sentry"), "More actions for sentry");
    chooseMenuItem("Sign out");
    expect(texts(row("sentry"), "status")).toEqual(["Signing out…"]);
    expect(button(row("sentry"), "More actions for sentry")).toBeNull();
    await settle();
    expect(management.changes.requests().map((request) => request.change)).toEqual([
      { kind: "signOut", name: "sentry" },
    ]);
    management.changes.latest()?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.changeUnsupported);
    await settle();
    expect(texts(row("sentry"), "alert")).toEqual(["This server cannot be changed from Codevo."]);
    pressButton(row("sentry"), "Try again");
    await settle();
    expect(management.changes.calls).toHaveLength(2);
    management.changes.latest()?.resolve();
    await settle();
    expect(texts(row("sentry"), "status")).toEqual(["Signed out. Checking the server…"]);
    await answer(
      "claudeCode",
      agentMcpServersFixture("claudeCode", [{ ...sentry, status: "needsAuth" }]),
    );
    expect(button(row("sentry"), "Sign in to sentry")).not.toBeNull();

    pressButton(row("codex-http", "codex"), "More actions for codex-http");
    chooseMenuItem("Sign in again");
    await settle();
    expect(
      management.starts.requests().map(({ name, mode, target }) => [name, mode, target.provider]),
    ).toEqual([["codex-http", "signInAgain", "codex"]]);
    expect(texts(row("codex-http", "codex"), "status")).toEqual(["Opening the sign-in page…"]);
  });

  it("removes a server only after confirming the scope it is removed from", async () => {
    await showServers();
    pressButton(row("files"), "More actions for files");
    chooseMenuItem("Remove…");
    expect(dialog()?.getAttribute("role")).toBe("alertdialog");
    expect(dialog()?.textContent).toContain("Remove files?");
    expect(dialog()?.textContent).toContain(
      "It will be removed from this project's shared configuration.",
    );
    pressButton(document.body, "Cancel");
    expect(dialog()).toBeNull();
    expect(management.changes.calls).toEqual([]);
    expect(document.activeElement).toBe(button(row("files"), "More actions for files"));

    pressButton(row("sentry"), "More actions for sentry");
    chooseMenuItem("Remove…");
    expect(dialog()?.textContent).toContain(
      "It will be removed from your Claude Code configuration for all projects.",
    );
    const open = dialog();
    if (open !== null) press(open, "Escape");
    expect(dialog()).toBeNull();

    pressButton(row("linear"), "More actions for linear");
    chooseMenuItem("Remove…");
    expect(dialog()?.textContent).toContain(
      "It will be removed from your Claude Code configuration for this project.",
    );
    pressButton(document.body, "Remove");
    expect(dialog()).toBeNull();
    expect(texts(row("linear"), "status")).toEqual(["Removing…"]);
    await settle();
    expect(management.changes.requests().map((request) => request.change)).toEqual([
      { kind: "remove", name: "linear", scope: "local" },
    ]);
    management.changes.latest()?.resolve();
    await settle();
    expect(texts(row("linear"), "status")).toEqual(["Removed. Checking servers…"]);
    await answer("claudeCode", agentMcpServersFixture("claudeCode", [sentry, files]));
    expect(section("claudeCode").querySelector('[data-mcp-server="linear"]')).toBeNull();
  });

  it("searches fallback command hints and excludes hints hidden by built-in sign-in", async () => {
    await showServers([linear, { name: "fallback", status: "needsAuth", transport: "stdio" }], []);
    expect(row("linear").querySelector(".settings-mcp-signin")).toBeNull();
    expect(row("fallback").querySelector(".settings-mcp-signin")?.textContent).toContain(
      "mcp login",
    );
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search MCP servers"]');
    expect(input).not.toBeNull();
    act(() => {
      if (input === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "mcp login",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      [...host.querySelectorAll<HTMLElement>("[data-mcp-server]")].map(
        (element) => element.dataset.mcpServer,
      ),
    ).toEqual(["fallback"]);
    expect(row("fallback").querySelector("code")?.textContent).toBe(
      "claude mcp login -- 'fallback'",
    );
  });

  it("keeps add controls and duplicate-name validation available with no search matches", async () => {
    await showServers();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search MCP servers"]');
    expect(input).not.toBeNull();
    act(() => {
      if (input === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "no-match",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelectorAll("[data-mcp-server]")).toHaveLength(0);
    expect(host.textContent).toContain('No MCP servers match "no-match"');
    expect(button(host, "Add Codex MCP server")).not.toBeNull();
    pressButton(host, "Add Claude Code MCP server");
    const form = present(dialog());
    type(form, "Name", "sentry");
    expect(texts(form, "alert")).toEqual(["A server with this name is already configured."]);
    pressButton(form, "Cancel");
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button(host, "Add Claude Code MCP server"));
  });

  it("adds a Claude server with a type, a scope, and inline validation", async () => {
    await showServers();
    const add = button(host, "Add Claude Code MCP server");
    expect(add?.textContent).toBe("Add server");
    expect(section("claudeCode").textContent).toContain("Checked");
    add?.focus();
    pressButton(host, "Add Claude Code MCP server");
    const form = present(dialog());
    expect(form.textContent).toContain("Add Claude Code MCP server");
    expect([...form.querySelectorAll('[role="radio"]')].map((node) => node.textContent)).toEqual([
      "HTTP",
      "SSE",
      "Command",
      "This project",
      "All projects",
    ]);
    expect(radio(form, "This project")?.getAttribute("aria-checked")).toBe("true");
    expect(form.textContent).not.toContain("Codex servers apply to all projects.");
    expect(button(form, "Add server")?.disabled).toBe(true);
    expect(texts(form, "alert")).toEqual([]);

    type(form, "Name", "-bad");
    expect(texts(form, "alert")).toEqual([
      "Use letters, digits, hyphens and underscores, and do not start with a hyphen.",
    ]);
    type(form, "Name", "sentry");
    expect(texts(form, "alert")).toEqual(["A server with this name is already configured."]);
    type(form, "Name", "docs");
    type(form, "URL", "ftp://docs.example.com");
    expect(texts(form, "alert")).toEqual(["The address must start with http:// or https://."]);
    expect(button(form, "Add server")?.disabled).toBe(true);

    click(present(radio(form, "Command")));
    expect(field(form, "URL")).toBeNull();
    type(form, "Command", "npx -y 'my server");
    expect(texts(form, "alert")).toEqual(["Close the open quote."]);
    type(form, "Command", "npx -y 'my server' $HOME");
    expect(texts(form, "alert")).toEqual([]);
    click(present(radio(form, "All projects")));
    expect(button(form, "Add server")?.disabled).toBe(false);

    pressButton(form, "Add server");
    expect(management.changes.requests()).toEqual([
      {
        target: localAgentMcpServersTarget(APP, "claudeCode"),
        change: {
          kind: "add",
          name: "docs",
          scope: "user",
          launch: { kind: "stdio", command: "npx", args: ["-y", "my server", "$HOME"] },
        },
      },
    ]);
    expect(button(form, "Adding…")?.disabled).toBe(true);
    expect(button(form, "Adding…")?.getAttribute("aria-busy")).toBe("true");
    expect(field(form, "Name")?.disabled).toBe(true);

    management.changes.latest()?.reject(AGENT_MCP_SERVER_MANAGEMENT_ERRORS.serverExists);
    await settle();
    expect(texts(form, "alert")).toEqual(["A server with this name is already configured."]);
    expect(button(form, "Add server")?.disabled).toBe(false);
    type(form, "Name", "docs2");
    expect(texts(form, "alert")).toEqual([]);

    pressButton(form, "Add server");
    await settle();
    management.changes.latest()?.resolve();
    await settle();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button(host, "Add Claude Code MCP server"));
    await answer(
      "claudeCode",
      agentMcpServersFixture("claudeCode", [sentry, { name: "docs2", scope: "user" }]),
    );
    expect(row("docs2").textContent).toContain("Connected");
    expect(row("docs2").querySelector("[data-mcp-activity]")).toBeNull();
  });

  it("adds a Codex server for all projects without SSE or a scope choice", async () => {
    await showServers();
    pressButton(host, "Add Codex MCP server");
    const form = present(dialog());
    expect([...form.querySelectorAll('[role="radio"]')].map((node) => node.textContent)).toEqual([
      "HTTP",
      "Command",
    ]);
    expect(form.textContent).toContain("Codex servers apply to all projects.");
    type(form, "Name", "linear");
    type(form, "URL", " https://mcp.linear.app/mcp ");
    const submit = present(form.querySelector("form"));
    act(() => {
      submit.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(management.changes.requests().map((request) => request.change)).toEqual([
      {
        kind: "add",
        name: "linear",
        scope: "user",
        launch: { kind: "http", url: "https://mcp.linear.app/mcp" },
      },
    ]);
    expect(management.changes.latest()?.request.target.provider).toBe("codex");
  });

  it("closes the add dialog without changing anything and forgets a failure", async () => {
    await showServers();
    pressButton(host, "Add Claude Code MCP server");
    press(present(dialog()), "Escape");
    expect(dialog()).toBeNull();
    expect(management.changes.calls).toEqual([]);

    pressButton(host, "Add Claude Code MCP server");
    type(present(dialog()), "Name", "docs");
    type(present(dialog()), "URL", "https://docs.example.com/mcp");
    pressButton(present(dialog()), "Add server");
    await settle();
    management.changes.latest()?.reject("boom");
    await settle();
    expect(texts(present(dialog()), "alert")).toEqual(["Could not add the server."]);
    pressButton(present(dialog()), "Cancel");
    expect(dialog()).toBeNull();
    expect(
      surface.management.activity(present(localAgentMcpServersTarget(APP, "claudeCode")), "docs"),
    ).toEqual({ kind: "idle" });

    pressButton(host, "Add Claude Code MCP server");
    expect(field(present(dialog()), "Name")?.value).toBe("");
    expect(texts(present(dialog()), "alert")).toEqual([]);
  });

  it("discards an open remove confirmation when the project changes", async () => {
    await showBothProjects();
    pressButton(row("linear"), "More actions for linear");
    chooseMenuItem("Remove…");
    expect(dialog()?.textContent).toContain("Remove linear?");

    await chooseProject(API);
    expect(dialog()).toBeNull();
    expect(button(document.body, "Remove")).toBeNull();
    expect(management.changes.calls).toEqual([]);
    expect(row("linear").querySelector("[data-mcp-activity]")).toBeNull();

    pressButton(row("sentry"), "More actions for sentry");
    expect(menuItems()).toEqual(["Sign in again", "Sign out", "Remove…"]);
    await chooseProject(APP);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(dialog()).toBeNull();
    expect(management.changes.calls).toEqual([]);
    expect(management.starts.calls).toEqual([]);
  });

  it("removes from the project that was shown when the confirmation was opened", async () => {
    await showBothProjects();
    await chooseProject(API);
    pressButton(row("linear"), "More actions for linear");
    chooseMenuItem("Remove…");
    pressButton(document.body, "Remove");
    expect(management.changes.requests()).toEqual([
      {
        target: localAgentMcpServersTarget(API, "claudeCode"),
        change: { kind: "remove", name: "linear", scope: "local" },
      },
    ]);
    expect(texts(row("linear"), "status")).toEqual(["Removing…"]);

    await chooseProject(APP);
    expect(row("linear").querySelector("[data-mcp-activity]")).toBeNull();
    expect(button(row("linear"), "Sign in to linear")).not.toBeNull();
    await chooseProject(API);
    expect(texts(row("linear"), "status")).toEqual(["Removing…"]);
  });

  it("discards an open add draft when the project changes", async () => {
    await showBothProjects();
    pressButton(host, "Add Claude Code MCP server");
    type(present(dialog()), "Name", "docs");
    type(present(dialog()), "URL", "https://docs.example.com/mcp");
    expect(button(present(dialog()), "Add server")?.disabled).toBe(false);

    await chooseProject(API);
    expect(dialog()).toBeNull();
    expect(management.changes.calls).toEqual([]);

    pressButton(host, "Add Claude Code MCP server");
    expect(field(present(dialog()), "Name")?.value).toBe("");
    expect(field(present(dialog()), "URL")?.value).toBe("");
    expect(button(present(dialog()), "Add server")?.disabled).toBe(true);
    type(present(dialog()), "Name", "docs");
    type(present(dialog()), "URL", "https://docs.example.com/mcp");
    pressButton(present(dialog()), "Add server");
    expect(management.changes.requests().map((request) => request.target)).toEqual([
      localAgentMcpServersTarget(API, "claudeCode"),
    ]);
  });

  it("keeps a sign-in of project A out of project B and shows it again on return", async () => {
    await showBothProjects();
    pressButton(row("linear"), "Sign in to linear");
    await settle();
    expect(management.starts.requests().map((request) => request.target)).toEqual([
      localAgentMcpServersTarget(APP, "claudeCode"),
    ]);

    await chooseProject(API);
    const checkedApp = checksFor(APP);
    const checkedApi = checksFor(API);
    const expectQuietB = (): void => {
      expect(host.querySelector("[data-mcp-activity]")).toBeNull();
      expect(button(row("linear"), "Sign in to linear")).not.toBeNull();
      expect(row("linear").textContent).toContain("Needs sign-in");
    };
    expectQuietB();

    management.starts.latest()?.resolve(awaiting());
    await settle();
    urlOpener.opened.latest()?.resolve();
    await settle();
    expectQuietB();
    await poll("pending");
    expectQuietB();
    await poll("succeeded");
    expectQuietB();
    expect(management.starts.calls).toHaveLength(1);
    expect(management.cancels).toEqual([]);
    expect(checksFor(APP)).toBe(checkedApp + 1);
    expect(checksFor(API)).toBe(checkedApi);

    await chooseProject(APP);
    expect(texts(row("linear"), "status")).toEqual(["Signed in. Checking the server…"]);
    await answer(
      "claudeCode",
      agentMcpServersFixture("claudeCode", [{ ...linear, status: "connected" }, sentry]),
    );
    expect(row("linear").textContent).toContain("Connected");
    expect(row("linear").querySelector("[data-mcp-activity]")).toBeNull();
    await chooseProject(API);
    expectQuietB();
    expect(checksFor(API)).toBe(checkedApi);
  });

  it("shows a waiting sign-in again when the user returns to its project", async () => {
    await showBothProjects();
    await startSignIn(awaiting());
    await chooseProject(API);
    expect(host.querySelector("[data-mcp-activity]")).toBeNull();
    await chooseProject(APP);
    expect(texts(row("linear"), "status")).toEqual(["Finish signing in in your browser."]);
    pressButton(row("linear"), "Cancel");
    expect(management.cancels.map((cancel) => [cancel.target, cancel.loginId])).toEqual([
      [localAgentMcpServersTarget(APP, "claudeCode"), LOGIN_ID],
    ]);
  });

  it("says so when too many changes are still in progress", async () => {
    surface = {
      ...surface,
      management: new AgentMcpServerManagementCoordinator(
        { management, statuses: surface.store, urlOpener, scheduler },
        1,
      ),
    };
    await showServers();
    pressButton(row("sentry"), "More actions for sentry");
    chooseMenuItem("Sign out");
    expect(texts(row("sentry"), "status")).toEqual(["Signing out…"]);

    pressButton(row("linear"), "Sign in to linear");
    expect(texts(row("linear"), "alert")).toEqual([
      "Too many MCP changes are still in progress. Try again in a moment.",
    ]);
    expect(button(row("linear"), "Sign in to linear")).not.toBeNull();
    expect(management.starts.calls).toEqual([]);

    pressButton(host, "Add Claude Code MCP server");
    type(present(dialog()), "Name", "docs");
    type(present(dialog()), "URL", "https://docs.example.com/mcp");
    pressButton(present(dialog()), "Add server");
    expect(texts(present(dialog()), "alert")).toEqual([
      "Too many MCP changes are still in progress. Try again in a moment.",
    ]);
    expect(management.changes.calls).toHaveLength(1);
    pressButton(present(dialog()), "Cancel");

    management.changes.latest()?.resolve();
    await settle();
    await answer("claudeCode", agentMcpServersFixture("claudeCode", [linear, sentry]));
    pressButton(row("linear"), "Sign in to linear");
    expect(texts(row("linear"), "alert")).toEqual([]);
    expect(texts(row("linear"), "status")).toEqual(["Opening the sign-in page…"]);
  });

  it("works under StrictMode without duplicate requests", async () => {
    show((children) => <StrictMode>{children}</StrictMode>);
    await answer("claudeCode", agentMcpServersFixture("claudeCode", [linear]));
    await answer("codex", agentMcpServersFixture("codex", []));
    await startSignIn(awaiting());
    expect(management.starts.calls).toHaveLength(1);
    expect(urlOpener.opened.calls).toHaveLength(1);
    await poll("pending");
    expect(management.states.calls).toHaveLength(1);
    expect(texts(row("linear"), "status")).toEqual(["Finish signing in in your browser."]);
  });
});

function present<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  expect(value).toBeDefined();
  return value as T;
}
