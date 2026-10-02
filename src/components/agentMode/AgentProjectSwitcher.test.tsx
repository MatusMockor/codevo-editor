// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAllStyleSheets } from "../cssContractTestSupport";
import { AgentProjectSwitcher } from "./AgentProjectSwitcher";
import type {
  AgentProjectMenuCommand,
  AgentProjectMenuTarget,
} from "./agentProjectMenuPresentation";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

const SIDEBAR_SHEET = "components/agentMode/agentSidebar.css";
const SHARED_CLASS = /^(cv-popover|cv-icon-button(--[\w-]+|__[\w-]+)?|lucide(-[\w-]+)?)$/;

function entry(label: string): AgentRailScopeEntry {
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
