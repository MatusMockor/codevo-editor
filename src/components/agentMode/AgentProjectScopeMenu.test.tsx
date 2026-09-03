// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProjectScopeMenu, type AgentProjectScopeMenuProps } from "./AgentProjectScopeMenu";
import {
  ALL_PROJECTS_SCOPE_LABEL,
  ALL_PROJECTS_SCOPE_VALUE,
  agentRailScopeValue,
  type AgentRailProjectScopeEntry,
  type AgentRailScopeEntry,
} from "./agentSidebarPresentation";

const ROOT = "/workspace/app";
const OTHER = "/workspace/api";

const ALL_ENTRY: AgentRailScopeEntry = {
  kind: "all",
  value: ALL_PROJECTS_SCOPE_VALUE,
  label: ALL_PROJECTS_SCOPE_LABEL,
};

describe("AgentProjectScopeMenu", () => {
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

  it("lists a folder row per project and keeps the gear off the All projects row", () => {
    render();
    openMenu();

    expect(rowLabels()).toEqual(["All projects", "app", "api"]);
    expect(host.querySelectorAll('[role="menuitemradio"] svg').length).toBe(3);
    expect(gears().map((gear) => gear.getAttribute("aria-label"))).toEqual([
      "Project actions for app",
      "Project actions for api",
    ]);
  });

  it("reports the repository count of a multi-repository project", () => {
    render({ entries: [ALL_ENTRY, entry(ROOT, "app", { repositoryCount: 2 })] });
    openMenu();

    expect(host.querySelector(".agent-scope-menu__count")?.textContent).toBe("2 repos");
  });

  it("filters projects by label and repository path", () => {
    render({
      entries: [
        ALL_ENTRY,
        entry(ROOT, "boxes / app"),
        entry("/workspace/boxes/ebox-crm", "boxes / ebox-crm"),
      ],
    });
    openMenu();

    typeSearch("ebox");
    expect(rowLabels()).toEqual(["boxes / ebox-crm"]);

    typeSearch("workspace/app");
    expect(rowLabels()).toEqual(["boxes / app"]);

    typeSearch("missing");
    expect(rowLabels()).toEqual([]);
    expect(host.textContent).toContain("No matching projects.");
  });

  it("opens the project actions from the gear of that row", () => {
    render();
    openMenu();
    click(gears()[1]);

    expect(menuItemLabels()).toEqual([
      "Close project",
      "Filter to this project",
      "Terminal sessions…",
      "Reveal in Finder",
      "Copy path",
    ]);
  });

  it("offers Trust project only while the project is untrusted", () => {
    render({
      entries: [ALL_ENTRY, entry(ROOT, "app", { trust: "untrusted" })],
    });
    openMenu();
    click(gears()[0]);

    expect(menuItemLabels()).toContain("Trust project");
  });

  it("offers Release project only for a project whose tab was closed", () => {
    render({
      entries: [ALL_ENTRY, entry(ROOT, "app", { origin: "closed-tab-live-tasks" })],
    });
    openMenu();
    click(gears()[0]);

    expect(menuItemLabels()).toContain("Release project");
  });

  it("hides the path actions for a project without a known root path", () => {
    render({ entries: [ALL_ENTRY, entry(ROOT, "app", { rootPath: null })] });
    openMenu();
    click(gears()[0]);

    expect(menuItemLabels()).toEqual(["Filter to this project", "Terminal sessions…"]);
  });

  it("reports a project command with the root key of that project", () => {
    const onProjectCommand = vi.fn();
    render({ onProjectCommand });
    openMenu();
    click(gears()[1]);
    clickMenuItem("Copy path");

    expect(onProjectCommand).toHaveBeenCalledWith(
      { projectRootKey: OTHER, repositoryRoot: OTHER, rootPath: OTHER },
      "copyPath",
    );
  });

  it("reports the filter command and disables it for the active scope", () => {
    const onProjectCommand = vi.fn();
    render({ onProjectCommand, value: agentRailScopeValue(ROOT, ROOT) });
    openMenu();
    click(gears()[1]);
    clickMenuItem("Filter to this project");

    expect(onProjectCommand).toHaveBeenCalledWith(
      { projectRootKey: OTHER, repositoryRoot: OTHER, rootPath: OTHER },
      "filterToProject",
    );

    click(gears()[0]);
    expect(menuItem("Filter to this project")?.disabled).toBe(true);
  });

  it("changes the scope from a project row", () => {
    const onChange = vi.fn();
    render({ onChange });
    openMenu();
    click(scopeRow(agentRailScopeValue(OTHER, OTHER)));

    expect(onChange).toHaveBeenCalledWith(agentRailScopeValue(OTHER, OTHER));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("focuses project search on open and walks the filtered rows with the arrow keys", () => {
    render({ value: agentRailScopeValue(ROOT, ROOT) });
    openMenu();

    expect(document.activeElement).toBe(searchInput());

    keydown("ArrowDown");
    expect(document.activeElement).toBe(scopeRow(ALL_PROJECTS_SCOPE_VALUE));

    keydown("ArrowUp");
    expect(document.activeElement).toBe(gears()[1]);
  });

  it("clears a project query before Escape closes the menu", () => {
    render();
    openMenu();
    typeSearch("api");

    keydown("Escape", searchInput());
    expect(searchInput().value).toBe("");
    expect(host.querySelector('[role="menu"]')).not.toBeNull();

    keydown("Escape", searchInput());
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("returns focus to the trigger when Escape closes the scope menu", () => {
    render();
    openMenu();
    keydown("Escape");

    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("returns focus to the gear when Escape closes the project actions", () => {
    render();
    openMenu();
    click(gears()[0]);
    expect(document.activeElement).toBe(menuItem("Close project"));

    keydown("Escape", document.activeElement);

    expect(host.querySelectorAll('[role="menu"]').length).toBe(1);
    expect(document.activeElement).toBe(gears()[0]);
  });

  function render(overrides: Partial<AgentProjectScopeMenuProps> = {}): void {
    const props: AgentProjectScopeMenuProps = {
      id: "agent-rail-scope",
      label: "Project scope",
      entries: [ALL_ENTRY, entry(ROOT, "app"), entry(OTHER, "api")],
      value: ALL_PROJECTS_SCOPE_VALUE,
      disabled: false,
      onChange: vi.fn(),
      onProjectCommand: vi.fn(),
      ...overrides,
    };
    act(() => root.render(<AgentProjectScopeMenu {...props} />));
  }

  function entry(
    repositoryRoot: string,
    label: string,
    overrides: Partial<AgentRailProjectScopeEntry> = {},
  ): AgentRailProjectScopeEntry {
    return {
      kind: "repository",
      value: agentRailScopeValue(repositoryRoot, repositoryRoot),
      label,
      projectRootKey: repositoryRoot,
      repositoryRoot,
      repositoryResolved: true,
      trust: "trusted",
      origin: "active-tab",
      rootPath: repositoryRoot,
      repositoryCount: 1,
      ...overrides,
    };
  }

  function trigger(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>("button#agent-rail-scope");
    expect(element).not.toBeNull();
    return element as HTMLButtonElement;
  }

  function openMenu(): void {
    click(trigger());
  }

  function searchInput(): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>('input[aria-label="Search projects"]');
    expect(element).not.toBeNull();
    return element as HTMLInputElement;
  }

  function typeSearch(value: string): void {
    const element = searchInput();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function gears(): ReadonlyArray<HTMLButtonElement> {
    return [...host.querySelectorAll<HTMLButtonElement>(".agent-scope-menu__gear")];
  }

  function scopeRow(value: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(
      `[role="menuitemradio"][data-value="${value}"]`,
    );
    expect(element).not.toBeNull();
    return element as HTMLButtonElement;
  }

  function rowLabels(): ReadonlyArray<string> {
    return [...host.querySelectorAll('[role="menuitemradio"] .agent-menu__label')].map(
      (element) => element.textContent ?? "",
    );
  }

  function projectMenuItems(): ReadonlyArray<HTMLButtonElement> {
    return [...host.querySelectorAll<HTMLButtonElement>('.agent-menu__item[role="menuitem"]')];
  }

  function menuItemLabels(): ReadonlyArray<string> {
    return projectMenuItems().map((item) => item.textContent ?? "");
  }

  function menuItem(label: string): HTMLButtonElement | null {
    return projectMenuItems().find((item) => item.textContent === label) ?? null;
  }

  function clickMenuItem(label: string): void {
    const item = menuItem(label);
    expect(item).not.toBeNull();
    click(item as HTMLButtonElement);
  }

  function click(element: HTMLElement | undefined): void {
    expect(element).toBeDefined();
    act(() => element?.click());
  }

  function keydown(
    key: string,
    target: Element | null = host.querySelector('[role="menu"]'),
  ): void {
    expect(target).not.toBeNull();
    act(() => {
      target?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
    });
  }
});
