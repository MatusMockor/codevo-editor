// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseDebugConsoleResult } from "../application/useDebugConsole";
import type { DebugCopyValueCandidate } from "../application/debugCopyValue";
import {
  MAX_DEBUG_CONSOLE_ENTRIES,
  createDebugConsoleState,
  reduceDebugConsoleState,
  type DebugConsoleEntry,
  type DebugConsoleState,
} from "../domain/debugConsoleState";
import type { DebugInspectionOwner, DebugVariablePagesState } from "../domain/debugVariablePages";
import { createLatencyTracker, type LatencyClock } from "../domain/latencyTracker";
import { DebugConsolePanel } from "./DebugConsolePanel";
import type { DebugCopyDisplayedValueSurface } from "./debugCopyValueSurface";

const OWNER = { pauseGeneration: 1, sessionId: 7 };
const INSPECTION_OWNER: DebugInspectionOwner = {
  ...OWNER,
  frameId: 11,
  rootKey: "/workspace",
};
const RESULT_OWNER = {
  ...INSPECTION_OWNER,
  epoch: 1,
  workspaceOwnerKey: "workspace-owner",
};

describe("DebugConsolePanel virtualization", () => {
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

  it("mounts only the visible window of a thousand-entry log", () => {
    render(outputEntries(1_000));

    const mounted = host.querySelectorAll('[data-testid="debug-output-line"]');
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(100);
    expect(host.textContent).not.toContain("line-500");
    expect(spacer().style.height).toBe("18000px");
  });

  it("stays pinned to the bottom as new output and height corrections arrive", () => {
    const entries = outputEntries(100);
    render(entries);
    const body = consoleBody();
    body.scrollTop = 1_620;
    dispatchScroll(body);

    render([...entries, outputEntry(100, "line-100")]);
    expect(body.scrollTop).toBe(1_638);

    geometry.setOffsetHeight(36, "output-100");
    render([...entries, outputEntry(100, "line-100")]);
    expect(body.scrollTop).toBe(1_656);
  });

  it("does not move the scroll position when output arrives while scrolled up", () => {
    const entries = outputEntries(100);
    render(entries);
    const body = consoleBody();
    body.scrollTop = 360;
    dispatchScroll(body);

    render([...entries, outputEntry(100, "line-100")]);

    expect(body.scrollTop).toBe(360);
  });

  it("records entry growth once and ignores scroll-only updates", () => {
    const tracker = createLatencyTracker();
    let now = 0;
    const latencyClock = () => {
      now += 3;
      return now;
    };
    const entries = outputEntries(100);
    render(entries, { latencyClock, latencyTracker: tracker });
    expect(tracker.statsFor("debug-console-append")).toBeNull();

    render([...entries, outputEntry(100, "line-100")], {
      latencyClock,
      latencyTracker: tracker,
    });
    expect(tracker.statsFor("debug-console-append")).toMatchObject({
      count: 1,
      last: 3,
    });

    const body = consoleBody();
    body.scrollTop = 360;
    dispatchScroll(body);
    expect(tracker.statsFor("debug-console-append")?.count).toBe(1);

    render([...entries, outputEntry(100, "line-100")], {
      latencyClock,
      latencyTracker: tracker,
    });
    expect(tracker.statsFor("debug-console-append")?.count).toBe(1);

    const replacementTracker = createLatencyTracker();
    render([...entries, outputEntry(100, "line-100"), outputEntry(101, "line-101")], {
      latencyClock,
      latencyTracker: replacementTracker,
    });
    expect(tracker.statsFor("debug-console-append")?.count).toBe(1);
    expect(replacementTracker.statsFor("debug-console-append")?.count).toBe(1);
  });

  it("records an append after the bounded entry ring is saturated", () => {
    const tracker = createLatencyTracker();
    let now = 0;
    const latencyClock = () => {
      now += 3;
      return now;
    };
    let state = createDebugConsoleState(OWNER);
    for (let index = 0; index <= MAX_DEBUG_CONSOLE_ENTRIES; index += 1) {
      state = reduceDebugConsoleState(state, {
        owner: OWNER,
        stream: "stdout",
        text: `line-${index}`,
        type: "output",
      });
    }
    render(state.entries, { latencyClock, latencyTracker: tracker });

    state = reduceDebugConsoleState(state, {
      owner: OWNER,
      stream: "stdout",
      text: `line-${MAX_DEBUG_CONSOLE_ENTRIES + 1}`,
      type: "output",
    });
    render(state.entries, {
      latencyClock,
      latencyTracker: tracker,
    });

    expect(tracker.statsFor("debug-console-append")).toMatchObject({
      count: 1,
      last: 3,
    });

    render([truncatedEntry(3), ...state.entries.slice(1)], {
      latencyClock,
      latencyTracker: tracker,
    });
    expect(tracker.statsFor("debug-console-append")?.count).toBe(1);
  });

  it("records one committed append under StrictMode", () => {
    const tracker = createLatencyTracker();
    let now = 0;
    const latencyClock = () => {
      now += 3;
      return now;
    };
    const entries = outputEntries(100);
    renderStrict(entries, { latencyClock, latencyTracker: tracker });

    renderStrict([...entries, outputEntry(100, "line-100")], {
      latencyClock,
      latencyTracker: tracker,
    });

    expect(tracker.statsFor("debug-console-append")).toMatchObject({
      count: 1,
      last: 3,
    });
  });

  it("does not read the latency clock without a tracker", () => {
    const latencyClock = vi.fn(() => 0);

    render(outputEntries(100), { latencyClock });

    expect(latencyClock).not.toHaveBeenCalled();
  });

  it("preserves the visible row position when capped output evicts leading entries", () => {
    const entries = [truncatedEntry(1), ...outputEntries(999)];
    render(entries);
    const body = consoleBody();
    body.scrollTop = 360;
    dispatchScroll(body);
    const visibleRow = host.querySelector<HTMLElement>('[data-entry-id="output-19"]')!;
    const previousViewportOffset = rowOffsetTop(visibleRow) - body.scrollTop;

    render([truncatedEntry(3), ...outputEntries(999, 2)]);

    const preservedRow = host.querySelector<HTMLElement>('[data-entry-id="output-19"]')!;
    expect(body.scrollTop).toBe(324);
    expect(rowOffsetTop(preservedRow) - body.scrollTop).toBe(previousViewportOffset);
  });

  it("remains pinned to the bottom when capped output evicts leading entries", () => {
    const entries = [truncatedEntry(1), ...outputEntries(999)];
    render(entries);
    const body = consoleBody();
    body.scrollTop = 17_820;
    dispatchScroll(body);

    render([truncatedEntry(3), ...outputEntries(999, 2)]);

    expect(body.scrollTop).toBe(17_820);
  });

  it("windows expanded result-tree rows under the shared 500-row budget", () => {
    const variables = Array.from({ length: 501 }, (_value, index) => ({
      name: `child-${index}`,
      value: String(index),
      variablesReference: 0,
    }));
    render([resultEntry("result-1", 41)], {
      variablePages: variablePages(41, variables),
    });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand debug console result"]')?.click(),
    );

    expect(host.querySelectorAll('[data-testid="debug-console-variable"]').length).toBeLessThan(
      100,
    );
    expect(spacer().style.height).toBe(`${18 * 502}px`);

    const body = consoleBody();
    body.scrollTop = 8_900;
    dispatchScroll(body);
    expect(host.textContent).toContain("Display limit reached");
    expect(host.textContent).not.toContain("child-500:");
  });

  it("keeps the expanded tree wrapper mounted across window shifts", () => {
    const variables = Array.from({ length: 100 }, (_value, index) => ({
      name: `child-${index}`,
      value: String(index),
      variablesReference: 0,
    }));
    render([resultEntry("result-1", 41)], {
      variablePages: variablePages(41, variables),
    });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand debug console result"]')?.click(),
    );
    const tree = host.querySelector<HTMLElement>(
      '[role="tree"][aria-label="Debug console result variables"]',
    );
    const body = consoleBody();
    body.scrollTop = 360;
    dispatchScroll(body);

    expect(
      host.querySelector<HTMLElement>('[role="tree"][aria-label="Debug console result variables"]'),
    ).toBe(tree);
  });

  it("moves the roving focus to a virtualized End target without mounting the full tree", async () => {
    const variables = Array.from({ length: 100 }, (_value, index) => ({
      name: `child-${index}`,
      value: String(index),
      variablesReference: 0,
    }));
    render([resultEntry("result-1", 41)], {
      variablePages: variablePages(41, variables),
    });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand debug console result"]')?.click(),
    );
    const first = host.querySelector<HTMLElement>('[data-testid="debug-console-variable"]')!;

    await act(async () => {
      first.focus();
      first.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End" }),
      );
      geometry.flushAnimationFrames();
      await Promise.resolve();
    });

    const mounted = Array.from(
      host.querySelectorAll<HTMLElement>('[data-testid="debug-console-variable"]'),
    );
    expect(mounted.length).toBeLessThan(100);
    expect(mounted.filter((row) => row.tabIndex === 0)).toHaveLength(1);
    expect(document.activeElement?.textContent).toContain("child-99:");

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowLeft" }),
      );
      geometry.flushAnimationFrames();
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(
      host.querySelector<HTMLElement>('[data-entry-id="result-1"]'),
    );
  });

  it("uses unique stable segment keys when a focused tree row is pinned outside the window", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const variables = Array.from({ length: 100 }, (_value, index) => ({
      name: `child-${index}`,
      value: String(index),
      variablesReference: 0,
    }));
    render([resultEntry("result-1", 41)], {
      variablePages: variablePages(41, variables),
    });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand debug console result"]')?.click(),
    );
    const body = consoleBody();
    body.scrollTop = 0;
    dispatchScroll(body);
    const first = host.querySelector<HTMLElement>('[data-testid="debug-console-variable"]')!;
    expect(first.textContent).toContain("child-0:");
    act(() => first.focus());

    body.scrollTop = 1_200;
    dispatchScroll(body);

    expect(document.activeElement).toBe(
      Array.from(host.querySelectorAll<HTMLElement>('[data-testid="debug-console-variable"]')).find(
        (row) => row.textContent?.includes("child-0:"),
      ),
    );
    expect(host.textContent).toContain("child-70:");
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((value) => String(value).includes("same key")),
      ),
    ).toBe(false);

    body.scrollTop = 0;
    dispatchScroll(body);
    expect(document.activeElement).toBe(
      Array.from(host.querySelectorAll<HTMLElement>('[data-testid="debug-console-variable"]')).find(
        (row) => row.textContent?.includes("child-0:"),
      ),
    );
    consoleError.mockRestore();
  });

  it("restores the exact result root when the focused sole child is removed", async () => {
    const entries = [resultEntry("result-1", 41)];
    render(entries, {
      variablePages: variablePages(41, [{ name: "only-child", value: "1", variablesReference: 0 }]),
    });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Expand debug console result"]')?.click(),
    );
    const onlyChild = host.querySelector<HTMLElement>('[data-testid="debug-console-variable"]')!;
    act(() => onlyChild.focus());

    await act(async () => {
      render(entries, { variablePages: variablePages(41, []) });
      geometry.flushAnimationFrames();
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(
      host.querySelector<HTMLElement>('[data-entry-id="result-1"]'),
    );
  });

  it("keeps a focused result entry mounted for copy shortcuts outside the window", () => {
    const copy = displayedValueSurface();
    const resultEntryValue = resultEntry("result-1", 0);
    render([resultEntryValue], { copyDisplayedValueSurface: copy.surface });
    const result = host.querySelector<HTMLElement>('[data-entry-id="result-1"]')!;
    act(() => result.focus());
    render([resultEntryValue, ...outputEntries(999, 1)], {
      copyDisplayedValueSurface: copy.surface,
    });

    const body = consoleBody();
    body.scrollTop = 17_820;
    dispatchScroll(body);

    const pinnedResult = host.querySelector<HTMLElement>('[data-entry-id="result-1"]');
    expect(pinnedResult).not.toBeNull();
    act(() =>
      pinnedResult?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "c",
        }),
      ),
    );
    expect(copy.copyDisplayedValue).toHaveBeenCalledOnce();
  });

  it("estimates multiline entries by line count and corrects after measurement", () => {
    geometry.setOffsetHeight(72);
    render([outputEntry(0, "one\ntwo\nthree")]);

    expect(spacer().style.height).toBe("72px");
  });

  function render(
    entries: readonly DebugConsoleEntry[],
    overrides: {
      readonly copyDisplayedValueSurface?: DebugCopyDisplayedValueSurface;
      readonly latencyClock?: LatencyClock;
      readonly latencyTracker?: ReturnType<typeof createLatencyTracker>;
      readonly variablePages?: DebugVariablePagesState;
    } = {},
  ) {
    act(() => {
      root.render(
        <DebugConsolePanel
          console={consoleResult(entries)}
          copyDisplayedValueSurface={overrides.copyDisplayedValueSurface}
          enabled
          inspectionOwner={INSPECTION_OWNER}
          latencyClock={overrides.latencyClock}
          latencyTracker={overrides.latencyTracker}
          onLoadVariablePage={vi.fn()}
          variablePages={overrides.variablePages}
          workspaceOwnerKey="workspace-owner"
        />,
      );
      geometry.flushAnimationFrames();
    });
  }

  function renderStrict(
    entries: readonly DebugConsoleEntry[],
    overrides: {
      readonly latencyClock?: LatencyClock;
      readonly latencyTracker?: ReturnType<typeof createLatencyTracker>;
    } = {},
  ) {
    act(() => {
      root.render(
        <StrictMode>
          <DebugConsolePanel
            console={consoleResult(entries)}
            enabled
            inspectionOwner={INSPECTION_OWNER}
            latencyClock={overrides.latencyClock}
            latencyTracker={overrides.latencyTracker}
            onLoadVariablePage={vi.fn()}
            workspaceOwnerKey="workspace-owner"
          />
        </StrictMode>,
      );
      geometry.flushAnimationFrames();
    });
  }

  function consoleBody(): HTMLDivElement {
    return host.querySelector<HTMLDivElement>('[data-testid="debug-console-body"]')!;
  }

  function spacer(): HTMLDivElement {
    return host.querySelector<HTMLDivElement>('[data-testid="debug-console-spacer"]')!;
  }
});

