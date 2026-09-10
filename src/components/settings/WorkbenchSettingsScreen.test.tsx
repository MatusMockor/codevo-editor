// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { defaultAppSettings, defaultWorkspaceSettings } from "../../domain/settings";
import type { SettingsSection } from "../../domain/settings";
import type { SettingsEnvironment } from "./settingsPageProps";
import { settingsRowDescriptor } from "./settingsRegistry";
import { WorkbenchSettingsScreen } from "./WorkbenchSettingsScreen";

describe("WorkbenchSettingsScreen", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onClose: Mock<() => void>;
  let scrollIntoView: Mock<(options?: boolean | ScrollIntoViewOptions) => void>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    onClose = vi.fn<() => void>();
    scrollIntoView = vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>();
    Element.prototype.scrollIntoView = scrollIntoView;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("focuses the page heading and exposes the section list as a tablist", () => {
    render();

    expect(document.activeElement?.textContent).toBe("Settings");
    expect(tablist()?.getAttribute("aria-orientation")).toBe("vertical");
    expect(tabLabels()).toEqual([
      "General",
      "Appearance",
      "Agents",
      "Keybindings",
      "Index & languages",
      "PHP",
      "Snippets",
    ]);
    expect(selectedTab()?.textContent).toBe("General");
    expect(panel()?.getAttribute("aria-labelledby")).toBe(selectedTab()?.id);
  });

  it("moves the selection with arrow keys and wraps at both ends", () => {
    render();

    keyDown(selectedTab(), "ArrowDown");
    expect(selectedTab()?.textContent).toBe("Appearance");
    expect(document.activeElement).toBe(selectedTab());

    keyDown(selectedTab(), "ArrowUp");
    keyDown(selectedTab(), "ArrowUp");
    expect(selectedTab()?.textContent).toBe("Snippets");

    keyDown(selectedTab(), "Home");
    expect(selectedTab()?.textContent).toBe("General");
    expect(tabs().every((tab) => tab.tabIndex === (tab === selectedTab() ? 0 : -1))).toBe(true);
  });

  it("selects a section by click and labels the panel with it", () => {
    render();

    click(tabs()[3]);

    expect(selectedTab()?.textContent).toBe("Keybindings");
    expect(panel()?.getAttribute("aria-labelledby")).toBe(selectedTab()?.id);
  });

  it("publishes the combobox contract for the search row", () => {
    render();

    const input = searchInput();

    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-controls")).toBe("settings-search-results");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.placeholder).toBe("Search");
    expect(results()?.hasAttribute("hidden")).toBe(true);
    expect(host.querySelector(".settings-kbd")?.textContent).toBe("/");
  });

  it("filters rows, moves the active option and activates the hit with Enter", () => {
    render();
    const descriptor = settingsRowDescriptor("general.formatOnSave");

    type(descriptor.title);

    const input = searchInput();
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(tablist()?.hasAttribute("hidden")).toBe(true);
    expect(optionLabels()[0]).toContain(descriptor.title);
    expect(input.getAttribute("aria-activedescendant")).toBe(
      "settings-search-option-general.formatOnSave",
    );
    expect(options()[0]?.textContent).toContain("General");

    keyDown(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      `settings-search-option-${options()[1]?.id.replace("settings-search-option-", "")}`,
    );

    keyDown(input, "Home");
    keyDown(input, "Enter");

    expect(input.value).toBe("");
    expect(selectedTab()?.textContent).toBe("General");
    expect(scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement?.getAttribute("data-settings-row")).toBe("general.formatOnSave");
  });

  it("clears the query on the first Escape and closes the surface on the next", () => {
    render();

    type("format");
    escape(searchInput());

    expect(searchInput().value).toBe("");
    expect(onClose).not.toHaveBeenCalled();

    escape(searchInput());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape when the search query is already empty", () => {
    render();

    escape(searchInput());

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers an exit control that never takes the mount focus from the heading", () => {
    render();

    const exit = exitButton();

    expect(exit.tagName).toBe("BUTTON");
    expect(exit.type).toBe("button");
    expect(exit.disabled).toBe(false);
    expect(exit.tabIndex).toBe(0);
    expect(accessibleName(exit)).toBe("Back");
    expect(document.activeElement).toBe(host.querySelector(".settings-screen__title"));
    expect(document.activeElement).not.toBe(exit);
    expect(tabbables()[0]).toBe(exit);
    expect(tabbables()[1]).toBe(searchInput());
  });

  it("closes the surface when the exit control is clicked", () => {
    render();

    click(exitButton());

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes the surface when the exit control is activated from the keyboard", () => {
    render();
    const exit = exitButton();

    act(() => exit.focus());
    expect(document.activeElement).toBe(exit);

    activateWithKey(exit, "Enter");
    expect(onClose).toHaveBeenCalledOnce();

    activateWithKey(exit, " ");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps the Escape ladder intact while the exit control holds focus", () => {
    render();
    const exit = exitButton();

    type("format");
    act(() => exit.focus());
    escape(exit);

    expect(searchInput().value).toBe("");
    expect(onClose).not.toHaveBeenCalled();

    escape(exit);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("focuses the search with / only when the active element is not editable", () => {
    render();

    slash(document.body);
    expect(document.activeElement).toBe(searchInput());

    const input = searchInput();
    input.value = "";
    slash(input);
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("resolves the git deep link to the Index & languages row", () => {
    render("git");

    expect(selectedTab()?.textContent).toBe("Index & languages");
    expect(scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement?.getAttribute("data-settings-row")).toBe(
      "index.gitDirectoryMappings",
    );
  });

  function render(initialSection: SettingsSection = "general"): void {
    act(() =>
      root.render(
        <WorkbenchSettingsScreen
          env={environment()}
          initialAppSettings={defaultAppSettings()}
          initialSection={initialSection}
          initialTrusted
          initialWorkspaceSettings={defaultWorkspaceSettings()}
          onClose={onClose}
          onSave={async () => undefined}
        />,
      ),
    );
  }

  function type(value: string): void {
    const input = searchInput();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function searchInput(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]');
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  function exitButton(): HTMLButtonElement {
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => accessibleName(candidate) === "Back",
    );
    expect(button).toBeDefined();
    return button as HTMLButtonElement;
  }

  function tabbables(): HTMLElement[] {
    const candidates = [
      ...host.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]"),
    ];

    return candidates.filter((candidate) => {
      if (candidate.tabIndex < 0) return false;
      if (candidate.closest("[hidden]") !== null) return false;
      if (candidate instanceof HTMLButtonElement && candidate.disabled) return false;

      return true;
    });
  }

  function results(): HTMLElement | null {
    return host.querySelector('[role="listbox"]');
  }

  function options(): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>('[role="option"]')];
  }

  function optionLabels(): string[] {
    return options().map((option) => option.textContent ?? "");
  }

  function tablist(): HTMLElement | null {
    return host.querySelector('[role="tablist"]');
  }

  function tabs(): HTMLButtonElement[] {
    return [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  }

  function tabLabels(): string[] {
    return tabs().map((tab) => tab.textContent ?? "");
  }

  function selectedTab(): HTMLButtonElement | undefined {
    return tabs().find((tab) => tab.getAttribute("aria-selected") === "true");
  }

  function panel(): HTMLElement | null {
    return host.querySelector('[role="tabpanel"]');
  }
});

function click(element: HTMLElement | undefined): void {
  expect(element).toBeDefined();
  act(() => element?.click());
}

function keyDown(element: HTMLElement | undefined, key: string): void {
  expect(element).toBeDefined();
  act(() => {
    element?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
  });
}

function accessibleName(element: HTMLElement): string {
  const label = element.getAttribute("aria-label");

  if (label !== null) return label.trim();

  return (element.textContent ?? "").trim();
}

function activateWithKey(element: HTMLElement, key: string): void {
  act(() => {
    const proceed = element.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
    );
    element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key }));

    if (!proceed) return;

    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
  });
}

function escape(element: HTMLElement): void {
  keyDown(element, "Escape");
}

function slash(element: HTMLElement): void {
  keyDown(element, "/");
}

function environment(): SettingsEnvironment {
  return {
    appUpdater: null,
    gitDetectedRepositoryMappings: [],
    hasWorkspace: true,
    onCopyInstallCommand: () => undefined,
    onOpenJavaScriptTypeScriptServiceLog: async () => undefined,
    onOpenNodeLaunchConfigurations: () => undefined,
    onRestartJavaScriptTypeScriptService: async () => undefined,
    phpTools: null,
    providerManagement: null,
    providerSignIn: null,
    systemFontGateway: { listMonospaceFontFamilies: async () => [] },
    workspaceDescriptor: null,
    workspaceRoot: "/workspace",
  };
}
