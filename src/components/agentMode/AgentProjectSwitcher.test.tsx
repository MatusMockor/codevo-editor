// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAllStyleSheets } from "../cssContractTestSupport";
import { AgentProjectSwitcher } from "./AgentProjectSwitcher";
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

  function openSwitcher(): HTMLElement {
    const editor = entry("editor");
    act(() =>
      root.render(
        <AgentProjectSwitcher
          activeEntry={editor}
          entries={[editor, entry("docs-site")]}
          focus="active"
          onProjectCommand={() => undefined}
          onSelectAll={() => undefined}
          onSelectProject={() => undefined}
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
});
