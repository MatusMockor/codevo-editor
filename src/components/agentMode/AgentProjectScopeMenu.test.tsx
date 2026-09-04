// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProjectScopeMenu, type AgentProjectScopeMenuProps } from "./AgentProjectScopeMenu";
import { agentRailScopeValue, type AgentRailScopeEntry } from "./agentSidebarPresentation";

const ROOT = "/workspace/app";
const OTHER = "/workspace/api";

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

  it("lists a folder row per open project with a gear and a close button", () => {
    render();
    openMenu();

    expect(rowLabels()).toEqual(["app", "api"]);
    expect(host.querySelectorAll('[role="menuitemradio"] svg').length).toBe(2);
    expect(gears().map((gear) => gear.getAttribute("aria-label"))).toEqual([
      "Project actions for app",
      "Project actions for api",
    ]);
    expect(closeButtons().map((button) => button.getAttribute("aria-label"))).toEqual([
      "Close project app",
      "Close project api",
    ]);
    expect(closeButtons()[0]?.title).toBe("Close project");
  });

  it("never lists an All projects entry", () => {
    render();
    openMenu();

    expect(host.textContent).not.toContain("All projects");
    expect(trigger().textContent).not.toContain("All projects");
  });

  it("closes the project from the row without opening the gear menu", () => {
    const onProjectCommand = vi.fn();
    const onChange = vi.fn();
    render({ onChange, onProjectCommand });
    openMenu();
    click(closeButtons()[1]);

    expect(onProjectCommand).toHaveBeenCalledExactlyOnceWith(
      { projectRootKey: OTHER, repositoryRoot: OTHER, rootPath: OTHER },
      "close",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides the close button for a project it cannot close", () => {
    render({
      entries: [
        entry(ROOT, "app", { rootPath: null }),
        entry(OTHER, "api", { origin: "closed-tab-live-tasks" }),
      ],
    });
    openMenu();

    expect(closeButtons()).toEqual([]);
  });

  it("keeps the menu keyboard-operable after the close button removes its row", () => {
    render({ entries: [entry(ROOT, "app"), entry(OTHER, "api")] });
    openMenu();

    keydown("ArrowUp");
    expect(document.activeElement).toBe(closeButtons()[1]);

    act(() => closeButtons()[1]?.click());

    expect(document.activeElement).toBe(searchInput());
  });

  it("reaches the close button with the roving arrow focus and activates it with Enter", () => {
    const onProjectCommand = vi.fn();
    render({ entries: [entry(ROOT, "app")], onProjectCommand });
    openMenu();

    keydown("ArrowDown");
    expect(document.activeElement).toBe(scopeRow(agentRailScopeValue(ROOT)));
    keydown("ArrowDown");
    expect(document.activeElement).toBe(gears()[0]);
    keydown("ArrowDown");
    expect(document.activeElement).toBe(closeButtons()[0]);

    click(closeButtons()[0]);
    expect(onProjectCommand).toHaveBeenCalledExactlyOnceWith(
      { projectRootKey: ROOT, repositoryRoot: ROOT, rootPath: ROOT },
      "close",
    );
  });

  it("moves focus out of the menu when the last project leaves the picker", () => {
    const addProject = document.createElement("button");
    addProject.setAttribute("aria-label", "Add project");
    document.body.append(addProject);
    render();
    openMenu();
    keydown("ArrowDown");
    expect(host.contains(document.activeElement)).toBe(true);

    render({ entries: [], value: "", disabled: true });

    expect(document.activeElement).toBe(addProject);
    addProject.remove();
  });

  it("shows a neutral label when no project is open", () => {
    render({ entries: [], value: "", disabled: true });

    expect(trigger().textContent).toContain("No project");
  });

  it("reports the repository count of a multi-repository project", () => {
    render({ entries: [entry(ROOT, "app", { repositoryCount: 2 })] });
    openMenu();

    expect(host.querySelector(".agent-scope-menu__count")?.textContent).toBe("2 repos");
  });

  it("filters projects by label and repository path", () => {
    render({
      entries: [entry(ROOT, "boxes / app"), entry("/workspace/boxes/ebox-crm", "boxes / ebox-crm")],
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

  it("opens the project actions from the gear of that row without a filter entry", () => {
    render();
    openMenu();
    click(gears()[1]);

    expect(menuItemLabels()).toEqual([
      "Close project",
      "Terminal sessions…",
      "Reveal in Finder",
      "Copy path",
    ]);
  });

  it("offers Trust project only while the project is untrusted", () => {
    render({
      entries: [entry(ROOT, "app", { trust: "untrusted" })],
    });
    openMenu();
    click(gears()[0]);

    expect(menuItemLabels()).toContain("Trust project");
  });

  it("offers Release project only for a project whose tab was closed", () => {
    render({
      entries: [entry(ROOT, "app", { origin: "closed-tab-live-tasks" })],
    });
    openMenu();
    click(gears()[0]);

    expect(menuItemLabels()).toContain("Release project");
  });

  it("hides the path actions for a project without a known root path", () => {
    render({ entries: [entry(ROOT, "app", { rootPath: null })] });
    openMenu();
    click(gears()[0]);

    expect(menuItemLabels()).toEqual(["Terminal sessions…"]);
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

  it("changes the scope from a project row", () => {
    const onChange = vi.fn();
    render({ onChange });
    openMenu();
    click(scopeRow(agentRailScopeValue(OTHER)));

    expect(onChange).toHaveBeenCalledWith(agentRailScopeValue(OTHER));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("focuses project search on open and walks the filtered rows with the arrow keys", () => {
    render({ value: agentRailScopeValue(ROOT) });
    openMenu();

    expect(document.activeElement).toBe(searchInput());

    keydown("ArrowDown");
    expect(document.activeElement).toBe(scopeRow(agentRailScopeValue(ROOT)));

    keydown("ArrowUp");
    expect(document.activeElement).toBe(closeButtons()[1]);
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
      entries: [entry(ROOT, "app"), entry(OTHER, "api")],
      value: agentRailScopeValue(ROOT),
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
    overrides: Partial<AgentRailScopeEntry> = {},
  ): AgentRailScopeEntry {
    return {
      value: agentRailScopeValue(repositoryRoot),
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

  function closeButtons(): ReadonlyArray<HTMLButtonElement> {
    return [
      ...host.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"][aria-label^="Close project "]',
      ),
    ];
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