function consoleResult(entries: readonly DebugConsoleEntry[]): UseDebugConsoleResult {
  const state: DebugConsoleState = {
    entries,
    history: [],
    nextSequence: entries.length + 1,
    owner: OWNER,
    pendingRequestIds: [],
    totalBytes: 0,
  };
  return {
    clear: vi.fn(),
    resultOwner: RESULT_OWNER,
    state,
    submit: vi.fn().mockResolvedValue(undefined),
  };
}

function outputEntries(count: number, start = 0): readonly DebugConsoleEntry[] {
  return Array.from({ length: count }, (_value, index) =>
    outputEntry(index + start, `line-${index + start}`),
  );
}

function outputEntry(index: number, text: string): DebugConsoleEntry {
  return {
    id: `output-${index}`,
    kind: "stdout",
    owner: OWNER,
    sequence: index + 1,
    text,
    truncated: false,
  };
}

function truncatedEntry(omittedEntries: number): DebugConsoleEntry {
  return {
    id: "console-truncated",
    kind: "truncated",
    omittedBytes: omittedEntries * 8,
    omittedEntries,
    owner: OWNER,
    sequence: omittedEntries,
  };
}

function rowOffsetTop(row: HTMLElement): number {
  let element = row.parentElement;
  let offsetTop = 0;

  while (element && element.dataset.testid !== "debug-console-spacer") {
    const transform = element.style.transform;

    if (transform.startsWith("translateY(")) {
      offsetTop += Number.parseFloat(transform.slice("translateY(".length));
    }

    element = element.parentElement;
  }

  return offsetTop;
}

