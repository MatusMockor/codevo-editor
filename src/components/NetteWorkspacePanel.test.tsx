// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetteWorkspacePanelModel } from "../application/netteWorkspacePanelModel";
import { NetteWorkspacePanel } from "./NetteWorkspacePanel";

describe("NetteWorkspacePanel", () => {
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

  it("renders an accessible searchable services grid with metadata", async () => {
    await render();

    expect(host.querySelector("section")?.getAttribute("aria-label")).toBe("Nette workspace");
    expect(host.querySelector('[role="grid"]')?.getAttribute("aria-label")).toBe("Nette services");
    expect(host.querySelectorAll('[role="row"]')).toHaveLength(2);
    expect(host.textContent).toContain("App\\Clock");
    expect(host.textContent).toContain("alias: LegacyClock");
    expect(host.textContent).toContain("clock.neon:3");
    expect(host.querySelector('[aria-label="Services total"]')?.textContent).toBe("2");
  });

  it("routes query, refresh, definition, and PHP class actions independently", async () => {
    const onOpenClass = vi.fn(async () => true);
    const onOpenDefinition = vi.fn(async () => true);
    const onQueryChange = vi.fn();
    const onRefresh = vi.fn(async () => true);
    await render({ onOpenClass, onOpenDefinition, onQueryChange, onRefresh });

    await act(async () => button("Open definition for clock").click());
    await act(async () => button("Open PHP class for clock").click());
    await act(async () => button("Refresh Nette workspace services").click());
    const input = host.querySelector<HTMLInputElement>('[aria-label="Filter Nette services"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "mail",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onOpenDefinition).toHaveBeenCalledWith(expect.objectContaining({ id: "clock" }));
    expect(onOpenClass).toHaveBeenCalledWith(expect.objectContaining({ id: "clock" }));
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onQueryChange).toHaveBeenCalledWith("mail");
    expect(button("Open PHP class for mailer").disabled).toBe(true);
  });

  it("supports Arrow, Home, End, and Enter keyboard navigation", async () => {
    const onOpenDefinition = vi.fn(async () => true);
    await render({ onOpenDefinition });
    const input = host.querySelector<HTMLInputElement>('[aria-label="Filter Nette services"]')!;

    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" })));
    expect(host.querySelectorAll('[aria-selected="true"]')[0]?.textContent).toContain("mailer");
    await act(async () =>
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })),
    );
    expect(onOpenDefinition).toHaveBeenLastCalledWith(expect.objectContaining({ id: "mailer" }));

    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" })));
    act(() =>
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })),
    );
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" })));
    expect(host.querySelectorAll('[aria-selected="true"]')[0]?.textContent).toContain("clock");
  });

  it("announces unavailable, error, empty, truncated, and busy states", async () => {
    await render({
      services: { status: "unavailable", message: "Nette unavailable" },
      filteredServices: [],
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Nette unavailable");

    await render({ error: "inspection failed", filteredServices: [] });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("inspection failed");

    await render({
      services: { ...services, services: [], truncated: true },
      filteredServices: [],
    });
    expect(host.textContent).toContain("Results were truncated");

    await render({
      busy: true,
      services: { status: "unavailable", message: "waiting" },
      filteredServices: [],
    });
    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
    expect(host.textContent).toContain("Inspecting Nette services");
    expect(button("Refresh Nette workspace services").disabled).toBe(true);

    await render({ services: { ...services, services: [], total: 0 }, filteredServices: [] });
    expect(host.textContent).toContain("No Nette services found");
  });

  async function render(overrides: Partial<NetteWorkspacePanelModel> = {}): Promise<void> {
    await act(async () => {
      root.render(<NetteWorkspacePanel {...model(overrides)} />);
    });
  }

  function button(label: string): HTMLButtonElement {
    const candidate = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) => element.getAttribute("aria-label") === label,
    );
    if (!candidate) throw new Error(`Missing button: ${label}`);
    return candidate;
  }
});

const serviceList = [
  {
    alias: "LegacyClock",
    autowired: true,
    className: "App\\Clock",
    id: "clock",
    key: "clock-key",
    source: { column: 5, lineNumber: 3, path: "app/config/clock.neon" },
  },
  {
    alias: null,
    autowired: ["App\\MailSender"],
    className: null,
    id: "mailer",
    key: "mailer-key",
    source: { column: 5, lineNumber: 8, path: "app/config/services.neon" },
  },
] as const;
const services = {
  status: "ok" as const,
  services: serviceList,
  total: 2,
  truncated: false,
};

function model(overrides: Partial<NetteWorkspacePanelModel>): NetteWorkspacePanelModel {
  return {
    busy: false,
    error: null,
    filteredServices: serviceList,
    onOpenClass: vi.fn(async () => true),
    onOpenDefinition: vi.fn(async () => true),
    onQueryChange: vi.fn(),
    onRefresh: vi.fn(async () => true),
    query: "",
    services,
    ...overrides,
  };
}
