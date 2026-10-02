// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";
import { TauriRemoteRunnerGateway } from "../../infrastructure/tauriRemoteRunnerGateway";
import { parseAllStyleSheets } from "../cssContractTestSupport";
import { RemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { AgentProjectSwitcher } from "./AgentProjectSwitcher";
import type {
  AgentProjectMenuCommand,
  AgentProjectMenuTarget,
} from "./agentProjectMenuPresentation";
import type { AgentProjectServerPresence } from "./agentProjectServerPresence";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

const SIDEBAR_SHEET = "components/agentMode/agentSidebar.css";
const SHARED_CLASS = /^(cv-popover|cv-icon-button(--[\w-]+|__[\w-]+)?|lucide(-[\w-]+)?)$/;

const LOCAL_ONLY: AgentProjectServerPresence = { local: true, remoteServerIds: [] };

const LINUX: RemoteRunnerServer = {
  id: "srv-7f3a",
  name: "Linux box",
  host: "linux.internal",
  username: "dev",
  port: 22,
  connected: true,
};

function entry(label: string, serverPresence = LOCAL_ONLY): AgentRailScopeEntry {
  const root = `/work/${label}`;
  return {
    value: root,
    label,
    projectRootKey: root,
    repositoryRoot: root,
    trust: "trusted",
    origin: "active-tab",
    rootPath: root,
    repositoryCount: 1,
    serverPresence,
  };
}

function escapeClass(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sheetsStyling(className: string): ReadonlyArray<string> {
  const pattern = new RegExp(`\\.${escapeClass(className)}(?![\\w-])`);
  const sheets = parseAllStyleSheets()
    .rules.filter((rule) => pattern.test(rule.selector))
    .map((rule) => rule.sheet);
  return [...new Set(sheets)].sort();
}

describe("AgentProjectSwitcher", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function openSwitcher(
    entries: ReadonlyArray<AgentRailScopeEntry> = [entry("editor"), entry("docs-site")],
    onProjectCommand: (
      target: AgentProjectMenuTarget,
      command: AgentProjectMenuCommand,
    ) => void = () => undefined,
    onSelectProject: (projectRootKey: string) => void = () => undefined,
  ): HTMLElement {
    act(() =>
      root.render(
        <AgentProjectSwitcher
          activeEntry={entries[0] ?? null}
          entries={entries}
          focus="active"
          onProjectCommand={onProjectCommand}
          onSelectAll={() => undefined}
          onSelectProject={onSelectProject}
        />,
      ),
    );
    const trigger = host.querySelector<HTMLButtonElement>(".cv-sb-switch");
    expect(trigger).not.toBeNull();
    act(() => trigger?.click());
    const surface = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Switch project"]',
    );
    expect(surface).not.toBeNull();
    return surface as HTMLElement;
  }

  it("portals the open popover to the document body, outside the sidebar layout", () => {
    const surface = openSwitcher();

    expect(surface.parentElement).toBe(document.body);
    expect(host.contains(surface)).toBe(false);
    expect(surface.classList.contains("cv-popover")).toBe(true);
    expect(surface.querySelector('input[aria-label="Search projects"]')).toBe(
      document.activeElement,
    );
  });

  it("styles the popover only through classes the sidebar sheet owns", () => {
    const surface = openSwitcher();
    const names = [surface, ...surface.querySelectorAll<HTMLElement>("[class]")]
      .flatMap((element) => [...element.classList])
      .filter((name) => !SHARED_CLASS.test(name));

    expect(names).toContain("cv-project-switch");
    expect(names).toContain("cv-project-badge");
    for (const name of new Set(names)) {
      expect(sheetsStyling(name), name).toEqual([SIDEBAR_SHEET]);
    }
  });

  describe("server badge", () => {
    const linked = entry("editor", { local: true, remoteServerIds: [LINUX.id] });
    const serverOnly = entry("gpu-jobs", { local: false, remoteServerIds: [LINUX.id] });
    const localOnly = entry("docs-site");

    function withServers(
      servers: ReadonlyArray<RemoteRunnerServer> | null,
      node: ReactNode,
    ): ReactNode {
      if (servers === null) return node;
      return (
        <RemoteRunnerContext.Provider
          value={{
            gateway: new TauriRemoteRunnerGateway(vi.fn()),
            servers,
            status: "ready",
            error: null,
            selectedServerId: null,
            selectServer: vi.fn(),
            refresh: vi.fn(),
            connect: vi.fn(),
            disconnect: vi.fn(),
            remove: vi.fn(),
          }}
        >
          {node}
        </RemoteRunnerContext.Provider>
      );
    }

    async function openWith(
      servers: ReadonlyArray<RemoteRunnerServer> | null,
    ): Promise<HTMLElement> {
      await act(async () =>
        root.render(
          withServers(
            servers,
            <AgentProjectSwitcher
              activeEntry={linked}
              entries={[linked, serverOnly, localOnly]}
              focus="active"
              onProjectCommand={() => undefined}
              onSelectAll={() => undefined}
              onSelectProject={() => undefined}
            />,
          ),
        ),
      );
      const trigger = host.querySelector<HTMLButtonElement>(".cv-sb-switch");
      await act(async () => trigger?.click());
      const surface = document.querySelector<HTMLElement>(
        '[role="dialog"][aria-label="Switch project"]',
      );
      expect(surface).not.toBeNull();
      return surface as HTMLElement;
    }

    function optionFor(surface: HTMLElement, label: string): HTMLElement {
      const option = [...surface.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (candidate) => candidate.querySelector(".cv-project-switch__label")?.textContent === label,
      );
      expect(option, label).toBeDefined();
      return option as HTMLElement;
    }

    function rowLeaks(row: HTMLElement, value: string): boolean {
      return [row, ...row.querySelectorAll<HTMLElement>("*")].some(
        (element) =>
          [...element.attributes].some((attribute) => attribute.value.includes(value)) ||
          (element.textContent ?? "").includes(value),
      );
    }

    it("names the server a project also runs on, and says On for a server-only project", async () => {
      const surface = await openWith([LINUX]);
      const linkedRow = optionFor(surface, "editor");
      const serverOnlyRow = optionFor(surface, "gpu-jobs");
      const localRow = optionFor(surface, "docs-site");

      expect(linkedRow.textContent).toContain("Also on Linux box");
      expect(linkedRow.querySelector(".cv-project-switch__server")?.getAttribute("title")).toBe(
        "Also on Linux box",
      );
      expect(serverOnlyRow.textContent).toContain("On Linux box");
      expect(serverOnlyRow.textContent).not.toContain("Also on");
      expect(localRow.querySelector(".cv-project-switch__server")).toBeNull();
      expect(localRow.textContent).not.toContain("Linux box");
      for (const row of [linkedRow, serverOnlyRow]) {
        expect(rowLeaks(row, LINUX.id)).toBe(false);
        expect(rowLeaks(row, LINUX.host)).toBe(false);
      }
      expect(sheetsStyling("cv-project-switch__server")).toEqual([SIDEBAR_SHEET]);
    });

    it("keeps the Current label and gear column for a project with a badge", async () => {
      const surface = await openWith([LINUX]);
      const option = optionFor(surface, "editor");

      expect(option.querySelector(".cv-project-switch__state")?.textContent).toBe("Current");
      expect(surface.querySelectorAll(".cv-project-switch__gear-slot")).toHaveLength(
        surface.querySelectorAll('[role="option"]').length,
      );
    });

    it("renders no badge when no remote servers are configured", async () => {
      const withoutContext = await openWith(null);
      expect(withoutContext.querySelector(".cv-project-switch__server")).toBeNull();

      await act(async () => root.unmount());
      root = createRoot(host);
      const emptyServers = await openWith([]);
      expect(emptyServers.querySelector(".cv-project-switch__server")).toBeNull();
    });
  });

  it("closes a project straight from its row without leaving the switcher", () => {
    const commands: Array<[AgentProjectMenuTarget, AgentProjectMenuCommand]> = [];
    const selected: string[] = [];
    const surface = openSwitcher(
      undefined,
      (target, command) => commands.push([target, command]),
      (projectRootKey) => selected.push(projectRootKey),
    );
    const close = surface.querySelector<HTMLButtonElement>(
      'button[aria-label="Close project docs-site"]',
    );
    expect(close).not.toBeNull();

    act(() => close?.click());

    expect(commands).toEqual([
      [
        {
          projectRootKey: "/work/docs-site",
          repositoryRoot: "/work/docs-site",
          rootPath: "/work/docs-site",
        },
        "close",
      ],
    ]);
    expect(selected).toEqual([]);
    expect(document.querySelector('[role="dialog"][aria-label="Switch project"]')).toBe(surface);
    expect(surface.querySelector('input[aria-label="Search projects"]')).toBe(
      document.activeElement,
    );
  });

  it("offers a close button only for projects that can be closed", () => {
    const released: AgentRailScopeEntry = { ...entry("legacy"), origin: "closed-tab-live-tasks" };
    const remoteKey = "remote:linux:runner:orders";
    const remote: AgentRailScopeEntry = {
      ...entry("orders"),
      value: remoteKey,
      projectRootKey: remoteKey,
      rootPath: remoteKey,
    };
    const surface = openSwitcher([entry("editor"), released, remote]);
    const labels = [
      ...surface.querySelectorAll<HTMLButtonElement>(".cv-project-switch__close"),
    ].map((button) => button.getAttribute("aria-label"));

    expect(labels).toEqual(["Close project editor"]);
  });

  it("dismisses the switcher when the last project is closed from it", () => {
    const only = entry("editor");
    const surface = openSwitcher([only]);
    const close = surface.querySelector<HTMLButtonElement>(
      'button[aria-label="Close project editor"]',
    );

    act(() => close?.click());

    expect(document.querySelector('[role="dialog"][aria-label="Switch project"]')).toBeNull();
    expect(host.querySelector(".cv-sb-switch")).toBe(document.activeElement);
  });
});
