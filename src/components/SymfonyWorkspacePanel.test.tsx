// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SymfonyWorkspacePanelModel } from "../application/symfonyWorkspacePanelModel";
import { SymfonyWorkspacePanel } from "./SymfonyWorkspacePanel";

describe("SymfonyWorkspacePanel", () => {
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

  it("renders accessible sections, totals, and command metadata", async () => {
    await render();
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Commands");
    expect(host.querySelector('[role="grid"]')?.getAttribute("aria-label")).toBe(
      "Symfony commands",
    );
    expect(host.textContent).toContain("cache:clear");
    expect(host.textContent).toContain("Clear cache");
    expect(host.querySelector('[aria-label="Commands total"]')?.textContent).toBe("1");
  });

  it("supports tab and list keyboard navigation", async () => {
    const onTabChange = vi.fn();
    await render({ onTabChange });
    const commandsTab = button("Commands");
    act(() =>
      commandsTab.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" })),
    );
    expect(onTabChange).toHaveBeenCalledWith("routes");

    const onOpenRouteController = vi.fn(async () => true);
    await render({ activeTab: "routes", onOpenRouteController, onTabChange });
    const input = host.querySelector<HTMLInputElement>('[aria-label="Filter Symfony routes"]')!;
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })));
    expect(onOpenRouteController).toHaveBeenCalledWith(
      expect.objectContaining({ name: "app_home" }),
    );
  });

  it("routes controller, service, source, query, and refresh actions independently", async () => {
    const onOpenRouteController = vi.fn(async () => true);
    const onQueryChange = vi.fn();
    const onRefresh = vi.fn(async () => true);
    await render({
      activeTab: "routes",
      onOpenRouteController,
      onQueryChange,
      onRefresh,
    });
    await act(async () => {
      button("Open controller for app_home").click();
    });
    await act(async () => {
      button("Refresh Symfony workspace intelligence").click();
    });
    const input = host.querySelector<HTMLInputElement>('[aria-label="Filter Symfony routes"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "home",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onOpenRouteController).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onQueryChange).toHaveBeenCalledWith("home");

    await render({ activeTab: "services" });
    expect(button("Open service App\\Clock").disabled).toBe(false);
  });

  it("announces unavailable, error, empty, truncated, and busy states", async () => {
    await render({
      commands: { status: "unavailable", message: "console unavailable" },
      filteredCommands: [],
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("console unavailable");

    await render({ error: "inspection failed", filteredCommands: [] });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("inspection failed");

    await render({
      commands: { ...commands, commands: [], total: 10, truncated: true },
      filteredCommands: [],
    });
    expect(host.textContent).toContain("Results were truncated");

    await render({ busy: true });
    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
    expect(button("Refresh Symfony workspace intelligence").disabled).toBe(true);
  });

  async function render(overrides: Partial<SymfonyWorkspacePanelModel> = {}): Promise<void> {
    await act(async () => {
      root.render(<SymfonyWorkspacePanel {...model(overrides)} />);
    });
  }

  function button(label: string): HTMLButtonElement {
    const candidate = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) => element.getAttribute("aria-label") === label || element.textContent === label,
    );
    if (!candidate) throw new Error(`Missing button: ${label}`);
    return candidate;
  }
});

const command = {
  key: "command-cache-clear",
  name: "cache:clear",
  description: "Clear cache",
  aliases: ["cc"],
};
const route = {
  key: "route-home",
  name: "app_home",
  path: "/",
  methods: ["GET"],
  controller: "App\\Controller\\HomeController::index",
};
const service = {
  key: "service-clock",
  id: "App\\Clock",
  className: "App\\Clock",
  alias: null,
  public: false,
};
const commands = { status: "ok" as const, commands: [command], total: 1, truncated: false };
const routes = { status: "ok" as const, routes: [route], total: 1, truncated: false };
const services = { status: "ok" as const, services: [service], total: 1, truncated: false };

function model(overrides: Partial<SymfonyWorkspacePanelModel>): SymfonyWorkspacePanelModel {
  return {
    activeTab: "commands",
    busy: false,
    commands,
    error: null,
    filteredCommands: commands.commands,
    filteredRoutes: routes.routes,
    filteredServices: services.services,
    onOpenRouteController: vi.fn(async () => true),
    onOpenService: vi.fn(async () => true),
    onQueryChange: vi.fn(),
    onRefresh: vi.fn(async () => true),
    onTabChange: vi.fn(),
    query: "",
    routes,
    services,
    ...overrides,
  };
}
