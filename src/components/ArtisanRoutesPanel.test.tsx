// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtisanRoute } from "../domain/artisanRoutes";
import { ArtisanRoutesPanel } from "./ArtisanRoutesPanel";

describe("ArtisanRoutesPanel", () => {
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

  it.each([
    [{ loading: true }, "Loading routes"],
    [{ unavailable: "Trust this workspace to inspect Artisan routes." }, "Trust this workspace"],
    [{ error: "Artisan failed" }, "Artisan failed"],
    [{ routes: [] }, "No routes match"],
  ])("renders truthful state %#", async (overrides, message) => {
    await render(overrides);
    expect(host.textContent).toContain(message);
  });

  it("renders route fields and forwards filter changes", async () => {
    const onChangeQuery = vi.fn();
    await render({ onChangeQuery });
    const input = host.querySelector<HTMLInputElement>(
      '[aria-label="Filter routes"]',
    );

    if (!input) {
      throw new Error("filter input missing");
    }

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "users");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(host.textContent).toContain("GET");
    expect(host.textContent).toContain("users.show");
    expect(onChangeQuery).toHaveBeenCalledWith("users");
  });

  it("navigates controller rows and mutes closure routes", async () => {
    const onOpenController = vi.fn();
    await render({ onOpenController });
    const rows = Array.from(host.querySelectorAll("tbody tr"));

    await act(async () => {
      rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenController).toHaveBeenCalledExactlyOnceWith({
      className: "App\\Http\\Controllers\\UserController",
      methodName: "show",
    });
    expect(rows[1].getAttribute("aria-disabled")).toBe("true");
  });

  it("navigates invokable controller rows through __invoke", async () => {
    const onOpenController = vi.fn();
    await render({
      onOpenController,
      routes: [
        {
          action: "App\\Http\\Controllers\\HealthController",
          methods: ["GET"],
          uri: "health",
        },
      ],
      total: 1,
    });
    const row = host.querySelector("tbody tr");

    if (!row) {
      throw new Error("route row missing");
    }

    await act(async () => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(row.hasAttribute("aria-disabled")).toBe(false);
    expect(onOpenController).toHaveBeenCalledExactlyOnceWith({
      className: "App\\Http\\Controllers\\HealthController",
      methodName: "__invoke",
    });
  });

  it("shows matched and total counts and titles truncated cells", async () => {
    await render({ query: "users", routes: [routes()[0]], total: 87 });

    expect(host.querySelector('[aria-label="Route total"]')?.textContent).toBe(
      "1 of 87 routes",
    );
    expect(
      host.querySelector("tbody tr td:nth-child(2)")?.getAttribute("title"),
    ).toBe("users/{user}");
    expect(
      host.querySelector("tbody tr td:nth-child(4)")?.getAttribute("title"),
    ).toBe("App\\Http\\Controllers\\UserController@show");
  });

  async function render(
    overrides: Partial<Parameters<typeof ArtisanRoutesPanel>[0]> = {},
  ) {
    await act(async () => {
      root.render(
        <ArtisanRoutesPanel
          error={overrides.error ?? null}
          loading={overrides.loading ?? false}
          onChangeQuery={overrides.onChangeQuery ?? vi.fn()}
          onOpenController={overrides.onOpenController ?? vi.fn()}
          onRefresh={overrides.onRefresh ?? vi.fn()}
          query={overrides.query ?? ""}
          routes={overrides.routes ?? routes()}
          total={overrides.total ?? 2}
          unavailable={overrides.unavailable ?? null}
        />,
      );
      await Promise.resolve();
    });
  }
});

function routes(): ArtisanRoute[] {
  return [
    {
      methods: ["GET", "HEAD"],
      uri: "users/{user}",
      name: "users.show",
      action: "App\\Http\\Controllers\\UserController@show",
    },
    {
      methods: ["POST"],
      uri: "login",
      name: "login",
      action: "Closure",
    },
  ];
}
