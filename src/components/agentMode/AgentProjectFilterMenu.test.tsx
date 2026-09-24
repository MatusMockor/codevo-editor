// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProjectFilterMenu } from "./AgentProjectFilterMenu";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

function entry(
  projectRootKey: string,
  label: string,
  trust: AgentRailScopeEntry["trust"] = "trusted",
): AgentRailScopeEntry {
  return {
    value: projectRootKey,
    label,
    projectRootKey,
    repositoryRoot: projectRootKey,
    trust,
    origin: "active-tab",
    rootPath: projectRootKey,
    repositoryCount: 1,
  };
}

const entries = [entry("/orders", "orders-api"), entry("/web", "web-dashboard", "untrusted")];

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

function openFilter(): void {
  const trigger = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Filter threads by project"]',
  );
  expect(trigger).not.toBeNull();
  act(() => trigger?.click());
}

function options(): ReadonlyArray<HTMLElement> {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

function type(input: HTMLInputElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function searchInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search projects"]');
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

describe("AgentProjectFilterMenu", () => {
  it("exposes the current scope on the closed trigger without opening the popover", () => {
    const renderFilter = (filter: { kind: "all" } | { kind: "project"; projectRootKey: string }) =>
      act(() =>
        root.render(
          <AgentProjectFilterMenu
            entries={entries}
            filter={filter}
            onProjectCommand={vi.fn()}
            onSelectAll={vi.fn()}
            onSelectProject={vi.fn()}
          />,
        ),
      );
    const scopeText = (): string | null | undefined => {
      const trigger = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Filter threads by project"]',
      );
      const describedBy = trigger?.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      return document.getElementById(describedBy ?? "")?.textContent;
    };

    renderFilter({ kind: "all" });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(host.querySelector("button svg")).not.toBeNull();
    expect(scopeText()).toBe("Showing All projects");

    renderFilter({ kind: "project", projectRootKey: "/orders" });
    expect(host.querySelector(".cv-favicon")?.textContent).toBe("O");
    expect(scopeText()).toBe("Showing orders-api");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it("lists All projects and every project, marks the current one and picks by click", () => {
    const onSelectProject = vi.fn();
    const onSelectAll = vi.fn();
    act(() =>
      root.render(
        <AgentProjectFilterMenu
          entries={entries}
          filter={{ kind: "all" }}
          onProjectCommand={vi.fn()}
          onSelectAll={onSelectAll}
          onSelectProject={onSelectProject}
        />,
      ),
    );
    openFilter();
    const listed = options();
    expect(listed.map((option) => option.querySelector(".cv-filter__label")?.textContent)).toEqual([
      "All projects",
      "orders-api",
      "web-dashboard",
    ]);
    expect(listed[0]?.getAttribute("aria-selected")).toBe("true");
    expect(listed[1]?.getAttribute("aria-selected")).toBe("false");
    expect(listed[2]?.textContent).toContain("Not trusted");
    act(() => listed[1]?.click());
    expect(onSelectProject).toHaveBeenCalledWith(entries[0]);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    openFilter();
    act(() => options()[0]?.click());
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it("searches projects, hides All projects while searching and selects with the keyboard", () => {
    const onSelectProject = vi.fn();
    act(() =>
      root.render(
        <AgentProjectFilterMenu
          entries={entries}
          filter={{ kind: "project", projectRootKey: "/orders" }}
          onProjectCommand={vi.fn()}
          onSelectAll={vi.fn()}
          onSelectProject={onSelectProject}
        />,
      ),
    );
    expect(host.querySelector(".cv-favicon")?.textContent).toBe("O");
    openFilter();
    const input = searchInput();
    type(input, "web");
    expect(
      [...document.querySelectorAll(".cv-filter__label")].map((node) => node.textContent),
    ).toEqual(["web-dashboard"]);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSelectProject).toHaveBeenCalledWith(entries[1]);
  });

  it("moves the highlight with the arrow keys and says when no project matches", () => {
    const onSelectProject = vi.fn();
    act(() =>
      root.render(
        <AgentProjectFilterMenu
          entries={entries}
          filter={{ kind: "all" }}
          onProjectCommand={vi.fn()}
          onSelectAll={vi.fn()}
          onSelectProject={onSelectProject}
        />,
      ),
    );
    openFilter();
    const input = searchInput();
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(options()[1]?.dataset.highlighted).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[1]?.id);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSelectProject).toHaveBeenCalledWith(entries[0]);
    openFilter();
    type(searchInput(), "zzz");
    expect(options()).toHaveLength(0);
    expect(document.body.textContent).toContain("No matching projects.");
  });

  it("keeps the listbox pure options and the gear buttons keyboard reachable outside it", () => {
    act(() =>
      root.render(
        <AgentProjectFilterMenu
          entries={entries}
          filter={{ kind: "all" }}
          onProjectCommand={vi.fn()}
          onSelectAll={vi.fn()}
          onSelectProject={vi.fn()}
        />,
      ),
    );
    openFilter();
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox?.querySelector("button")).toBeNull();
    expect(
      [...(listbox?.children ?? [])].every((child) => child.getAttribute("role") === "option"),
    ).toBe(true);
    const gears = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="group"] button.cv-filter__gear'),
    ];
    expect(gears.map((gear) => gear.getAttribute("aria-label"))).toEqual([
      "Project settings for orders-api",
      "Project settings for web-dashboard",
    ]);
    expect(gears.every((gear) => gear.tabIndex === 0 && !gear.disabled)).toBe(true);
    expect(gears.some((gear) => gear.closest('[role="option"], [role="listbox"]') !== null)).toBe(
      false,
    );
  });

  it("opens project actions from the gear and routes the chosen command", () => {
    const onProjectCommand = vi.fn();
    act(() =>
      root.render(
        <AgentProjectFilterMenu
          entries={entries}
          filter={{ kind: "all" }}
          onProjectCommand={onProjectCommand}
          onSelectAll={vi.fn()}
          onSelectProject={vi.fn()}
        />,
      ),
    );
    openFilter();
    act(() =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Project settings for web-dashboard"]')
        ?.click(),
    );
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    const trust = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Trust project…",
    );
    expect(trust).toBeDefined();
    act(() => trust?.click());
    expect(onProjectCommand).toHaveBeenCalledWith(
      { projectRootKey: "/web", repositoryRoot: "/web", rootPath: "/web" },
      "trust",
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
