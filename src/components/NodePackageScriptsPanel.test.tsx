// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodePackageScript } from "../domain/nodePackageScripts";
import type { NodePackageTaskState } from "../application/nodePackageTaskLifecycle";
import {
  NODE_PACKAGE_GROUP_DOM_PAGE_SIZE,
  NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE,
  NodePackageScriptsPanel,
  type NodePackageScriptsPanelProps,
} from "./NodePackageScriptsPanel";

describe("NodePackageScriptsPanel", () => {
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

  it("keeps manifest groups collapsed and lazily omits even very large script collections", async () => {
    const scripts = Array.from({ length: 20_000 }, (_, index) =>
      script("package.json", "", `script-${index}`),
    );
    await render({ scripts, total: scripts.length });

    expect(treeItems()).toHaveLength(1);
    expect(treeItems()[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("script-19999");
    expect(host.querySelector('[role="group"]')).toBeNull();
  });

  it("caps mounted script rows while paging through a 20k expanded group", async () => {
    const scripts = Array.from({ length: 20_000 }, (_, index) =>
      script("package.json", "", `script-${index.toString().padStart(5, "0")}`),
    );
    await render({ scripts, total: scripts.length });
    await clickGroup("Workspace root");

    expect(treeItems()).toHaveLength(NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE + 1);
    expect(host.querySelectorAll("*").length).toBeLessThan(2_500);
    expect(host.textContent).not.toContain("script-19999");
    await act(async () =>
      host
        .querySelector<HTMLElement>(
          '[aria-label="Pages of scripts in Workspace root"] button:last-child',
        )
        ?.click(),
    );
    expect(treeItems()).toHaveLength(NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE + 1);
    expect(host.textContent).toContain("script-00200");
  });

  it("clamps a stale script page after refreshed results shrink", async () => {
    const scripts = Array.from({ length: 500 }, (_, index) =>
      script("package.json", "", `script-${index.toString().padStart(3, "0")}`),
    );
    await render({ scripts, total: scripts.length });
    await clickGroup("Workspace root");
    await clickPagination("Pages of scripts in Workspace root", "Next");
    expect(host.textContent).toContain("script-200");

    await render({ scripts: [scripts[0]!], total: 1 });
    expect(host.textContent).toContain("script-000");
    expect(treeItems()).toHaveLength(2);
  });

  it("reveals an active task across bounded pages and keeps a detached task stoppable", async () => {
    const scripts = Array.from({ length: 500 }, (_, index) =>
      script("package.json", "", `script-${index.toString().padStart(3, "0")}`),
    );
    const activeTask: NodePackageTaskState = {
      ...runningTask,
      scriptName: "script-450",
    };
    await render({ scripts, task: activeTask, total: scripts.length });
    expect(host.querySelector('[aria-current="true"]')?.textContent).toContain("script-450");
    expect(button("Stop script-450").disabled).toBe(false);
    expect(treeItems().length).toBeLessThanOrEqual(NODE_PACKAGE_SCRIPT_DOM_PAGE_SIZE + 1);

    const onStop = vi.fn();
    await render({ onStop, scripts: [], task: activeTask, total: 0, truncated: true });
    expect(host.textContent).toContain("package.json · script-450");
    await click("Stop active package script");
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("caps mounted collapsed groups while paging through 2k manifests", async () => {
    const scripts = Array.from({ length: 2_000 }, (_, index) => {
      const root = `packages/${index.toString().padStart(4, "0")}`;
      return script(`${root}/package.json`, root, "test", `package-${index}`);
    });
    await render({ scripts, total: scripts.length });

    expect(treeItems()).toHaveLength(NODE_PACKAGE_GROUP_DOM_PAGE_SIZE);
    expect(host.querySelectorAll("*").length).toBeLessThan(1_000);
    expect(host.textContent).not.toContain("package-1999");
    await act(async () =>
      host
        .querySelector<HTMLElement>('[aria-label="Pages of package groups"] button:last-child')
        ?.click(),
    );
    expect(treeItems()).toHaveLength(NODE_PACKAGE_GROUP_DOM_PAGE_SIZE);
    expect(host.textContent).toContain("package-100");
  });

  it("renders root and nested package groups and only mounts an expanded group's scripts", async () => {
    await render();

    expect(treeItems().map((item) => item.getAttribute("aria-level"))).toEqual(["1", "1"]);
    await clickGroup("root");
    expect(treeItems().map((item) => item.getAttribute("aria-level"))).toEqual(["1", "2", "1"]);
    expect(host.textContent).toContain("test");
    expect(host.textContent).not.toContain("build");
  });

  it("supports tree navigation and opens the selected script with Enter or Space", async () => {
    const onOpen = vi.fn();
    const onRun = vi.fn();
    await render({ onOpen, onRun });
    const tree = getTree();

    await key(tree, "ArrowRight");
    expect(selectedItem().textContent).toContain("root");
    await key(tree, "ArrowRight");
    expect(selectedItem().textContent).toContain("test");
    await key(tree, " ");
    await key(tree, "Enter");
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ scriptName: "test" }));
    expect(onRun).not.toHaveBeenCalled();

    await key(tree, "End");
    expect(selectedItem().textContent).toContain("web");
    await key(tree, "Enter");
    expect(selectedItem().getAttribute("aria-expanded")).toBe("true");
    await key(tree, "ArrowRight");
    expect(selectedItem().textContent).toContain("build");
    await key(tree, "ArrowLeft");
    expect(selectedItem().textContent).toContain("web");
    await key(tree, "Home");
    expect(selectedItem().textContent).toContain("root");
  });

  it("does not let Run button keyboard events trigger the selected tree item", async () => {
    const onOpen = vi.fn();
    const onRun = vi.fn();
    await render({ onOpen, onRun });
    await clickGroup("root");
    const runButton = button("Run test");
    runButton.focus();
    await key(runButton, "Enter");
    await key(runButton, " ");
    expect(treeItems()[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(onOpen).not.toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
    await click("Run test");
    expect(onOpen).not.toHaveBeenCalled();
    expect(onRun).toHaveBeenCalledOnce();
  });

  it("opens a script row on a single click without implicitly running it", async () => {
    const onOpen = vi.fn();
    const onRun = vi.fn();
    await render({ onOpen, onRun });
    await clickGroup("root");

    await clickTreeItem("test");

    expect(onOpen).toHaveBeenCalledWith(rootScript);
    expect(onRun).not.toHaveBeenCalled();
    expect(selectedItem().textContent).toContain("test");
  });

  it("refreshes, disables unavailable or pending runs, and exposes the active stop action", async () => {
    const onOpen = vi.fn();
    const onRefresh = vi.fn();
    const onRun = vi.fn();
    const onStop = vi.fn();
    await render({ available: false, onOpen, onRefresh, onRun });
    await click("Refresh Node package scripts");
    await clickGroup("root");
    expect(button("Run test").disabled).toBe(true);
    expect(host.textContent).toContain("execution is unavailable");
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onRun).not.toHaveBeenCalled();
    await clickTreeItem("test");
    expect(onOpen).toHaveBeenCalledWith(rootScript);

    await render({ onOpen, onStop, pending: true, task: runningTask });
    expect(host.querySelector('[aria-current="true"]')?.textContent).toContain("Running");
    expect(button("Stop test").disabled).toBe(false);
    await click("Stop test");
    expect(onStop).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
    await clickGroup("web");
    expect(button("Run build").disabled).toBe(true);
  });

  it("announces loading, error, empty, and truncated states", async () => {
    await render({ loading: true });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Loading");
    expect(button("Refresh Node package scripts").disabled).toBe(true);

    await render({ error: "Discovery failed", loading: false });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Discovery failed");

    await render({ error: null, scripts: [], total: 0 });
    expect(host.textContent).toContain("No package scripts found");

    await render({ scripts: [rootScript], total: 9, truncated: true });
    expect(host.textContent).toContain("Showing 1 of 9 package scripts");
  });

  async function render(overrides: Partial<NodePackageScriptsPanelProps> = {}) {
    const props: NodePackageScriptsPanelProps = {
      available: true,
      error: null,
      loading: false,
      onOpen: vi.fn(),
      onRefresh: vi.fn(),
      onRun: vi.fn(),
      onStop: vi.fn(),
      pending: false,
      scripts: [rootScript, nestedScript],
      task: null,
      total: 2,
      truncated: false,
      ...overrides,
    };
    await act(async () => root.render(<NodePackageScriptsPanel {...props} />));
  }

  async function clickGroup(label: string) {
    const item = treeItems().find((candidate) => candidate.textContent?.includes(label));
    const row = item?.firstElementChild as HTMLElement | null;
    if (!row) throw new Error(`Missing group ${label}`);
    await act(async () => row.click());
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  async function clickPagination(label: string, action: "Previous" | "Next") {
    const navigation = host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
    const target = Array.from(navigation?.querySelectorAll("button") ?? []).find(
      (candidate) => candidate.textContent === action,
    );
    if (!target) throw new Error(`Missing ${action} in ${label}`);
    await act(async () => target.click());
  }

  async function clickTreeItem(label: string) {
    const item = treeItems().find(
      (candidate) =>
        candidate.getAttribute("aria-level") === "2" && candidate.textContent?.includes(label),
    );
    if (!item) throw new Error(`Missing script ${label}`);
    await act(async () => item.click());
  }

  function button(label: string): HTMLButtonElement {
    const value = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!value) throw new Error(`Missing button ${label}`);
    return value;
  }

  function getTree(): HTMLUListElement {
    const value = host.querySelector<HTMLUListElement>('[role="tree"]');
    if (!value) throw new Error("Missing tree");
    return value;
  }

  function treeItems(): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  }

  function selectedItem(): HTMLElement {
    const value = host.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]');
    if (!value) throw new Error("Missing selected tree item");
    return value;
  }
});

async function key(target: HTMLElement, value: string) {
  await act(async () =>
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value })),
  );
}

const rootScript = script("package.json", "", "test", "root");
const nestedScript = script("apps/web/package.json", "apps/web", "build", "web");

const runningTask: NodePackageTaskState = {
  manifestRelativePath: "package.json",
  runId: "run-1",
  scriptName: "test",
  sessionId: 8,
  status: "running",
  workspaceId: "workspace-1",
};

function script(
  manifestRelativePath: string,
  packageRootRelativePath: string,
  scriptName: string,
  packageName: string | null = null,
): NodePackageScript {
  return {
    key: `${manifestRelativePath}:${scriptName}`,
    manifestRelativePath,
    packageManager: "npm",
    packageName,
    packageRootRelativePath,
    scriptName,
  };
}
