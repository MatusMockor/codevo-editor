// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetteOperationalWorkspacePanel } from "./NetteOperationalWorkspacePanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("NetteOperationalWorkspacePanel", () => {
  it("switches between Services and Presenters without rendering the inactive surface", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onSectionChange = vi.fn();
    act(() =>
      root.render(
        <NetteOperationalWorkspacePanel
          activeSection="services"
          onSectionChange={onSectionChange}
          presenters={presenterProps()}
          routes={routeProps()}
          services={serviceProps()}
        />,
      ),
    );

    expect(host.querySelector('[aria-label="Nette workspace"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Filter Nette services"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Filter Nette presenters"]')).toBeNull();
    const presentersTab = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      (button) => button.textContent === "Presenters",
    );
    act(() => presentersTab?.click());
    expect(onSectionChange).toHaveBeenCalledWith("presenters");
    act(() => root.unmount());
  });
});

function serviceProps() {
  return {
    busy: false,
    error: null,
    filteredServices: [],
    onOpenClass: vi.fn(async () => false),
    onOpenDefinition: vi.fn(async () => false),
    onQueryChange: vi.fn(),
    onRefresh: vi.fn(async () => true),
    query: "",
    services: { services: [], status: "ok" as const, total: 0, truncated: false },
  };
}

function routeProps() {
  return {
    busy: false,
    error: null,
    filteredRoutes: [],
    onOpenDefinition: vi.fn(async () => false),
    onOpenTarget: vi.fn(async () => false),
    onQueryChange: vi.fn(),
    onRefresh: vi.fn(async () => true),
    query: "",
    routes: { routes: [], status: "ok" as const, total: 0, truncated: false },
  };
}

function presenterProps() {
  return {
    busy: false,
    error: null,
    filteredPresenters: [],
    onOpenMethod: vi.fn(async () => false),
    onOpenPresenter: vi.fn(async () => false),
    onOpenTemplate: vi.fn(async () => false),
    onQueryChange: vi.fn(),
    onRefresh: vi.fn(async () => true),
    presenters: { presenters: [], status: "ok" as const, total: 0, truncated: false },
    query: "",
  };
}
