// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Breakpoint } from "../domain/debug";
import { createDebugConsoleState } from "../domain/debugConsoleState";
import { breakpointGroupCollapseStorageKey } from "../application/useBreakpointGroupCollapseState";
import { DebugPanel, type DebugPanelProps } from "./DebugPanel";

function breakpoint(id: string, filePath: string, lineNumber: number): Breakpoint {
  return { enabled: true, filePath, id, lineNumber };
}

function defaultProps(): DebugPanelProps {
  return {
    breakpointBulkMutationPending: false,
    breakpointCounts: { disabled: 0, enabled: 0 },
    breakpoints: [],
    console: {
      clear: vi.fn(),
      state: createDebugConsoleState({ pauseGeneration: 1, sessionId: 1 }),
      submit: vi.fn(),
    },
    debugAdapterKind: "node",
    exceptionPauseError: null,
    exceptionPauseMode: "none",
    exceptionPausePending: false,
    exceptionTypeFilter: [],
    hasJavaScriptTypeScriptWorkspace: true,
    lastStartError: null,
    onDisableAllBreakpoints: vi.fn(),
    onDisconnect: vi.fn(),
    onEnableAllBreakpoints: vi.fn(),
    onLoadVariables: vi.fn(),
    onNavigateToBreakpoint: vi.fn(),
    onNavigateToFrame: vi.fn(),
    onPause: vi.fn(),
    onRemoveAllBreakpoints: vi.fn(),
    onRemoveBreakpoint: vi.fn(),
    onSelectFrame: vi.fn(),
    onSetBreakpointCondition: vi.fn(),
    onSetBreakpointEnabled: vi.fn(),
    onSetBreakpointHitCondition: vi.fn(),
    onSetBreakpointLogMessage: vi.fn(),
    onSetExceptionPauseMode: vi.fn(),
    onSetExceptionTypeFilter: vi.fn(),
    onStep: vi.fn(),
    onStop: vi.fn(),
    rootPath: "/workspace",
    scopeLoadState: { kind: "inactive" },
    scopes: [],
    selectedFrameId: null,
    snapshot: { lastSeq: 0, state: { kind: "inactive" } },
    variablesByReference: {},
    watches: {
      definitions: [],
      evaluations: {},
      onAdd: vi.fn(),
      onClear: vi.fn(),
      onRemove: vi.fn(),
      onSetEnabled: vi.fn(),
      onUpdate: vi.fn(),
      pendingIds: [],
    },
    workspaceTrusted: true,
  };
}

