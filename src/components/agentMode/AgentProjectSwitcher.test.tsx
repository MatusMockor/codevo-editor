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
import type { AgentRailProjectSignal } from "./agentRailProjectSignal";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

const SIDEBAR_SHEET = "components/agentMode/agentSidebar.css";
const SHARED_CLASS = /^(cv-popover|cv-icon-button(--[\w-]+|__[\w-]+)?|lucide(-[\w-]+)?)$/;

const LOCAL_ONLY: AgentProjectServerPresence = { local: true, remoteServerIds: [] };
const NO_SIGNALS: ReadonlyMap<string, AgentRailProjectSignal> = new Map();
const WORKING: AgentRailProjectSignal = { tone: "working", label: "2 threads working" };
const ATTENTION: AgentRailProjectSignal = { tone: "attention", label: "1 thread waiting for you" };
const UNREAD: AgentRailProjectSignal = { tone: "unread", label: "1 thread unread" };

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

function optionFor(surface: HTMLElement, label: string): HTMLElement {
  const option = [...surface.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (candidate) => candidate.querySelector(".cv-project-switch__label")?.textContent === label,
  );
  expect(option, label).toBeDefined();
  return option as HTMLElement;
}

function signalOf(option: HTMLElement): ReadonlyArray<string | null> {
  return [...option.querySelectorAll<HTMLElement>(".cv-project-switch__signal")].flatMap((dot) => [
    dot.getAttribute("role"),
    dot.getAttribute("data-tone"),
    dot.getAttribute("aria-label"),
    dot.getAttribute("title"),
  ]);
}

function searchProjects(surface: HTMLElement, query: string): void {
  const input = surface.querySelector<HTMLInputElement>('input[aria-label="Search projects"]');
  expect(input).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, query);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
    signals: ReadonlyMap<string, AgentRailProjectSignal> = NO_SIGNALS,
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
          signals={signals}
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
    const surface = openSwitcher(
      undefined,
      undefined,
      undefined,
      new Map([["/work/docs-site", WORKING]]),
    );
    const names = [surface, ...surface.querySelectorAll<HTMLElement>("[class]")]
      .flatMap((element) => [...element.classList])
      .filter((name) => !SHARED_CLASS.test(name));

    expect(names).toContain("cv-project-switch");
    expect(names).toContain("cv-project-badge");
    expect(names).toContain("cv-project-switch__signal");
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
              signals={NO_SIGNALS}
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

  describe("thread signal", () => {
    const entries = [entry("editor"), entry("docs-site"), entry("api")];

    function openWithSignals(signals: ReadonlyMap<string, AgentRailProjectSignal>): HTMLElement {
      return openSwitcher(entries, undefined, undefined, signals);
    }

    it("marks a project row with the tone and label of its threads", () => {
      const surface = openWithSignals(
        new Map([
          ["/work/docs-site", WORKING],
          ["/work/api", UNREAD],
        ]),
      );

      expect(signalOf(optionFor(surface, "docs-site"))).toEqual([
        "img",
        "working",
        "2 threads working",
        "2 threads working",
      ]);
      expect(signalOf(optionFor(surface, "api"))).toEqual([
        "img",
        "unread",
        "1 thread unread",
        "1 thread unread",
      ]);
    });

    it("leaves rows without a signal and the All projects row unmarked", () => {
      const surface = openWithSignals(
        new Map([
          ["/work/docs-site", WORKING],
          ["all", ATTENTION],
        ]),
      );

      expect(signalOf(optionFor(surface, "editor"))).toEqual([]);
      expect(signalOf(optionFor(surface, "api"))).toEqual([]);
      expect(signalOf(optionFor(surface, "All projects"))).toEqual([]);
      expect(surface.querySelectorAll(".cv-project-switch__signal")).toHaveLength(1);
      expect(host.querySelector(".cv-project-switch__signal")).toBeNull();
    });

    it("marks the current project row next to its Current label and check", () => {
      const surface = openWithSignals(new Map([["/work/editor", ATTENTION]]));
      const current = optionFor(surface, "editor");

      expect(current.getAttribute("aria-current")).toBe("true");
      expect(signalOf(current)).toEqual([
        "img",
        "attention",
        "1 thread waiting for you",
        "1 thread waiting for you",
      ]);
      expect([...current.children].map((child) => child.classList.item(0))).toEqual([
        "cv-project-badge",
        "cv-project-switch__label",
        "cv-project-switch__state",
        "cv-project-switch__signal",
        "lucide",
      ]);
      expect(current.querySelector(".cv-project-switch__state")?.textContent).toBe("Current");
    });

    it("keeps the signal on rows that survive a search", () => {
      const surface = openWithSignals(
        new Map([
          ["/work/editor", ATTENTION],
          ["/work/docs-site", WORKING],
        ]),
      );

      searchProjects(surface, "docs");

      const labels = [...surface.querySelectorAll(".cv-project-switch__label")].map(
        (label) => label.textContent,
      );
      expect(labels).toEqual(["docs-site"]);
      expect(signalOf(optionFor(surface, "docs-site"))).toEqual([
        "img",
        "working",
        "2 threads working",
        "2 threads working",
      ]);
      expect(surface.querySelectorAll(".cv-project-switch__signal")).toHaveLength(1);
    });

    it("takes its size and tone colours from the collapsed project group dot", () => {
      const rules = parseAllStyleSheets().rules.filter((rule) =>
        /\.cv-project-switch__signal(?![\w-])/.test(rule.selector),
      );

      expect(rules.map((rule) => rule.selector.replace(/\s+/g, " "))).toEqual([
        ".cv-sb-project__signal, .cv-project-switch__signal",
        '.cv-sb-project__signal[data-tone="attention"], .cv-project-switch__signal[data-tone="attention"]',
        '.cv-sb-project__signal[data-tone="working"], .cv-project-switch__signal[data-tone="working"]',
        '.cv-sb-project__signal[data-tone="unread"], .cv-project-switch__signal[data-tone="unread"]',
      ]);
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
