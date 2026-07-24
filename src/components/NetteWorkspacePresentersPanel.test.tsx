// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetteWorkspacePresentersPanelModel } from "../application/netteWorkspacePresentersPanelModel";
import { NetteWorkspacePresentersPanel } from "./NetteWorkspacePresentersPanel";

describe("NetteWorkspacePresentersPanel", () => {
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

  it("renders a collapsed accessible presenter treegrid with metadata", async () => {
    await render();
    const tree = host.querySelector('[role="treegrid"]')!;
    expect(tree.getAttribute("aria-label")).toBe("Nette presenters");
    expect(tree.getAttribute("aria-rowcount")).toBe("1");
    expect(host.querySelector('[role="row"]')?.getAttribute("aria-level")).toBe("1");
    expect(host.textContent).toContain("App\\UI\\Home\\HomePresenter");
    expect(host.querySelector('[aria-label="Presenters total"]')?.textContent).toBe("1");
  });

  it("expands presenter actions, signals and template children", async () => {
    await render();
    act(() => button("Expand Home").click());
    expect(host.querySelectorAll('[role="row"]')).toHaveLength(3);
    expect(host.textContent).toContain("detail");
    expect(host.textContent).toContain("refresh!");

    act(() => button("Expand detail").click());
    expect(host.querySelectorAll('[role="row"]')).toHaveLength(4);
    expect(host.textContent).toContain("detail.latte");
    expect(host.querySelectorAll('[role="row"]')[2]?.getAttribute("aria-level")).toBe("3");
  });

  it("routes presenter, action, render, signal and template actions independently", async () => {
    const onOpenMethod = vi.fn(async () => true);
    const onOpenPresenter = vi.fn(async () => true);
    const onOpenTemplate = vi.fn(async () => true);
    await render({ onOpenMethod, onOpenPresenter, onOpenTemplate });
    await act(async () => button("Open presenter Home").click());
    act(() => button("Expand Home").click());
    await act(async () => button("Open action method detail").click());
    await act(async () => button("Open render method detail").click());
    await act(async () => button("Open signal handler refresh").click());
    act(() => button("Expand detail").click());
    await act(async () => button("Open template app/UI/Home/detail.latte").click());

    expect(onOpenPresenter).toHaveBeenCalledOnce();
    expect(onOpenMethod).toHaveBeenCalledTimes(3);
    expect(onOpenMethod).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ methodName: "actionDetail" }),
    );
    expect(onOpenMethod).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ methodName: "renderDetail" }),
    );
    expect(onOpenMethod).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ methodName: "handleRefresh" }),
    );
    expect(onOpenTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "app/UI/Home/detail.latte" }),
    );
  });

  it("supports treegrid Arrow, Home, End, Enter and Space semantics", async () => {
    const onOpenMethod = vi.fn(async () => true);
    const onOpenPresenter = vi.fn(async () => true);
    await render({ onOpenMethod, onOpenPresenter });
    const tree = host.querySelector<HTMLElement>('[role="treegrid"]')!;
    tree.focus();

    act(() => key(tree, "ArrowRight"));
    expect(host.querySelectorAll('[role="row"]')).toHaveLength(3);
    act(() => key(tree, "ArrowRight"));
    expect(selectedRow().textContent).toContain("detail");
    await act(async () => key(tree, "Enter"));
    expect(onOpenMethod).toHaveBeenCalledWith(
      expect.objectContaining({ methodName: "renderDetail" }),
    );
    act(() => key(tree, "End"));
    expect(selectedRow().textContent).toContain("refresh!");
    act(() => key(tree, "Home"));
    expect(selectedRow().textContent).toContain("Home");
    act(() => key(tree, " "));
    expect(host.querySelectorAll('[role="row"]')).toHaveLength(1);
    await act(async () => key(tree, "Enter"));
    expect(onOpenPresenter).toHaveBeenCalledOnce();
  });

  it("auto-expands filtered matches and forwards query and refresh", async () => {
    const onQueryChange = vi.fn();
    const onRefresh = vi.fn(async () => true);
    await render({ onQueryChange, onRefresh, query: "detail" });
    expect(host.querySelectorAll('[role="row"]')).toHaveLength(4);
    await act(async () => button("Refresh Nette presenters").click());
    const input = host.querySelector<HTMLInputElement>('[aria-label="Filter Nette presenters"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "home",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onQueryChange).toHaveBeenCalledWith("home");
  });

  it("announces unavailable, error, empty, truncated and busy states", async () => {
    await render({
      presenters: { status: "unavailable", message: "presenters unavailable" },
      filteredPresenters: [],
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("presenters unavailable");
    await render({ error: "inspection failed", filteredPresenters: [] });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("inspection failed");
    await render({ presenters: { ...presenters, truncated: true } });
    expect(host.textContent).toContain("Results were truncated");
    await render({
      busy: true,
      presenters: { status: "unavailable", message: "waiting" },
      filteredPresenters: [],
    });
    expect(host.textContent).toContain("Inspecting Nette presenters");
    expect(button("Refresh Nette presenters").disabled).toBe(true);
    await render({
      presenters: { ...presenters, presenters: [], total: 0 },
      filteredPresenters: [],
    });
    expect(host.textContent).toContain("No Nette presenters found");
  });

  async function render(
    overrides: Partial<NetteWorkspacePresentersPanelModel> = {},
  ): Promise<void> {
    await act(async () => {
      root.render(<NetteWorkspacePresentersPanel {...model(overrides)} />);
    });
  }

  function button(label: string): HTMLButtonElement {
    const candidate = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (element) => element.getAttribute("aria-label") === label,
    );
    if (!candidate) throw new Error(`Missing button: ${label}`);
    return candidate;
  }

  function selectedRow(): HTMLElement {
    return host.querySelector<HTMLElement>('[role="row"][aria-selected="true"]')!;
  }
});

const presenterPath = "/workspace/app/UI/Home/HomePresenter.php";
const presenter = {
  actions: [
    {
      actionMethod: { methodName: "actionDetail", source: location(presenterPath, 8, 21) },
      key: "home-action-detail",
      name: "detail",
      renderMethod: { methodName: "renderDetail", source: location(presenterPath, 12, 21) },
      templates: [{ path: "app/UI/Home/detail.latte", lineNumber: 1 as const, column: 1 as const }],
      templatesTruncated: false,
    },
  ],
  actionsTruncated: false,
  className: "App\\UI\\Home\\HomePresenter",
  key: "home-presenter",
  name: "Home",
  signals: [
    {
      key: "home-signal-refresh",
      method: { methodName: "handleRefresh", source: location(presenterPath, 18, 21) },
      name: "refresh",
    },
  ],
  signalsTruncated: false,
  source: location(presenterPath, 4, 7),
};
const presenters = {
  status: "ok" as const,
  presenters: [presenter],
  total: 1,
  truncated: false,
};
const matches = [{ actions: presenter.actions, presenter, signals: presenter.signals }];

function model(
  overrides: Partial<NetteWorkspacePresentersPanelModel>,
): NetteWorkspacePresentersPanelModel {
  return {
    busy: false,
    error: null,
    filteredPresenters: matches,
    onOpenMethod: vi.fn(async () => true),
    onOpenPresenter: vi.fn(async () => true),
    onOpenTemplate: vi.fn(async () => true),
    onQueryChange: vi.fn(),
    onRefresh: vi.fn(async () => true),
    presenters,
    query: "",
    ...overrides,
  };
}

function location(path: string, lineNumber: number, column: number) {
  return { path, lineNumber, column };
}

function key(target: HTMLElement, keyName: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: keyName }));
}