describe("DebugPanel breakpoint file groups", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(overrides: Partial<DebugPanelProps>) {
    const props = { ...defaultProps(), ...overrides };
    act(() => root.render(<DebugPanel {...props} />));
    return props;
  }

  function header(name: string): HTMLButtonElement {
    const match = [...host.querySelectorAll<HTMLButtonElement>("[data-breakpoint-group]")].find(
      (element) => element.textContent?.includes(name),
    );
    expect(match, `Missing breakpoint group ${name}`).toBeDefined();
    return match as HTMLButtonElement;
  }

  it("renders one accessible file section per file with counts and duplicate-name paths", () => {
    render({
      breakpoints: [
        breakpoint("api-1", "/workspace/packages/api/src/index.ts", 2),
        breakpoint("api-2", "/workspace/packages/api/src/index.ts", 1),
        breakpoint("web-1", "/workspace/packages/web/src/index.ts", 3),
      ],
    });

    const headers = host.querySelectorAll<HTMLButtonElement>("[data-breakpoint-group]");
    expect(headers).toHaveLength(2);
    expect(headers[0]?.textContent).toContain("index.ts");
    expect(headers[0]?.textContent).toContain("packages/api/src/index.ts");
    expect(headers[0]?.getAttribute("aria-label")).toContain("2 breakpoints");
    expect(headers[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(headers[1]?.textContent).toContain("packages/web/src/index.ts");
    expect(headers[1]?.getAttribute("aria-label")).toContain("1 breakpoint");
  });

  it("removes collapsed breakpoint rows before windowing and restores them on expand", () => {
    render({
      breakpoints: [
        breakpoint("a-1", "/workspace/a.ts", 1),
        breakpoint("a-2", "/workspace/a.ts", 2),
        breakpoint("b-1", "/workspace/b.ts", 1),
      ],
    });

    act(() => header("a.ts").click());
    expect(host.querySelectorAll("[data-testid=debug-breakpoint]")).toHaveLength(1);
    expect(header("a.ts").getAttribute("aria-expanded")).toBe("false");

    act(() => header("a.ts").click());
    expect(host.querySelectorAll("[data-testid=debug-breakpoint]")).toHaveLength(3);
  });

  it("collapses loose-file groups without a workspace root and does not persist them", () => {
    render({
      breakpoints: [breakpoint("loose-1", "/loose/a.ts", 1)],
      rootPath: null,
    });

    act(() => header("a.ts").click());

    expect(header("a.ts").getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelectorAll("[data-testid=debug-breakpoint]")).toHaveLength(0);
    expect(window.localStorage.length).toBe(0);
  });

  it("does not retain pending collapse focus after a non-applying toggle", () => {
    const looseBreakpoint = breakpoint("loose-1", "", 1);
    const editor = document.createElement("textarea");
    document.body.append(editor);
    render({ breakpoints: [looseBreakpoint], rootPath: null });
    const location = host.querySelector<HTMLButtonElement>(
      "[data-testid=debug-breakpoint-location]",
    );
    const groupHeader = host.querySelector<HTMLButtonElement>("[data-breakpoint-group]");
    expect(location).not.toBeNull();
    expect(groupHeader).not.toBeNull();

    act(() => location?.focus());
    act(() => groupHeader?.click());
    act(() => editor.focus());
    render({
      breakpoints: [{ ...looseBreakpoint, verified: false }],
      rootPath: null,
    });

    expect(document.activeElement).toBe(editor);
    editor.remove();
  });

  it("keeps virtualization active with many grouped breakpoints", () => {
    render({
      breakpoints: Array.from({ length: 2_000 }, (_value, index) =>
        breakpoint(
          `bp-${index}`,
          `/workspace/packages/package-${String(index % 100).padStart(3, "0")}/index.ts`,
          index + 1,
        ),
      ),
    });

    expect(host.querySelectorAll("[data-breakpoint-group]").length).toBeLessThan(100);
    expect(host.querySelectorAll("[data-testid=debug-breakpoint]").length).toBeLessThan(100);
    expect(host.textContent).not.toContain("package-099/index.ts:2000");
  });

  it("keeps breakpoint actions and unverified state working inside a group", () => {
    const item = {
      ...breakpoint("a-1", "/workspace/a.ts", 1),
      verified: false,
    };
    const props = render({ breakpoints: [item] });
    const row = host.querySelector<HTMLElement>("[data-testid=debug-breakpoint]");
    expect(row).not.toBeNull();

    expect(row?.textContent).toContain("unverified");
    act(() => row?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    expect(props.onSetBreakpointEnabled).toHaveBeenCalledWith("a-1", false);
    act(() =>
      row?.querySelector<HTMLButtonElement>("[data-testid=debug-breakpoint-location]")?.click(),
    );
    expect(props.onNavigateToBreakpoint).toHaveBeenCalledWith(item);
    act(() =>
      row?.querySelector<HTMLButtonElement>('button[aria-label="Remove breakpoint"]')?.click(),
    );
    expect(props.onRemoveBreakpoint).toHaveBeenCalledWith("a-1");
  });

  it("reports visible breakpoint positions and exposes group headers as list items", () => {
    render({
      breakpoints: [
        breakpoint("a-1", "/workspace/a.ts", 1),
        breakpoint("a-2", "/workspace/a.ts", 2),
        breakpoint("b-1", "/workspace/b.ts", 1),
      ],
    });

    expect(header("a.ts").closest('[role="listitem"]')).not.toBeNull();
    act(() => header("a.ts").click());
    const survivor = host.querySelector<HTMLElement>("[data-breakpoint-id=b-1]");
    expect(survivor?.getAttribute("aria-posinset")).toBe("1");
    expect(survivor?.getAttribute("aria-setsize")).toBe("1");
  });

  it("moves keyboard focus coherently through group headers and breakpoint rows", () => {
    render({
      breakpoints: [
        breakpoint("a-1", "/workspace/a.ts", 1),
        breakpoint("a-2", "/workspace/a.ts", 2),
        breakpoint("b-1", "/workspace/b.ts", 1),
      ],
    });

    const aHeader = header("a.ts");
    act(() => aHeader.focus());
    act(() =>
      aHeader.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" })),
    );
    expect(document.activeElement?.getAttribute("data-breakpoint-row-key")).toBe("breakpoint:a-1");
    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "End" }),
      ),
    );
    expect(document.activeElement?.textContent).toContain("b.ts:1");
    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }),
      ),
    );
    expect(document.activeElement?.textContent).toContain("b.ts");
    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: " " }),
      ),
    );
    expect(header("b.ts").getAttribute("aria-expanded")).toBe("false");
    act(() =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      ),
    );
    expect(header("b.ts").getAttribute("aria-expanded")).toBe("true");
  });

  it("moves focus to the retained header when a focused group row is collapsed", () => {
    render({
      breakpoints: [
        breakpoint("a-1", "/workspace/a.ts", 1),
        breakpoint("a-2", "/workspace/a.ts", 2),
      ],
    });

    const location = host.querySelector<HTMLButtonElement>(
      "[data-testid=debug-breakpoint-location]",
    );
    expect(location).not.toBeNull();
    act(() => location?.focus());
    act(() => header("a.ts").click());

    expect(document.activeElement).toBe(header("a.ts"));
    expect(host.querySelectorAll("[data-testid=debug-breakpoint]")).toHaveLength(0);
  });

  it("keeps a rendered collapsed group header in the tab order after scrolling", async () => {
    const breakpoints = Array.from({ length: 60 }, (_value, index) =>
      breakpoint(`bp-${index}`, `/workspace/file-${String(index).padStart(2, "0")}.ts`, index + 1),
    );
    window.localStorage.setItem(
      breakpointGroupCollapseStorageKey("/workspace"),
      JSON.stringify(breakpoints.map(({ filePath }) => filePath)),
    );
    render({ breakpoints });

    const list = host.querySelector<HTMLElement>('[role="list"][aria-label="Source breakpoints"]');
    expect(list).not.toBeNull();
    await act(async () => {
      if (list) {
        list.scrollTop = 1_000;
        list.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
      await nextAnimationFrame();
    });

    const renderedHeaders = [
      ...host.querySelectorAll<HTMLButtonElement>("[data-breakpoint-group]"),
    ];
    expect(renderedHeaders.length).toBeGreaterThan(0);
    expect(renderedHeaders.some(({ tabIndex }) => tabIndex === 0)).toBe(true);
  });

  it("loads persisted collapse state for only the active workspace root", () => {
    window.localStorage.setItem(
      breakpointGroupCollapseStorageKey("/workspace-a"),
      '["/workspace-a/a.ts"]',
    );
    render({
      breakpoints: [breakpoint("a", "/workspace-a/a.ts", 1)],
      rootPath: "/workspace-a",
    });
    expect(host.querySelectorAll("[data-testid=debug-breakpoint]")).toHaveLength(0);

    render({
      breakpoints: [breakpoint("b", "/workspace-b/b.ts", 1)],
      rootPath: "/workspace-b",
    });
    expect(host.querySelectorAll("[data-testid=debug-breakpoint]")).toHaveLength(1);

    render({
      breakpoints: [breakpoint("a", "/workspace-a/a.ts", 1)],
      rootPath: "/workspace-a/",
    });
    expect(host.querySelectorAll("[data-testid=debug-breakpoint]")).toHaveLength(0);
  });
});

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
