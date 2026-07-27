// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceExpressRoutesFromSnapshots } from "../domain/workspaceExpressRoutes";
import { ExpressRoutesPanel, type ExpressRoutesPanelProps } from "./ExpressRoutesPanel";

describe("ExpressRoutesPanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  let geometry: ReturnType<typeof installGeometry>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    geometry = installGeometry();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    geometry.restore();
  });

  it("renders workspace route details and emits the complete route on click", async () => {
    const onOpenRoute = vi.fn();
    await render({ onOpenRoute });

    expect(host.textContent).toContain("GET");
    expect(host.textContent).toContain("/users/:id");
    expect(host.textContent).toContain("router");
    expect(host.textContent).toContain("api · packages/api/routes.ts:2");
    await clickOption(0);
    expect(onOpenRoute).toHaveBeenCalledExactlyOnceWith(routes[0]);
  });

  it("renders and filters a statically resolved mounted runtime path", async () => {
    const mounted = workspaceExpressRoutesFromSnapshots([
      {
        relativeFilePath: "src/server.ts",
        source: [
          "import express from 'express';",
          "import users from './users';",
          "const app = express();",
          "app.use('/api', users);",
        ].join("\n"),
      },
      {
        relativeFilePath: "src/users.ts",
        source: [
          "import express from 'express';",
          "const users = express.Router();",
          "users.get('/users/:id', handler);",
          "export default users;",
        ].join("\n"),
      },
    ]);

    await render({ query: "/api/users", routes: mounted });

    expect(routeOptions()).toHaveLength(1);
    expect(host.textContent).toContain("/api/users/:id");
    expect(host.textContent).toContain("src/users.ts:3");
  });

  it("filters the controlled query through every workspace field", async () => {
    const onQueryChange = vi.fn();
    await render({ onQueryChange, query: "admin app :3" });
    expect(routeOptions()).toHaveLength(1);
    expect(host.textContent).toContain("/admin/health");

    await typeQuery("users");
    expect(onQueryChange).toHaveBeenCalledWith("users");
    expect(queryInput().value).toBe("admin app :3");

    await render({ onQueryChange, query: "missing" });
    expect(routeOptions()).toHaveLength(0);
    expect(host.textContent).toContain("No Express routes match the current filter.");
    expect(queryInput().hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("supports listbox arrow, Home, End, and Enter navigation", async () => {
    const onOpenRoute = vi.fn();
    await render({ onOpenRoute });

    await key("End");
    expect(queryInput().getAttribute("aria-activedescendant")).toBe(routeOptions()[1]?.id);
    await key("Home");
    expect(queryInput().getAttribute("aria-activedescendant")).toBe(routeOptions()[0]?.id);
    await key("ArrowDown");
    await key("Enter");
    expect(onOpenRoute).toHaveBeenCalledExactlyOnceWith(routes[1]);
    expect(routeOptions().map((option) => option.tabIndex)).toEqual([-1, -1]);
  });

  it("windows twenty thousand routes while preserving exact keyboard navigation", async () => {
    const manyRoutes = Array.from({ length: 20_000 }, (_, index) => route(index));
    const onOpenRoute = vi.fn();
    await render({ onOpenRoute, routes: manyRoutes });

    expect(routeOptions().length).toBeGreaterThan(0);
    expect(routeOptions().length).toBeLessThan(40);
    expect(routeOptions()[0]?.getAttribute("aria-posinset")).toBe("1");
    expect(routeOptions()[0]?.getAttribute("aria-setsize")).toBe("20000");
    expect(spacer().style.height).toBe(`${20_000 * 32}px`);
    expect(host.textContent).not.toContain("/route-10000");

    await key("PageDown");
    expect(queryInput().getAttribute("aria-activedescendant")).toContain(manyRoutes[10].id);
    expect(
      routeOptions().find((option) => option.getAttribute("aria-selected") === "true")?.textContent,
    ).toContain("/route-10");

    await key("End");
    expect(queryInput().getAttribute("aria-activedescendant")).toContain(manyRoutes[19_999].id);
    expect(
      routeOptions().find((option) => option.getAttribute("aria-selected") === "true")?.textContent,
    ).toContain("/route-19999");

    await key("PageUp");
    expect(queryInput().getAttribute("aria-activedescendant")).toContain(manyRoutes[19_989].id);
    expect(
      routeOptions().find((option) => option.getAttribute("aria-selected") === "true")?.textContent,
    ).toContain("/route-19989");

    await key("End");
    await key("Enter");
    expect(onOpenRoute).toHaveBeenCalledExactlyOnceWith(manyRoutes[19_999]);
  });

  it("guards route opening while asynchronous navigation is pending", async () => {
    let resolveOpen!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveOpen = resolve;
    });
    const onOpenRoute = vi.fn(() => pending);
    await render({ onOpenRoute });

    await clickOption(0);
    await clickOption(1);
    expect(onOpenRoute).toHaveBeenCalledExactlyOnceWith(routes[0]);
    expect(routeOptions().every((option) => option.disabled)).toBe(true);

    await act(async () => resolveOpen());
    expect(routeOptions().every((option) => !option.disabled)).toBe(true);
  });

  it("recovers the open guard when navigation throws synchronously", async () => {
    const onOpenRoute = vi.fn(() => {
      throw new Error("Navigation failed");
    });
    await render({ onOpenRoute });

    await clickOption(0);

    expect(onOpenRoute).toHaveBeenCalledExactlyOnceWith(routes[0]);
    expect(routeOptions().every((option) => !option.disabled)).toBe(true);
  });

  it("renders refresh, loading, error, empty, filter-empty, and truncated states", async () => {
    const onRefresh = vi.fn();
    await render({ loading: true, onRefresh });
    expect(host.textContent).toContain("Loading Express routes");
    expect(button("Refresh Express routes").disabled).toBe(true);
    expect(routeOptions()).toHaveLength(0);

    await render({ error: "Discovery failed", loading: false, onRefresh });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Discovery failed");
    button("Refresh Express routes").click();
    expect(onRefresh).toHaveBeenCalledOnce();

    await render({ error: null, routes: [], truncated: false });
    expect(host.textContent).toContain("No Express routes found.");

    await render({ truncated: true });
    expect(host.textContent).toContain("Results are truncated.");
  });

  async function render(overrides: Partial<ExpressRoutesPanelProps> = {}) {
    await act(async () => {
      root.render(
        <ExpressRoutesPanel
          error={overrides.error ?? null}
          loading={overrides.loading ?? false}
          onOpenRoute={overrides.onOpenRoute ?? vi.fn()}
          onQueryChange={overrides.onQueryChange ?? vi.fn()}
          onRefresh={overrides.onRefresh ?? vi.fn()}
          query={overrides.query ?? ""}
          routes={overrides.routes ?? routes}
          truncated={overrides.truncated ?? false}
        />,
      );
    });
  }

  async function typeQuery(value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        queryInput(),
        value,
      );
      queryInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function key(value: string) {
    await act(async () => {
      queryInput().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value }));
    });
  }

  async function clickOption(index: number) {
    await act(async () => {
      routeOptions()[index]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function queryInput(): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>('[aria-label="Filter Express routes"]');
    if (!input) throw new Error("Express route filter is missing");
    return input;
  }

  function routeOptions(): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="option"]'));
  }

  function button(label: string): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!element) throw new Error(`Button is missing: ${label}`);
    return element;
  }

  function spacer(): HTMLDivElement {
    const element = host.querySelector<HTMLDivElement>('[data-testid="express-routes-spacer"]');
    if (!element) throw new Error("Express route spacer is missing");
    return element;
  }
});