function resultEntry(id: string, variablesReference: number): DebugConsoleEntry {
  return {
    id,
    kind: "result",
    owner: OWNER,
    requestId: `request-${id}`,
    resultOwner: RESULT_OWNER,
    sequence: 1,
    value: "Object",
    valueType: "object",
    variablesReference,
  };
}

function variablePages(
  variablesReference: number,
  variables: readonly {
    readonly name: string;
    readonly value: string;
    readonly variablesReference: number;
  }[],
): DebugVariablePagesState {
  return {
    owner: INSPECTION_OWNER,
    pendingCount: 0,
    references: {
      [variablesReference]: {
        errors: {},
        limit: null,
        pages: { 0: { nextStart: null, start: 0, variables } },
        pending: {},
      },
    },
    totalBytes: 0,
    totalVariables: variables.length,
  };
}

function displayedValueSurface() {
  let candidate: DebugCopyValueCandidate | null = null;
  const copyDisplayedValue = vi.fn(async () => candidate !== null);
  const surface: DebugCopyDisplayedValueSurface = {
    canCopyDisplayedValue: () => candidate !== null,
    canCopyEvaluatePath: () => candidate?.adapterEvaluateName !== undefined,
    copyDisplayedValue,
    copyDisplayedValueFromMenu: vi.fn(async () => candidate !== null),
    copyEvaluatePath: vi.fn(async () => candidate?.adapterEvaluateName !== undefined),
    copyEvaluatePathFromMenu: vi.fn(async () => candidate?.adapterEvaluateName !== undefined),
    epoch: 1,
    generation: 1,
    isOwnerCurrent: () => true,
    onCandidateChange: (next) => {
      candidate = next;
      return true;
    },
    source: "console",
    workspaceOwnerKey: "workspace-owner",
  };
  return { copyDisplayedValue, surface };
}

