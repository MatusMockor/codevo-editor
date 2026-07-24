// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetteWorkspaceRoutesPanelModel } from "../application/netteWorkspaceRoutesPanelModel";
import { NetteWorkspaceRoutesPanel } from "./NetteWorkspaceRoutesPanel";

describe("NetteWorkspaceRoutesPanel", () => {
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

  it("renders route metadata in an accessible grid", async () => {
    await render();
    expect(host.querySelector('[role="grid"]')?.getAttribute("aria-label")).toBe("Nette routes");
    expect(host.querySelectorAll('[role="row"]')).toHaveLength(2);
    expect(host.textContent).toContain("api/<id>");
    expect(host.textContent).toContain("GET | POST");
    expect(host.textContent).toContain("Product:detail");
    expect(host.textContent).toContain("Dynamic target");
  });

  it("routes definition, presenter, query and refresh actions", async () => {
    const onOpenDefinition = vi.fn(async () => true);
    const onOpenTarget = vi.fn(async () => true);
    const onQueryChange = vi.fn();
    const onRefresh = vi.fn(async () => true);
    await render({ onOpenDefinition, onOpenTarget, onQueryChange, onRefresh });
    await act(async () => button("Open route definition api/<id>").click());
    await act(async () => button("Open route target api/<id>").click());
    expect(button("Open route target dynamic").disabled).toBe(true);
    await act(async () => button("Refresh Nette routes").click());
    const input = host.querySelector<HTMLInputElement>('[aria-label="Filter Nette routes"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "api");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onOpenDefinition).toHaveBeenCalledOnce();
    expect(onOpenTarget).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onQueryChange).toHaveBeenCalledWith("api");
  });

  it("supports Arrow, Home, End and Enter keyboard navigation", async () => {
    const onOpenDefinition = vi.fn(async () => true);
    const onOpenTarget = vi.fn(async () => true);
    await render({ onOpenDefinition, onOpenTarget });
    const grid = host.querySelector<HTMLElement>('[role="grid"]')!;
    act(() => key(grid, "End"));
    expect(selectedRow().textContent).toContain("dynamic");
    await act(async () => key(grid, "Enter"));
    expect(onOpenDefinition).toHaveBeenCalledWith(expect.objectContaining({ mask: "dynamic" }));
    act(() => key(grid, "Home"));
    act(() => key(grid, "ArrowDown"));
    act(() => key(grid, "ArrowUp"));
    await act(async () => key(grid, "Enter"));
    expect(onOpenTarget).toHaveBeenCalledWith(expect.objectContaining({ mask: "api/<id>" }));
  });

  it("announces unavailable, error, empty, truncated and busy states", async () => {
    await render({
      routes: { status: "unavailable", message: "routes unavailable" },
      filteredRoutes: [],
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("routes unavailable");
    await render({ error: "inspection failed", filteredRoutes: [] });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("inspection failed");
    await render({ routes: { ...routes, truncated: true } });
    expect(host.textContent).toContain("Results were truncated");
    await render({
      busy: true,
      routes: { status: "unavailable", message: "waiting" },
      filteredRoutes: [],
    });
    expect(host.textContent).toContain("Inspecting Nette routes");
    expect(button("Refresh Nette routes").disabled).toBe(true);
    await render({ routes: { ...routes, routes: [], total: 0 }, filteredRoutes: [] });
    expect(host.textContent).toContain("No Nette routes found");
  });

  async function render(overrides: Partial<NetteWorkspaceRoutesPanelModel> = {}) {
    await act(async () => root.render(<NetteWorkspaceRoutesPanel {...model(overrides)} />));
  }
  function button(label: string): HTMLButtonElement {
    const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.getAttribute("aria-label") === label,
    );
    if (!result) throw new Error(`Missing button: ${label}`);
    return result;
  }
  function selectedRow(): HTMLElement {
    return host.querySelector<HTMLElement>('[role="row"][aria-selected="true"]')!;
  }
});

const routeList = [
  {
    key: "api",
    mask: "api/<id>",
    methods: ["GET", "POST"],
    target: { raw: "Product:detail", presenter: "Product", action: "detail" },
    source: { path: "/workspace/app/Router.php", lineNumber: 4, column: 19 },
  },
  {
    key: "dynamic",
    mask: "dynamic",
    methods: [],
    target: null,
    source: { path: "/workspace/app/Router.php", lineNumber: 5, column: 19 },
  },
] as const;
const routes = { status: "ok" as const, routes: routeList, total: 2, truncated: false };
function model(overrides: Partial<NetteWorkspaceRoutesPanelModel>): NetteWorkspaceRoutesPanelModel {
  return {
    busy: false,
    error: null,
    filteredRoutes: routeList,
    onOpenDefinition: vi.fn(async () => true),
    onOpenTarget: vi.fn(async () => true),
    onQueryChange: vi.fn(),
    onRefresh: vi.fn(async () => true),
    query: "",
    routes,
    ...overrides,
  };
}
function key(target: HTMLElement, name: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: name }));
}