const routes = workspaceExpressRoutesFromSnapshots([
  {
    packageLabel: "api",
    relativeFilePath: "packages/api/routes.ts",
    source: "\nrouter.get('/users/:id', handler);",
  },
  {
    relativeFilePath: "src/admin.ts",
    source: "\n\napp.post('/admin/health', handler);",
  },
]);

function route(index: number) {
  return {
    column: 1,
    id: `route-${index}`,
    line: index + 1,
    method: "GET",
    occurrence: 1,
    path: `/route-${index}`,
    receiver: "router",
    relativeFilePath: `src/route-${index}.ts`,
  } as const;
}

function installGeometry() {
  const descriptors = {
    cancelAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame"),
    clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
    clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
    requestAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame"),
  };
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  Object.defineProperties(HTMLElement.prototype, {
    clientHeight: { configurable: true, get: () => 320 },
    clientWidth: { configurable: true, get: () => 800 },
    offsetHeight: { configurable: true, get: () => 32 },
  });
  Object.defineProperties(globalThis, {
    cancelAnimationFrame: {
      configurable: true,
      value: (handle: number) => callbacks.delete(handle),
    },
    requestAnimationFrame: {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
      },
    },
  });

  return {
    restore() {
      for (const [property, descriptor] of Object.entries(descriptors)) {
        const target =
          property === "requestAnimationFrame" || property === "cancelAnimationFrame"
            ? globalThis
            : HTMLElement.prototype;
        if (descriptor) Object.defineProperty(target, property, descriptor);
        else Reflect.deleteProperty(target, property);
      }
    },
  };
}