function dispatchScroll(body: HTMLElement) {
  act(() => {
    body.dispatchEvent(new Event("scroll", { bubbles: true }));
    geometryForCurrentTest?.flushAnimationFrames();
  });
}

let geometryForCurrentTest: ReturnType<typeof installGeometry> | null = null;

function installGeometry() {
  const descriptors = {
    cancelAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame"),
    clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
    clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
    requestAnimationFrame: Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame"),
    scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
  };
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextHandle = 1;
  let correctedEntryId: string | null = null;
  let offsetHeight = 18;
  Object.defineProperties(HTMLElement.prototype, {
    clientHeight: { configurable: true, get: () => 180 },
    clientWidth: { configurable: true, get: () => 600 },
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return !correctedEntryId || this.dataset.entryId === correctedEntryId ? offsetHeight : 18;
      },
    },
    scrollHeight: {
      configurable: true,
      get(this: HTMLElement) {
        const spacer = this.querySelector<HTMLElement>('[data-testid="debug-console-spacer"]');
        return spacer ? Number.parseFloat(spacer.style.height) : 0;
      },
    },
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
  const geometry = {
    flushAnimationFrames() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(0));
    },
    restore() {
      geometryForCurrentTest = null;
      for (const [property, descriptor] of Object.entries(descriptors)) {
        const target =
          property === "requestAnimationFrame" || property === "cancelAnimationFrame"
            ? globalThis
            : HTMLElement.prototype;
        if (descriptor) Object.defineProperty(target, property, descriptor);
        else Reflect.deleteProperty(target, property);
      }
    },
    setOffsetHeight(value: number, entryId: string | null = null) {
      correctedEntryId = entryId;
      offsetHeight = value;
    },
  };
  geometryForCurrentTest = geometry;
  return geometry;
}
